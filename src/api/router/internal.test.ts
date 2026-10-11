import { afterEach, describe, expect, it, vi } from "vitest";

const queries = vi.hoisted(() => ({
  getVisitSummary: vi.fn(),
  insertVisit: vi.fn(),
  getOrCreateMeta: vi.fn(),
}));
vi.mock("../../db/queries.js", () => queries);

const SUMMARY_FIXTURE = {
  today: { landing: 3, manifest: 12, catalog: 0, meta: 0, stream: 0, subtitle: 0 },
  week: { landing: 51, manifest: 89, catalog: 10, meta: 4, stream: 2, subtitle: 1 },
  uniqueToday: 7,
  installsToday: 3,
  daily: Array.from({ length: 14 }, (_, i) => ({
    day: `2026-10-${String(i + 1).padStart(2, "0")}`,
    count: i,
  })),
  recent: [
    {
      ts: 1760000000000,
      kind: "manifest",
      provider: null,
      client: "stremio",
      status: 200,
      durationMs: 42,
    },
  ],
};

const load = async () => {
  vi.resetModules();
  process.env.INTERNAL_PORT = "55914";
  queries.getVisitSummary.mockResolvedValue(SUMMARY_FIXTURE);
  queries.getOrCreateMeta.mockResolvedValue("testsalt");
  return (await import("./internal.js")).default;
};

afterEach(() => {
  delete process.env.INTERNAL_PORT;
});

describe("internal router", () => {
  it("renders the stats page with the summary injected", async () => {
    const internal = await load();
    const res = await internal.request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain('id="visitData"');
    expect(html).toContain('"uniqueToday":7');
    expect(html).toContain('"installsToday":3');
    expect(html).toContain('"/vendor/chart.umd.js"');
    expect(html).toContain("/js/stats.js?v=");
  });

  it("streams visit events over SSE and stops on abort", async () => {
    const internal = await load();
    const { emitVisit } = await import("../middleware/visit-log.js");

    const controller = new AbortController();
    const res = await internal.request("/events", {
      signal: controller.signal,
    });
    expect(res.status).toBe(200);

    const reader = res.body!.getReader();
    emitVisit({
      ts: 1760000000000,
      kind: "manifest",
      provider: "kisskh",
      client: "stremio",
      status: 200,
      durationMs: 42,
    });
    const chunk = await reader.read();
    const text = new TextDecoder().decode(chunk.value);
    expect(text).toContain("event: visit");
    expect(text).toContain('"kind":"manifest"');
    expect(text).toContain('"provider":"kisskh"');

    // Aborting the request resolves the stream (no dangling subscription)
    controller.abort();
    await reader.cancel().catch(() => {});
  });
});
