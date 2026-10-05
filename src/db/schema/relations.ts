import { defineRelations } from "drizzle-orm";
import { content } from "./content.js";
import { providerContent } from "./provider_content.js";
import { searchMiss } from "./search_miss.js";
import { stream } from "./stream.js";
import { subtitle } from "./subtitle.js";

export const relations = defineRelations(
  { content, providerContent, stream, subtitle, searchMiss },
  (r) => ({
    content: {
      providerContent: r.many.providerContent({
        from: r.content.id,
        to: r.providerContent.contentId,
      }),
    },
    providerContent: {
      content: r.one.content(),
    },
    stream: {
      providerContent: r.one.providerContent({
        from: r.stream.providerContentId,
        to: r.providerContent.id,
      }),
    },
    subtitle: {
      providerContent: r.one.providerContent({
        from: r.subtitle.providerContentId,
        to: r.providerContent.id,
      }),
    },
  }),
);
