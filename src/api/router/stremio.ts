import {
  AddonBuilder,
  createRouter,
  MetaDetail,
  MetaPreview,
  ShortManifestResource,
  Stream,
  Subtitle,
} from "@stremio-addon/sdk";
import { rateLimiter } from "hono-rate-limiter";
import {
  buildCatalogHandler,
  buildMetaHandler,
  buildStreamHandler,
  buildSubtitleHandler,
} from "../../lib/addon.js";
import {
  buildManifest,
  defaultConfig,
  Prefix,
  UserConfig,
} from "../../lib/manifest.js";
import { Hono } from "hono";
import { getSubtitleVtt } from "../../source/kisskh-subtitle.js";
import {
  expandKisskhCatalogs,
  getKisskhQuery,
  isMirrorUrl,
  isSubtitleSourceHost,
  KISSKH_HIDDEN_CATALOGS,
  normalizeKisskhTiers,
} from "../../source/kisskh-catalogs.js";
import { isSeenSubtitleOrigin } from "../../source/kisskh.js";
import { Provider } from "../../source/provider.js";
import { DISPLAY_NAME } from "../../utils/constant.js";
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
const getName = () => `⏱️${DISPLAY_NAME}\nRate Limit`;
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
        const key = `${ip}`;
        return key;
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
const stremioRouteConfigs: RouteConfig[] = [
  { route: "/catalog/*", limiter: catalogLimiter },
  { route: "/meta/*", limiter: metaLimiter },
  { route: "/stream/*", limiter: streamLimiter },
  { route: "/subtitles/*", limiter: subtitlesLimiter },
];
stremioRouteConfigs.forEach((config) => {
  stremio.use(config.route, config.limiter);
  stremio.get(config.route, async (c) => {
    const origin = getRequestOrigin(c);
    const defaultManifest = buildManifest(undefined, origin);
    const builder = new AddonBuilder(defaultManifest);
    builder.defineCatalogHandler(async (args) => {
      return await buildCatalogHandler(args);
    });
    builder.defineMetaHandler(async (args) => {
      return await buildMetaHandler(args);
    });
    builder.defineStreamHandler(async (args) => {
      return await buildStreamHandler(args);
    });
    builder.defineSubtitlesHandler(async (args) => {
      return await buildSubtitleHandler(args, defaultConfig, origin);
    });
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

const asStringArray = (value: any): string[] =>
  Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];

/**
 * Normalize a decoded config: validate mirrors and tier picks, expand catalog
 * ids and derive catalog/stream providers. Legacy flat configs (older
 * manifest links) fall back to their kisskh catalog ids.
 */
function normalizeConfig(raw: any): UserConfig {
  const config: UserConfig = {
    providers: {},
    catalogs: [],
    catalog: [],
    stream: [],
  };

  const rawKisskh = raw?.providers?.kisskh;
  if (rawKisskh && typeof rawKisskh === "object") {
    const tiers = normalizeKisskhTiers({
      type: asStringArray(rawKisskh.type),
      region: asStringArray(rawKisskh.region),
      status: asStringArray(rawKisskh.status),
      update: asStringArray(rawKisskh.update),
    });
    const mirrors = asStringArray(rawKisskh.mirrors).filter(isMirrorUrl);
    config.providers.kisskh = { ...tiers, mirrors };
    config.catalogs = [
      ...expandKisskhCatalogs(tiers),
      ...KISSKH_HIDDEN_CATALOGS,
    ];
    config.catalog = [Provider.KISSKH];
    config.stream = [Provider.KISSKH];
  } else if (Array.isArray(raw?.catalogs)) {
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
  } else {
    // Unrecognized shape: serve the default catalogs instead of an addon
    // with no rows
    return { ...defaultConfig };
  }
  return config;
}

export const decodeConfig = (configBase64: string): UserConfig => {
  try {
    const decoded = Buffer.from(configBase64, "base64").toString("utf-8");
    const raw = JSON.parse(decoded);
    const config = normalizeConfig(raw);
    logger.debug(
      `Config | catalogs: ${config.catalogs.length}, mirrors: ${config.providers.kisskh?.mirrors.join(",") || "default"}`,
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
configStremioRoutes.forEach((route) => {
  stremio.use(route.route, route.limiter);
  stremio.get(route.route, async (c) => {
    const origin = getRequestOrigin(c);
    const configBase64 = c.req.param("configBase64") as string;
    const config = decodeConfig(configBase64);
    const manifest = buildManifest(config, origin);
    const builder = new AddonBuilder(manifest);
    if (manifest.resources.includes("catalog")) {
      builder.defineCatalogHandler(async (args) => {
        return await buildCatalogHandler(args, config);
      });
    }
    if (
      manifest.resources.includes("meta") ||
      manifest.resources.some(
        (r) => typeof r === "object" && "name" in r && r.name === "meta",
      )
    ) {
      builder.defineMetaHandler(async (args) => {
        return await buildMetaHandler(args, config);
      });
    }
    if (manifest.resources.includes("stream")) {
      builder.defineStreamHandler(async (args) => {
        return await buildStreamHandler(args, config);
      });
    }
    if (manifest.resources.includes("subtitles")) {
      builder.defineSubtitlesHandler(async (args) => {
        return await buildSubtitleHandler(args, config, origin);
      });
    }
    const customRouter = createRouter(builder.getInterface());
    const response = await customRouter(c.req.raw);
    if (response) {
      c.header(
        "Cache-Control",
        response.headers.get("Cache-Control") || "no-cache",
      );
    }
    return response || c.notFound();
  });
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
