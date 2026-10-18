const DEFAULT = "/admin/dashboard";

/** Only ever redirect to an in-app admin path after login (prevents open redirects). */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return DEFAULT;
  if (!raw.startsWith("/admin/") || raw.startsWith("/admin/login")) return DEFAULT;
  if (raw.includes("//") || raw.includes("\\") || raw.includes("://") || /[\u0000-\u001F]/.test(raw)) return DEFAULT;
  return raw;
}
