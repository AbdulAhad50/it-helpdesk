import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sendToN8n } from "@/lib/n8n";
import { buildSyncEvent, type SyncEvent } from "@/lib/sheet-row";
import { sampleComplaint } from "./fixtures";

/**
 * A local stand-in for n8n. It runs the REAL Code-node JavaScript from the workflow files and keeps an
 * in-memory "sheet", then answers the way the Respond nodes do. This proves the app's payloads, client
 * and the workflows' decision logic agree. It does NOT prove n8n's own nodes or Google Sheets work.
 */
const wfPath = (f: string) => path.join(__dirname, "../../n8n", f);
const wfA = JSON.parse(readFileSync(wfPath("new-complaint-sync.json"), "utf8"));
const wfB = JSON.parse(readFileSync(wfPath("resolve-complaint-sync.json"), "utf8"));

const code = (wf: any, name: string) => wf.nodes.find((n: any) => n.name === name).parameters.jsCode as string;
const wrap = (items: unknown[]) => ({ all: () => items.map((json) => ({ json })), first: () => ({ json: items[0] }) });
const run = (js: string, input: unknown[], others: Record<string, unknown[]> = {}) =>
  new Function("$input", "$", js)(wrap(input), (n: string) => wrap(others[n]!)) as { json: any }[];

const SECRET = "s".repeat(40);
let sheet: Record<string, string | number>[] = [];
let server: Server;
let base = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (req.headers["x-webhook-secret"] !== SECRET) return send(403, { message: "Authorization data is wrong!" });

      const isCreate = req.url!.endsWith("complaint-created");
      const wf = isCreate ? wfA : wfB;
      const validated = run(code(wf, "Validate Payload"), [{ body: JSON.parse(raw), spreadsheetId: "s", sheetName: "IT Complaints" }])[0]!.json;
      if (!validated.valid) return send(400, { ok: false, error: "invalid_payload", message: validated.reason });

      const found = sheet.filter((r) => r["Complaint ID"] === validated.complaintId); // the sheet's lookup filter
      const ev = run(code(wf, "Evaluate Matches"), found.length ? found : [{}], { "Validate Payload": [validated] })[0]!.json;
      const echo = { eventId: validated.eventId, complaintId: validated.complaintId };

      if (ev.action === "duplicate") return send(409, { ok: false, error: "duplicate_rows", message: `${ev.matchCount} rows share this Complaint ID` });
      if (isCreate) {
        if (ev.action === "exists") return send(200, { ok: true, result: "already_exists", ...echo, rowNumber: ev.rowNumber });
        sheet.push({ ...validated.row, row_number: sheet.length + 2 });
        return send(200, { ok: true, result: "appended", ...echo, rowNumber: sheet.length + 1 });
      }
      if (ev.action === "missing") return send(404, { ok: false, error: "row_missing", message: "No sheet row has this Complaint ID." });
      const target = sheet.find((r) => r.row_number === ev.rowNumber)!;
      for (const col of ["Department", "Problem Category", "Priority", "Solved Date", "Resolve Time", "Solve Duration", "Work Stuck Reason", "Status", "Resolution Notes", "Resolved By", "Last Updated"]) {
        target[col] = validated.row[col];
      }
      return send(200, { ok: true, result: "updated", ...echo, rowNumber: ev.rowNumber });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  sheet = [];
});

const cfg = () => ({ newComplaintUrl: `${base}/webhook/helpdesk/complaint-created`, updateComplaintUrl: `${base}/webhook/helpdesk/complaint-updated`, secret: SECRET });
const idOf = (n: number) => `IT-20261018-A7K${n}`;
const event = (n: number, type: SyncEvent["eventType"], over = {}, suffix = "") =>
  buildSyncEvent({ eventId: type === "complaint.created" ? `complaint.created:${idOf(n)}` : `${type}:${idOf(n)}:${suffix || 2}`, type, complaintId: idOf(n) }, sampleComplaint({ complaintId: idOf(n), ...over }), "IT Admin");

