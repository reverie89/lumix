import {
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { content } from "./content.js";

export const providerContent = sqliteTable(
  "provider_content",
  {
    id: text("id").primaryKey(),
    contentId: text("content_id").references(() => content.id),
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    title: text("title").notNull(),
    year: integer("year").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("idx_provider_content_external_id").on(
      table.provider,
      table.externalId,
    ),
    // The relational `with: { providerContent: true }` queries filter on
    // content_id — without this index each one scans the table
    index("idx_provider_content_content_id").on(table.contentId),
  ],
);

export type EProviderContent = typeof providerContent.$inferSelect;
export type EProviderContentInsert = typeof providerContent.$inferInsert;
