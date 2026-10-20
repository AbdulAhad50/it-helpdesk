import { ObjectId, type Db } from "mongodb";
import { ApiError } from "@/lib/api";
import { SYNC_MAX_ATTEMPTS } from "@/lib/complaint-service";
import { log } from "@/lib/logger";
import { readSheet, sheetsConfigFromEnv, SheetsError, type SheetRowRead, type SheetSnapshot } from "@/lib/google-sheets";
import { auditLogsCollection } from "@/models/AuditLog";
import { complaintsCollection } from "@/models/Complaint";
import { settingsCollection } from "@/models/Setting";
import { syncJobsCollection, type SyncJobDoc } from "@/models/SyncJob";

export interface ComplaintLite {
  complaintId: string;
  status: "Pending" | "Resolved";
  version: number;
}

export interface Findings {
  /** In MongoDB but no sheet row. */
  missing: string[];
  /** More than one sheet row carries the ID. Never auto-fixed. */
  duplicates: { complaintId: string; rows: number[] }[];
  /** In the sheet but not in MongoDB. Never auto-fixed. */
  orphans: { complaintId: string; rowNumber: number }[];
  /** Exactly one row, but its Status differs from MongoDB. */
  statusMismatches: { complaintId: string; sheetStatus: string; dbStatus: string; rowNumber: number }[];
  consistent: string[];
}

/** Pure comparison by exact Complaint ID. MongoDB is the truth; the sheet is checked against it. */
export function compareSheetToDatabase(rows: SheetRowRead[], complaints: ComplaintLite[]): Findings {
  const byId = new Map<string, SheetRowRead[]>();
  for (const r of rows) byId.set(r.complaintId, [...(byId.get(r.complaintId) ?? []), r]);

  const f: Findings = { missing: [], duplicates: [], orphans: [], statusMismatches: [], consistent: [] };
  const known = new Set<string>();
  for (const c of complaints) {
    known.add(c.complaintId);
    const found = byId.get(c.complaintId) ?? [];
    if (found.length === 0) f.missing.push(c.complaintId);
    else if (found.length > 1) f.duplicates.push({ complaintId: c.complaintId, rows: found.map((r) => r.rowNumber) });
    else if (found[0]!.status !== c.status) f.statusMismatches.push({ complaintId: c.complaintId, sheetStatus: found[0]!.status, dbStatus: c.status, rowNumber: found[0]!.rowNumber });
    else f.consistent.push(c.complaintId);
  }
  for (const r of rows) if (!known.has(r.complaintId)) f.orphans.push({ complaintId: r.complaintId, rowNumber: r.rowNumber });
  return f;
}

export interface ReconciliationSummary {
  ranAt: string;
  sheetRows: number;
  complaintsChecked: number;
  skippedInFlight: number;
  missing: number;
  duplicates: number;
  orphans: number;
  statusMismatches: number;
  unidentifiedRows: number;
  repairsQueued: number;
  consistent: number;
}

export interface ReconciliationReport extends ReconciliationSummary {
  /** Lists are capped so a badly broken sheet can't produce an enormous response. */
  missingIds: string[];
  duplicateRows: Findings["duplicates"];
  orphanRows: Findings["orphans"];
  statusMismatchRows: Findings["statusMismatches"];
  unidentifiedRowNumbers: number[];
  eventIds: string[];
}

const CAP = 200;
const MAX_REPAIRS = 200;

function toApiError(err: unknown): never {
  if (err instanceof SheetsError) {
    const status = err.code === "unavailable" ? 502 : err.code === "not_configured" ? 503 : 422;
    throw new ApiError(status, err.code === "not_configured" ? "NOT_CONFIGURED" : "SHEETS_ERROR", err.message);
  }
  throw err;
}

/**
 * Compare MongoDB with the sheet, flag problems on the complaints concerned, and (optionally) queue
 * repairs. Repairs only ever (a) re-append a MISSING row, or (b) re-send the current row to fix a
 * STATUS mismatch. Duplicate rows and orphan rows are reported, never changed: a person decides.
 * Complaints with a sync still in flight are skipped, since they would look "missing" by timing alone.
 */