describe("app ⇄ workflow contract (simulated n8n)", () => {
  it("A appends exactly one row, and a duplicate delivery does not add another", async () => {
    expect(await sendToN8n(event(2, "complaint.created"), { config: cfg() })).toMatchObject({ kind: "success", result: "appended" });
    expect(sheet).toHaveLength(1);
    expect(await sendToN8n(event(2, "complaint.created"), { config: cfg() })).toMatchObject({ kind: "success", result: "already_exists" });
    expect(sheet).toHaveLength(1);
  });

  it("B resolves ONLY the matching row and leaves every other row byte-for-byte unchanged", async () => {
    for (const n of [2, 3, 4]) await sendToN8n(event(n, "complaint.created"), { config: cfg() });
    const before = JSON.stringify(sheet.filter((r) => r["Complaint ID"] !== idOf(3)));

    const solvedAt = new Date("2026-10-18T07:45:00Z");
    const resolved = event(3, "complaint.resolved", { status: "Resolved", solvedAt, solveDurationMinutes: 135, resolutionNotes: "Replaced the roller.", updatedAt: solvedAt });
    expect(await sendToN8n(resolved, { config: cfg() })).toMatchObject({ kind: "success", result: "updated" });

    const row = sheet.find((r) => r["Complaint ID"] === idOf(3))!;
    expect(row).toMatchObject({ Status: "Resolved", "Solve Duration": "2 hours 15 minutes", "Resolve Time": "12:45 PM", "Resolved By": "IT Admin" });
    expect(row["User Name"]).toBe("Ayesha Khan"); // identity columns untouched
    expect(JSON.stringify(sheet.filter((r) => r["Complaint ID"] !== idOf(3)))).toBe(before);
    expect(sheet).toHaveLength(3); // no row inserted
  });

  it("B re-delivered after success is idempotent", async () => {
    await sendToN8n(event(2, "complaint.created"), { config: cfg() });
    const r1 = await sendToN8n(event(2, "complaint.updated", { priority: "Critical", priorityRank: 4 }), { config: cfg() });
    const snapshot = JSON.stringify(sheet);
    const r2 = await sendToN8n(event(2, "complaint.updated", { priority: "Critical", priorityRank: 4 }), { config: cfg() });
    expect([r1.kind, r2.kind]).toEqual(["success", "success"]);
    expect(JSON.stringify(sheet)).toBe(snapshot);
  });

  it("B with a missing row reports row_missing and inserts nothing", async () => {
    await sendToN8n(event(2, "complaint.created"), { config: cfg() });
    const r = await sendToN8n(event(9, "complaint.resolved"), { config: cfg() });
    expect(r).toMatchObject({ kind: "integrity", code: "row_missing" });
    expect(sheet).toHaveLength(1);
  });

  it("duplicate rows are detected and neither workflow touches them", async () => {
    await sendToN8n(event(2, "complaint.created"), { config: cfg() });
    sheet.push({ ...sheet[0]!, row_number: 3 });
    const before = JSON.stringify(sheet);
    expect(await sendToN8n(event(2, "complaint.created"), { config: cfg() })).toMatchObject({ kind: "integrity", code: "duplicate_rows" });
    expect(await sendToN8n(event(2, "complaint.resolved", { status: "Resolved" }), { config: cfg() })).toMatchObject({ kind: "integrity", code: "duplicate_rows" });
    expect(JSON.stringify(sheet)).toBe(before);
  });

  it("a wrong secret is refused and writes nothing", async () => {
    const r = await sendToN8n(event(2, "complaint.created"), { config: { ...cfg(), secret: "x".repeat(40) } });
    expect(r.kind).toBe("retryable");
    expect(sheet).toHaveLength(0);
  });

  it("a tampered payload is rejected by the workflow's own validation", async () => {
    const bad = event(2, "complaint.created");
    (bad.row as Record<string, string>)["Complaint ID"] = idOf(5);
    expect(await sendToN8n(bad, { config: cfg() })).toMatchObject({ kind: "rejected" });
    expect(sheet).toHaveLength(0);
  });
});
