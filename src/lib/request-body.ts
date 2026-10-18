import { ApiError } from "@/lib/api";

/** Read a small JSON object body with content-type and size checks. */
export async function readJsonBody(req: Request, maxBytes = 4 * 1024): Promise<Record<string, unknown>> {
  if (!req.headers.get("content-type")?.includes("application/json")) {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Send the request as JSON.");
  }
  if (Number(req.headers.get("content-length") ?? 0) > maxBytes) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", "That request is too large.");
  }
  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > maxBytes) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "That request is too large.");
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  throw new ApiError(400, "INVALID_JSON", "The request could not be read.");
}
