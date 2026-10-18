// Pure password rules, safe to import in the browser (instant feedback) and on the server (enforcement).

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

const COMMON = new Set([
  "password1234", "password12345", "passwordpassword", "123456789012", "1234567890123",
  "qwertyuiop12", "qwertyuiopas", "adminadmin12", "administrator", "welcome12345",
  "letmein12345", "iloveyou1234", "changeme1234", "helpdesk1234", "ithelpdesk12",
  "abcdefghijkl", "111111111111", "000000000000", "p@ssw0rd1234", "pakistan1234",
]);

/** Returns a list of human-readable problems. An empty list means the password is acceptable. */
export function checkPasswordPolicy(password: string, ctx: { email?: string; name?: string } = {}): string[] {
  const problems: string[] = [];
  if (password.length < PASSWORD_MIN) problems.push(`Use at least ${PASSWORD_MIN} characters.`);
  if (password.length > PASSWORD_MAX) problems.push(`Use ${PASSWORD_MAX} characters or fewer.`);
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) problems.push("That password is too common. Choose something less guessable.");
  if (password.length > 0 && new Set(password).size === 1) problems.push("Don't repeat a single character.");
  const local = ctx.email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) problems.push("Don't include your email name in your password.");
  return problems;
}
