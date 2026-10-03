import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import publicRouter from "./api/router/public.js";
import stremio from "./api/router/stremio.js";
import { closeSqlite } from "./db/sqlite.js";
import { initMigrations } from "./db/drizzle.js";
import { buildManifest } from "./lib/manifest.js";
import { ENV } from "./utils/env.js";
import { Logger } from "./utils/logger.js";

const logger = new Logger("SERVER");
const HOST = "0.0.0.0";
const PORT = 55913;

/**
 * Hit the default manifest + catalogs so their upstream fetches warm the
 * response caches; chunked so boot doesn't fire ~170 upstream calls at once
 * against the shared connection pool. Failures are logged, not fatal.
 */
async function warmCache() {
  const defaultCatalogUrls = buildManifest()
    .catalogs.filter((catalog) => {
      return !catalog.id.toLowerCase().includes("search");
    })
    .map((catalog) => `/catalog/${catalog.type}/${catalog.id}.json`);
  const warmUrls = ["/manifest.json", ...defaultCatalogUrls];
  let failures = 0;
  const chunkSize = 3;
  for (let i = 0; i < warmUrls.length; i += chunkSize) {
    const chunk = warmUrls.slice(i, i + chunkSize);
    const results = await Promise.allSettled(
      chunk.map(async (url) => {
        // 127.0.0.1, not localhost: the name may resolve to ::1, which a
        // 0.0.0.0 bind does not cover
        const response = await fetch(`http://127.0.0.1:${PORT}${url}`);
        await response.arrayBuffer();
      }),
    );
    failures += results.filter((r) => r.status === "rejected").length;
  }
  if (failures > 0) {
    logger.error(`Warm cache failures | ${failures}/${warmUrls.length}`);
  }
}

const app = new Hono();
app.use("*", cors());
app.route("/", stremio);
app.route("/", publicRouter);

// Error handling
app.onError((err, c) => {
  logger.error(`${err}`);
  return c.text("Internal Server Error", 500);
});

// Start server
await initMigrations();
try {
  serve({ fetch: app.fetch, port: PORT, hostname: HOST }, () => {
    logger.log(`lumix running on http://${HOST}:${PORT}`);
  });
  if (ENV.WARM_CACHE) {
    await warmCache();
    logger.log(`Warming cache completed`);
  }
} catch (error) {
  logger.log(`Fail to start | ${error}`);
}

// Global catch to prevent crashes
process.on("unhandledRejection", (reason, _) => {
  logger.error(`UNHANDLED_REJECTION | Reason: ${reason}`);
});
process.on("uncaughtException", (err) => {
  logger.error(`UNCAUGHT_EXCEPTION | ${err}`);
});
async function shutdown(signal: string) {
  logger.log(signal);
  closeSqlite();
  process.exit();
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
