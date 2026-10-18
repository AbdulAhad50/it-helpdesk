import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES, DEFAULT_DEPARTMENTS } from "@/lib/constants";
import { buildComplaintInputSchema, cleanMultiline, cleanSingleLine, toFieldErrors } from "@/lib/validation";

const schema = buildComplaintInputSchema({ departments: DEFAULT_DEPARTMENTS, categories: DEFAULT_CATEGORIES });
const valid = {
  userName: "Ayesha Khan",
  department: "Finance & Accounts",
  problemCategory: "Printer / Scanner",
  problemDescription: "The printer on the second floor shows a paper jam but the tray is empty.",
};

describe("public complaint schema", () => {
  it("accepts a minimal valid complaint and applies defaults", () => {
    const r = schema.parse(valid);
    expect(r.priority).toBe("Normal");
    expect(r.contactNumber).toBeUndefined();
  });

  it("trims and normalises text", () => {
    const r = schema.parse({ ...valid, userName: "  Ayesha   Khan \u0000 ", problemDescription: `  ${valid.problemDescription}  \n\n\n\n` });
    expect(r.userName).toBe("Ayesha Khan");
    expect(r.problemDescription.endsWith("empty.")).toBe(true);
  });

  it("rejects empty and whitespace-only names", () => {
    for (const userName of ["", "   ", "\n\t"]) {
      expect(schema.safeParse({ ...valid, userName }).success).toBe(false);
    }
  });

  it("reports field-level errors", () => {
    const r = schema.safeParse({ userName: "", department: "Mars", problemCategory: "", problemDescription: "short" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const errs = toFieldErrors(r.error);
      expect(Object.keys(errs).sort()).toEqual(["department", "problemCategory", "problemDescription", "userName"]);
    }
  });

  it("enforces the 3,000 character description limit", () => {
    expect(schema.safeParse({ ...valid, problemDescription: "a".repeat(3000) }).success).toBe(true);
    expect(schema.safeParse({ ...valid, problemDescription: "a".repeat(3001) }).success).toBe(false);
  });

  it("only accepts configured departments and categories", () => {
    expect(schema.safeParse({ ...valid, department: "Narnia" }).success).toBe(false);
    const custom = buildComplaintInputSchema({ departments: ["Legal"], categories: ["Other"] });
    expect(custom.safeParse({ ...valid, department: "Legal", problemCategory: "Other" }).success).toBe(true);
    expect(custom.safeParse(valid).success).toBe(false);
  });

  it("validates priority and treats empty as Normal", () => {
    expect(schema.parse({ ...valid, priority: "" }).priority).toBe("Normal");
    expect(schema.parse({ ...valid, priority: "Critical" }).priority).toBe("Critical");
    expect(schema.safeParse({ ...valid, priority: "Urgent" }).success).toBe(false);
  });

  it.each(["0300 1234567", "+92 300 1234567", "(021) 3456-7890", "204", "ext 204", "x204"])("accepts contact %s", (contactNumber) => {
    expect(schema.safeParse({ ...valid, contactNumber }).success).toBe(true);
  });
  it.each(["abc", "1", "<script>", "12345678901234567890123456789012345"])("rejects contact %s", (contactNumber) => {
    expect(schema.safeParse({ ...valid, contactNumber }).success).toBe(false);
  });
  it("treats a blank contact number as not provided", () => {
    expect(schema.parse({ ...valid, contactNumber: "   " }).contactNumber).toBeUndefined();
  });

  it("drops fields the public must not set", () => {
    const r = schema.parse({ ...valid, status: "Resolved", receivedAt: "2001-01-01", complaintId: "IT-X", solvedAt: "2001-01-01" }) as Record<string, unknown>;
    expect(r.status).toBeUndefined();
    expect(r.receivedAt).toBeUndefined();
    expect(r.complaintId).toBeUndefined();
    expect(r.solvedAt).toBeUndefined();
  });
});

describe("sanitisers", () => {
  it("removes control and zero-width characters", () => {
    expect(cleanSingleLine("a\u0007b\u200Bc")).toBe("a b c");
    expect(cleanMultiline("line1\r\n\r\n\r\n\r\nline2\u0000")).toBe("line1\n\nline2");
  });
  it("keeps angle brackets as literal text (output is escaped, not stripped)", () => {
    expect(cleanMultiline("Press <Enter> twice")).toBe("Press <Enter> twice");
  });
});

describe("empty required fields give the clearest message first", () => {
  it("uses 'Choose…' / 'Enter…' wording, not list-membership wording", () => {
    const r = schema.safeParse({ userName: "", department: "", problemCategory: "", problemDescription: "" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const e = toFieldErrors(r.error);
      expect(e.userName?.[0]).toBe("Enter your name.");
      expect(e.department?.[0]).toBe("Choose your department.");
      expect(e.problemCategory?.[0]).toBe("Choose a problem category.");
      expect(e.problemDescription?.[0]).toBe("Describe the problem.");
    }
  });
});
