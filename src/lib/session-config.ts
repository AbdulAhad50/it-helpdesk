// Constants only (no Node or database imports) so the proxy can use them too.

/** The __Host- prefix makes browsers require Secure, Path=/ and no Domain. Used in production only. */
export const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-helpdesk_session" : "helpdesk_session";

export const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000; // hard cap: sign in again after 12 hours
export const SESSION_IDLE_MS = 60 * 60 * 1000; // or after 1 hour without activity
export const SESSION_TOUCH_INTERVAL_MS = 60 * 1000; // write lastSeenAt at most once a minute

export const LOGIN_RATE_LIMITS = {
  perIp: { limit: 10, windowSeconds: 15 * 60 },
  perAccount: { limit: 8, windowSeconds: 15 * 60 },
} as const;
