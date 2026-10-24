import { ObjectId } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { generateTransferId, isValidTransferId, isValidComplaintId } from "@/lib/complaint-id";
import { sendToN8n } from "@/lib/n8n";
import { TRANSFER_COLUMNS, buildTransferSyncEvent, toTransferRow } from "@/lib/sheet-row";
import { buildTransferFilter } from "@/lib/transfer-service";
import { toTransferDetail, toTransferListItem } from "@/lib/transfer-view";
import { submitTransfer } from "@/lib/transfer-client";
import { acceptTransferSchema, buildAdminTransferSchema, buildPublicTransferSchema, parseTransferListQuery } from "@/lib/validation-transfer";
import { formOptionsSchema } from "@/lib/validation-admin";
import { sampleTransfer } from "./fixtures";

const OUTLETS = ["Malir", "Clifton", "Other"];

describe("transfer IDs", () => {
  it("use the TR prefix, the Karachi date and unambiguous characters", () => {
    const id = generateTransferId(new Date("2026-10-17T19:30:00Z"));
    expect(id).toMatch(/^TR-20261018-[A-HJKMNP-Z2-9]{4}$/);
    expect(isValidTransferId(id)).toBe(true);
  });
  it("are never mistaken for complaint IDs, and vice versa", () => {
    expect(isValidComplaintId("TR-20261018-B3M9")).toBe(false);
    expect(isValidTransferId("IT-20261018-B3M9")).toBe(false);
  });
  it("reject malformed IDs", () => {
    for (const bad of ["", "TR-2026-B3M9", "tr-20261018-b3m9", "TR-20261018-B3M0", "TR-20261018-B3M9X"]) expect(isValidTransferId(bad)).toBe(false);
  });
});

describe("public transfer form schema", () => {
  const schema = buildPublicTransferSchema(OUTLETS);
  const valid = { name: "Ayesha Khan", email: "Ayesha@Example.com", contact: "0300 1234567", outlet: "Malir", description: "Receipt printer with a faulty cutter." };

  it("accepts a complete submission and normalises it", () => {
    const r = schema.parse({ ...valid, name: "  Ayesha   Khan ", email: "  Ayesha@Example.COM " });
    expect(r).toMatchObject({ name: "Ayesha Khan", email: "ayesha@example.com", outlet: "Malir" });
  });
  it("requires every field", () => {
    const r = schema.safeParse({ name: "", email: "", contact: "", outlet: "", description: "" });
    expect(r.success).toBe(false);
    if (!r.success) expect(Object.keys(r.error.flatten().fieldErrors).sort()).toEqual(["contact", "description", "email", "name", "outlet"]);
  });
  it("gives the clearest message first for empty fields", () => {
    const r = schema.safeParse({ name: "", email: "", contact: "", outlet: "", description: "" });
    if (r.success) throw new Error("expected failure");
    const e = r.error.flatten().fieldErrors;
    expect(e.name?.[0]).toBe("Enter the name.");
    expect(e.email?.[0]).toBe("Enter an email address.");
    expect(e.contact?.[0]).toBe("Enter a phone number or extension.");
    expect(e.outlet?.[0]).toBe("Choose an outlet.");
    expect(e.description?.[0]).toBe("Describe the item.");
  });
  it("validates email format, contact format and the outlet list", () => {
    for (const email of ["nope", "a@b", "a b@c.com", "@x.com"]) expect(schema.safeParse({ ...valid, email }).success, email).toBe(false);
    for (const contact of ["abc", "1", "<script>"]) expect(schema.safeParse({ ...valid, contact }).success, contact).toBe(false);
    expect(schema.safeParse({ ...valid, outlet: "Narnia" }).success).toBe(false);
    expect(buildPublicTransferSchema(["Legal"]).safeParse({ ...valid, outlet: "Legal" }).success).toBe(true);
  });
  it("enforces the description limits", () => {
    expect(schema.safeParse({ ...valid, description: "abcd" }).success).toBe(false);
    expect(schema.safeParse({ ...valid, description: "x".repeat(2000) }).success).toBe(true);
    expect(schema.safeParse({ ...valid, description: "x".repeat(2001) }).success).toBe(false);
  });
  it("drops fields the public must not set (direction, status, dates, IDs)", () => {
    const r = schema.parse({ ...valid, direction: "from_it", status: "Received", createdAt: "2001-01-01", transferId: "TR-X", receivedBy: "me" }) as Record<string, unknown>;
    for (const k of ["direction", "status", "createdAt", "transferId", "receivedBy"]) expect(r[k]).toBeUndefined();
  });
});

