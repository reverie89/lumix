import { ENV } from "./env.js";
import { isMirrorUrl } from "./format.js";

// The short brand token Stremio-facing strings share: catalog names
// ("[L/kisskh] …"), stream rows ("L/kisskh") and rate-limit rows ("⏱️L …").
export const SHORT_NAME = "L";

// Provider display names for catalog rows ("[L/欧乐] …") and stream rows
// ("L/欧乐"); keys are the catalog-id prefixes / Provider enum values.
export const PROVIDER_LABELS: Record<string, string> = {
  kisskh: "kisskh",
  ole: "欧乐",
};

export const RATE_LIMIT_DESCRIPTION = `Rate limit\nRetry after a few seconds`;
export const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64; rv:156.0) Gecko/20100101 Firefox/156.0";

// kisskh serves subtitles and HLS streams from its own CDN rather than the
// mirrors (sub.cdnvideo11.shop, hlsNN.cdnvideo11.shop)
export const KISSKH_CDN_DOMAIN = "cdnvideo11.shop";

// Deployment defaults for the kisskh mirrors a user can pick from on the
// config page (KISSKH_MIRRORS in .env). They also serve as the candidates
// when a config carries no mirrors (default traffic). Entries that aren't
// valid mirror URLs are dropped; users may add further *.kisskh.* mirrors
// in their config — any http(s) URL is accepted.
export const KISSKH_DEFAULT_MIRRORS = ENV.KISSKH_MIRRORS.filter(isMirrorUrl);

// How long a mirror failure stays counted (shared by every provider's
// failover window). After this the mirror is probed again and reclaims its
// user-chosen fallback position once it recovers.
export const MIRROR_FAIL_TTL_MS = 10 * 60 * 1000;

// ole (欧乐) serves everything through one JSON API host (OLE_HOSTS
// in .env). Kept configurable like the kisskh mirrors so a rotated host can
// be added from the config page.
export const OLE_DEFAULT_MIRRORS = ENV.OLE_HOSTS.filter(isMirrorUrl);
