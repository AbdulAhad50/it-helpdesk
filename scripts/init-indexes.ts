import { MongoClient } from "mongodb";
import { ensureIndexes } from "../src/models/indexes";

async function main() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB_NAME || "it_helpdesk";
  if (!uri) {
    console.error("MONGODB_URI is not set. Copy .env.example to .env.local and fill it in.");
    process.exit(1);
  }
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
  try {
    await client.connect();
    await ensureIndexes(client.db(dbName));
    console.log(`Database "${dbName}" is initialised (collections, validators, indexes).`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("Initialisation failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
