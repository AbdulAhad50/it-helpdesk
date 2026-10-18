import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/password";
import { checkPasswordPolicy } from "@/lib/password-policy";

describe("password hashing", () => {
  it("uses Argon2id and never stores the plain text", async () => {
    const h = await hashPassword("a long enough passphrase");
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(h).not.toContain("passphrase");
  });
  it("verifies the right password and rejects the wrong one", async () => {
    const h = await hashPassword("a long enough passphrase");
    expect(await verifyPassword(h, "a long enough passphrase")).toBe(true);
    expect(await verifyPassword(h, "a long enough passphrasE")).toBe(false);
  });
  it("salts every hash", async () => {
    expect(await hashPassword("same password here")).not.toBe(await hashPassword("same password here"));
  });
  it("treats a malformed stored hash as a failed login, not a crash", async () => {
    expect(await verifyPassword("not-a-hash", "whatever password")).toBe(false);
    expect(await verifyPassword("", "whatever password")).toBe(false);
  });
});

describe("password policy", () => {
  it("accepts a long passphrase", () => {
    expect(checkPasswordPolicy("purple-tractor-notebook-42", { email: "it@company.com" })).toEqual([]);
  });
  it("enforces length bounds", () => {
    expect(checkPasswordPolicy("short")).not.toEqual([]);
    expect(checkPasswordPolicy("a".repeat(129)).join(" ")).toMatch(/128/);
  });
  it("rejects common passwords case-insensitively", () => {
    expect(checkPasswordPolicy("Password1234").join(" ")).toMatch(/common/);
  });
  it("rejects a single repeated character and passwords containing the email name", () => {
    expect(checkPasswordPolicy("zzzzzzzzzzzzzz").join(" ")).toMatch(/repeat/);
    expect(checkPasswordPolicy("ayesha.khan-2026!", { email: "ayesha.khan@company.com" }).join(" ")).toMatch(/email/);
  });
});
