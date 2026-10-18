import { formatDate, formatDuration, formatTime } from "@/lib/time";
import type { ComplaintDoc } from "@/models/Complaint";
import type { SyncJobType } from "@/models/SyncJob";

/** The worksheet's columns, in this exact order. The n8n workflows map each of these explicitly. */
export const SHEET_COLUMNS = [
  "Complaint ID",
  "User Name",
  "Department",
  "Problem Category",
  "Problem Description",
  "Priority",
  "Received Date",
  "Received Time",
  "Solved Date",
  "Resolve Time",
  "Solve Duration",
  "Work Stuck Reason",
  "Status",
  "Resolution Notes",
  "Resolved By",
  "Last Updated",
] as const;

export type SheetColumn = (typeof SHEET_COLUMNS)[number];
export type SheetRow = Record<SheetColumn, string>;

const FORMULA_START = /^(\s*[=+\-@]|[\t\r])/;

/**
 * Defence against spreadsheet formula injection (OWASP): text that starts with = + - @ (or a tab/CR)
 * gets a leading apostrophe, so it stays inert text even if the sheet is later exported to CSV and
 * opened in Excel. n8n also writes with cellFormat RAW, so Google Sheets never evaluates it either.
 */
export function neutralizeCell(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

const text = (v: string | null | undefined) => neutralizeCell(v ?? "");

/** Dates are shown in Asia/Karachi; durations are human-readable. Unsolved fields are blank. */
export function toSheetRow(c: ComplaintDoc, resolvedByLabel: string | null = null): SheetRow {
  return {
    "Complaint ID": c.complaintId,
    "User Name": text(c.userName),
    Department: text(c.department),
    "Problem Category": text(c.problemCategory),
    "Problem Description": text(c.problemDescription),
    Priority: c.priority,
    "Received Date": formatDate(c.receivedAt),
    "Received Time": formatTime(c.receivedAt),
    "Solved Date": c.solvedAt ? formatDate(c.solvedAt) : "",
    "Resolve Time": c.solvedAt ? formatTime(c.solvedAt) : "",
    "Solve Duration": c.solveDurationMinutes === null ? "" : formatDuration(c.solveDurationMinutes),
    "Work Stuck Reason": text(c.workStuckReason),
    Status: c.status,
    "Resolution Notes": text(c.resolutionNotes),
    "Resolved By": text(resolvedByLabel),
    "Last Updated": `${formatDate(c.updatedAt)} ${formatTime(c.updatedAt)}`,
  };
}

export interface SyncEvent {
  schemaVersion: 1;
  /** Idempotency key. Unique per job. */
  eventId: string;
  eventType: SyncJobType;
  sentAt: string;
  complaintId: string;
  /** A full snapshot of the row as it should look NOW, so retries are naturally idempotent. */
  row: SheetRow;
}

export function buildSyncEvent(
  job: { eventId: string; type: SyncJobType; complaintId: string },
  complaint: ComplaintDoc,
  resolvedByLabel: string | null,
  now: Date = new Date(),
): SyncEvent {
  return {
    schemaVersion: 1,
    eventId: job.eventId,
    eventType: job.type,
    sentAt: now.toISOString(),
    complaintId: job.complaintId,
    row: toSheetRow(complaint, resolvedByLabel),
  };
}
