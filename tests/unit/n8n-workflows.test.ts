import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SHEET_COLUMNS, buildSyncEvent } from "@/lib/sheet-row";
import { sampleComplaint } from "./fixtures";

interface N8nNode {
  name: string;
  type: string;
  parameters: Record<string, any>;
  credentials?: Record<string, unknown>;
  onError?: string;
  alwaysOutputData?: boolean;
}
interface Workflow {
  name: string;
  active: boolean;
  nodes: N8nNode[];
  connections: Record<string, { main: { node: string }[][] }>;
  settings: Record<string, unknown>;
}

const load = (file: string): Workflow => JSON.parse(readFileSync(path.join(__dirname, "../../n8n", file), "utf8"));
const A = load("new-complaint-sync.json");
const B = load("resolve-complaint-sync.json");
const C = load("reconciliation.json");
const byName = (w: Workflow, name: string) => {
  const n = w.nodes.find((x) => x.name === name);
  if (!n) throw new Error(`node not found: ${name}`);
  return n;
};
const workingNodes = (w: Workflow) => w.nodes.filter((n) => n.type !== "n8n-nodes-base.stickyNote");

/** Runs a Code node's JavaScript the way n8n does, with $input and $('Node') helpers. */
function runCode(w: Workflow, nodeName: string, input: unknown[], others: Record<string, unknown[]> = {}) {
  const wrap = (items: unknown[]) => ({ all: () => items.map((json) => ({ json })), first: () => ({ json: items[0] }) });
  const $ = (name: string) => {
    if (!(name in others)) throw new Error(`unknown node referenced: ${name}`);
    return wrap(others[name]!);
  };
  const fn = new Function("$input", "$", byName(w, nodeName).parameters.jsCode as string);
  return fn(wrap(input), $) as { json: Record<string, any> }[];
}

const ID = "IT-20261018-A7K2";
const cfg = { spreadsheetId: "sheet123", sheetName: "IT Complaints" };
const createdBody = () => buildSyncEvent({ eventId: `complaint.created:${ID}`, type: "complaint.created", complaintId: ID }, sampleComplaint(), null);
const webhookItem = (body: unknown) => ({ headers: {}, params: {}, query: {}, body, ...cfg });

