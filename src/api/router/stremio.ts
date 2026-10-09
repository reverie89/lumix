import {
  AddonBuilder,
  createRouter,
  Manifest,
  MetaDetail,
  MetaPreview,
  ShortManifestResource,
  Stream,
  Subtitle,
} from "@stremio-addon/sdk";
import { rateLimiter } from "hono-rate-limiter";
import { Hono, type Context } from "hono";
import {
  buildCatalogHandler,
  buildMetaHandler,
  buildStreamHandler,
  buildSubtitleHandler,
} from "../../lib/addon.js";
import {
  buildManifest,
  defaultConfig,
} from "../../lib/manifest.js";
import {
  Prefix,
  Provider,
  ProviderSettings,
  UserConfig,
} from "../../utils/config.js";
import { getSubtitleVtt } from "../../source/kisskh-subtitle.js";
import {
  expandKisskhCatalogs,
  getKisskhQuery,
  isSubtitleSourceHost,
  KISSKH_HIDDEN_CATALOGS,
  normalizeKisskhTiers,
} from "../../source/kisskh-catalogs.js";
import { isSeenSubtitleOrigin } from "../../source/kisskh.js";
import {
  expandOleCatalogs,
  normalizeOleTiers,
  OLE_HIDDEN_CATALOGS,
} from "../../source/ole-catalogs.js";
import { isMirrorUrl } from "../../utils/format.js";
import { SHORT_NAME } from "../../utils/constant.js";
import { ENV } from "../../utils/env.js";
import { Logger } from "../../utils/logger.js";
import { extractHeaderInfo, getRequestOrigin } from "../../utils/request.js";
import { TTL_SECS } from "../../utils/cache.js";

const logger = new Logger("SERVER");

const stremio = new Hono();

function getDescription(remaining: number) {
  const description = "Too Many Request\nRetry after";
  return `${description} ${getRetryAfterText(remaining)}`;
}
function getRetryAfterText(remaining: number) {
  if (remaining < 60) {
    return `${remaining} seconds`;
  } else {
    const minutes = Math.ceil(remaining / 60);
    return `${minutes} minutes`;
  }
}
const getName = () => `⏱️${SHORT_NAME}\nRate Limit`;

// Catalog requests are provider-scoped by id ("kisskh.series.Korean"), so the
// catalog budget splits per provider per IP — scrolling one provider's boards
// can't starve the other. Meta/stream/subtitles stay one budget per IP:
// imdb/tmdb ids resolve against both providers in a single request. Config
// segments are base64url (no dots), so "<provider>." only matches catalog ids.
const providerIdPrefix = new RegExp(
  `(${Object.values(Provider).join("|")})\\.`,
);
export const limiterKey = (
  resource: ShortManifestResource,
  ip: string,
  path: string,
): string => {
  if (resource !== "catalog") return ip;
  const provider = providerIdPrefix.exec(path)?.[1];
  return provider ? `${ip}:${provider}` : ip;
};

