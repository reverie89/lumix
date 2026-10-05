import { ENV } from "./env.js";
import { isMirrorUrl } from "./format.js";

// The short brand token Stremio-facing strings share: catalog names
// ("[L/kisskh] …"), stream rows ("L/kisskh") and rate-limit rows ("⏱️L …").
export const SHORT_NAME = "L";

export const RATE_LIMIT_DESCRIPTION = `Rate limit\nRetry after a few seconds`;
export const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64; rv:156.0) Gecko/20100101 Firefox/156.0";

// Browser-ish headers shared by every outbound JSON client; each client adds
// its own User-Agent (and any deltas) on top.
export const BROWSER_HEADERS: Record<string, string> = {
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.5",
  "Accept-Encoding": "gzip, deflate",
  Connection: "keep-alive",
  "Upgrade-Insecure-Requests": "1",
};

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
// Kept configurable like the kisskh mirrors so a rotated host can be added
// from the config page.
export const OLE_DEFAULT_MIRRORS = ENV.OLE_HOSTS.filter(isMirrorUrl);

// 中文 display labels for tier options. kisskh and ole share one English
// option vocabulary (see kisskh-catalogs.ts / ole-catalogs.ts), so one
// table serves both providers' catalog names and the config page's chips.
// A test in manifest.test.ts pins completeness against every option list.
export const TIER_LABELS_ZH: Record<string, string> = {
  // types (kisskh + ole)
  TVSeries: "剧集",
  Movies: "电影",
  Anime: "动漫",
  Hollywood: "好莱坞",
  Variety: "综艺",
  ShortDrama: "短剧",
  // regions (kisskh + ole)
  Korean: "韩国",
  Chinese: "大陆",
  Japanese: "日本",
  Hongkong: "香港",
  Thai: "泰国",
  Taiwanese: "台湾",
  Philippine: "菲律宾",
  Indonesian: "印度尼西亚",
  Singaporean: "新加坡",
  Vietnamese: "越南",
  Turkish: "土耳其",
  Indian: "印度",
  Malaysian: "马来西亚",
  US: "美国",
  UK: "英国",
  French: "法国",
  German: "德国",
  Italian: "意大利",
  Spanish: "西班牙",
  Canadian: "加拿大",
  Russian: "俄罗斯",
  Dutch: "荷兰",
  Australian: "澳大利亚",
  // kisskh status
  Ongoing: "连载中",
  Completed: "已完结",
  // kisskh + ole update sorts
  Popular: "热门",
  "Last Update": "最近更新",
  "Release Date": "最新上架",
  Score: "评分",
  // hidden search catalogs
  Search: "搜索",
};

// Provider display names for catalog rows ("[L/欧乐] …") and stream rows
// ("L/欧乐"); keys are the catalog-id prefixes / Provider enum values.
export const PROVIDER_LABELS: Record<string, string> = {
  kisskh: "kisskh",
  ole: "欧乐",
};

export const MANIFEST_DESCRIPTION_ZH = "在线观看电视剧、电影、综艺、动漫与短剧";
