import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { startTestDb } from "./helpers";
import { ApiError } from "@/lib/api";
import { createComplaint } from "@/lib/complaint-service";
import { getDashboardMetrics } from "@/lib/dashboard-service";
import { getComplaintFull, listComplaints, resolveComplaint, retryComplaintSync, updateComplaint } from "@/lib/complaint-admin-service";
import { resolveRange } from "@/lib/range";
import { computeSolveDurationMinutes } from "@/lib/time";
import { parseListQuery } from "@/lib/validation-admin";
import { DEFAULT_CATEGORIES, DEFAULT_DEPARTMENTS } from "@/lib/constants";
import { adminsCollection } from "@/models/Admin";
import { auditLogsCollection } from "@/models/AuditLog";
import { complaintsCollection } from "@/models/Complaint";
import { syncJobsCollection } from "@/models/SyncJob";

let db: Db;
let stop: () => Promise<void>;
const ADMIN = new ObjectId();
const ADMIN_ID = ADMIN.toHexString();
const options = { departments: DEFAULT_DEPARTMENTS, categories: DEFAULT_CATEGORIES };

beforeAll(async () => ({ db, stop } = await startTestDb()));
afterAll(async () => stop());
beforeEach(async () => {
  await Promise.all(["complaints", "syncjobs", "auditlogs", "admins"].map((c) => db.collection(c).deleteMany({})));
  const now = new Date();
  await adminsCollection(db).insertOne({ _id: ADMIN, email: "it@company.com", name: "IT Admin", passwordHash: "x", disabled: false, lastLoginAt: null, createdAt: now, updatedAt: now });
});

let n = 0;
async function make(over: Record<string, unknown> = {}, at?: Date) {
  const { complaintId } = await createComplaint(
    { userName: `Employee ${++n}`, department: "Sales", problemCategory: "Email / Outlook", problemDescription: "Outlook keeps asking for my password.", priority: "Normal", ...over } as never,
    { correlationId: "corr-12345" },
    db,
  );
  if (at) await complaintsCollection(db).updateOne({ complaintId }, { $set: { receivedAt: at, createdAt: at, updatedAt: at } });
  return complaintId;
}
const get = (id: string) => complaintsCollection(db).findOne({ complaintId: id });
const query = (o: Record<string, string> = {}) => {
  const r = parseListQuery(o);
  if (!r.ok) throw new Error(`invalid test query: ${JSON.stringify(r.errors)}`);
  return r.query;
};
const ctx = { correlationId: "corr-12345" };
const resolve = (complaintId: string, input = {}) => resolveComplaint(db, { complaintId, adminId: ADMIN_ID, input, correlationId: ctx.correlationId });
const edit = (complaintId: string, input: Record<string, unknown>) =>
  updateComplaint(db, { complaintId, adminId: ADMIN_ID, input: input as never, options, correlationId: ctx.correlationId });
const apiStatus = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof ApiError ? e.status : (e as Error);
  }
};

