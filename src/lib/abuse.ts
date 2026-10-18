/**
 * Abuse-protection hook for public endpoints.
 *
 * CAPTCHA is not required by default. If abuse appears, implement the check here (for example
 * Cloudflare Turnstile: POST the client token to the siteverify endpoint with a secret from the
 * environment) and add the token field to the complaint form. Nothing else needs to change,
 * because POST /api/complaints already awaits this function.
 */
export async function verifyHuman(_request: Request, _token?: string): Promise<boolean> {
  return true;
}
