import { createHash, randomBytes } from "crypto";
import type { Context, MiddlewareHandler } from "hono";
import { getOrCreateMeta, insertVisit } from "../../db/queries.js";
import type { VisitKind } from "../../db/schema/visit.js";
import { providerIdPrefix } from "../../utils/config.js";
import { ENV } from "../../utils/env.js";
import { Logger } from "../../utils/logger.js";
import { extractHeaderInfo } from "../../utils/request.js";

const logger = new Logger("VISITS");

// Everything the dashboard's live feed and recent table display — the
// pseudonymous hashes are deliberately not part of it (nothing shows them)
export interface VisitEvent {
  ts: number;
  kind: VisitKind;
  provider: string | null;
  client: string | null;
  status: number;
  durationMs: number;
}

// In-process pub/sub: the middleware emits, the internal dashboard's SSE
// route subscribes. No queue — events with no connected dashboard are
// dropped; the sqlite row is the record of truth.
const listeners = new Set<(event: VisitEvent) => void>();

export function onVisit(listener: (event: VisitEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Exported for the internal-router tests (the middleware is the only
// production emitter)
export function emitVisit(event: VisitEvent) {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // A dead subscriber never blocks the feed or the response
    }
  }
}

// Static assets change on every page load and carry no visit signal
const STATIC_EXT =
  /\.(js|css|map|svg|ico|png|jpg|jpeg|webp|gif|woff2?|ttf|webmanifest|txt|xml)$/i;

/**
 * Map a request path to its visit kind and provider. Returns null for
 * anything the addon does not serve (404 scans and the like) so only real
 * traffic is logged. Provider comes from the "<provider>." resource-id
 * prefix when the path carries one.
 */
export function classifyVisit(
  pathname: string,
): { kind: VisitKind; provider: string | null } | null {
  if (pathname === "/" || pathname.endsWith("/configure")) {
    return { kind: "landing", provider: null };
  }
  if (pathname.endsWith("/manifest.json")) {
    return { kind: "manifest", provider: null };
  }
  // "/subtitles" resource family and the "/subtitle/:url" VTT proxy
  if (/\/subtitles?(\/|$)/.test(pathname)) {
    return {
      kind: "subtitle",
      provider: providerIdPrefix.exec(pathname)?.[1] ?? null,
    };
  }
  const resource = /^(?:\/[^/]+)?\/(catalog|meta|stream)(?:\/|$)/.exec(pathname);
  if (!resource) return null;
  return {
    kind: resource[1] as VisitKind,
    provider: providerIdPrefix.exec(pathname)?.[1] ?? null,
  };
}

/**
 * The config segment (base64url) of a config-scoped path, null for bare
 * resource paths, the config page and the root.
 */
export function configSegment(pathname: string): string | null {
  const segment = /^\/([^/]+)(?:\/|$)/.exec(pathname)?.[1];
  if (
    !segment ||
    segment === "configure" ||
    segment === "manifest.json" ||
    ["catalog", "meta", "stream", "subtitles", "subtitle"].includes(segment)
  ) {
    return null;
  }
  return segment;
}

const sha256Prefix = (input: string) =>
  createHash("sha256").update(input).digest("hex").slice(0, 16);

const pad2 = (n: number) => String(n).padStart(2, "0");

export const dayKey = (date = new Date()): string =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

export function hashIp(salt: string, ip: string, day = dayKey()): string {
  // The day in the hash input rotates the pseudonym daily: a visitor is
  // dedupable within one day only, by design
  return sha256Prefix(`${salt}:${day}:${ip}`);
}

export function hashConfig(salt: string, configBase64: string): string {
  return sha256Prefix(`${salt}:config:${configBase64}`);
}

// The salt lives in the meta table (a fresh one would scramble every stored
// hash) and is fetched lazily on the first logged request
let salt: Promise<string> | null = null;
const getSalt = () =>
  (salt ??= getOrCreateMeta("visit_salt", () =>
    randomBytes(16).toString("hex"),
  ));

async function recordVisit(
  c: Context,
  event: VisitEvent,
  segment: string | null,
) {
  try {
    const saltValue = await getSalt();
    await insertVisit({
      ts: new Date(event.ts),
      kind: event.kind,
      provider: event.provider,
      client: event.client,
      status: event.status,
      durationMs: event.durationMs,
      ipHash: hashIp(saltValue, extractHeaderInfo(c).ip),
      configHash: segment ? hashConfig(saltValue, segment) : null,
    });
  } catch (e) {
    // The visit log must never break serving
    logger.debug(`Visit not logged | ${e}`);
  }
}

/**
 * Log one row per served request and emit it to the live feed. Runs only
 * when the internal dashboard is enabled (INTERNAL_PORT) — that env var is
 * the switch for logging and the dashboard alike.
 */
export function visitLog(): MiddlewareHandler {
  return async (c, next) => {
    if (
      !ENV.INTERNAL_PORT ||
      STATIC_EXT.test(c.req.path) ||
      c.req.header("x-lumix-warm")
    ) {
      return next();
    }
    const classified = classifyVisit(c.req.path);
    if (!classified) return next();
    const { kind, provider } = classified;

    const segment = configSegment(c.req.path);
    const start = performance.now();
    await next();
    const event: VisitEvent = {
      ts: Date.now(),
      kind,
      provider,
      client: /stremio/i.test(c.req.header("user-agent") ?? "")
        ? "stremio"
        : "web",
      status: c.res.status,
      durationMs: Math.round(performance.now() - start),
    };
    emitVisit(event);
    void recordVisit(c, event, segment);
  };
}
