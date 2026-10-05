import { z } from "zod";
import { Logger } from "./logger.js";

// Strict boolean: only true/false/1/0 flip the value — unlike coerce.boolean,
// which treats any non-empty string (including "false") as true.
const booleanFlag = (defaultValue: boolean) =>
  z
    .enum(["true", "false", "1", "0"])
    .default(defaultValue ? "true" : "false")
    .transform((value) => value === "true" || value === "1");

// Comma-separated string list ("a, b, c"); entries are trimmed, empties
// dropped, and a bare var ("" → undefined, see `cleaned`) parses as []
const stringList = z
  .string()
  .transform((str) =>
    str
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.string()))
  .default([]);

const envSchema = z.object({
  // Optional: TMDB enriches catalogs and metas with artwork/descriptions.
  // Leave empty to skip the TMDB feature entirely (kisskh data is used as-is)
  TMDB_API_KEY: z.string().default(""),

  // OPTIONAL with Defaults
  // Min title matching score (higher mean only very similar title matches)
  MIN_MATCHING_SCORE: z.coerce.number().min(0).max(100).default(75),
  MATCH_IGNORES: z
    .string()
    .transform((str) => JSON.parse(str))
    .pipe(z.array(z.string()))
    .default(["uncut", "uncut version", "uncut ver."]),

  // Provider mirror defaults (comma-separated http(s) URLs): served to the
  // config page's mirror rows and used when a config carries no mirrors
  KISSKH_MIRRORS: stringList,
  OLE_HOSTS: stringList,

  // Server configuration
  // Rate-limit keys come from x-forwarded-for/cf-connecting-ip; set false to
  // rate-limit by socket address instead (when not behind a trusted proxy)
  TRUST_PROXY: booleanFlag(true),
  // Retry configuration
  RETRY_TIMEOUT_MS: z.coerce.number().min(1).default(7000),
  RETRY_DELAY_MS: z.coerce.number().min(0).default(5000),
  RETRY_JITTER_MS: z.coerce.number().min(0).default(500),
  // Cache warming
  WARM_CACHE: booleanFlag(true),
  // Rate limit
  CATALOG_WINDOW_MINUTES: z.coerce.number().min(1).default(10),
  CATALOG_REQUEST_LIMIT: z.coerce.number().min(1).default(20),
  META_WINDOW_MINUTES: z.coerce.number().min(1).default(10),
  META_REQUEST_LIMIT: z.coerce.number().min(1).default(20),
  STREAM_WINDOW_MINUTES: z.coerce.number().min(1).default(10),
  STREAM_REQUEST_LIMIT: z.coerce.number().min(1).default(10),
  SUBTITLES_WINDOW_MINUTES: z.coerce.number().min(1).default(10),
  SUBTITLES_REQUEST_LIMIT: z.coerce.number().min(1).default(10),
  // VTT proxy fetches per IP in the subtitles window; every rendered track
  // request counts, so this rides a wider budget than the list endpoint
  SUBTITLES_PROXY_REQUEST_LIMIT: z.coerce.number().min(1).default(60),

  // Outbound proxy
  PROXY_URL: z.string().default(""),
  PROXY_PORT: z.coerce.number().min(1).max(65535).default(443),
  PROXY_TMDB: booleanFlag(false),
  PROXY_KISSKH_SUBTITLE: booleanFlag(false),
  PROXY_WEBSHARE_URL: z.string().default(""),
  PROXY_WEBSHARE_PORT: z.coerce.number().min(1).max(65535).default(80),
  PROXY_WEBSHARE_USERNAME: z.string().default(""),
  PROXY_WEBSHARE_PASSWORD: z.string().default(""),
});

// A var left bare in .env parses as the empty string; treat that as unset so
// defaults apply instead of coercing (PORT= became 0, MATCH_IGNORES= crashed
// JSON.parse, and boolean flags read "false" as true).
const cleaned = Object.fromEntries(
  Object.entries(process.env).map(([key, value]) => [
    key,
    value === "" ? undefined : value,
  ]),
);

const parsed = envSchema.safeParse(cleaned);

if (!parsed.success) {
  new Logger("ENV").error(
    `Invalid .env | ${JSON.stringify(z.treeifyError(parsed.error).properties)}`,
  );
  process.exit(1);
}

export { booleanFlag };
export const ENV = parsed.data;
