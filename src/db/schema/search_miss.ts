import {
  integer,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";

/**
 * Titles TMDB could not match. Keyed on the post-extractTitle search string
 * + type; year is intentionally not part of the key — the TTL bounds how
 * long a wrong negative can stand.
 */
export const searchMiss = sqliteTable(
  "search_miss",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    type: text("type", {
      enum: ["movie", "series"],
    }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date()),
    ttl: integer("ttl"),
  },
  (table) => [unique("uq_search_miss_title").on(table.title, table.type)],
);

export type ESearchMiss = typeof searchMiss.$inferSelect;
export type ESearchMissInsert = typeof searchMiss.$inferInsert;
