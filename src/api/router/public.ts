import { serveStatic } from "@hono/node-server/serve-static";
import crypto from "crypto";
import fs from "fs";
import { Hono } from "hono";
import path from "path";
import { defaultConfig } from "../../lib/manifest.js";
import { ENV } from "../../utils/env.js";
import {
  IYF_DEFAULT_MIRRORS,
  KISSKH_DEFAULT_MIRRORS,
  OLE_DEFAULT_MIRRORS,
} from "../../utils/constant.js";
import { APP_VERSION } from "../../utils/version.js";

const publicRouter = new Hono();
const rootDir = process.cwd();
const publicDir = path.join(rootDir, "public");

// Placeholder host for the config page's mirror input — derived from
// the default so it can't drift when the default host rotates (an empty
// list degrades to an empty placeholder; new URL("") would throw)
const oleHost = OLE_DEFAULT_MIRRORS[0]
  ? new URL(OLE_DEFAULT_MIRRORS[0]).hostname
  : "";
const iyfHost = IYF_DEFAULT_MIRRORS[0]
  ? new URL(IYF_DEFAULT_MIRRORS[0]).hostname
  : "";

// Asset URLs are fingerprinted with a content hash: Cloudflare's edge
// caches /js and /css past the origin TTL, so a redeploy can pair fresh
// HTML with yesterday's landing.js and break the config page. Changing the
// URL on every content change orphans the stale edge entry.
const assetHash = (relativePath: string): string => {
  try {
    return crypto
      .createHash("sha1")
      .update(fs.readFileSync(path.join(publicDir, relativePath)))
      .digest("hex")
      .slice(0, 10);
  } catch {
    return "0";
  }
};

// Serve custom landing page at root
let cachedLandingHtml: string | null = null;
const getLandingPage = () => {
  if (cachedLandingHtml) return cachedLandingHtml;
  const filePath = path.join(publicDir, "landing.html");
  if (!fs.existsSync(filePath)) return null;
  cachedLandingHtml = fs
    .readFileSync(filePath, "utf8")
    .replace("{{VERSION}}", APP_VERSION)
    .replace("{{DEFAULT_CONFIG}}", JSON.stringify(defaultConfig))
    .replace("{{DEFAULT_MIRRORS}}", JSON.stringify(KISSKH_DEFAULT_MIRRORS))
    .replace(
      "{{OLE_DEFAULT_MIRRORS}}",
      JSON.stringify(OLE_DEFAULT_MIRRORS),
    )
    .replace("{{IYF_DEFAULT_MIRRORS}}", JSON.stringify(IYF_DEFAULT_MIRRORS))
    // The mirror input's placeholder tracks the default host (see oleHost)
    .replace("{{OLE_HOST}}", oleHost)
    .replace("{{IYF_HOST}}", iyfHost)
    // The tagline only credits TMDB on deployments that actually enrich with
    // it; both languages' credit text ships as one payload the page appends
    // to its (localized) tagline
    .replace(
      "{{TMDB_CREDIT}}",
      JSON.stringify(
        ENV.TMDB_API_KEY
          ? { en: " Metadata provided by TMDB.", zh: " 元数据由 TMDB 提供。" }
          : { en: "", zh: "" },
      ),
    )
    .replace("{{CSS_HASH}}", assetHash("css/style.css"))
    .replace("{{JS_HASH}}", assetHash("js/landing.js"));

  return cachedLandingHtml;
};

// Public static file
const CACHE_SECONDS = 3600;
const CACHE_CONTROL = `max-age=${CACHE_SECONDS}, public`;
publicRouter.use(async (c, next) => {
  c.header("cache-control", CACHE_CONTROL);
  return next();
});
publicRouter.on("GET", ["/", "/configure", "/:configBase64/configure"], (c) => {
  const html = getLandingPage();
  if (!html) return c.notFound();
  // The HTML is the only thing that knows the current asset hashes, so it
  // must revalidate on every load (it is tiny; assets stay cached)
  c.header("cache-control", "no-cache");
  return c.html(html);
});
publicRouter.use(
  "/*",
  serveStatic({
    root: "./public",
  }),
);

export default publicRouter;
