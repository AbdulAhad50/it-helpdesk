/**
 * Create the first administrator (or reset an administrator's password).
 *
 *   npm run admin:create
 *   npm run admin:create -- --email it@company.com --name "IT Admin"
 *   npm run admin:create -- --email it@company.com --reset-password
 *
 * The password is typed at a hidden prompt (never on the command line, so it stays out of shell
 * history). For automation you may set ADMIN_PASSWORD in the environment instead.
 * There is no default account and no public sign-up: this script is the only way in.
 */
import { createInterface } from "node:readline/promises";
import { MongoClient, ObjectId } from "mongodb";
import { z } from "zod";
import { hashPassword } from "../src/lib/password";
import { checkPasswordPolicy } from "../src/lib/password-policy";
import { ensureIndexes } from "../src/models/indexes";
import type { AdminDoc } from "../src/models/Admin";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) return reject(new Error("No terminal available for a hidden prompt. Set ADMIN_PASSWORD instead."));
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const done = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      stdout.write("\n");
    };
    const onData = (chunk: string) => {
      for (const c of chunk) {
        if (c === "\r" || c === "\n" || c === "\u0004") {
          done();
          return resolve(value);
        }
        if (c === "\u0003") {
          done();
          process.exit(130);
        }
        if (c === "\u007f" || c === "\b") value = value.slice(0, -1);
        else value += c;
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB_NAME || "it_helpdesk";
  if (!uri) throw new Error("MONGODB_URI is not set. Copy .env.example to .env.local and fill it in.");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const reset = flag("reset-password");

  const email = z.email().parse((arg("email") ?? (await rl.question("Admin email: "))).trim().toLowerCase());
  const name = reset ? "" : (arg("name") ?? (await rl.question("Admin name: "))).trim();
  rl.close();
  if (!reset && (name.length < 2 || name.length > 100)) throw new Error("Name must be 2 to 100 characters.");

  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    password = await promptHidden("Password (hidden): ");
    const again = await promptHidden("Repeat password: ");
    if (password !== again) throw new Error("The passwords did not match.");
  }
  const problems = checkPasswordPolicy(password, { email, name });
  if (problems.length) throw new Error(`Password rejected:\n - ${problems.join("\n - ")}`);

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
  try {
    await client.connect();
    const db = client.db(dbName);
    await ensureIndexes(db); // makes sure the unique email index exists
    const admins = db.collection<AdminDoc>("admins");
    const passwordHash = await hashPassword(password);
    const now = new Date();

    if (reset) {
      const existing = await admins.findOne({ email });
      if (!existing) throw new Error(`No administrator with email ${email}.`);
      await admins.updateOne({ _id: existing._id }, { $set: { passwordHash, disabled: false, updatedAt: now } });
      const { deletedCount } = await db.collection("adminsessions").deleteMany({ adminId: existing._id });
      console.log(`Password reset for ${email}. ${deletedCount} existing session(s) were signed out.`);
      return;
    }

    if (await admins.findOne({ email })) {
      throw new Error(`An administrator with email ${email} already exists. Use --reset-password to change their password.`);
    }
    await admins.insertOne({
      _id: new ObjectId(),
      email,
      name,
      passwordHash,
      disabled: false,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    });
    console.log(`Administrator created: ${email}. You can now sign in at /admin/login.`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
