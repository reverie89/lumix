import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { relations } from "./schema/relations.js";
import { pruneExpiredRows } from "./queries.js";
import { sqlite } from "./sqlite.js";

const db = drizzle({ client: sqlite, relations });

export { db };

export async function initMigrations() {
  try {
    await migrate(db, { migrationsFolder: "drizzle/lumix" });
    console.log("Migration lumix completed");
    await pruneExpiredRows();
  } catch (err) {
    console.error(`Migration failed: ${err}`);
    throw err;
  }
}
