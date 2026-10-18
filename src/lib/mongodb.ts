import { MongoClient, type Db } from "mongodb";
import { getEnv } from "@/lib/env";

// Cache the client promise on globalThis so dev hot-reloads and warm serverless
// invocations reuse one connection pool instead of opening a new one per request.
const g = globalThis as unknown as { __mongoClient?: Promise<MongoClient> };

export function getClient(): Promise<MongoClient> {
  if (!g.__mongoClient) {
    const client = new MongoClient(getEnv().MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5_000,
      retryWrites: true,
      appName: "it-helpdesk",
    });
    g.__mongoClient = client.connect().catch((err) => {
      g.__mongoClient = undefined; // allow a later request to retry the connection
      throw err;
    });
  }
  return g.__mongoClient;
}

export async function getDb(): Promise<Db> {
  const client = await getClient();
  return client.db(getEnv().MONGODB_DB_NAME);
}
