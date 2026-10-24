import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sendToN8n } from "@/lib/n8n";
import { TRANSFER_COLUMNS, buildTransferSyncEvent } from "@/lib/sheet-row";
import { runCode, startFakeN8n, type FakeN8n } from "../support/fake-n8n";
import { sampleTransfer } from "./fixtures";

interface N8nNode { name: string; type: string; parameters: Record<string, any>; credentials?: Record<string, unknown>; onError?: string; alwaysOutputData?: boolean }
interface Workflow { active: boolean; nodes: N8nNode[]; connections: Record<string, { main: { node: string }[][] }>; settings: Record<string, unknown> }

const load = (f: string): Workflow => JSON.parse(readFileSync(path.join(__dirname, "../../n8n", f), "utf8"));
const D = load("new-transfer-sync.json");
const E = load("received-transfer-sync.json");
const node = (w: Workflow, name: string) => {
  const n = w.nodes.find((x) => x.name === name);
  if (!n) throw new Error(`node not found: ${name}`);
  return n;
};
const working = (w: Workflow) => w.nodes.filter((n) => n.type !== "n8n-nodes-base.stickyNote");
const code = (w: Workflow, name: string) => node(w, name).parameters.jsCode as string;

const ID = "TR-20261018-B3M9";
const cfg = { spreadsheetId: "sheet123", sheetName: "Item Transfers" };
const item = (body: unknown) => ({ headers: {}, params: {}, query: {}, body, ...cfg });
const createdEvent = () => buildTransferSyncEvent({ eventId: `transfer.created:${ID}`, type: "transfer.created", complaintId: ID }, sampleTransfer(), null, null);
const receivedEvent = (suffix = "2") => buildTransferSyncEvent({ eventId: `transfer.received:${ID}:${suffix}`, type: "transfer.received", complaintId: ID }, sampleTransfer({ status: "Received", receivedAt: new Date("2026-10-18T09:15:00Z") }), "IT Admin", null);

