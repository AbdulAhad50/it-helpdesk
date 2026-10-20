/**
 * End-to-end test runner: `npm run test:e2e`
 *
 * Starts a throw-away MongoDB replica set, a fake n8n/Google Sheets (which runs the real workflow
 * logic from n8n/*.json), the app in dev mode, then Playwright. First run only:
 *   npx playwright install chromium
 * Needs internet once (to download the MongoDB test binary). Nothing real is touched.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient, ObjectId } from "mongodb";
import { hashPassword } from "../src/lib/password";
import { ensureIndexes } from "../src/models/indexes";
import { startFakeN8n } from "../tests/support/fake-n8n";

const PORT = 3210;
const BASE = `http://localhost:${PORT}`;
const ADMIN = { email: "e2e-admin@example.com", password: "e2e-correct-horse-battery-9", name: "E2E Admin" };
const DB_NAME = "it_helpdesk_e2e";

const secret = () => randomBytes(24).toString("base64url");
const run = (cmd: string, args: string[], env: Record<string, string>) => spawn(cmd, args, { env: { ...process.env, ...env }, stdio: "inherit", shell: true });
const exited = (p: ChildProcess) => new Promise<number>((resolve) => p.on("exit", (code) => resolve(code ?? 1)));

async function waitFor(url: string, ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function main() {
  console.log("Starting MongoDB (in memory)…");
  const rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = rs.getUri();
  const client = await MongoClient.connect(uri);
  const db = client.db(DB_NAME);
  await ensureIndexes(db);
  const now = new Date();
  await db.collection("admins").insertOne({
    _id: new ObjectId(), email: ADMIN.email, name: ADMIN.name, passwordHash: await hashPassword(ADMIN.password),
    disabled: false, lastLoginAt: null, createdAt: now, updatedAt: now,
  });

  const webhookSecret = secret() + secret();
  const fake = await startFakeN8n(webhookSecret);
  const appEnv = {
    NODE_ENV: "development", // so the app accepts the http://127.0.0.1 fake webhook
    APP_BASE_URL: BASE,
    MONGODB_URI: uri,
    MONGODB_DB_NAME: DB_NAME,
    AUTH_SECRET: secret() + secret(),
    N8N_NEW_COMPLAINT_WEBHOOK_URL: `${fake.url}/webhook/helpdesk/complaint-created`,
    N8N_UPDATE_COMPLAINT_WEBHOOK_URL: `${fake.url}/webhook/helpdesk/complaint-updated`,
    N8N_WEBHOOK_SECRET: webhookSecret,
    SYNC_RUNNER_SECRET: secret() + secret(),
  };

  console.log("Starting the app…");
  const app = run("npx", ["next", "dev", "-p", String(PORT)], appEnv);
  let code = 1;
  try {
    await waitFor(`${BASE}/complaint`, 120_000);
    const tests = run("npx", ["playwright", "test"], {
      E2E_BASE_URL: BASE,
      E2E_ADMIN_EMAIL: ADMIN.email,
      E2E_ADMIN_PASSWORD: ADMIN.password,
      E2E_MONGODB_URI: uri,
      E2E_DB_NAME: DB_NAME,
      E2E_FAKE_N8N_URL: fake.url,
      E2E_WEBHOOK_SECRET: webhookSecret,
    });
    code = await exited(tests);
  } finally {
    app.kill();
    await fake.stop();
    await client.close();
    await rs.stop();
  }
  process.exit(code);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
