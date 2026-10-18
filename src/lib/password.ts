import { hash, verify, type Algorithm } from "@node-rs/argon2";

// Argon2id (algorithm id 2) with the OWASP-recommended minimum profile: 19 MiB, 2 passes, 1 lane.
// (`Algorithm` is a const enum in the library typings, so the numeric id is used with a cast.)
const ARGON2_OPTIONS = { algorithm: 2 as Algorithm, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/** Never throws: a malformed hash simply fails verification. */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}