describe("resolveComplaint", () => {
  it("resolves one complaint: server timestamp, consistent duration, admin recorded, history and sync job written", async () => {
    const received = new Date(Date.now() - 135 * 60_000);
    const id = await make({}, received);
    const other = await make();
    const otherBefore = JSON.stringify(await get(other));

    const res = await resolve(id, { workStuckReason: "Waiting for parts", resolutionNotes: "Replaced the roller." });
    const doc = (await get(id))!;

    expect(doc).toMatchObject({ status: "Resolved", resolvedBy: ADMIN_ID, workStuckReason: "Waiting for parts", resolutionNotes: "Replaced the roller.", version: 2, googleSheetSynced: false, syncState: "pending" });
    expect(doc.solvedAt!.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    expect(doc.solveDurationMinutes).toBe(computeSolveDurationMinutes(doc.receivedAt, doc.solvedAt!)); // DB rule == JS rule
    expect(doc.solveDurationMinutes).toBe(135);
    expect(res.solvedAt.getTime()).toBe(doc.solvedAt!.getTime());

    expect(await syncJobsCollection(db).findOne({ eventId: `complaint.resolved:${id}:2` })).toMatchObject({ type: "complaint.resolved", status: "pending" });
    expect(await auditLogsCollection(db).findOne({ complaintId: id, action: "complaint.resolved" })).toMatchObject({ actor: ADMIN_ID });
    expect(JSON.stringify(await get(other))).toBe(otherBefore); // every other complaint is untouched
  });

  it("never resolves twice: a second attempt is a 409 and the first resolution time is preserved", async () => {
    const id = await make();
    await resolve(id);
    const first = (await get(id))!;
    expect(await apiStatus(resolve(id, { resolutionNotes: "again" }))).toBe(409);
    const after = (await get(id))!;
    expect(after.solvedAt!.getTime()).toBe(first.solvedAt!.getTime());
    expect(after.version).toBe(first.version);
    expect(after.resolutionNotes).toBe(first.resolutionNotes);
    expect(await syncJobsCollection(db).countDocuments({ complaintId: id, type: "complaint.resolved" })).toBe(1);
  });

  it("simultaneous resolves: exactly one wins, the rest get 409, and only one job and audit entry exist", async () => {
    const id = await make();
    const results = await Promise.all(Array.from({ length: 6 }, () => apiStatus(resolve(id))));
    expect(results.filter((r) => r === null)).toHaveLength(1);
    expect(results.filter((r) => r === 409)).toHaveLength(5);
    expect(await syncJobsCollection(db).countDocuments({ complaintId: id, type: "complaint.resolved" })).toBe(1);
    expect(await auditLogsCollection(db).countDocuments({ complaintId: id, action: "complaint.resolved" })).toBe(1);
  });

  it("stores admin text literally, even when it looks like a field path or operator", async () => {
    const id = await make();
    await resolve(id, { resolutionNotes: "$receivedAt", workStuckReason: "$$NOW" });
    expect(await get(id)).toMatchObject({ resolutionNotes: "$receivedAt", workStuckReason: "$$NOW" });
  });

  it("keeps existing notes when none are supplied", async () => {
    const id = await make();
    await edit(id, { version: 1, resolutionNotes: "Tried a restart." });
    await resolve(id);
    expect(await get(id)).toMatchObject({ resolutionNotes: "Tried a restart.", status: "Resolved" });
  });

  it("returns 404 for an unknown complaint", async () => {
    expect(await apiStatus(resolve("IT-20260101-AAAA"))).toBe(404);
  });

  it("does not hide a failed sync flag when resolving", async () => {
    const id = await make();
    await complaintsCollection(db).updateOne({ complaintId: id }, { $set: { syncState: "needs_reconciliation", syncError: "No row" } });
    await resolve(id);
    expect(await get(id)).toMatchObject({ syncState: "needs_reconciliation", syncError: "No row" });
  });
});

describe("updateComplaint", () => {
  it("changes only allowed fields, bumps the version, records the diff and queues one sync job", async () => {
    const id = await make();
    const before = (await get(id))!;
    const r = await edit(id, { version: 1, priority: "Critical", workStuckReason: "Waiting for vendor" });
    const after = (await get(id))!;

    expect(r).toMatchObject({ changed: true, version: 2 });
    expect(after).toMatchObject({ priority: "Critical", priorityRank: 4, workStuckReason: "Waiting for vendor", version: 2 });
    for (const k of ["complaintId", "userName", "problemDescription", "receivedAt", "status", "solvedAt", "contactNumber"] as const) {
      expect(after[k]).toEqual(before[k]);
    }
    const audit = await auditLogsCollection(db).findOne({ complaintId: id, action: "complaint.updated" });
    expect(audit!.changes.map((c) => c.field).sort()).toEqual(["priority", "workStuckReason"]);
    expect(await syncJobsCollection(db).findOne({ eventId: `complaint.updated:${id}:2` })).not.toBeNull();
  });

  it("a no-op edit changes nothing: no version bump, no job, no audit entry", async () => {
    const id = await make();
    const r = await edit(id, { version: 1, priority: "Normal" });
    expect(r).toMatchObject({ changed: false, version: 1, eventId: null });
    expect((await get(id))!.version).toBe(1);
    expect(await syncJobsCollection(db).countDocuments({ complaintId: id, type: "complaint.updated" })).toBe(0);
  });

  it("rejects a stale version with 409 and leaves the data alone", async () => {
    const id = await make();
    await edit(id, { version: 1, priority: "High" });
    expect(await apiStatus(edit(id, { version: 1, priority: "Low" }))).toBe(409);
    expect((await get(id))!.priority).toBe("High");
  });

  it("two edits from the same version: exactly one wins", async () => {
    const id = await make();
    const r = await Promise.all([apiStatus(edit(id, { version: 1, priority: "High" })), apiStatus(edit(id, { version: 1, priority: "Low" }))]);
    expect(r.filter((x) => x === null)).toHaveLength(1);
    expect(r.filter((x) => x === 409)).toHaveLength(1);
    expect((await get(id))!.version).toBe(2);
  });

  it("can clear a field, and rejects unconfigured departments (but tolerates an unchanged legacy one)", async () => {
    const id = await make();
    await edit(id, { version: 1, resolutionNotes: "note" });
    await edit(id, { version: 2, resolutionNotes: null });
    expect((await get(id))!.resolutionNotes).toBeNull();
    expect(await apiStatus(edit(id, { version: 3, department: "Narnia" }))).toBe(422);

    await complaintsCollection(db).updateOne({ complaintId: id }, { $set: { department: "Legacy Dept" } });
    expect(await edit(id, { version: 3, department: "Legacy Dept", priority: "High" })).toMatchObject({ changed: true });
  });

  it("editing a resolved complaint never alters its resolution time, duration or status", async () => {
    const id = await make();
    await resolve(id);
    const resolved = (await get(id))!;
    await edit(id, { version: resolved.version, resolutionNotes: "Clarified the fix.", priority: "Low" });
    const after = (await get(id))!;
    expect(after.solvedAt!.getTime()).toBe(resolved.solvedAt!.getTime());
    expect(after.solveDurationMinutes).toBe(resolved.solveDurationMinutes);
    expect(after.status).toBe("Resolved");
    expect(after.resolvedBy).toBe(ADMIN_ID);
  });
});

describe("retryComplaintSync", () => {
  it("re-queues failed and dead jobs only, and refuses when nothing is stuck", async () => {
    const id = await make();
    expect(await apiStatus(retryComplaintSync(db, { complaintId: id, adminId: ADMIN_ID, correlationId: "c" }))).toBe(409);

    await syncJobsCollection(db).updateOne({ complaintId: id }, { $set: { status: "dead", attempts: 8, lastError: "down" } });
    await complaintsCollection(db).updateOne({ complaintId: id }, { $set: { syncState: "failed", syncError: "down" } });
    const { eventIds } = await retryComplaintSync(db, { complaintId: id, adminId: ADMIN_ID, correlationId: "c" });
    expect(eventIds).toEqual([`complaint.created:${id}`]);
    expect(await syncJobsCollection(db).findOne({ complaintId: id })).toMatchObject({ status: "pending", attempts: 0, lastError: null });
    expect(await get(id)).toMatchObject({ syncState: "pending", syncError: null });
    expect(await auditLogsCollection(db).countDocuments({ complaintId: id, action: "sync.retried" })).toBe(1);
  });
});

describe("listComplaints", () => {
  it("filters by status, priority, department and category", async () => {
    const a = await make({ priority: "High", department: "HR", problemCategory: "Other" });
    await make({ department: "Sales" });
    await resolve(await make());
    expect((await listComplaints(db, query({ priority: "High" }))).items.map((i) => i.complaintId)).toEqual([a]);
    expect((await listComplaints(db, query({ department: "HR", category: "Other" }))).total).toBe(1);
    expect((await listComplaints(db, query({ status: "Resolved" }))).total).toBe(1);
    expect((await listComplaints(db, query({ status: "Pending" }))).total).toBe(2);
  });

  it("searches by ID fragment and by employee name (case-insensitive), treating input as text", async () => {
    const id = await make({ userName: "Ayesha Khan" });
    await make({ userName: "Bilal Ahmed" });
    expect((await listComplaints(db, query({ q: "ayesha" }))).items.map((i) => i.complaintId)).toEqual([id]);
    expect((await listComplaints(db, query({ q: id.slice(-4).toLowerCase() }))).items.map((i) => i.complaintId)).toContain(id);
    expect((await listComplaints(db, query({ q: ".*" }))).total).toBe(0); // not a wildcard
  });

  it("filters by received date using Karachi days", async () => {
    const late = await make({}, new Date("2026-10-17T18:59:00Z")); // 23:59 on the 17th in Karachi
    const early = await make({}, new Date("2026-10-17T19:01:00Z")); // 00:01 on the 18th
    const ids = async (o: Record<string, string>) => (await listComplaints(db, query(o))).items.map((i) => i.complaintId).sort();
    expect(await ids({ from: "2026-10-18", to: "2026-10-18" })).toEqual([early]);
    expect(await ids({ from: "2026-10-17", to: "2026-10-17" })).toEqual([late]);
    expect(await ids({ from: "2026-10-17", to: "2026-10-18" })).toEqual([early, late].sort());
  });

  it("paginates without gaps or repeats, in every sort order", async () => {
    for (let i = 0; i < 23; i++) await make({ priority: (["Low", "Normal", "High", "Critical"] as const)[i % 4] }, new Date(Date.UTC(2026, 9, 1, i)));
    for (const sort of ["received", "priority", "status"]) {
      const seen: string[] = [];
      for (let page = 1; page <= 3; page++) {
        const r = await listComplaints(db, query({ sort, pageSize: "10", page: String(page) }));
        expect(r.total).toBe(23);
        expect(r.totalPages).toBe(3);
        seen.push(...r.items.map((x) => x.complaintId));
      }
      expect(new Set(seen).size).toBe(23);
    }
  });

  it("default view lists Pending first; priority sort puts Critical first", async () => {
    const resolvedId = await make();
    await resolve(resolvedId);
    await make();
    expect((await listComplaints(db, query())).items.map((i) => i.status)).toEqual(["Pending", "Resolved"]);
    await make({ priority: "Critical" });
    expect((await listComplaints(db, query({ sort: "priority" }))).items[0]!.priority).toBe("Critical");
  });

  it("does not return contact numbers in list items", async () => {
    await make({ contactNumber: "ext 204" });
    expect(JSON.stringify((await listComplaints(db, query())).items)).not.toContain("ext 204");
  });
});

describe("getDashboardMetrics: matches an independent calculation", () => {
  it("totals, averages, priority counts, groupings and the date range", async () => {
    const day = (d: number, h = 6) => new Date(Date.UTC(2026, 9, d, h)); // Oct d, hh:00 UTC (Karachi +5)
    const spec: { at: Date; dept: string; cat: string; pri: "Low" | "Normal" | "High" | "Critical"; mins: number | null }[] = [
      { at: day(10), dept: "Sales", cat: "Printer / Scanner", pri: "High", mins: 30 },
      { at: day(10), dept: "Sales", cat: "Other", pri: "Critical", mins: 90 },
      { at: day(11), dept: "HR", cat: "Printer / Scanner", pri: "Low", mins: null },
      { at: day(12), dept: "IT", cat: "Other", pri: "Normal", mins: 60 },
      { at: day(12), dept: "Sales", cat: "Other", pri: "High", mins: null },
      { at: day(20), dept: "Sales", cat: "Other", pri: "Critical", mins: 15 }, // outside the range below
    ];
    for (const s of spec) {
      const id = await make({ department: s.dept, problemCategory: s.cat, priority: s.pri }, s.at);
      if (s.mins !== null) {
        await complaintsCollection(db).updateOne({ complaintId: id }, { $set: { status: "Resolved", solvedAt: new Date(s.at.getTime() + s.mins * 60_000), solveDurationMinutes: s.mins } });
      }
    }
    const r = resolveRange({ preset: "custom", from: "2026-10-10", to: "2026-10-12" });
    if (!r.ok) throw new Error(r.error);
    const m = await getDashboardMetrics(db, r.range);

    const inRange = spec.slice(0, 5);
    const durations = inRange.map((s) => s.mins).filter((x): x is number => x !== null);
    expect(m.total).toBe(5);
    expect(m.resolved).toBe(durations.length);
    expect(m.pending).toBe(5 - durations.length);
    expect(m.highCritical).toBe(inRange.filter((s) => s.pri === "High" || s.pri === "Critical").length);
    expect(m.avgResolutionMinutes).toBe(Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)); // resolved only
    expect(m.byDepartment.find((d) => d.name === "Sales")!.count).toBe(3);
    expect(m.byCategory.find((c) => c.name === "Other")!.count).toBe(3);
    expect(m.overTime.map((p) => p.day)).toEqual(["2026-10-10", "2026-10-11", "2026-10-12"]);
    expect(m.overTime.map((p) => p.received)).toEqual([2, 1, 2]);
    expect(m.overTime[0]!.avgResolutionMinutes).toBe(60);
    expect(m.overTime[1]!.avgResolutionMinutes).toBeNull();
  });

  it("is all zeros, with a full zero-filled series, when the range has no complaints", async () => {
    const r = resolveRange({ preset: "7d" });
    if (!r.ok) throw new Error(r.error);
    const m = await getDashboardMetrics(db, r.range);
    expect(m).toMatchObject({ total: 0, pending: 0, resolved: 0, highCritical: 0, avgResolutionMinutes: null });
    expect(m.overTime).toHaveLength(7);
  });

  it("buckets days in Karachi time, not UTC", async () => {
    await make({}, new Date("2026-10-17T19:30:00Z")); // 00:30 on the 18th in Karachi
    const r = resolveRange({ preset: "custom", from: "2026-10-17", to: "2026-10-18" });
    if (!r.ok) throw new Error(r.error);
    expect((await getDashboardMetrics(db, r.range)).overTime.map((p) => p.received)).toEqual([0, 1]);
  });
});

describe("getComplaintFull", () => {
  it("returns history with administrator names, newest first", async () => {
    const id = await make();
    await edit(id, { version: 1, priority: "High" });
    await resolve(id);
    const full = (await getComplaintFull(db, id))!;
    expect(full.history.map((h) => h.label)).toEqual(["Marked resolved", "Details updated", "Complaint submitted"]);
    expect(full.history[0]!.actor).toBe("IT Admin");
    expect(full.history[2]!.actor).toBe("Employee");
    expect(full.complaint.resolvedBy).toBe("IT Admin");
    expect(full.syncJobs.map((j) => j.type)).toEqual(["complaint.created", "complaint.updated", "complaint.resolved"]);
    expect(await getComplaintFull(db, "IT-20260101-AAAA")).toBeNull();
  });
});
