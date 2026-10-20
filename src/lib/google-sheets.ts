import { createSign } from "node:crypto";
import { getEnv } from "@/lib/env";
import { SHEET_COLUMNS } from "@/lib/sheet-row";

/**
 * READ-ONLY access to the complaints worksheet, used only by reconciliation. All writes go through
 * n8n. We sign a service-account JWT ourselves (RS256) and call the Sheets REST API with `fetch`,
 * so no heavy Google SDK is needed. The credential only ever lives in server environment variables.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const TIMEOUT_MS = 20_000;

export type SheetsErrorCode = "not_configured" | "auth_failed" | "no_access" | "headers_mismatch" | "unavailable";
export class SheetsError extends Error {
  constructor(public readonly code: SheetsErrorCode, message: string) {
    super(message);
  }
}

export interface SheetsConfig {
  spreadsheetId: string;
  worksheetName: string;
  clientEmail: string;
  privateKey: string;
}

export function sheetsConfigFromEnv(): SheetsConfig | null {
  const env = getEnv();
  if (!env.GOOGLE_SHEETS_SPREADSHEET_ID || !env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) return null;
  return {
    spreadsheetId: env.GOOGLE_SHEETS_SPREADSHEET_ID,
    worksheetName: env.GOOGLE_SHEETS_WORKSHEET_NAME,
    clientEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: normalizePrivateKey(env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY),
  };
}

/** Env files and dashboards often store the key with literal "\n" and surrounding quotes. */
export function normalizePrivateKey(raw: string): string {
  return raw.trim().replace(/^["']|["']$/g, "").replace(/\\n/g, "\n");
}

const b64url = (v: string) => Buffer.from(v).toString("base64url");

export function signServiceAccountJwt(clientEmail: string, privateKey: string, now: Date): string {
  const iat = Math.floor(now.getTime() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: clientEmail, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 }));
  const signature = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(privateKey).toString("base64url");
  return `${header}.${claims}.${signature}`;
}

export interface SheetsDeps {
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

async function timedFetch(f: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await f(url, { ...init, signal: controller.signal });
  } catch {
    throw new SheetsError("unavailable", "Couldn't reach Google. Try again in a moment.");
  } finally {
    clearTimeout(timer);
  }
}

let cached: { key: string; token: string; expires: number } | undefined;

export async function getAccessToken(cfg: SheetsConfig, deps: SheetsDeps = {}): Promise<string> {
  const now = deps.now?.() ?? new Date();
  const key = `${cfg.clientEmail}`;
  if (cached && cached.key === key && cached.expires > now.getTime() + 60_000) return cached.token;

  let assertion: string;
  try {
    assertion = signServiceAccountJwt(cfg.clientEmail, cfg.privateKey, now);
  } catch {
    throw new SheetsError("auth_failed", "The Google service account private key could not be read. Check GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.");
  }
  const res = await timedFetch(deps.fetchImpl ?? fetch, TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const body = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
  if (!res.ok || !body?.access_token) {
    throw new SheetsError("auth_failed", "Google rejected the service account credentials. Check the email and private key.");
  }
  cached = { key, token: body.access_token, expires: now.getTime() + (body.expires_in ?? 3600) * 1000 };
  return body.access_token;
}

export function resetTokenCache() {
  cached = undefined;
}

export interface SheetRowRead {
  rowNumber: number; // 1-based, as shown in Google Sheets
  complaintId: string;
  status: string;
}

export interface SheetSnapshot {
  rows: SheetRowRead[];
  /** Rows that have content but no Complaint ID. */
  unidentifiedRows: number[];
}

const quoteSheet = (name: string) => `'${name.replace(/'/g, "''")}'`;
const lastColumn = String.fromCharCode("A".charCodeAt(0) + SHEET_COLUMNS.length - 1); // "P"

export async function readSheet(cfg: SheetsConfig, deps: SheetsDeps = {}): Promise<SheetSnapshot> {
  const token = await getAccessToken(cfg, deps);
  const range = encodeURIComponent(`${quoteSheet(cfg.worksheetName)}!A:${lastColumn}`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(cfg.spreadsheetId)}/values/${range}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`;
  const res = await timedFetch(deps.fetchImpl ?? fetch, url, { headers: { Authorization: `Bearer ${token}` } });

  if (res.status === 403 || res.status === 404) {
    throw new SheetsError("no_access", `The service account can't read this spreadsheet or worksheet. Share the spreadsheet with ${cfg.clientEmail} and check the spreadsheet ID and worksheet name.`);
  }
  if (res.status === 400) {
    throw new SheetsError("no_access", `Worksheet "${cfg.worksheetName}" was not found. Check GOOGLE_SHEETS_WORKSHEET_NAME.`);
  }
  if (!res.ok) throw new SheetsError("unavailable", `Google Sheets returned an error (HTTP ${res.status}). Try again in a moment.`);

  const body = (await res.json().catch(() => null)) as { values?: unknown[][] } | null;
  const values = body?.values ?? [];
  const headers = (values[0] ?? []).map((h) => String(h ?? "").trim());
  if (SHEET_COLUMNS.some((c, i) => headers[i] !== c)) {
    throw new SheetsError("headers_mismatch", `Row 1 of the worksheet must contain exactly these headers, in order: ${SHEET_COLUMNS.join(", ")}.`);
  }

  const statusIndex = SHEET_COLUMNS.indexOf("Status");
  const rows: SheetRowRead[] = [];
  const unidentifiedRows: number[] = [];
  values.slice(1).forEach((r, i) => {
    const rowNumber = i + 2;
    const id = String(r[0] ?? "").trim();
    if (id) rows.push({ rowNumber, complaintId: id, status: String(r[statusIndex] ?? "").trim() });
    else if (r.some((cell) => String(cell ?? "").trim() !== "")) unidentifiedRows.push(rowNumber);
  });
  return { rows, unidentifiedRows };
}
