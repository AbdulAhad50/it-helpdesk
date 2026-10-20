import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sendToN8n } from "@/lib/n8n";
import { buildSyncEvent, type SyncEvent } from "@/lib/sheet-row";
import { sampleComplaint } from "./fixtures";
import { startFakeN8n, type FakeN8n } from "../support/fake-n8n";

/** The fake n8n lives in tests/support so the end-to-end test can use the very same one. */
let fake: FakeN8n;
const SECRET = "s".repeat(40);

beforeAll(async () => {
  fake = await startFakeN8n(SECRET);
});
afterAll(() => fake.stop());
beforeEach(() => fake.reset());

const cfg = () => ({ newComplaintUrl: `${fake.url}/webhook/helpdesk/complaint-created`, updateComplaintUrl: `${fake.url}/webhook/helpdesk/complaint-updated`, secret: SECRET });
const idOf = (n: number) => `IT-20261018-A7K${n}`;
const event = (n: number, type: SyncEvent["eventType"], over = {}, suffix = "") =>
  buildSyncEvent({ eventId: type === "complaint.created" ? `complaint.created:${idOf(n)}` : `${type}:${idOf(n)}:${suffix || 2}`, type, complaintId: idOf(n) }, sampleComplaint({ complaintId: idOf(n), ...over }), "IT Admin");

describe("app ⇄ workflow contract (simulated n8n)", () => {
  it("A appends exactly one row, and a duplicate delivery does not add another", async () => {
    expect(await sendToN8n(event(2, "complaint.created"), { config: cfg() })).toMatchObject({ kind: "success", result: "appended" });
    expect(fake.sheet).toHaveLength(1);
    expect(await sendToN8n(event(2, "complaint.created"), { config: cfg() })).toMatchObject({ kind: "success", result: "already_exists" });
    expect(fake.sheet).toHaveLength(1);
  });

  it("B resolves ONLY the matching row and leaves every other row byte-for-byte unchanged", async () => {
    for (const n of [2, 3, 4]) await sendToN8n(event(n, "complaint.created"), { config: cfg() });
    const before = JSON.stringify(fake.sheet.filter((r) => r["Complaint ID"] !== idOf(3)));

    const solvedAt = new Date("2026-10-18T07:45:00Z");
    const resolved = event(3, "complaint.resolved", { status: "Resolved", solvedAt, solveDurationMinutes: 135, resolutionNotes: "Replaced the roller.", updatedAt: solvedAt });
    expect(await sendToN8n(resolved, { config: cfg() })).toMatchObject({ kind: "success", result: "updated" });

    const row = fake.sheet.find((r) => r["Complaint ID"] === idOf(3))!;
    expect(row).toMatchObject({ Status: "Resolved", "Solve Duration": "2 hours 15 minutes", "Resolve Time": "12:45 PM", "Resolved By": "IT Admin" });
    expect(row["User Name"]).toBe("Ayesha Khan"); // identity columns untouched
    expect(JSON.stringify(fake.sheet.filter((r) => r["Complaint ID"] !== idOf(3)))).toBe(before);
    expect(fake.sheet).toHaveLength(3); // no row inserted
  });

  it("B re-delivered after success is idempotent", async () => {
    await sendToN8n(event(2, "complaint.created"), { config: cfg() });
    const r1 = await sendToN8n(event(2, "complaint.updated", { priority: "Critical", priorityRank: 4 }), { config: cfg() });
    const snapshot = JSON.stringify(fake.sheet);
    const r2 = await sendToN8n(event(2, "complaint.updated", { priority: "Critical", priorityRank: 4 }), { config: cfg() });
    expect([r1.kind, r2.kind]).toEqual(["success", "success"]);
    expect(JSON.stringify(fake.sheet)).toBe(snapshot);
  });

  it("B with a missing row reports row_missing and inserts nothing", async () => {
    await sendToN8n(event(2, "complaint.created"), { config: cfg() });
    const r = await sendToN8n(event(9, "complaint.resolved"), { config: cfg() });
    expect(r).toMatchObject({ kind: "integrity", code: "row_missing" });
    expect(fake.sheet).toHaveLength(1);
  });

  it("duplicate rows are detected and neither workflow touches them", async () => {
    await sendToN8n(event(2, "complaint.created"), { config: cfg() });
    fake.sheet.push({ ...fake.sheet[0]!, row_number: 3 });
    const before = JSON.stringify(fake.sheet);
    expect(await sendToN8n(event(2, "complaint.created"), { config: cfg() })).toMatchObject({ kind: "integrity", code: "duplicate_rows" });
    expect(await sendToN8n(event(2, "complaint.resolved", { status: "Resolved" }), { config: cfg() })).toMatchObject({ kind: "integrity", code: "duplicate_rows" });
    expect(JSON.stringify(fake.sheet)).toBe(before);
  });

  it("a wrong secret is refused and writes nothing", async () => {
    const r = await sendToN8n(event(2, "complaint.created"), { config: { ...cfg(), secret: "x".repeat(40) } });
    expect(r.kind).toBe("retryable");
    expect(fake.sheet).toHaveLength(0);
  });

  it("a tampered payload is rejected by the workflow's own validation", async () => {
    const bad = event(2, "complaint.created");
    (bad.row as Record<string, string>)["Complaint ID"] = idOf(5);
    expect(await sendToN8n(bad, { config: cfg() })).toMatchObject({ kind: "rejected" });
    expect(fake.sheet).toHaveLength(0);
  });
});
