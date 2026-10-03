import {
  index,
  integer,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";
import { providerContent } from "./provider_content.js";

export const stream = sqliteTable(
  "stream",
  {
    id: text("id").primaryKey(),
    providerContentId: text("provider_content_id")
      .notNull()
      .references(() => providerContent.id),
    provider: text("provider").notNull(),
    externalId: text("external_id"),
    season: text("season").notNull(),
    episode: text("episode").notNull(),
    url: text("url").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date()),
    ttl: integer("ttl"),
  },
  (table) => [
    unique("uq_stream_url").on(table.url),
    index("idx_stream_provider_id").on(table.providerContentId),
  ],
);

export type StreamInsert = Omit<typeof stream.$inferInsert, "createdAt">;
