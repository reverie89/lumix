import { Context } from "hono";
import { ENV } from "./env.js";

function socketAddress(c: Context): string {
  // @hono/node-server exposes the raw IncomingMessage on c.env
  const incoming = (
    c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined
  )?.incoming;
  return incoming?.socket?.remoteAddress ?? "unknown";
}

// The addon's own address as the requesting client sees it. Forwarded
// headers are only honored behind a trusted proxy (they are spoofable),
// matching the IP logic in extractHeaderInfo.
export function getRequestOrigin(c: Context): string {
  const url = new URL(c.req.url);
  if (!ENV.TRUST_PROXY) return url.origin;
  const proto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim();
  const host =
    c.req.header("x-forwarded-host")?.split(",")[0]?.trim() ||
    c.req.header("host") ||
    url.host;
  return proto ? `${proto}://${host}` : url.origin;
}

export function extractHeaderInfo(c: Context) {
  // Forwarded headers hold the real client IP only behind a trusted proxy;
  // otherwise they are spoofable, so fall back to (or force) the socket address.
  // cf-connecting-ip wins when present: the Cloudflare edge overwrites it, so
  // a client cannot influence it, while an x-forwarded-for chain is appended
  // to per hop and only its first element is the originating client.
  const ip = ENV.TRUST_PROXY
    ? c.req.header("cf-connecting-ip")?.trim() ||
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
      socketAddress(c)
    : socketAddress(c);
  const country = c.req.header("cf-ipcountry") || "";
  const url = c.req.url;
  const origin = c.req.header("origin") || c.req.header("referer") || "";
  const userAgent = c.req.header("user-agent") || "";
  return { ip, country, url, origin, userAgent };
}
