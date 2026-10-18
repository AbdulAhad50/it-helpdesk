import { describe, expect, it } from "vitest";
import { backoffMs, planTransition, sanitizeSyncError } from "@/lib/sync-service";

const now = new Date("2026-10-18T06:00:00Z");
const job = { attempts: 0, maxAttempts: 8 };

describe("planTransition", () => {
  it("success with nothing else waiting → job done and complaint synced", () => {
    const t = planTransition(job, { kind: "success", result: "appended", rowNumber: 5 }, now, 0);
    expect(t.outcome).toBe("done");
    expect(t.job).toMatchObject({ status: "done", attempts: 1, lastError: null, lockedUntil: null, completedAt: now });
    expect(t.complaint).toMatchObject({ syncState: "synced", googleSheetSynced: true, googleSheetSyncedAt: now, syncError: null });
  });

  it("success while another job is still open must NOT mark the complaint synced", () => {
    const t = planTransition(job, { kind: "success", result: "updated", rowNumber: 5 }, now, 1);
    expect(t.job.status).toBe("done");
    expect(t.complaint).toBeNull();
  });

  it("retryable failure → pending with backoff and an error recorded, attempt counted", () => {
    const t = planTransition({ attempts: 2, maxAttempts: 8 }, { kind: "retryable", message: "Couldn't reach n8n." }, now, 0, () => 0);
    expect(t.outcome).toBe("retry");
    expect(t.job).toMatchObject({ status: "pending", attempts: 3, lastError: "Couldn't reach n8n.", lockedUntil: null });
    expect(t.job.nextAttemptAt!.getTime()).toBe(now.getTime() + 120_000); // 30s * 2^(3-1)
    expect(t.complaint).toMatchObject({ syncState: "pending", syncError: "Couldn't reach n8n." });
  });

  it("gives up after the maximum attempts: job dead, complaint failed", () => {
    const t = planTransition({ attempts: 7, maxAttempts: 8 }, { kind: "retryable", message: "still down" }, now, 0);
    expect(t.outcome).toBe("dead");
    expect(t.job.status).toBe("dead");
    expect(t.complaint).toMatchObject({ syncState: "failed" });
  });

  it("integrity problems go straight to needs_reconciliation (no retry)", () => {
    const t = planTransition(job, { kind: "integrity", code: "row_missing", message: "No row" }, now, 0);
    expect(t.outcome).toBe("failed");
    expect(t.job.status).toBe("failed");
    expect(t.complaint).toMatchObject({ syncState: "needs_reconciliation" });
  });

  it("a rejected payload is dead immediately", () => {
    const t = planTransition(job, { kind: "rejected", message: "bad" }, now, 0);
    expect(t.job.status).toBe("dead");
    expect(t.complaint).toMatchObject({ syncState: "failed" });
  });

  it("not_configured keeps the job pending and consumes no attempt", () => {
    const t = planTransition({ attempts: 3, maxAttempts: 8 }, { kind: "not_configured", message: "Awaiting configuration." }, now, 0);
    expect(t.outcome).toBe("not_configured");
    expect(t.job.status).toBe("pending");
    expect(t.job).not.toHaveProperty("attempts");
    expect(t.job.nextAttemptAt!.getTime()).toBe(now.getTime() + 5 * 60_000);
    expect(t.complaint).toMatchObject({ syncState: "pending", syncError: "Awaiting configuration." });
  });

  it("never touches updatedAt/version on the complaint (sync status is not a business edit)", () => {
    for (const result of [
      { kind: "success", result: "appended", rowNumber: null },
      { kind: "retryable", message: "x" },
      { kind: "integrity", code: "duplicate_rows", message: "x" },
    ] as const) {
      const c = planTransition(job, result, now, 0).complaint ?? {};
      expect(Object.keys(c)).not.toContain("updatedAt");
      expect(Object.keys(c)).not.toContain("version");
    }
  });
});

describe("backoffMs", () => {
  it("grows exponentially and is capped at one hour (plus jitter)", () => {
    const seq = [1, 2, 3, 4, 5, 6, 7, 8, 9, 20].map((n) => backoffMs(n, () => 0));
    expect(seq.slice(0, 7)).toEqual([30_000, 60_000, 120_000, 240_000, 480_000, 960_000, 1_920_000]);
    expect(seq[7]).toBe(3_600_000);
    expect(seq[9]).toBe(3_600_000);
    expect(backoffMs(20, () => 1)).toBe(4_320_000);
  });
});

describe("sanitizeSyncError", () => {
  it("removes URLs and token-shaped strings and truncates", () => {
    const s = sanitizeSyncError("failed calling https://x.app.n8n.cloud/webhook/abc?token=123 with key " + "A".repeat(40) + " " + "z".repeat(500));
    expect(s).not.toContain("n8n.cloud");
    expect(s).not.toContain("A".repeat(40));
    expect(s.length).toBeLessThanOrEqual(200);
  });
});
