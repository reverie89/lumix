import { ENV } from "./env.js";
import { isMirrorUrl } from "./format.js";

export const DISPLAY_NAME = "lumix";

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

// How long a mirror failure stays counted. After this the mirror is probed
// again and reclaims its user-chosen fallback position once it recovers.
export const KISSKH_FAIL_TTL_MS = 10 * 60 * 1000;
