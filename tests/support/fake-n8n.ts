import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * A local stand-in for n8n + Google Sheets, used by the contract test and the end-to-end test.
 * It runs the REAL Code-node JavaScript from the n8n/*.json workflow files, keeps an in-memory
 * "sheet", and answers the way the workflows' Respond nodes do. It proves the app and the workflows'
 * decision logic agree. It does NOT prove n8n's own nodes or Google Sheets behave.
 */
const wfPath = (f: string) => path.join(__dirname, "../../n8n", f);
const wfA = JSON.parse(readFileSync(wfPath("new-complaint-sync.json"), "utf8"));
const wfB = JSON.parse(readFileSync(wfPath("resolve-complaint-sync.json"), "utf8"));
const wfD = JSON.parse(readFileSync(wfPath("new-transfer-sync.json"), "utf8"));
const wfE = JSON.parse(readFileSync(wfPath("received-transfer-sync.json"), "utf8"));

const code = (wf: any, name: string) => wf.nodes.find((n: any) => n.name === name).parameters.jsCode as string;
const wrap = (items: unknown[]) => ({ all: () => items.map((json) => ({ json })), first: () => ({ json: items[0] }) });
export const runCode = (js: string, input: unknown[], others: Record<string, unknown[]> = {}) =>
  new Function("$input", "$", js)(wrap(input), (n: string) => wrap(others[n]!)) as { json: any }[];

export type SheetRow = Record<string, string | number>;

export interface FakeN8n {
  url: string;
  secret: string;
  sheet: SheetRow[];
  /** The "Item Transfers" worksheet. */
  transfers: SheetRow[];
  /** Webhook calls received, in order (event types and IDs only). */
  calls: { path: string; eventType: string; complaintId: string; status: number }[]; // complaintId holds the transfer ID for transfer events
  reset(): void;
  stop(): Promise<void>;
}

const UPDATE_COLUMNS = ["Department", "Problem Category", "Priority", "Solved Date", "Resolve Time", "Solve Duration", "Work Stuck Reason", "Status", "Resolution Notes", "Resolved By", "Last Updated"];
const TRANSFER_UPDATE_COLUMNS = ["Status", "Received Date", "Received Time", "Received By", "Receipt Notes", "Last Updated"];

/** Which workflow answers a URL, and how that workflow identifies and updates rows. */
function route(url: string) {
  if (url.endsWith("transfer-created")) return { wf: wfD, create: true, idCol: "Transfer ID", idKey: "transferId", update: TRANSFER_UPDATE_COLUMNS, sheet: "Item Transfers" };
  if (url.endsWith("transfer-received")) return { wf: wfE, create: false, idCol: "Transfer ID", idKey: "transferId", update: TRANSFER_UPDATE_COLUMNS, sheet: "Item Transfers" };
  if (url.endsWith("complaint-created")) return { wf: wfA, create: true, idCol: "Complaint ID", idKey: "complaintId", update: UPDATE_COLUMNS, sheet: "IT Complaints" };
  return { wf: wfB, create: false, idCol: "Complaint ID", idKey: "complaintId", update: UPDATE_COLUMNS, sheet: "IT Complaints" };
}

export async function startFakeN8n(secret: string, port = 0): Promise<FakeN8n> {
  const fake: FakeN8n = { url: "", secret, sheet: [], transfers: [], calls: [], reset() { fake.sheet.length = 0; fake.transfers.length = 0; fake.calls.length = 0; }, stop: async () => {} };

  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (req.headers["x-webhook-secret"] !== secret) return send(403, { message: "Authorization data is wrong!" });

      // Test-only inspection endpoint, protected by the same secret.
      if (req.method === "GET" && req.url === "/__sheet") return send(200, { rows: fake.sheet, transfers: fake.transfers, calls: fake.calls });

      const r = route(req.url!);
      let body: any;
      try {
        body = JSON.parse(raw);
      } catch {
        return send(400, { ok: false, error: "invalid_payload", message: "not JSON" });
      }
      const recordId = String(body?.[r.idKey]);
      const log = (status: number) => fake.calls.push({ path: req.url!, eventType: String(body?.eventType), complaintId: recordId, status });
      const reply = (status: number, payload: unknown) => (log(status), send(status, payload));
      const rows = r.idKey === "transferId" ? fake.transfers : fake.sheet;

      const validated = runCode(code(r.wf, "Validate Payload"), [{ body, spreadsheetId: "s", sheetName: r.sheet }])[0]!.json;
      if (!validated.valid) return reply(400, { ok: false, error: "invalid_payload", message: validated.reason });

      const found = rows.filter((row) => row[r.idCol] === validated[r.idKey]);
      const ev = runCode(code(r.wf, "Evaluate Matches"), found.length ? found : [{}], { "Validate Payload": [validated] })[0]!.json;
      const echo = { eventId: validated.eventId, [r.idKey]: validated[r.idKey] };

      if (ev.action === "duplicate") return reply(409, { ok: false, error: "duplicate_rows", message: `${ev.matchCount} rows share this ID` });
      if (r.create) {
        if (ev.action === "exists") return reply(200, { ok: true, result: "already_exists", ...echo, rowNumber: ev.rowNumber });
        rows.push({ ...validated.row, row_number: rows.length + 2 });
        return reply(200, { ok: true, result: "appended", ...echo, rowNumber: rows.length + 1 });
      }
      if (ev.action === "missing") return reply(404, { ok: false, error: "row_missing", message: "No sheet row has this ID." });
      const target = rows.find((row) => row.row_number === ev.rowNumber)!;
      for (const col of r.update) target[col] = validated.row[col];
      return reply(200, { ok: true, result: "updated", ...echo, rowNumber: ev.rowNumber });
    });
  });

  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  fake.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  fake.stop = () => new Promise<void>((r) => server.close(() => r()));
  return fake;
}