const getLimiter = (
  resource: ShortManifestResource,
  windowMs: number = 30 * 60 * 1000,
  limit: number = 30,
) => {
  const limiter = (resource: ShortManifestResource) => {
    return rateLimiter({
      windowMs: windowMs,
      limit: limit,
      keyGenerator: (c) => {
        const { ip } = extractHeaderInfo(c);
        return limiterKey(resource, ip, c.req.path);
      },
      handler: (c) => {
        const { ip } = extractHeaderInfo(c);
        const remaining = c.res.headers.get("RateLimit-Reset") ?? "5";
        const description = getDescription(parseInt(remaining));
        logger.warn(
          `Rate limit | Resource: ${resource}, IP: ${ip}, Wait: ${remaining}s`,
        );
        const limitResponse = getResourceLimitResponse(
          resource,
          description,
          getRequestOrigin(c),
        );
        const response = c.json(
          { ...limitResponse, retryAfter: remaining },
          200,
        );
        // Limit responses are transient — clients must re-fetch after the
        // window instead of caching the placeholder payload
        response.headers.set("Cache-Control", "no-cache");
        return response;
      },
    });
  };
  return limiter(resource);
};
export function getResourceLimitResponse(
  resource: ShortManifestResource,
  description: string,
  origin: string,
) {
  let limitResponse = {};
  switch (resource) {
    case "catalog":
      const catalogLimit: { metas: MetaPreview[] } = {
        metas: [
          {
            id: "catalog.ratelimit",
            type: "series",
            name: getName(),
            description: description,
          },
        ],
      };
      limitResponse = catalogLimit;
      break;
    case "meta":
      const metaLimit: { meta: MetaDetail } = {
        meta: {
          id: "meta.ratelimit",
          type: "series",
          name: getName(),
          description: description,
        },
      };
      limitResponse = metaLimit;
      break;
    case "stream":
      const streamsLimit: { streams: Stream[] } = {
        streams: [
          {
            name: getName(),
            description: description,
            externalUrl: origin,
          },
        ],
      };
      limitResponse = streamsLimit;
      break;
    case "subtitles":
      // No placeholder track: players would try to render it and show
      // nothing; an empty list lets them retry once the window passes
      const subtitlesLimit: { subtitles: Subtitle[] } = {
        subtitles: [],
      };
      limitResponse = subtitlesLimit;
      break;
    default:
      limitResponse = { description: description };
      break;
  }
  return limitResponse;
}
const catalogLimiter = getLimiter(
  "catalog",
  ENV.CATALOG_WINDOW_MINUTES * 60 * 1000,
  ENV.CATALOG_REQUEST_LIMIT,
);
const metaLimiter = getLimiter(
  "meta",
  ENV.META_WINDOW_MINUTES * 60 * 1000,
  ENV.META_REQUEST_LIMIT,
);
const streamLimiter = getLimiter(
  "stream",
  ENV.STREAM_WINDOW_MINUTES * 60 * 1000,
  ENV.STREAM_REQUEST_LIMIT,
);
const subtitlesLimiter = getLimiter(
  "subtitles",
  ENV.SUBTITLES_WINDOW_MINUTES * 60 * 1000,
  ENV.SUBTITLES_REQUEST_LIMIT,
);

// Handle config routes
stremio.get("/manifest.json", (c) => {
  const manifest = buildManifest(undefined, getRequestOrigin(c));
  return c.json(manifest);
});
stremio.get("/:configBase64/manifest.json", (c) => {
  const configBase64 = c.req.param("configBase64");
  const config = decodeConfig(configBase64);
  const manifest = buildManifest(config, getRequestOrigin(c));
  return c.json(manifest);
});

// Stremio addon routes handler
interface RouteConfig {
  route: string;
  limiter: ReturnType<typeof rateLimiter>;
}

// One AddonBuilder wiring shared by both route families: the default routes
// serve the unconfigured manifest, the config-scoped ones a decoded config —
// handlers register against the manifest's advertised resources either way
function registerAddonRoutes(
  routes: RouteConfig[],
  scope: (
    origin: string,
    c: Context,
  ) => { config: UserConfig; manifest: Manifest },
) {
  routes.forEach((route) => {
    stremio.use(route.route, route.limiter);
    stremio.get(route.route, async (c) => {
      const origin = getRequestOrigin(c);
      const { config, manifest } = scope(origin, c);
      const builder = new AddonBuilder(manifest);
      const resources = new Set(
        manifest.resources.map((r) => (typeof r === "string" ? r : r.name)),
      );
      if (resources.has("catalog")) {
        builder.defineCatalogHandler(async (args) => {
          return await buildCatalogHandler(args, config);
        });
      }
      if (resources.has("meta")) {
        builder.defineMetaHandler(async (args) => {
          return await buildMetaHandler(args, config);
        });
      }
      if (resources.has("stream")) {
        builder.defineStreamHandler(async (args) => {
          return await buildStreamHandler(args, config);
        });
      }
      if (resources.has("subtitles")) {
        builder.defineSubtitlesHandler(async (args) => {
          return await buildSubtitleHandler(args, config, origin);
        });
      }
      const addonRouter = createRouter(builder.getInterface());
      const response = await addonRouter(c.req.raw);
      if (response) {
        c.header(
          "Cache-Control",
          response.headers.get("Cache-Control") || "no-cache",
        );
      }
      return response || c.notFound();
    });
  });
}

const stremioRouteConfigs: RouteConfig[] = [
  { route: "/catalog/*", limiter: catalogLimiter },
  { route: "/meta/*", limiter: metaLimiter },
  { route: "/stream/*", limiter: streamLimiter },
  { route: "/subtitles/*", limiter: subtitlesLimiter },
];
registerAddonRoutes(stremioRouteConfigs, (origin) => ({
  config: defaultConfig,
  manifest: buildManifest(undefined, origin),
}));

const asStringArray = (value: any): string[] =>
  Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];

