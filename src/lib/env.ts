import { z } from "zod";

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optionalString = z.string().trim().optional().transform((v) => (v ? v : undefined));
const optionalUrl = z.preprocess(emptyToUndefined, z.string().trim().url("must be a valid URL").optional());
const optionalSecret = z.preprocess(emptyToUndefined, z.string().trim().min(32, "must be at least 32 characters").optional());

const envSchema = z.object({
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  MONGODB_URI: z.string().min(1, "mongodb+srv://techahad45:Makhan50@cluster0.d0oyv.mongodb.net/").default("mongodb+srv://techahad45:Makhan50@cluster0.d0oyv.mongodb.net/"),
  MONGODB_DB_NAME: z.string().min(1).default("it_helpdesk"),
  AUTH_SECRET: z.string().min(32, "17846723hfsdjhafgsdjhg7367462387gfjjksdjfksdasdhsjhfhasjhg").default("17846723hfsdjhafgsdjhg7367462387gfjjksdjfksdasdhsjhfhasjhg"),

  N8N_NEW_COMPLAINT_WEBHOOK_URL: optionalUrl,
  N8N_UPDATE_COMPLAINT_WEBHOOK_URL: optionalUrl,
  /** Sent by the app to n8n (X-Webhook-Secret). */
  N8N_WEBHOOK_SECRET: optionalSecret,
  /** Sent by n8n to the app's /api/internal/sync/run (Authorization: Bearer). A different secret, for the opposite direction. */
  SYNC_RUNNER_SECRET: optionalSecret,

  GOOGLE_SHEETS_SPREADSHEET_ID: optionalString,
  GOOGLE_SHEETS_WORKSHEET_NAME: z.string().default("IT Complaints"),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: optionalString,
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: optionalString,
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Validated, server-only environment. Throws a clear (secret-free) error when misconfigured. */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${problems}`);
  }
  cached = parsed.data;
  return cached;
}

/** For tests: forget the cached environment. */
export function resetEnvCache() {
  cached = undefined;
}

/** Integrations that are not configured are reported as "awaiting configuration", never faked. */
export function getIntegrationStatus() {
  const env = getEnv();
  return {
    n8n: Boolean(env.N8N_NEW_COMPLAINT_WEBHOOK_URL && env.N8N_UPDATE_COMPLAINT_WEBHOOK_URL && env.N8N_WEBHOOK_SECRET),
    googleSheets: Boolean(
      env.GOOGLE_SHEETS_SPREADSHEET_ID && env.GOOGLE_SERVICE_ACCOUNT_EMAIL && env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    ),
  };
}
