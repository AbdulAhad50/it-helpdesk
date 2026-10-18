import { ApiError } from "@/lib/api";

/**
 * CSRF defence for state-changing admin endpoints, layered on top of SameSite=Lax cookies and
 * the JSON-only content type (which forces a CORS preflight for cross-site fetches):
 * a browser-supplied Origin must match the host we are serving.
 */
export function assertSameOrigin(req: Request): void {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (origin) {
    try {
      if (new URL(origin).host === host) return;
    } catch {
      /* fall through */
    }
    throw new ApiError(403, "FORBIDDEN_ORIGIN", "This request came from an unexpected origin.");
  }
  const site = req.headers.get("sec-fetch-site");
  if (!site || site === "same-origin" || site === "none") return; // non-browser clients send neither header
  throw new ApiError(403, "FORBIDDEN_ORIGIN", "This request came from an unexpected origin.");
}
