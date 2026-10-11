import { sqliteTable, text } from "drizzle-orm/sqlite-core";

// Server-side key/value rows for derived values that must survive restarts —
// currently the visit log's hash salt (a fresh one would scramble every
// stored hash).
export const meta = sqliteTable("meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export type EMeta = typeof meta.$inferSelect;
