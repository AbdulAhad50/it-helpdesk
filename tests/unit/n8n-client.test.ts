import { describe, expect, it, vi } from "vitest";
import { isAllowedWebhookUrl, sendToN8n } from "@/lib/n8n";
import { buildSyncEvent } from "@/lib/sheet-row";
import { sampleComplaint } from "./fixtures";

const ID = "IT-20261018-A7K2";
const created = buildSyncEvent({ eventId: `complaint.created:${ID}`, type: "complaint.created", complaintId: ID }, sampleComplaint(), null);
const resolved = buildSyncEvent({ eventId: `complaint.resolved:${ID}:2`, type: "complaint.resolved", complaintId: ID }, sampleComplaint(), null);
const config = { newComplaintUrl: "https://n8n.example/webhook/helpdesk/complaint-created", updateComplaintUrl: "https://n8n.example/webhook/helpdesk/complaint-updated", secret: "s".repeat(40) };
const reply = (status: number, body: unknown) => vi.fn().mockResolvedValue(new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));

describe("sendToN8n", () => {
  it("sends the event with the secret header and routes by event type", async () => {
    const f = reply(200, { ok: true, result: "appended", eventId: created.eventId, complaintId: ID, rowNumber: 7 });
    expect(await sendToN8n(created, { fetchImpl: f, config })).toEqual({ kind: "success", result: "appended", rowNumber: 7 });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe(config.newComplaintUrl);
    expect(init.headers["X-Webhook-Secret"]).toBe(config.secret);
    expect(init.redirect).toBe("error");
    expect(JSON.parse(init.body).row["Complaint ID"]).toBe(ID);

    const g = reply(200, { ok: true, result: "updated", eventId: resolved.eventId, complaintId: ID });
    await sendToN8n(resolved, { fetchImpl: g, config });
    expect(g.mock.calls[0]![0]).toBe(config.updateComplaintUrl);
  });

  it("accepts an idempotent 'already_exists' as success", async () => {
    const f = reply(200, { ok: true, result: "already_exists", eventId: created.eventId, complaintId: ID, rowNumber: 3 });
    expect((await sendToN8n(created, { fetchImpl: f, config })).kind).toBe("success");
  });

  it("does NOT count a bare 200, or a reply for a different event, as success", async () => {
    for (const body of ["OK", {}, { ok: true }, { ok: true, result: "appended", eventId: "other", complaintId: ID }, { ok: true, result: "appended", eventId: created.eventId, complaintId: "IT-20261018-ZZZZ" }, { ok: true, result: "weird", eventId: created.eventId, complaintId: ID }]) {
      expect((await sendToN8n(created, { fetchImpl: reply(200, body), config })).kind).toBe("retryable");
    }
  });

  it("maps sheet integrity problems to 'integrity' (never retried blindly)", async () => {
    expect(await sendToN8n(resolved, { fetchImpl: reply(404, { ok: false, error: "row_missing", message: "No row" }), config })).toMatchObject({ kind: "integrity", code: "row_missing" });
    expect(await sendToN8n(resolved, { fetchImpl: reply(409, { ok: false, error: "duplicate_rows", message: "2 rows" }), config })).toMatchObject({ kind: "integrity", code: "duplicate_rows" });
  });

  it("maps invalid_payload to 'rejected' and sheet errors to retryable", async () => {
    expect((await sendToN8n(created, { fetchImpl: reply(400, { ok: false, error: "invalid_payload", message: "bad" }), config })).kind).toBe("rejected");
    expect((await sendToN8n(created, { fetchImpl: reply(502, { ok: false, error: "sheets_error", message: "quota" }), config })).kind).toBe("retryable");
  });

  it("treats auth failures, missing webhooks, 5xx and non-JSON as retryable", async () => {
    expect(await sendToN8n(created, { fetchImpl: reply(403, "Forbidden"), config })).toMatchObject({ kind: "retryable", message: expect.stringMatching(/secret/i) });
    expect(await sendToN8n(created, { fetchImpl: reply(404, { code: 404, message: "webhook not registered" }), config })).toMatchObject({ kind: "retryable", message: expect.stringMatching(/not found/i) });
    expect((await sendToN8n(created, { fetchImpl: reply(500, "<html>"), config })).kind).toBe("retryable");
  });

  it("treats network errors and timeouts as retryable", async () => {
    expect(await sendToN8n(created, { fetchImpl: vi.fn().mockRejectedValue(new TypeError("fetch failed")), config })).toMatchObject({ kind: "retryable" });
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    expect(await sendToN8n(created, { fetchImpl: vi.fn().mockRejectedValue(abort), config })).toMatchObject({ kind: "retryable", message: expect.stringMatching(/in time/) });
  });

  it("reports 'not_configured' without calling out when URLs or secret are missing", async () => {
    const f = vi.fn();
    expect((await sendToN8n(created, { fetchImpl: f, config: {} })).kind).toBe("not_configured");
    expect((await sendToN8n(created, { fetchImpl: f, config: { ...config, secret: undefined } })).kind).toBe("not_configured");
    expect((await sendToN8n(created, { fetchImpl: f, config: { ...config, newComplaintUrl: "http://n8n.example/hook" } })).kind).toBe("not_configured");
    expect(f).not.toHaveBeenCalled();
  });
});

describe("isAllowedWebhookUrl", () => {
  it("requires https, except localhost outside production", () => {
    expect(isAllowedWebhookUrl("https://x.app.n8n.cloud/webhook/a", "production")).toBe(true);
    expect(isAllowedWebhookUrl("http://x.example/a", "production")).toBe(false);
    expect(isAllowedWebhookUrl("http://localhost:5678/webhook/a", "production")).toBe(false);
    expect(isAllowedWebhookUrl("http://localhost:5678/webhook/a", "development")).toBe(true);
    expect(isAllowedWebhookUrl("http://evil.example/a", "development")).toBe(false);
    expect(isAllowedWebhookUrl("not a url", "development")).toBe(false);
  });
});
