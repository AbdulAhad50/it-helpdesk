import { getEnv } from "@/lib/env";
import type { SyncEvent, TransferSyncEvent } from "@/lib/sheet-row";

/**
 * What happened when we asked n8n to sync one event. Success is only ever reported when n8n's
 * own response says the Google Sheets node confirmed the write AND echoes our event.
 */
export type N8nResult =
  | { kind: "success"; result: "appended" | "already_exists" | "updated"; rowNumber: number | null }
  /** The sheet and MongoDB disagree: needs a human or reconciliation. Never auto-retried, never "fixed" by inserting. */
  | { kind: "integrity"; code: "row_missing" | "duplicate_rows"; message: string }
  /** n8n says our payload is invalid: retrying cannot help. */
  | { kind: "rejected"; message: string }
  /** Temporary: network, timeout, Google Sheets error, wrong secret, workflow inactive. */
  | { kind: "retryable"; message: string }
  | { kind: "not_configured"; message: string };

export interface N8nConfig {
  newComplaintUrl?: string;
  updateComplaintUrl?: string;
  newTransferUrl?: string;
  updateTransferUrl?: string;
  secret?: string;
}

export interface N8nDeps {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  config?: N8nConfig;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const SUCCESS_RESULTS = new Set(["appended", "already_exists", "updated"]);

function configFromEnv(): N8nConfig {
  const env = getEnv();
  return {
    newComplaintUrl: env.N8N_NEW_COMPLAINT_WEBHOOK_URL,
    updateComplaintUrl: env.N8N_UPDATE_COMPLAINT_WEBHOOK_URL,
    newTransferUrl: env.N8N_TRANSFER_CREATED_WEBHOOK_URL,
    updateTransferUrl: env.N8N_TRANSFER_UPDATED_WEBHOOK_URL,
    secret: env.N8N_WEBHOOK_SECRET,
  };
}

/** The webhook carries a shared secret and personal data, so it must be https (http only for local development). */
export function isAllowedWebhookUrl(url: string, nodeEnv = process.env.NODE_ENV): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === "https:") return true;
    return nodeEnv !== "production" && u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname);
  } catch {
    return false;
  }
}

const webhookUrl = (event: SyncEvent | TransferSyncEvent, cfg: N8nConfig) =>
  event.eventType === "complaint.created"
    ? cfg.newComplaintUrl
    : event.eventType === "transfer.created"
      ? cfg.newTransferUrl
      : event.eventType === "transfer.received"
        ? cfg.updateTransferUrl
        : cfg.updateComplaintUrl;

export async function sendToN8n(event: SyncEvent | TransferSyncEvent, deps: N8nDeps = {}): Promise<N8nResult> {
  const cfg = deps.config ?? configFromEnv();
  const recordId = "transferId" in event ? { key: "transferId", value: event.transferId } : { key: "complaintId", value: event.complaintId };
  const url = webhookUrl(event, cfg);
  if (!url || !cfg.secret) {
    return { kind: "not_configured", message: "Spreadsheet sync is awaiting configuration (n8n webhook URLs or secret not set)." };
  }
  if (!isAllowedWebhookUrl(url)) {
    return { kind: "not_configured", message: "The n8n webhook URL must use https." };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let res: Response;
  try {
    res = await (deps.fetchImpl ?? fetch)(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Webhook-Secret": cfg.secret },
      body: JSON.stringify(event),
      signal: controller.signal,
      redirect: "error", // never follow a redirect with the secret attached
    });
  } catch (err) {
    const aborted = (err as { name?: string })?.name === "AbortError";
    return { kind: "retryable", message: aborted ? "n8n did not respond in time." : "Couldn't reach n8n." };
  } finally {
    clearTimeout(timer);
  }

  let body: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = await res.json();
    if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
  } catch {
    /* not JSON */
  }

  if (res.status === 401 || res.status === 403) {
    return { kind: "retryable", message: "n8n rejected the request. Check that the webhook secret matches." };
  }

  if (body?.ok === false && typeof body.error === "string") {
    const message = typeof body.message === "string" ? body.message : body.error;
    if (body.error === "row_missing" || body.error === "duplicate_rows") {
      return { kind: "integrity", code: body.error, message };
    }
    if (body.error === "invalid_payload") return { kind: "rejected", message: `n8n rejected the payload: ${message}` };
    return { kind: "retryable", message: `Google Sheets sync failed: ${message}` };
  }

  if (res.ok && body?.ok === true) {
    const matches =
      body.eventId === event.eventId &&
      body[recordId.key] === recordId.value &&
      typeof body.result === "string" &&
      SUCCESS_RESULTS.has(body.result);
    if (matches) {
      return {
        kind: "success",
        result: body.result as "appended" | "already_exists" | "updated",
        rowNumber: typeof body.rowNumber === "number" ? body.rowNumber : null,
      };
    }
    return { kind: "retryable", message: "n8n replied, but its answer didn't confirm this event. The sync was not counted as done." };
  }

  if (res.status === 404) return { kind: "retryable", message: "n8n webhook not found. Check the URL and that the workflow is active." };
  return { kind: "retryable", message: `Unexpected response from n8n (HTTP ${res.status}).` };
}
