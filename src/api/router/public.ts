import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { defaultConfig } from "../../lib/manifest.js";
import { ENV } from "../../utils/env.js";
import {
  IYF_DEFAULT_MIRRORS,
  KISSKH_DEFAULT_MIRRORS,
  OLE_DEFAULT_MIRRORS,
} from "../../utils/constant.js";
import { APP_VERSION } from "../../utils/version.js";
import { assetHash, renderTemplate } from "./template.js";

const publicRouter = new Hono();

// Placeholder host for the config page's mirror input — derived from
// the default so it can't drift when the default host rotates (an empty
// list degrades to an empty placeholder; new URL("") would throw)
const oleHost = OLE_DEFAULT_MIRRORS[0]
  ? new URL(OLE_DEFAULT_MIRRORS[0]).hostname
  : "";
const iyfHost = IYF_DEFAULT_MIRRORS[0]
  ? new URL(IYF_DEFAULT_MIRRORS[0]).hostname
  : "";

// Serve custom landing page at root
let cachedLandingHtml: string | null = null;
const getLandingPage = () => {
  if (cachedLandingHtml) return cachedLandingHtml;
  const html = renderTemplate("landing.html", {
    VERSION: APP_VERSION,
    DEFAULT_CONFIG: JSON.stringify(defaultConfig),
    DEFAULT_MIRRORS: JSON.stringify(KISSKH_DEFAULT_MIRRORS),
    OLE_DEFAULT_MIRRORS: JSON.stringify(OLE_DEFAULT_MIRRORS),
    IYF_DEFAULT_MIRRORS: JSON.stringify(IYF_DEFAULT_MIRRORS),
    // The mirror input's placeholder tracks the default host (see oleHost)
    OLE_HOST: oleHost,
    IYF_HOST: iyfHost,
    // The tagline only credits TMDB on deployments that actually enrich with
    // it; both languages' credit text ships as one payload the page appends
    // to its (localized) tagline
    TMDB_CREDIT: JSON.stringify(
      ENV.TMDB_API_KEY
        ? { en: " Metadata provided by TMDB.", zh: " 元数据由 TMDB 提供。" }
        : { en: "", zh: "" },
    ),
    CSS_HASH: assetHash("css/style.css"),
    JS_HASH: assetHash("js/landing.js"),
  });
  if (html) cachedLandingHtml = html;
  return html;
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
