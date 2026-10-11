import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { Logger } from "../utils/logger.js";
import { relations } from "./schema/relations.js";
import { pruneExpiredRows, pruneVisits } from "./queries.js";
import { sqlite } from "./sqlite.js";

const db = drizzle({ client: sqlite, relations });
const logger = new Logger("DB");

export { db };

export async function initMigrations() {
  try {
    await migrate(db, { migrationsFolder: "drizzle/lumix" });
    logger.log("Migration lumix completed");
    await pruneExpiredRows();
    await pruneVisits();
  } catch (err) {
    logger.error(`Migration failed: ${err}`);
    throw err;
  }
}