export async function runReconciliation(
  db: Db,
  args: { adminId: string; correlationId: string; repair: boolean },
  deps: { readSheet?: () => Promise<SheetSnapshot>; now?: () => Date } = {},
): Promise<ReconciliationReport> {
  const now = deps.now?.() ?? new Date();
  let snapshot: SheetSnapshot;
  try {
    const cfg = sheetsConfigFromEnv();
    if (!deps.readSheet && !cfg) throw new SheetsError("not_configured", "Google Sheets read access isn't configured (GOOGLE_SHEETS_SPREADSHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY).");
    snapshot = await (deps.readSheet ? deps.readSheet() : readSheet(cfg!));
  } catch (err) {
    toApiError(err);
  }

  const complaints = complaintsCollection(db);
  const jobs = syncJobsCollection(db);
  const [all, inFlightIds, problemIds] = await Promise.all([
    complaints.find({}, { projection: { complaintId: 1, status: 1, version: 1, syncState: 1 } }).toArray(),
    jobs.distinct("complaintId", { status: { $in: ["pending", "processing"] } }),
    jobs.distinct("complaintId", { status: { $in: ["failed", "dead"] } }),
  ]);
  const inFlight = new Set(inFlightIds);
  const withProblemJobs = new Set(problemIds);
  const checked = all.filter((c) => !inFlight.has(c.complaintId));
  const findings = compareSheetToDatabase(snapshot.rows, checked);

  // Flag what's wrong; clear flags that are now resolved.
  const flag = async (ids: string[], message: string) => {
    if (ids.length) await complaints.updateMany({ complaintId: { $in: ids } }, { $set: { syncState: "needs_reconciliation", googleSheetSynced: false, syncError: message } });
  };
  await flag(findings.missing, "The sheet has no row for this complaint.");
  await flag(findings.duplicates.map((d) => d.complaintId), "More than one sheet row has this Complaint ID. Delete the extra row(s).");
  await flag(findings.statusMismatches.map((m) => m.complaintId), "The sheet's Status differs from the database.");
  const cleared = all.filter((c) => findings.consistent.includes(c.complaintId) && c.syncState === "needs_reconciliation" && !withProblemJobs.has(c.complaintId)).map((c) => c.complaintId);
  if (cleared.length) {
    await complaints.updateMany({ complaintId: { $in: cleared } }, { $set: { syncState: "synced", googleSheetSynced: true, googleSheetSyncedAt: now, syncError: null } });
  }

  // Optional, bounded repairs.
  const eventIds: string[] = [];
  if (args.repair) {
    const versions = new Map(all.map((c) => [c.complaintId, c.version]));
    const stamp = now.getTime();
    const plan: { id: string; type: SyncJobDoc["type"]; eventId: string }[] = [
      ...findings.missing.map((id) => ({ id, type: "complaint.created" as const, eventId: `complaint.created:${id}:reconcile:${stamp}` })),
      ...findings.statusMismatches.map((m) => ({ id: m.complaintId, type: "complaint.updated" as const, eventId: `complaint.updated:${m.complaintId}:${versions.get(m.complaintId)}:reconcile:${stamp}` })),
    ].slice(0, MAX_REPAIRS);

    for (const p of plan) {
      const job: SyncJobDoc = {
        _id: new ObjectId(), eventId: p.eventId, type: p.type, complaintId: p.id, status: "pending", attempts: 0,
        maxAttempts: SYNC_MAX_ATTEMPTS, nextAttemptAt: now, lockedUntil: null, lastError: null, createdAt: now, updatedAt: now, completedAt: null,
      };
      try {
        await jobs.insertOne(job);
        await auditLogsCollection(db).insertOne({ _id: new ObjectId(), complaintId: p.id, action: "sync.reconciled", actor: args.adminId, changes: [], correlationId: args.correlationId, createdAt: now });
        eventIds.push(p.eventId);
      } catch (err) {
        if ((err as { code?: number }).code !== 11000) throw err; // an identical repair is already queued
      }
    }
  }

  const summary: ReconciliationSummary = {
    ranAt: now.toISOString(),
    sheetRows: snapshot.rows.length,
    complaintsChecked: checked.length,
    skippedInFlight: all.length - checked.length,
    missing: findings.missing.length,
    duplicates: findings.duplicates.length,
    orphans: findings.orphans.length,
    statusMismatches: findings.statusMismatches.length,
    unidentifiedRows: snapshot.unidentifiedRows.length,
    repairsQueued: eventIds.length,
    consistent: findings.consistent.length,
  };
  await settingsCollection(db).updateOne(
    { _id: "last-reconciliation" as never },
    { $set: { ranAt: now, ranBy: args.adminId, result: summary } as never },
    { upsert: true },
  );
  log("info", "reconciliation.completed", { correlationId: args.correlationId, adminId: args.adminId, ...summary });

  return {
    ...summary,
    missingIds: findings.missing.slice(0, CAP),
    duplicateRows: findings.duplicates.slice(0, CAP),
    orphanRows: findings.orphans.slice(0, CAP),
    statusMismatchRows: findings.statusMismatches.slice(0, CAP),
    unidentifiedRowNumbers: snapshot.unidentifiedRows.slice(0, CAP),
    eventIds,
  };
}

export async function getLastReconciliation(db: Db): Promise<{ ranAt: Date; ranBy: string; result: ReconciliationSummary } | null> {
  const doc = (await db.collection("settings").findOne({ _id: "last-reconciliation" as never })) as { ranAt: Date; ranBy: string; result: ReconciliationSummary } | null;
  return doc ? { ranAt: doc.ranAt, ranBy: doc.ranBy, result: doc.result } : null;
}
