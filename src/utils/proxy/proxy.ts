import { ENV } from "../env.js";

export function getProxyUrl(url: string) {
  if (!ENV.PROXY_URL) return url;
  const needProxy = ENV.PROXY_TMDB || ENV.PROXY_KISSKH_SUBTITLE;
  if (!needProxy) return url;

  return `${ENV.PROXY_URL}:${ENV.PROXY_PORT}/${url}`;
}
