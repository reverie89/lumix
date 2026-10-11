import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

const queries = vi.hoisted(() => ({
  insertVisit: vi.fn(),
  getOrCreateMeta: vi.fn(),
}));
vi.mock("../../db/queries.js", () => queries);

// The middleware's feature switch is read from ENV, parsed at module load —
// tests re-import with INTERNAL_PORT set or deleted
const load = (internalPort?: string) => {
  vi.resetModules();
  if (internalPort === undefined) {
    delete process.env.INTERNAL_PORT;
  } else {
    process.env.INTERNAL_PORT = internalPort;
  }
  return import("./visit-log.js");
};

afterEach(() => {
  queries.insertVisit.mockClear();
  delete process.env.INTERNAL_PORT;
});

describe("classifyVisit", () => {
  it("classifies landing, manifest and resource paths", async () => {
    const { classifyVisit } = await load("55914");
    expect(classifyVisit("/")).toEqual({ kind: "landing", provider: null });
    expect(classifyVisit("/configure")).toEqual({ kind: "landing", provider: null });
    expect(classifyVisit("/abc_config/configure")).toEqual({
      kind: "landing",
      provider: null,
    });
    expect(classifyVisit("/manifest.json")).toEqual({ kind: "manifest", provider: null });
    expect(classifyVisit("/abc/manifest.json")).toEqual({ kind: "manifest", provider: null });
    expect(classifyVisit("/catalog/series/kisskh.series.Popular.json")).toEqual({
      kind: "catalog",
      provider: "kisskh",
    });
    expect(classifyVisit("/abc123/catalog/series/ole.ole.series.json")).toEqual({
      kind: "catalog",
      provider: "ole",
    });
    expect(classifyVisit("/abc123/stream/series/kisskh.123:1:1.json")).toEqual({
      kind: "stream",
      provider: "kisskh",
    });
    expect(classifyVisit("/meta/series/tmdb.123.json")).toEqual({
      kind: "meta",
      provider: null,
    });
    expect(classifyVisit("/subtitles/series/kisskh.1.json")).toEqual({
      kind: "subtitle",
      provider: "kisskh",
    });
    expect(classifyVisit("/subtitle/https%3A%2F%2Fsub.example.com%2Fa.vtt")).toEqual({
      kind: "subtitle",
      provider: null,
    });
  });

  it("returns null for unknown and static paths so they are not logged", async () => {
    const { classifyVisit } = await load("55914");
    expect(classifyVisit("/js/stats.js")).toBeNull();
    expect(classifyVisit("/img/lumix.svg")).toBeNull();
    expect(classifyVisit("/icons.svg")).toBeNull();
    expect(classifyVisit("/wp-admin")).toBeNull();
  });
});

describe("configSegment", () => {
  it("extracts the base64url config segment only where one exists", async () => {
    const { configSegment } = await load("55914");
    expect(configSegment("/abc/manifest.json")).toBe("abc");
    expect(configSegment("/abc/configure")).toBe("abc");
    expect(configSegment("/abc/stream/series/kisskh.1.json")).toBe("abc");
    expect(configSegment("/manifest.json")).toBeNull();
    expect(configSegment("/configure")).toBeNull();
    expect(configSegment("/catalog/series/x.json")).toBeNull();
    expect(configSegment("/subtitle/https%3A%2F%2Fa.vtt")).toBeNull();
    expect(configSegment("/")).toBeNull();
  });
});

describe("hashes", () => {
  it("stays stable within a day and rotates across days or salts", async () => {
    const { hashIp, hashConfig } = await load("55914");
    expect(hashIp("s", "1.2.3.4", "2026-10-11")).toBe(
      hashIp("s", "1.2.3.4", "2026-10-11"),
    );
    expect(hashIp("s", "1.2.3.4", "2026-10-11")).not.toBe(
      hashIp("s", "1.2.3.4", "2026-10-12"),
    );
    expect(hashIp("s", "1.2.3.4", "2026-10-11")).not.toBe(
      hashIp("other", "1.2.3.4", "2026-10-11"),
    );
    expect(hashConfig("s", "abc")).toBe(hashConfig("s", "abc"));
    expect(hashConfig("s", "abc")).not.toBe(hashConfig("s", "abd"));
  });
});

describe("visitLog middleware", () => {
  it("logs one row per served request and emits it to the bus", async () => {
    const mod = await load("55914");
    const app = new Hono();
    app.use("*", mod.visitLog());
    app.get("/abc/manifest.json", (c) => c.json({ ok: true }));
    app.get("/", (c) => c.text("landing"));
    app.get("/js/app.js", (c) => c.text("x"));

    const events: unknown[] = [];
    const unsubscribe = mod.onVisit((event) => events.push(event));
    try {
      await app.request("/abc/manifest.json", {
        headers: { "user-agent": "Stremio/270" },
      });
      await vi.waitFor(() => expect(queries.insertVisit).toHaveBeenCalledTimes(1));
      const loggedRow = queries.insertVisit.mock.calls[0]![0];
      expect(loggedRow).toMatchObject({
        kind: "manifest",
        client: "stremio",
        status: 200,
        provider: null,
        configHash: expect.any(String),
        ipHash: expect.any(String),
      });
      expect(loggedRow.ts).toBeInstanceOf(Date);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        kind: "manifest",
        client: "stremio",
        status: 200,
        durationMs: expect.any(Number),
      });

      await app.request("/");
      await vi.waitFor(() => expect(queries.insertVisit).toHaveBeenCalledTimes(2));
      expect(queries.insertVisit.mock.calls[1]![0]).toMatchObject({
        kind: "landing",
        client: "web",
      });

      // Static assets are never logged
      await app.request("/js/app.js");
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(queries.insertVisit).toHaveBeenCalledTimes(2);
    } finally {
      unsubscribe();
    }
  });

  it("skips the warm-cache marker header", async () => {
    const mod = await load("55914");
    const app = new Hono();
    app.use("*", mod.visitLog());
    app.get("/manifest.json", (c) => c.json({ ok: true }));

    await app.request("/manifest.json", { headers: { "x-lumix-warm": "1" } });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(queries.insertVisit).not.toHaveBeenCalled();
  });

  it("does nothing when INTERNAL_PORT is unset", async () => {
    const mod = await load();
    const app = new Hono();
    app.use("*", mod.visitLog());
    app.get("/manifest.json", (c) => c.json({ ok: true }));

    const events: unknown[] = [];
    const unsubscribe = mod.onVisit((event) => events.push(event));
    try {
      await app.request("/manifest.json");
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(queries.insertVisit).not.toHaveBeenCalled();
      expect(events).toHaveLength(0);
    } finally {
      unsubscribe();
    }
  });
});
