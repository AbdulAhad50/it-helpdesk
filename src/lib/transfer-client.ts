export type TransferSubmitResult =
  | { kind: "success"; transferId: string }
  | { kind: "field-errors"; message: string; fieldErrors: Record<string, string[]> }
  | { kind: "rate-limited"; message: string }
  | { kind: "unavailable"; message: string }
  | { kind: "error"; message: string }
  /** The request may or may not have reached the server. */
  | { kind: "uncertain"; message: string };

interface Envelope {
  ok?: boolean;
  data?: { transferId?: string };
  error?: { message?: string; fieldErrors?: Record<string, string[]> };
}

/** Browser-side call to a transfer-creating endpoint; every outcome becomes a UI-friendly result. */
export async function submitTransfer(endpoint: string, values: unknown, fetchImpl: typeof fetch = fetch): Promise<TransferSubmitResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
      signal: controller.signal,
    });
    const body = (await res.json().catch(() => null)) as Envelope | null;
    if (res.ok && body?.ok && body.data?.transferId) return { kind: "success", transferId: body.data.transferId };
    const err = body?.error;
    if (res.status === 422 && err?.fieldErrors) return { kind: "field-errors", message: err.message ?? "Please fix the highlighted fields.", fieldErrors: err.fieldErrors };
    if (res.status === 429) return { kind: "rate-limited", message: err?.message ?? "Too many submissions. Please wait a few minutes and try again." };
    if (res.status === 503) return { kind: "unavailable", message: err?.message ?? "The system is temporarily unavailable. Nothing was saved." };
    return { kind: "error", message: err?.message ?? "The record could not be saved. Please try again." };
  } catch {
    return {
      kind: "uncertain",
      message: "We couldn't confirm that the record was saved. Check your connection and try again. If IT sees it twice, that is why.",
    };
  } finally {
    clearTimeout(timer);
  }
}
