/** Builds "?a=1&b=2" from params, applying overrides; undefined/null/"" values are dropped. */
export function buildQuery(
  params: Record<string, string | number | null | undefined>,
  overrides: Record<string, string | number | null | undefined> = {},
): string {
  const merged = { ...params, ...overrides };
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}
