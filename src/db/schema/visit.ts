import {
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

// One row per logged HTTP request — the visit log behind the internal
// visits dashboard. Only pseudonymous hashes are stored, never raw IPs,
// URLs or config payloads (docs/ARCHITECTURE.md, "Visit log and internal
// dashboard").
export const visit = sqliteTable(
  "visit",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ts: integer("ts", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    kind: text("kind", {
      enum: ["landing", "manifest", "catalog", "meta", "stream", "subtitle"],
    }).notNull(),
    provider: text("provider"),
    client: text("client"),
    status: integer("status").notNull(),
    durationMs: integer("duration_ms").notNull(),
    // sha256(salt + day + ip) / sha256(salt + config segment), truncated.
    // The IP hash rotates daily: same-day dedup only, no cross-day tracking
    ipHash: text("ip_hash"),
    configHash: text("config_hash"),
  },
  (table) => [index("idx_visit_ts").on(table.ts)],
);

export type EVisit = typeof visit.$inferSelect;
export type EVisitInsert = typeof visit.$inferInsert;
export type VisitKind = EVisit["kind"];
