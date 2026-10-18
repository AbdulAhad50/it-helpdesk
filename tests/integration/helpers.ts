import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { ensureIndexes } from "@/models/indexes";

/** A throw-away replica set (needed for transactions) with the real validators and indexes applied. */
export async function startTestDb(): Promise<{ db: Db; uri: string; dbName: string; stop: () => Promise<void> }> {
  const rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = rs.getUri();
  const dbName = "it_helpdesk_test";
  const client = await MongoClient.connect(uri);
  const db = client.db(dbName);
  await ensureIndexes(db);
  return {
    db,
    uri,
    dbName,
    stop: async () => {
      await client.close();
      await rs.stop();
    },
  };
}