describe.each([
  ["A (new complaint)", A],
  ["B (update/resolve)", B],
  ["C (retry runner)", C],
])("workflow %s: structure", (_label, w) => {
  it("is valid, inactive by default, and keeps personal data out of success executions", () => {
    expect(w.active).toBe(false);
    expect(w.settings.saveDataSuccessExecution).toBe("none");
  });

  it("every connection points at an existing node, and every node is reachable from the trigger", () => {
    const names = new Set(w.nodes.map((n) => n.name));
    for (const [from, c] of Object.entries(w.connections)) {
      expect(names.has(from)).toBe(true);
      for (const out of c.main) for (const t of out) expect(names.has(t.node)).toBe(true);
    }
    const trigger = workingNodes(w).find((n) => /webhook|scheduleTrigger/.test(n.type))!;
    const seen = new Set<string>([trigger.name]);
    const queue = [trigger.name];
    while (queue.length) {
      for (const out of w.connections[queue.shift()!]?.main ?? []) for (const t of out) if (!seen.has(t.node)) (seen.add(t.node), queue.push(t.node));
    }
    for (const n of workingNodes(w)) expect(seen.has(n.name), `unreachable: ${n.name}`).toBe(true);
  });

  it("every $('Node') reference in an expression or code names a node that exists", () => {
    const names = new Set(w.nodes.map((n) => n.name));
    for (const m of JSON.stringify(w).matchAll(/\$\('([^']+)'\)/g)) expect(names.has(m[1]!), `bad reference: ${m[1]}`).toBe(true);
  });

  it("contains no embedded secrets (credentials are referenced, never inlined)", () => {
    const text = JSON.stringify(w);
    expect(text).not.toMatch(/[A-Za-z0-9_-]{40,}/);
    expect(text).not.toMatch(/Bearer [A-Za-z0-9]/);
  });
});

describe.each([["A", A], ["B", B]])("workflow %s: webhook and Google Sheets safety", (_l, w) => {
  it("the webhook requires header authentication and replies via a Respond node", () => {
    const hook = byName(w, "Webhook");
    expect(hook.parameters.authentication).toBe("headerAuth");
    expect(hook.parameters.responseMode).toBe("responseNode");
    expect(hook.parameters.httpMethod).toBe("POST");
    expect(hook.credentials).toHaveProperty("httpHeaderAuth");
  });

  it("looks rows up by the exact Complaint ID column", () => {
    const read = byName(w, "Find Rows by Complaint ID");
    expect(read.parameters.filtersUI.values).toEqual([{ lookupColumn: "Complaint ID", lookupValue: "={{ $json.complaintId }}" }]);
    expect(read.alwaysOutputData).toBe(true); // zero matches must still reach the decision node
  });

  it("writes literal text (RAW) and never uses a broad or upsert operation", () => {
    for (const n of w.nodes.filter((x) => x.type === "n8n-nodes-base.googleSheets")) {
      expect(n.parameters.operation ?? "read").not.toMatch(/appendOrUpdate|delete|clear/i);
      if (n.parameters.operation) expect(n.parameters.options.cellFormat).toBe("RAW");
      expect(n.parameters.authentication).toBe("serviceAccount");
      expect(n.onError).toBe("continueErrorOutput");
    }
  });

  it("routes every Google Sheets error output to the failure response (no false success)", () => {
    for (const n of w.nodes.filter((x) => x.type === "n8n-nodes-base.googleSheets")) {
      const errorOut = w.connections[n.name]!.main[1]!;
      expect(errorOut.map((t) => t.node)).toEqual(["Respond Sheets Error"]);
    }
  });

  it("the sheet and spreadsheet come from one editable Config node", () => {
    const cfgNode = byName(w, "Config");
    const names = cfgNode.parameters.assignments.assignments.map((a: { name: string }) => a.name);
    expect(names).toEqual(["spreadsheetId", "sheetName"]);
  });
});

describe("workflow A: append", () => {
  it("maps all 16 columns explicitly, in order, from the validated payload", () => {
    const append = byName(A, "Append Row");
    expect(append.parameters.operation).toBe("append");
    expect(Object.keys(append.parameters.columns.value)).toEqual([...SHEET_COLUMNS]);
    for (const col of SHEET_COLUMNS) {
      expect(append.parameters.columns.value[col]).toContain(`row[${JSON.stringify(col)}]`);
    }
  });
  it("success responses are only reachable after the sheet node's success output", () => {
    expect(A.connections["Append Row"]!.main[0]!.map((t) => t.node)).toEqual(["Respond Appended"]);
  });
});

describe("workflow B: exact-row update", () => {
  it("updates by row number only, and never inserts", () => {
    const update = byName(B, "Update Row");
    expect(update.parameters.operation).toBe("update");
    expect(update.parameters.columns.matchingColumns).toEqual(["row_number"]);
    expect(B.nodes.some((n) => n.parameters.operation === "append")).toBe(false);
  });
  it("leaves identity and original-receipt columns untouched", () => {
    const written = Object.keys(byName(B, "Update Row").parameters.columns.value);
    for (const protectedCol of ["Complaint ID", "User Name", "Problem Description", "Received Date", "Received Time"]) {
      expect(written).not.toContain(protectedCol);
    }
    for (const col of ["Solved Date", "Resolve Time", "Solve Duration", "Work Stuck Reason", "Status", "Resolution Notes", "Resolved By", "Last Updated", "Priority"]) {
      expect(written).toContain(col);
    }
  });
  it("only updates when exactly one row matched; zero → 404, many → 409", () => {
    expect(B.connections["Can Update?"]!.main[0]!.map((t) => t.node)).toEqual(["Update Row"]);
    expect(byName(B, "Respond Row Missing").parameters.options.responseCode).toBe(404);
    expect(byName(B, "Respond Duplicate Rows").parameters.options.responseCode).toBe(409);
  });
});

describe("workflow C", () => {
  it("calls the app's runner endpoint with a Bearer credential and fails loudly when work needs attention", () => {
    const http = byName(C, "Run Sync Retries");
    expect(http.parameters.method).toBe("POST");
    expect(http.parameters.url).toContain("/api/internal/sync/run");
    expect(http.parameters.genericAuthType).toBe("httpHeaderAuth");
    expect(C.connections["Needs Attention?"]!.main[0]!.map((t) => t.node)).toEqual(["Raise Alert"]);
  });
});

describe("workflow A: Validate Payload code (executed)", () => {
  const validate = (body: unknown) => runCode(A, "Validate Payload", [webhookItem(body)])[0]!.json;

  it("accepts the exact payload the app produces (contract compatibility)", () => {
    const out = validate(createdBody());
    expect(out.valid).toBe(true);
    expect(out.complaintId).toBe(ID);
    expect(out.spreadsheetId).toBe("sheet123");
  });

  it("rejects bad versions, event types, IDs and mismatches", () => {
    const base = createdBody();
    const cases: [string, unknown][] = [
      ["schemaVersion", { ...base, schemaVersion: 2 }],
      ["eventType", { ...base, eventType: "complaint.resolved" }],
      ["complaintId", { ...base, complaintId: "IT-1", eventId: "complaint.created:IT-1" }],
      ["eventId", { ...base, eventId: "complaint.created:IT-20261018-ZZZZ" }],
      ["row missing", { ...base, row: undefined }],
      ["column missing", { ...base, row: { ...base.row, Status: undefined } }],
      ["not text", { ...base, row: { ...base.row, Priority: 3 } }],
      ["too long", { ...base, row: { ...base.row, "Problem Description": "x".repeat(4001) } }],
      ["id mismatch", { ...base, row: { ...base.row, "Complaint ID": "IT-20261018-ZZZZ" } }],
    ];
    for (const [label, body] of cases) {
      const out = validate(body);
      expect(out.valid, label).toBe(false);
      expect(typeof out.reason).toBe("string");
    }
  });

  it("copes with an empty or non-object body without throwing", () => {
    expect(validate(undefined).valid).toBe(false);
    expect(validate({}).valid).toBe(false);
  });
});

describe("workflow B: Validate Payload code (executed)", () => {
  const validate = (body: unknown) => runCode(B, "Validate Payload", [webhookItem(body)])[0]!.json;
  const event = (type: "complaint.updated" | "complaint.resolved", eventId: string) =>
    buildSyncEvent({ eventId, type, complaintId: ID }, sampleComplaint(), null);

  it("accepts update and resolve events, rejects create events", () => {
    expect(validate(event("complaint.updated", `complaint.updated:${ID}:3`)).valid).toBe(true);
    expect(validate(event("complaint.resolved", `complaint.resolved:${ID}:2`)).valid).toBe(true);
    expect(validate(event("complaint.updated", `complaint.created:${ID}`)).valid).toBe(false);
    expect(validate({ ...createdBody() }).valid).toBe(false);
  });
});

describe("Evaluate Matches code (executed)", () => {
  const validated = { valid: true, complaintId: ID, eventId: `complaint.created:${ID}`, ...cfg };
  const evaluate = (w: Workflow, rows: unknown[]) => runCode(w, "Evaluate Matches", rows, { "Validate Payload": [validated] })[0]!.json;
  const row = (id: string, n = 2) => ({ "Complaint ID": id, row_number: n });

  it("A: no match → append; one → exists; several → duplicate", () => {
    expect(evaluate(A, [{}]).action).toBe("append"); // alwaysOutputData yields one empty item
    expect(evaluate(A, []).action).toBe("append");
    expect(evaluate(A, [row(ID, 9)])).toMatchObject({ action: "exists", matchCount: 1, rowNumber: 9 });
    expect(evaluate(A, [row(ID, 4), row(ID, 8)])).toMatchObject({ action: "duplicate", matchCount: 2 });
  });

  it("B: no match → missing; one → update with its row number; several → duplicate", () => {
    expect(evaluate(B, [{}]).action).toBe("missing");
    expect(evaluate(B, [row(ID, 12)])).toMatchObject({ action: "update", rowNumber: 12 });
    expect(evaluate(B, [row(ID, 4), row(ID, 8)]).action).toBe("duplicate");
  });

  it("ignores near-miss rows the lookup might return, and trims whitespace", () => {
    expect(evaluate(B, [row("IT-20261018-ZZZZ", 3), row(` ${ID} `, 6)])).toMatchObject({ action: "update", rowNumber: 6 });
    expect(evaluate(B, [row("IT-20261018-ZZZZ", 3)]).action).toBe("missing");
  });
});