describe("admin transfer form schema", () => {
  const schema = buildAdminTransferSchema(OUTLETS);
  it("defaults to From IT and makes email and contact optional", () => {
    const r = schema.parse({ name: "Bilal Ahmed", outlet: "Clifton", description: "Repaired card reader, returning.", email: "", contact: "" });
    expect(r.direction).toBe("from_it");
    expect(r.email).toBeUndefined();
    expect(r.contact).toBeUndefined();
  });
  it("accepts either direction and rejects others", () => {
    const base = { name: "Bilal Ahmed", outlet: "Clifton", description: "Repaired card reader." };
    expect(schema.parse({ ...base, direction: "to_it" }).direction).toBe("to_it");
    expect(schema.safeParse({ ...base, direction: "sideways" }).success).toBe(false);
  });
  it("still validates an email or contact when one is given", () => {
    const base = { name: "Bilal Ahmed", outlet: "Clifton", description: "Repaired card reader." };
    expect(schema.safeParse({ ...base, email: "nope" }).success).toBe(false);
    expect(schema.safeParse({ ...base, contact: "abc" }).success).toBe(false);
  });
});

describe("accept schema and list query", () => {
  it("accepts optional notes and turns blank into null", () => {
    expect(acceptTransferSchema.parse({})).toEqual({});
    expect(acceptTransferSchema.parse({ notes: "  " }).notes).toBeNull();
    expect(acceptTransferSchema.safeParse({ notes: "x".repeat(1001) }).success).toBe(false);
  });
  it("parses and validates list filters", () => {
    expect(parseTransferListQuery({ direction: "to_it", status: "In transit", q: " malir " })).toMatchObject({ ok: true, query: { direction: "to_it", status: "In transit", q: "malir", page: 1, pageSize: 25 } });
    for (const bad of [{ direction: "up" }, { status: "Lost" }, { page: "0" }, { pageSize: "7" }]) expect(parseTransferListQuery(bad).ok).toBe(false);
  });
  it("search text is escaped, never treated as a pattern", () => {
    const f = buildTransferFilter({ q: ".*(x)", page: 1, pageSize: 25 }) as { $or: { name?: { $regex: string } }[] };
    expect(f.$or[1]!.name!.$regex).toBe("\\.\\*\\(x\\)");
  });
});

describe("form options now include outlets", () => {
  it("outlets are optional (older clients keep working) but validated when sent", () => {
    expect(formOptionsSchema.safeParse({ departments: ["IT"], categories: ["Other"] }).success).toBe(true);
    expect(formOptionsSchema.safeParse({ departments: ["IT"], categories: ["Other"], outlets: ["Malir", " Malir "] }).success).toBe(false);
    expect(formOptionsSchema.safeParse({ departments: ["IT"], categories: ["Other"], outlets: [] }).success).toBe(false);
    expect(formOptionsSchema.parse({ departments: ["IT"], categories: ["Other"], outlets: [" Malir ", "Clifton"] }).outlets).toEqual(["Malir", "Clifton"]);
  });
});

describe("transfer sheet row", () => {
  it("has exactly the 16 columns in order", () => {
    expect(Object.keys(toTransferRow(sampleTransfer(), null, null))).toEqual([...TRANSFER_COLUMNS]);
    expect(TRANSFER_COLUMNS).toHaveLength(16);
  });
  it("renders an in-transit record: Karachi date/time, blank receipt cells, public logger", () => {
    const row = toTransferRow(sampleTransfer(), null, null);
    expect(row).toMatchObject({ "Transfer ID": "TR-20261018-B3M9", Direction: "To IT", Outlet: "Malir", Status: "In transit", Date: "18-Oct-2026", Time: "10:30 AM", "Logged By": "Outlet (public form)" });
    for (const c of ["Received Date", "Received Time", "Received By", "Receipt Notes"] as const) expect(row[c]).toBe("");
  });
  it("renders a received record and an admin-logged outbound record", () => {
    const receivedAt = new Date("2026-10-18T09:15:00Z");
    const row = toTransferRow(sampleTransfer({ status: "Received", receivedAt, updatedAt: receivedAt, receiptNotes: "Arrived intact." }), "IT Admin", null);
    expect(row).toMatchObject({ Status: "Received", "Received Date": "18-Oct-2026", "Received Time": "2:15 PM", "Received By": "IT Admin", "Receipt Notes": "Arrived intact." });
    expect(toTransferRow(sampleTransfer({ direction: "from_it", source: "admin", createdBy: "x" }), null, "IT Admin")).toMatchObject({ Direction: "From IT", "Logged By": "IT Admin" });
  });
  it("neutralises formula-looking text", () => {
    const row = toTransferRow(sampleTransfer({ name: "=HYPERLINK(\"http://evil\")", description: "+cmd", receiptNotes: "@SUM(1)" }), "=admin", null);
    for (const c of ["Name", "Description", "Receipt Notes", "Received By"] as const) expect(row[c].startsWith("'")).toBe(true);
  });
});

