import { describe, expect, it, vi } from "vitest";
import { submitComplaint } from "@/lib/complaint-client";

const values = { userName: "A B", department: "IT", problemCategory: "Other", problemDescription: "Something is broken", priority: "Normal" as const };
const json = (status: number, body: unknown) => vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe("submitComplaint", () => {
  it("returns the complaint ID on 201", async () => {
    const f = json(201, { ok: true, data: { complaintId: "IT-20261018-A7K2", receivedAt: "2026-10-18T05:30:00.000Z" } });
    expect(await submitComplaint(values, f)).toEqual({ kind: "success", complaintId: "IT-20261018-A7K2", receivedAt: "2026-10-18T05:30:00.000Z" });
    expect(f).toHaveBeenCalledWith("/api/complaints", expect.objectContaining({ method: "POST" }));
  });

  it("maps 422 to field errors", async () => {
    const r = await submitComplaint(values, json(422, { ok: false, error: { code: "VALIDATION_FAILED", message: "Fix", fieldErrors: { userName: ["Too short"] } } }));
    expect(r).toEqual({ kind: "field-errors", message: "Fix", fieldErrors: { userName: ["Too short"] } });
  });

  it("maps 429 and 503 to distinct states", async () => {
    expect((await submitComplaint(values, json(429, { ok: false, error: { message: "Slow down" } }))).kind).toBe("rate-limited");
    expect((await submitComplaint(values, json(503, { ok: false, error: { message: "Down" } }))).kind).toBe("unavailable");
  });

  it("never reports success for an unexpected 200 without a complaint ID", async () => {
    expect((await submitComplaint(values, json(200, { ok: true, data: {} }))).kind).toBe("error");
  });

  it("handles non-JSON error pages", async () => {
    const f = vi.fn().mockResolvedValue(new Response("<html>Bad gateway</html>", { status: 502 }));
    expect((await submitComplaint(values, f)).kind).toBe("error");
  });

  it("reports an uncertain outcome (not failure, not success) when the network drops", async () => {
    const r = await submitComplaint(values, vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    expect(r.kind).toBe("uncertain");
  });
});
