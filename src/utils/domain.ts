// Subtitle tracks are served through the addon's /subtitle/ proxy (see
// src/api/router/stremio.ts). The upstream URL is encoded so its ?query/
// #fragment can't split the /subtitle/ path. Callers pass the requesting
// client's own origin (src/utils/request.ts getRequestOrigin) — the one
// address guaranteed reachable from that client; no single deployment
// setting can be right for tunnel, LAN and localhost at once.
export function createSubtitleProxyUrl(
  origin: string,
  subtitleUrl: string,
): string {
  return `${origin}/subtitle/${encodeURIComponent(subtitleUrl)}`;
}
