import type { ComplaintFormInput } from "@/lib/validation";

export type SubmitResult =
  | { kind: "success"; complaintId: string; receivedAt: string }
  | { kind: "field-errors"; message: string; fieldErrors: Record<string, string[]> }
  | { kind: "rate-limited"; message: string }
  | { kind: "unavailable"; message: string }
  | { kind: "error"; message: string; correlationId?: string }
  /** The request may or may not have reached the server. */
  | { kind: "uncertain"; message: string };

const TIMEOUT_MS = 20_000;

interface Envelope {
  ok?: boolean;
  data?: { complaintId?: string; receivedAt?: string };
  error?: { code?: string; message?: string; fieldErrors?: Record<string, string[]>; correlationId?: string };
}

/** Browser-side call to POST /api/complaints, translating every outcome into a UI-friendly result. */
export async function submitComplaint(
  values: ComplaintFormInput,
  fetchImpl: typeof fetch = fetch,
): Promise<SubmitResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl("/api/complaints", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
      signal: controller.signal,
    });

    let body: Envelope | null = null;
    try {
      body = (await res.json()) as Envelope;
    } catch {
      /* non-JSON response */
    }

    if (res.ok && body?.ok && body.data?.complaintId) {
      return { kind: "success", complaintId: body.data.complaintId, receivedAt: body.data.receivedAt ?? "" };
    }
    const err = body?.error;
    if (res.status === 422 && err?.fieldErrors) {
      return { kind: "field-errors", message: err.message ?? "Please fix the highlighted fields.", fieldErrors: err.fieldErrors };
    }
    if (res.status === 429) {
      return { kind: "rate-limited", message: err?.message ?? "Too many submissions. Please wait a few minutes and try again." };
    }
    if (res.status === 503) {
      return { kind: "unavailable", message: err?.message ?? "The system is temporarily unavailable. Nothing was saved." };
    }
    return {
      kind: "error",
      message: err?.message ?? "Your complaint could not be submitted. Please try again.",
      correlationId: err?.correlationId,
    };
  } catch {
    return {
      kind: "uncertain",
      message:
        "We couldn't confirm that your complaint was received. Check your connection and try again. If IT contacts you about a duplicate, that is why.",
    };
  } finally {
    clearTimeout(timer);
  }
}
