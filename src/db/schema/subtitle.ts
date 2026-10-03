import {
  index,
  integer,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";
import { providerContent } from "./provider_content.js";
export const subtitle = sqliteTable(
  "subtitle",
  {
    id: text("id").primaryKey(),
    providerContentId: text("provider_content_id")
      .notNull()
      .references(() => providerContent.id),
    season: text("season"),
    episode: text("episode"),
    url: text("url").notNull(),
    lang: text("lang").notNull(),
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
    unique("uq_subtitles_provider_season_episode_lang").on(
      table.providerContentId,
      table.season,
      table.episode,
      table.lang,
    ),
    index("idx_subtitle_provider_id").on(table.providerContentId),
  ],
);

export type ESubtitleInsert = typeof subtitle.$inferInsert;
