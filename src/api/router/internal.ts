import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getVisitSummary } from "../../db/queries.js";
import { APP_VERSION } from "../../utils/version.js";
import { onVisit } from "../middleware/visit-log.js";
import { assetHash, renderTemplate } from "./template.js";

// The internal visits dashboard. This router is served by its own listener
// in server.ts (only when INTERNAL_PORT is set), bound to the loopback
// interface by default — it is never mounted on the public app.
const internalRouter = new Hono();

const getStatsPage = (visitDataJson: string) =>
  renderTemplate("stats.html", {
    VERSION: APP_VERSION,
    CSS_HASH: assetHash("css/style.css"),
    JS_HASH: assetHash("js/stats.js"),
    VISIT_DATA: visitDataJson,
  });

internalRouter.get("/", async (c) => {
  const summary = await getVisitSummary();
  const html = getStatsPage(JSON.stringify(summary));
  if (!html) return c.notFound();
  // The HTML embeds this load's summary — revalidate every load
  c.header("cache-control", "no-cache");
  return c.html(html);
});

// Live visit feed: one SSE stream per open dashboard, a visit event per
// logged request plus a heartbeat to keep intermediaries from closing the
// idle connection. EventSource reconnects on its own after a drop.
internalRouter.get("/events", (c) =>
  streamSSE(c, async (stream) => {
    const unsubscribe = onVisit((event) => {
      void stream
        .writeSSE({ event: "visit", data: JSON.stringify(event) })
        .catch(() => {});
    });
    const heartbeat = setInterval(() => {
      void stream
        .writeSSE({ event: "ping", data: String(Date.now()) })
        .catch(() => {});
    }, 25_000);
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearInterval(heartbeat);
        unsubscribe();
        resolve();
      };
      // The raw request signal aborts on client disconnect (also the only
      // trigger in in-process tests); stream.onAbort covers runtimes that
      // signal it instead
      stream.onAbort(finish);
      c.req.raw.signal.addEventListener("abort", finish, { once: true });
    });
  }),
);

// This listener serves its own static files (the vendor bundle, stats.js,
// the shared stylesheet) — it is a separate app from the public one
internalRouter.use(
  "/*",
  serveStatic({
    root: "./public",
  }),
);

export default internalRouter;