const KNOWN_PROVIDERS: readonly Provider[] = [
  Provider.KISSKH,
  Provider.OLE,
];

// The config's top-level `order` names the enabled providers in the order the
// user picked on the page: unknown names are dropped, providers missing from
// it are appended in canonical order.
function normalizeProviderOrder(values: string[]): Provider[] {
  const picked = [
    ...new Set(
      values
        .map((name) => name.toLowerCase())
        .filter((name): name is Provider =>
          KNOWN_PROVIDERS.includes(name as Provider),
        ),
    ),
  ];
  return [
    ...picked,
    ...KNOWN_PROVIDERS.filter((provider) => !picked.includes(provider)),
  ];
}

// A provider block present in the config contributes its mirrors, its
// expanded catalog rows (hidden Search rows close the block) and both
// provider lists — in the config's own order
function addProviderBlock(
  config: UserConfig,
  provider: Provider,
  settings: ProviderSettings,
  catalogs: string[],
  hidden: readonly string[],
) {
  config.providers[provider] = settings;
  config.catalogs.push(...catalogs, ...hidden);
  config.catalog.push(provider);
  config.stream.push(provider);
}

// First occurrence wins; the key ignores case and trailing slashes — the
// config page applies the same rule to user inputs (landing.js mirrorKey)
function dedupeMirrors(mirrors: string[]): string[] {
  const seen = new Set<string>();
  return mirrors.filter((mirror) => {
    const key = mirror.replace(/\/+$/, "").toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Normalize a decoded config: validate mirrors and tier picks, expand catalog
 * ids and derive catalog/stream providers. Providers contribute in the
 * config's `order` and tiers in each provider's `order` — that ordering is
 * the catalog order the manifest carries and Stremio displays. Every provider
 * block present in the raw config contributes — a config may enable kisskh
 * and 欧乐 together. Legacy flat configs (older manifest links) fall back to
 * their kisskh catalog ids.
 */
function normalizeConfig(raw: any): UserConfig {
  const config: UserConfig = {
    // Strict pick: anything but "zh" (absent, invalid, legacy) reads as "en"
    language: raw?.language === "zh" ? "zh" : "en",
    providers: {},
    catalogs: [],
    catalog: [],
    stream: [],
  };

  for (const provider of normalizeProviderOrder(asStringArray(raw?.order))) {
    const rawSettings = raw?.providers?.[provider];
    if (!rawSettings || typeof rawSettings !== "object") continue;
    const mirrors = dedupeMirrors(
      asStringArray(rawSettings.mirrors).filter(isMirrorUrl),
    );
    if (provider === Provider.KISSKH) {
      const tiers = normalizeKisskhTiers({
        order: asStringArray(rawSettings.order),
        type: asStringArray(rawSettings.type),
        region: asStringArray(rawSettings.region),
        status: asStringArray(rawSettings.status),
        update: asStringArray(rawSettings.update),
      });
      addProviderBlock(
        config,
        provider,
        { ...tiers, mirrors },
        expandKisskhCatalogs(tiers),
        KISSKH_HIDDEN_CATALOGS,
      );
    } else {
      const tiers = normalizeOleTiers({
        order: asStringArray(rawSettings.order),
        type: asStringArray(rawSettings.type),
        region: asStringArray(rawSettings.region),
        update: asStringArray(rawSettings.update),
      });
      addProviderBlock(
        config,
        provider,
        { ...tiers, mirrors },
        expandOleCatalogs(tiers),
        OLE_HIDDEN_CATALOGS,
      );
    }
  }

  if (config.catalog.length > 0) {
    return config;
  }

  if (Array.isArray(raw?.catalogs)) {
    // Legacy config format: keep known kisskh catalogs, drop other providers.
    // Names are reflected into the manifest, so only the known taxonomy passes.
    config.catalogs = raw.catalogs.filter((id: string) => {
      if (typeof id !== "string" || !id.startsWith(`${Prefix.KISSKH}.`)) {
        return false;
      }
      const [, type, name] = id.split(".");
      if (name === "Search") return true;
      return (
        getKisskhQuery(name ?? "", type === "movie" ? "movie" : "series") !==
        null
      );
    });
    config.catalog = asStringArray(raw.catalog).some(
      (name: string) => name.toLowerCase() === Provider.KISSKH,
    )
      ? [Provider.KISSKH]
      : [];
    config.stream = asStringArray(raw.stream).some(
      (name: string) => name.toLowerCase() === Provider.KISSKH,
    )
      ? [Provider.KISSKH]
      : [];
    return config;
  }

  // Unrecognized shape: serve the default catalogs instead of an addon
  // with no rows
  return { ...defaultConfig };
}

export const decodeConfig = (configBase64: string): UserConfig => {
  try {
    const decoded = Buffer.from(configBase64, "base64").toString("utf-8");
    const raw = JSON.parse(decoded);
    const config = normalizeConfig(raw);
    const mirrorSummary = Object.entries(config.providers)
      .map(
        ([name, settings]) =>
          `${name}: ${settings.mirrors.join(",") || "default"}`,
      )
      .join(" | ");
    logger.debug(
      `Config | catalogs: ${config.catalogs.length}, mirrors: ${mirrorSummary || "default"}`,
    );
    return config;
  } catch (error) {
    logger.error(`Fail parse config | ${error}`);
    return defaultConfig;
  }
};

const configStremioRoutes: RouteConfig[] = [
  { route: "/:configBase64/catalog/*", limiter: catalogLimiter },
  { route: "/:configBase64/meta/*", limiter: metaLimiter },
  { route: "/:configBase64/stream/*", limiter: streamLimiter },
  { route: "/:configBase64/subtitles/*", limiter: subtitlesLimiter },
];
registerAddonRoutes(configStremioRoutes, (origin, c) => {
  const config = decodeConfig(c.req.param("configBase64") as string);
  return { config, manifest: buildManifest(config, origin) };
});

// Serve subtitles converted to WebVTT. The upstream URL is attacker-
// controlled input, so it is pinned to kisskh hosts and kisskh's CDN plus
// the mirror origins actually seen serving subtitle lists (mirrors are
// user-supplied and may live on any host), and rate limited — otherwise
// this route is an unauthenticated proxy for internal addresses. The
// upstream fetch is server-side, so http mirrors are as safe as https.
// The VTT proxy serves a file, not a Stremio resource payload — a limited
// response must stay plain text (players would try to parse the resource
// placeholder JSON as VTT and fail every track).
const subtitleProxyLimiter = rateLimiter({
  windowMs: ENV.SUBTITLES_WINDOW_MINUTES * 60 * 1000,
  limit: ENV.SUBTITLES_PROXY_REQUEST_LIMIT,
  keyGenerator: (c) => {
    const { ip } = extractHeaderInfo(c);
    return ip;
  },
  handler: (c) => {
    const { ip } = extractHeaderInfo(c);
    const remaining = c.res.headers.get("RateLimit-Reset") ?? "5";
    logger.warn(
      `Rate limit | Resource: subtitles-proxy, IP: ${ip}, Wait: ${remaining}s`,
    );
    const response = c.text(
      `Too Many Requests\nRetry after ${remaining} seconds`,
      429,
    );
    response.headers.set("Retry-After", remaining);
    // Transient: clients must re-fetch after the window passes
    response.headers.set("Cache-Control", "no-cache");
    return response;
  },
});
stremio.use("/subtitle/:url{.*}", subtitleProxyLimiter);
stremio.get("/subtitle/:url{.*}", async (c) => {
  const rawParam = c.req.param("url");
  let candidate = rawParam;
  try {
    candidate = decodeURIComponent(rawParam);
  } catch {
    // Keep the raw param; it may already be decoded or plain
  }
  let subtitleOrigin = "";
  try {
    const parsed = new URL(candidate);
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      (!isSubtitleSourceHost(parsed.hostname) &&
        !isSeenSubtitleOrigin(parsed.origin))
    ) {
      return c.text("Invalid subtitle URL", 400);
    }
    subtitleOrigin = parsed.origin;
  } catch {
    return c.text("Invalid subtitle URL", 400);
  }

  try {
    const subtitleVtt = await getSubtitleVtt(candidate);
    if (subtitleVtt) {
      return c.text(subtitleVtt, 200, {
        "Content-Type": "text/vtt; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        // The VTT for a given upstream URL is immutable
        "Cache-Control": `max-age=${TTL_SECS.stream}, public`,
      });
    } else {
      logger.error(`Missing subtitle | ${subtitleOrigin}`);
      return c.text("Subtitle not found or conversion failed", 404);
    }
  } catch (error) {
    logger.error(`Fail subtitle proxy | ${error}`);
    return c.text("Invalid subtitle URL", 400);
  }
});

export default stremio;
