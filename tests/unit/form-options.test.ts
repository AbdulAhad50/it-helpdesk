import { describe, expect, it } from "vitest";
import { formOptionsSchema } from "@/lib/validation-admin";

describe("formOptionsSchema", () => {
  it("cleans, trims and drops blank lines, keeping order", () => {
    const r = formOptionsSchema.parse({ departments: ["  IT ", "", "HR\u0000", "  "], categories: ["Other"] });
    expect(r.departments).toEqual(["IT", "HR"]);
  });
  it("needs at least one of each", () => {
    const r = formOptionsSchema.safeParse({ departments: ["", " "], categories: [] });
    expect(r.success).toBe(false);
  });
  it("rejects duplicates ignoring case, over-long entries and too many entries", () => {
    expect(formOptionsSchema.safeParse({ departments: ["IT", "it"], categories: ["A"] }).success).toBe(false);
    expect(formOptionsSchema.safeParse({ departments: ["x".repeat(101)], categories: ["A"] }).success).toBe(false);
    expect(formOptionsSchema.safeParse({ departments: Array.from({ length: 51 }, (_, i) => `D${i}`), categories: ["A"] }).success).toBe(false);
    expect(formOptionsSchema.safeParse({ departments: Array.from({ length: 50 }, (_, i) => `D${i}`), categories: ["A"] }).success).toBe(true);
  });
  it("rejects non-array input", () => {
    expect(formOptionsSchema.safeParse({ departments: "IT", categories: ["A"] }).success).toBe(false);
    expect(formOptionsSchema.safeParse({ departments: [1], categories: ["A"] }).success).toBe(false);
  });
});
