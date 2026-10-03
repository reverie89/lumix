import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { Logger } from "../utils/logger.js";

const logger = new Logger("DB");

// Single canonical database location: <repo>/data locally, /app/data in the
// container (volume-mounted; not mounting it is the only "off" switch). Tests
// run on an in-memory database so they never touch real data — vitest sets
// NODE_ENV=test.
const SQLITE_PATH =
  process.env.NODE_ENV === "test" ? ":memory:" : "./data/lumix.db";

/**
 * Embedded sqlite connection. better-sqlite3 is synchronous and a single
 * connection is enough for the addon's workload; WAL keeps readers cheap.
 */
function createSqlite(): Database.Database {
  const dir = path.dirname(SQLITE_PATH);
  if (dir && dir !== ".") {
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new Database(SQLITE_PATH);
  db.pragma("journal_mode = WAL");
  // WAL's recommended pairing: commits no longer fsync on every write
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  logger.log(`Sqlite ready | ${SQLITE_PATH}`);
  return db;
}

export const sqlite: Database.Database = createSqlite();

export function closeSqlite() {
  if (sqlite) sqlite.close();
}
