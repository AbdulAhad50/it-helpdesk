import { describe, expect, it } from "vitest";
import { generateComplaintId, isValidComplaintId } from "@/lib/complaint-id";

describe("complaint IDs", () => {
  it("matches the IT-YYYYMMDD-XXXX format using the Karachi date", () => {
    const id = generateComplaintId(new Date("2026-10-17T19:30:00Z"));
    expect(id).toMatch(/^IT-20261018-[A-Z2-9]{4}$/);
    expect(isValidComplaintId(id)).toBe(true);
  });
  it("never uses ambiguous characters", () => {
    for (let i = 0; i < 500; i++) expect(generateComplaintId().slice(-4)).not.toMatch(/[01ILO]/);
  });
  it("is random enough that 2,000 IDs rarely collide (the unique index handles the rest)", () => {
    const ids = new Set(Array.from({ length: 2000 }, () => generateComplaintId()));
    expect(ids.size).toBeGreaterThan(1990);
  });
  it("rejects malformed IDs", () => {
    for (const bad of ["", "IT-2026-A7K2", "it-20261018-a7k2", "IT-20261018-A7K0", "IT-20261018-A7K2X", "../etc/passwd"]) {
      expect(isValidComplaintId(bad)).toBe(false);
    }
  });
});
