import { createVerify, generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { compareSheetToDatabase } from "@/lib/reconcile";
import { SHEET_COLUMNS } from "@/lib/sheet-row";
import { SheetsError, normalizePrivateKey, readSheet, resetTokenCache, signServiceAccountJwt, type SheetsConfig } from "@/lib/google-sheets";

const row = (id: string, status: string, rowNumber: number) => ({ rowNumber, complaintId: id, status });
const c = (id: string, status: "Pending" | "Resolved" = "Pending") => ({ complaintId: id, status, version: 1 });

describe("compareSheetToDatabase", () => {
  it("classifies consistent, missing, duplicate, status-mismatch and orphan rows by exact ID", () => {
    const f = compareSheetToDatabase(
      [row("IT-1", "Pending", 2), row("IT-3", "Pending", 3), row("IT-3", "Pending", 4), row("IT-4", "Pending", 5), row("IT-X", "Pending", 6)],
      [c("IT-1"), c("IT-2"), c("IT-3"), c("IT-4", "Resolved")],
    );
    expect(f.consistent).toEqual(["IT-1"]);
    expect(f.missing).toEqual(["IT-2"]);
    expect(f.duplicates).toEqual([{ complaintId: "IT-3", rows: [3, 4] }]);
    expect(f.statusMismatches).toEqual([{ complaintId: "IT-4", sheetStatus: "Pending", dbStatus: "Resolved", rowNumber: 5 }]);
    expect(f.orphans).toEqual([{ complaintId: "IT-X", rowNumber: 6 }]);
  });
  it("does not check status on duplicated IDs (they need a human first)", () => {
    const f = compareSheetToDatabase([row("IT-1", "Resolved", 2), row("IT-1", "Pending", 3)], [c("IT-1")]);
    expect(f.duplicates).toHaveLength(1);
    expect(f.statusMismatches).toHaveLength(0);
  });
  it("is case-sensitive: a lower-case ID in the sheet is not a match", () => {
    const f = compareSheetToDatabase([row("it-1", "Pending", 2)], [c("IT-1")]);
    expect(f.missing).toEqual(["IT-1"]);
    expect(f.orphans).toHaveLength(1);
  });
  it("handles empty inputs", () => {
    expect(compareSheetToDatabase([], [])).toEqual({ missing: [], duplicates: [], orphans: [], statusMismatches: [], consistent: [] });
    expect(compareSheetToDatabase([], [c("IT-1")]).missing).toEqual(["IT-1"]);
  });
});

describe("service-account JWT", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  it("is a correctly signed RS256 token with the right claims and a one-hour life", () => {
    const now = new Date("2026-10-18T10:00:00Z");
    const jwt = signServiceAccountJwt("svc@proj.iam.gserviceaccount.com", privateKey, now);
    const [h, p, s] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h!, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = JSON.parse(Buffer.from(p!, "base64url").toString());
    expect(claims).toMatchObject({ iss: "svc@proj.iam.gserviceaccount.com", scope: "https://www.googleapis.com/auth/spreadsheets.readonly", aud: "https://oauth2.googleapis.com/token" });
    expect(claims.exp - claims.iat).toBe(3600);
    expect(createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(s!, "base64url"))).toBe(true);
  });
  it("only asks for READ-ONLY access", () => {
    const claims = JSON.parse(Buffer.from(signServiceAccountJwt("a@b", privateKey, new Date()).split(".")[1]!, "base64url").toString());
    expect(claims.scope).toMatch(/readonly$/);
  });
  it("repairs a key pasted with literal \\n sequences and quotes", () => {
    const flat = `"${privateKey.replace(/\n/g, "\\n")}"`;
    const fixed = normalizePrivateKey(flat);
    expect(fixed).toBe(privateKey);
    expect(() => signServiceAccountJwt("a@b", fixed, new Date())).not.toThrow(); // and it really signs
  });

  describe("readSheet", () => {
    const cfg: SheetsConfig = { spreadsheetId: "sheet-1", worksheetName: "IT Complaints", clientEmail: "svc@proj.iam.gserviceaccount.com", privateKey };
    const headers = [...SHEET_COLUMNS] as string[];
    const full = (id: string, status: string) => { const r = Array(16).fill(""); r[0] = id; r[12] = status; return r; };
    const fetcher = (sheetRes: Response) =>
      vi.fn(async (url: string | URL | Request, _init?: RequestInit) => (String(url).includes("oauth2") ? new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 })) : sheetRes));
    beforeEach(() => resetTokenCache());

    it("reads rows with their sheet row numbers, trims IDs, and reports unidentified rows", async () => {
      const f = fetcher(new Response(JSON.stringify({ values: [headers, full("IT-1", "Pending"), full(" IT-2 ", "Resolved"), [], full("", ""), (() => { const r = Array(16).fill(""); r[4] = "stray text"; return r; })()] })));
      const snap = await readSheet(cfg, { fetchImpl: f as never });
      expect(snap.rows).toEqual([{ rowNumber: 2, complaintId: "IT-1", status: "Pending" }, { rowNumber: 3, complaintId: "IT-2", status: "Resolved" }]);
      expect(snap.unidentifiedRows).toEqual([6]);
      const sheetCall = String(f.mock.calls[1]![0]);
      expect(sheetCall).toContain("/spreadsheets/sheet-1/values/");
      expect(decodeURIComponent(sheetCall)).toContain("'IT Complaints'!A:P");
      expect((f.mock.calls[1]![1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer tok" });
    });
    it("refuses a sheet whose headers aren't exactly the expected ones, in order", async () => {
      const swapped = [...headers]; [swapped[1], swapped[2]] = [swapped[2]!, swapped[1]!];
      await expect(readSheet(cfg, { fetchImpl: fetcher(new Response(JSON.stringify({ values: [swapped] }))) as never })).rejects.toMatchObject({ code: "headers_mismatch" });
      resetTokenCache();
      await expect(readSheet(cfg, { fetchImpl: fetcher(new Response(JSON.stringify({}))) as never })).rejects.toMatchObject({ code: "headers_mismatch" });
    });
    it("explains access problems without leaking tokens", async () => {
      for (const status of [403, 404]) {
        resetTokenCache();
        const err = await readSheet(cfg, { fetchImpl: fetcher(new Response("{}", { status })) as never }).catch((e) => e);
        expect(err).toBeInstanceOf(SheetsError);
        expect(err.code).toBe("no_access");
        expect(err.message).toContain("svc@proj.iam.gserviceaccount.com");
        expect(err.message).not.toContain("tok");
      }
    });
    it("reports bad credentials and network failures distinctly", async () => {
      const badAuth = vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
      await expect(readSheet(cfg, { fetchImpl: badAuth as never })).rejects.toMatchObject({ code: "auth_failed" });
      await expect(readSheet(cfg, { fetchImpl: vi.fn().mockRejectedValue(new TypeError("fetch failed")) as never })).rejects.toMatchObject({ code: "unavailable" });
      await expect(readSheet({ ...cfg, privateKey: "not a key" }, { fetchImpl: badAuth as never })).rejects.toMatchObject({ code: "auth_failed" });
    });
    it("reuses a valid access token instead of requesting a new one each time", async () => {
      const f = fetcher(new Response(JSON.stringify({ values: [headers] })));
      await readSheet(cfg, { fetchImpl: f as never });
      const g = vi.fn(async () => new Response(JSON.stringify({ values: [headers] })));
      await readSheet(cfg, { fetchImpl: g as never });
      expect(g).toHaveBeenCalledTimes(1); // only the sheet call: no second token request
    });
  });
});