describe("transfer sync event and n8n routing", () => {
  const cfg = { newComplaintUrl: "https://n8n.example/c1", updateComplaintUrl: "https://n8n.example/c2", newTransferUrl: "https://n8n.example/t1", updateTransferUrl: "https://n8n.example/t2", secret: "s".repeat(40) };
  const created = buildTransferSyncEvent({ eventId: "transfer.created:TR-20261018-B3M9", type: "transfer.created", complaintId: "TR-20261018-B3M9" }, sampleTransfer(), null, null);
  const received = buildTransferSyncEvent({ eventId: "transfer.received:TR-20261018-B3M9:2", type: "transfer.received", complaintId: "TR-20261018-B3M9" }, sampleTransfer(), "IT Admin", null);
  const ok = (id: string, eventId: string, result: string) => vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, result, eventId, transferId: id })));

  it("carries the transfer ID (not a complaint ID) and the full row", () => {
    expect(created).toMatchObject({ schemaVersion: 1, eventType: "transfer.created", transferId: "TR-20261018-B3M9" });
    expect(created).not.toHaveProperty("complaintId");
    expect(created.row["Transfer ID"]).toBe(created.transferId);
  });
  it("sends created events to the transfer-created webhook and received events to the other", async () => {
    const a = ok("TR-20261018-B3M9", created.eventId, "appended");
    expect((await sendToN8n(created, { fetchImpl: a, config: cfg })).kind).toBe("success");
    expect(a.mock.calls[0]![0]).toBe(cfg.newTransferUrl);
    const b = ok("TR-20261018-B3M9", received.eventId, "updated");
    expect((await sendToN8n(received, { fetchImpl: b, config: cfg })).kind).toBe("success");
    expect(b.mock.calls[0]![0]).toBe(cfg.updateTransferUrl);
  });
  it("verifies the echoed TRANSFER ID: a reply for a different record is not success", async () => {
    const wrong = ok("TR-20261018-ZZZZ", created.eventId, "appended");
    expect((await sendToN8n(created, { fetchImpl: wrong, config: cfg })).kind).toBe("retryable");
    const complaintShaped = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, result: "appended", eventId: created.eventId, complaintId: "TR-20261018-B3M9" })));
    expect((await sendToN8n(created, { fetchImpl: complaintShaped, config: cfg })).kind).toBe("retryable");
  });
  it("is 'not configured' for transfers when only the complaint URLs are set, without calling out", async () => {
    const f = vi.fn();
    const onlyComplaints = { ...cfg, newTransferUrl: undefined, updateTransferUrl: undefined };
    expect((await sendToN8n(created, { fetchImpl: f, config: onlyComplaints })).kind).toBe("not_configured");
    expect((await sendToN8n(received, { fetchImpl: f, config: onlyComplaints })).kind).toBe("not_configured");
    expect(f).not.toHaveBeenCalled();
  });
});

describe("transfer view models", () => {
  it("formats a list item and truncates long descriptions", () => {
    const item = toTransferListItem(sampleTransfer({ description: "x".repeat(300) }), new Map());
    expect(item).toMatchObject({ directionLabel: "To IT", date: "18-Oct-2026", time: "10:30 AM", status: "In transit", receivedAt: null });
    expect(item.descriptionPreview.length).toBeLessThanOrEqual(120);
  });
  it("names administrators in the detail history, and the public submitter as the outlet", () => {
    const admin = new ObjectId().toHexString();
    const t = sampleTransfer({ status: "Received", receivedAt: new Date("2026-10-18T09:15:00Z"), receivedBy: admin, history: [
      { at: new Date("2026-10-18T05:30:00Z"), action: "created", actor: "public", note: null },
      { at: new Date("2026-10-18T09:15:00Z"), action: "received", actor: admin, note: "Intact" },
    ] });
    const d = toTransferDetail(t, new Map([[admin, "IT Admin"]]));
    expect(d.receivedByName).toBe("IT Admin");
    expect(d.history.map((h) => [h.label, h.actor])).toEqual([["Item recorded as sent to IT", "Outlet (public form)"], ["Item received by IT", "IT Admin"]]);
  });
});

describe("submitTransfer (browser helper)", () => {
  const values = { name: "A B" };
  const reply = (status: number, body: unknown) => vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  it("maps every outcome", async () => {
    expect(await submitTransfer("/api/transfers", values, reply(201, { ok: true, data: { transferId: "TR-20261018-B3M9" } }))).toEqual({ kind: "success", transferId: "TR-20261018-B3M9" });
    expect((await submitTransfer("/x", values, reply(422, { ok: false, error: { fieldErrors: { email: ["bad"] } } }))).kind).toBe("field-errors");
    expect((await submitTransfer("/x", values, reply(429, { ok: false, error: {} }))).kind).toBe("rate-limited");
    expect((await submitTransfer("/x", values, reply(503, { ok: false, error: {} }))).kind).toBe("unavailable");
    expect((await submitTransfer("/x", values, reply(200, { ok: true, data: {} }))).kind).toBe("error"); // never success without an ID
    expect((await submitTransfer("/x", values, vi.fn().mockRejectedValue(new TypeError("fetch failed")))).kind).toBe("uncertain");
  });
});