describe.each([["D (new item)", D], ["E (item received)", E]])("workflow %s: structure and safety", (_l, w) => {
  it("is inactive by default and keeps personal data out of success executions", () => {
    expect(w.active).toBe(false);
    expect(w.settings.saveDataSuccessExecution).toBe("none");
  });
  it("every connection targets an existing node; every node is reachable from the webhook", () => {
    const names = new Set(w.nodes.map((n) => n.name));
    for (const [from, c] of Object.entries(w.connections)) {
      expect(names.has(from)).toBe(true);
      for (const out of c.main) for (const t of out) expect(names.has(t.node)).toBe(true);
    }
    const seen = new Set(["Webhook"]);
    const queue = ["Webhook"];
    while (queue.length) for (const out of w.connections[queue.shift()!]?.main ?? []) for (const t of out) if (!seen.has(t.node)) (seen.add(t.node), queue.push(t.node));
    for (const n of working(w)) expect(seen.has(n.name), `unreachable: ${n.name}`).toBe(true);
  });
  it("every $('Node') reference names a node that exists, and no secrets are embedded", () => {
    const names = new Set(w.nodes.map((n) => n.name));
    for (const m of JSON.stringify(w).matchAll(/\$\('([^']+)'\)/g)) expect(names.has(m[1]!), m[1]).toBe(true);
    expect(JSON.stringify(w)).not.toMatch(/[A-Za-z0-9_-]{40,}/);
  });
  it("authenticates the webhook with a header secret and replies through a Respond node", () => {
    const hook = node(w, "Webhook");
    expect(hook.parameters).toMatchObject({ httpMethod: "POST", authentication: "headerAuth", responseMode: "responseNode" });
  });
  it("looks rows up by the exact Transfer ID column", () => {
    const read = node(w, "Find Rows by Transfer ID");
    expect(read.parameters.filtersUI.values).toEqual([{ lookupColumn: "Transfer ID", lookupValue: "={{ $json.transferId }}" }]);
    expect(read.alwaysOutputData).toBe(true);
  });
  it("writes literal text (RAW), uses no upsert/delete, and sends every Sheets error to the failure response", () => {
    for (const n of w.nodes.filter((x) => x.type === "n8n-nodes-base.googleSheets")) {
      expect(n.parameters.operation ?? "read").not.toMatch(/appendOrUpdate|delete|clear/i);
      if (n.parameters.operation) expect(n.parameters.options.cellFormat).toBe("RAW");
      expect(n.onError).toBe("continueErrorOutput");
      expect(w.connections[n.name]!.main[1]!.map((t) => t.node)).toEqual(["Respond Sheets Error"]);
    }
  });
  it("the worksheet defaults to the Item Transfers tab, separate from the complaints tab", () => {
    const names = node(w, "Config").parameters.assignments.assignments;
    expect(names.find((a: { name: string }) => a.name === "sheetName").value).toBe("Item Transfers");
  });
});

describe("workflow D: append", () => {
  it("maps all 16 columns explicitly, in order", () => {
    const append = node(D, "Append Row");
    expect(append.parameters.operation).toBe("append");
    expect(Object.keys(append.parameters.columns.value)).toEqual([...TRANSFER_COLUMNS]);
    for (const c of TRANSFER_COLUMNS) expect(append.parameters.columns.value[c]).toContain(`row[${JSON.stringify(c)}]`);
  });
  it("has no update node, and success replies come only after the append succeeded", () => {
    expect(D.nodes.some((n) => n.parameters.operation === "update")).toBe(false);
    expect(D.connections["Append Row"]!.main[0]!.map((t) => t.node)).toEqual(["Respond Appended"]);
  });
});

describe("workflow E: exact-row update", () => {
  it("updates by row number only, never inserts, and writes only the receipt columns", () => {
    const update = node(E, "Update Row");
    expect(update.parameters.columns.matchingColumns).toEqual(["row_number"]);
    expect(E.nodes.some((n) => n.parameters.operation === "append")).toBe(false);
    const written = Object.keys(update.parameters.columns.value).filter((k) => k !== "row_number");
    expect(written.sort()).toEqual(["Last Updated", "Received By", "Received Date", "Received Time", "Receipt Notes", "Status"].sort());
    for (const protectedCol of ["Transfer ID", "Direction", "Outlet", "Name", "Email", "Contact", "Description", "Date", "Time", "Logged By"]) expect(written).not.toContain(protectedCol);
  });
  it("only updates on exactly one match; zero → 404, many → 409", () => {
    expect(E.connections["Can Update?"]!.main[0]!.map((t) => t.node)).toEqual(["Update Row"]);
    expect(node(E, "Respond Row Missing").parameters.options.responseCode).toBe(404);
    expect(node(E, "Respond Duplicate Rows").parameters.options.responseCode).toBe(409);
  });
});

describe("Validate Payload code (executed)", () => {
  const validateD = (b: unknown) => runCode(code(D, "Validate Payload"), [item(b)])[0]!.json;
  const validateE = (b: unknown) => runCode(code(E, "Validate Payload"), [item(b)])[0]!.json;

  it("accepts exactly what the app sends (contract), including a reconcile-style suffix", () => {
    expect(validateD(createdEvent()).valid).toBe(true);
    expect(validateE(receivedEvent()).valid).toBe(true);
    expect(validateD({ ...createdEvent(), eventId: `transfer.created:${ID}:reconcile:1` }).valid).toBe(true);
  });
  it("each workflow accepts only its own event type", () => {
    expect(validateD(receivedEvent()).valid).toBe(false);
    expect(validateE(createdEvent()).valid).toBe(false);
  });
  it("rejects bad versions, IDs, complaint-shaped IDs and mismatches", () => {
    const base = createdEvent();
    const cases: [string, unknown][] = [
      ["schemaVersion", { ...base, schemaVersion: 2 }],
      ["transferId", { ...base, transferId: "TR-1", eventId: "transfer.created:TR-1" }],
      ["complaint id", { ...base, transferId: "IT-20261018-A7K2", eventId: "transfer.created:IT-20261018-A7K2", row: { ...base.row, "Transfer ID": "IT-20261018-A7K2" } }],
      ["eventId", { ...base, eventId: "transfer.created:TR-20261018-ZZZZ" }],
      ["row missing", { ...base, row: undefined }],
      ["column missing", { ...base, row: { ...base.row, Status: undefined } }],
      ["not text", { ...base, row: { ...base.row, Outlet: 7 } }],
      ["too long", { ...base, row: { ...base.row, Description: "x".repeat(4001) } }],
      ["id mismatch", { ...base, row: { ...base.row, "Transfer ID": "TR-20261018-ZZZZ" } }],
    ];
    for (const [label, body] of cases) expect(validateD(body).valid, label).toBe(false);
    expect(validateD(undefined).valid).toBe(false);
  });
});

describe("Evaluate Matches code (executed)", () => {
  const validated = { valid: true, transferId: ID, eventId: `transfer.created:${ID}`, ...cfg };
  const evaluate = (w: Workflow, rows: unknown[]) => runCode(code(w, "Evaluate Matches"), rows, { "Validate Payload": [validated] })[0]!.json;
  const row = (id: string, n = 2) => ({ "Transfer ID": id, row_number: n });
  it("D: none → append, one → exists, several → duplicate", () => {
    expect(evaluate(D, [{}]).action).toBe("append");
    expect(evaluate(D, [row(ID, 9)])).toMatchObject({ action: "exists", rowNumber: 9 });
    expect(evaluate(D, [row(ID, 4), row(ID, 8)])).toMatchObject({ action: "duplicate", matchCount: 2 });
  });
  it("E: none → missing, one → update with its row number, several → duplicate; near-misses are ignored", () => {
    expect(evaluate(E, [{}]).action).toBe("missing");
    expect(evaluate(E, [row(ID, 12)])).toMatchObject({ action: "update", rowNumber: 12 });
    expect(evaluate(E, [row(ID, 4), row(ID, 8)]).action).toBe("duplicate");
    expect(evaluate(E, [row("TR-20261018-ZZZZ", 3), row(` ${ID} `, 6)])).toMatchObject({ action: "update", rowNumber: 6 });
  });
});

describe("app ⇄ transfer workflows (simulated n8n)", () => {
  let fake: FakeN8n;
  const SECRET = "s".repeat(40);
  beforeAll(async () => (fake = await startFakeN8n(SECRET)));
  afterAll(() => fake.stop());
  beforeEach(() => fake.reset());
  const config = () => ({ newTransferUrl: `${fake.url}/webhook/helpdesk/transfer-created`, updateTransferUrl: `${fake.url}/webhook/helpdesk/transfer-received`, secret: SECRET });
  const idOf = (n: number) => `TR-20261018-B3M${n}`;
  const created = (n: number) => buildTransferSyncEvent({ eventId: `transfer.created:${idOf(n)}`, type: "transfer.created", complaintId: idOf(n) }, sampleTransfer({ transferId: idOf(n) }), null, null);
  const received = (n: number) => buildTransferSyncEvent({ eventId: `transfer.received:${idOf(n)}:2`, type: "transfer.received", complaintId: idOf(n) }, sampleTransfer({ transferId: idOf(n), status: "Received", receivedAt: new Date("2026-10-18T09:15:00Z"), updatedAt: new Date("2026-10-18T09:15:00Z"), receiptNotes: "Arrived intact." }), "IT Admin", null);

  it("appends one row per record, and a duplicate delivery adds none", async () => {
    expect(await sendToN8n(created(2), { config: config() })).toMatchObject({ kind: "success", result: "appended" });
    expect(await sendToN8n(created(2), { config: config() })).toMatchObject({ kind: "success", result: "already_exists" });
    expect(fake.transfers).toHaveLength(1);
    expect(fake.sheet).toHaveLength(0); // never touches the complaints tab
  });
  it("accepting one item updates ONLY its row; every other row stays byte-for-byte identical", async () => {
    for (const n of [2, 3, 4]) await sendToN8n(created(n), { config: config() });
    const before = JSON.stringify(fake.transfers.filter((r) => r["Transfer ID"] !== idOf(3)));
    expect(await sendToN8n(received(3), { config: config() })).toMatchObject({ kind: "success", result: "updated" });
    const row = fake.transfers.find((r) => r["Transfer ID"] === idOf(3))!;
    expect(row).toMatchObject({ Status: "Received", "Received Date": "18-Oct-2026", "Received By": "IT Admin", "Receipt Notes": "Arrived intact.", Name: "Ayesha Khan", Description: expect.any(String) });
    expect(JSON.stringify(fake.transfers.filter((r) => r["Transfer ID"] !== idOf(3)))).toBe(before);
    expect(fake.transfers).toHaveLength(3);
  });
  it("a missing row is reported (row_missing) and nothing is inserted; duplicates are reported and untouched", async () => {
    await sendToN8n(created(2), { config: config() });
    expect(await sendToN8n(received(9), { config: config() })).toMatchObject({ kind: "integrity", code: "row_missing" });
    fake.transfers.push({ ...fake.transfers[0]!, row_number: 3 });
    const snapshot = JSON.stringify(fake.transfers);
    expect(await sendToN8n(received(2), { config: config() })).toMatchObject({ kind: "integrity", code: "duplicate_rows" });
    expect(JSON.stringify(fake.transfers)).toBe(snapshot);
  });
  it("refuses a wrong secret and a tampered payload", async () => {
    expect((await sendToN8n(created(2), { config: { ...config(), secret: "x".repeat(40) } })).kind).toBe("retryable");
    const bad = created(2);
    (bad.row as Record<string, string>)["Transfer ID"] = idOf(5);
    expect(await sendToN8n(bad, { config: config() })).toMatchObject({ kind: "rejected" });
    expect(fake.transfers).toHaveLength(0);
  });
});
