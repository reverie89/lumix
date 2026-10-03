import {
  integer,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";

export const content = sqliteTable(
  "content",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    year: integer("year").notNull(),
    type: text("type", {
      enum: ["movie", "series"],
    }).notNull(),
    imdbId: text("imdb_id"),
    tmdbId: text("tmdb_id"),
    poster: text("poster"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("uq_content_imdb").on(table.imdbId, table.type),
    unique("uq_content_tmdb").on(table.tmdbId, table.type),
  ],
);

export type EContent = typeof content.$inferSelect;
export type EContentInsert = typeof content.$inferInsert;
