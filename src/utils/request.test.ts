import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { extractHeaderInfo, getRequestOrigin } from "./request.js";

const probeApp = () => {
  const app = new Hono();
  app.get("/probe", (c) => c.text(getRequestOrigin(c)));
  return app;
};

describe("getRequestOrigin", () => {
  it("falls back to the request url when no proxy headers are present", async () => {
    const response = await probeApp().request("/probe");
    expect(await response.text()).toBe("http://localhost");
  });

  it("derives https from forwarded proto/host behind a trusted proxy", async () => {
    const response = await probeApp().request("/probe", {
      headers: {
        host: "addon.example.com",
        "x-forwarded-proto": "https",
      },
    });
    expect(await response.text()).toBe("https://addon.example.com");
  });

  it("takes the first value of comma-joined proxy headers", async () => {
    const response = await probeApp().request("/probe", {
      headers: {
        "x-forwarded-proto": "https,http",
        "x-forwarded-host": "real.example.com,older.example.com",
      },
    });
    expect(await response.text()).toBe("https://real.example.com");
  });

  it("ignores forwarded headers when TRUST_PROXY is false", async () => {
    process.env.TRUST_PROXY = "false";
    try {
      vi.resetModules();
      const { getRequestOrigin: untrusting } = await import("./request.js");
      const app = new Hono();
      app.get("/probe", (c) => c.text(untrusting(c)));
      const response = await app.request("/probe", {
        headers: {
          host: "addon.example.com",
          "x-forwarded-proto": "https",
        },
      });
      // Spoofable headers are ignored; the socket's own view wins
      expect(await response.text()).toBe("http://localhost");
    } finally {
      delete process.env.TRUST_PROXY;
    }
  });
});

describe("extractHeaderInfo rate-limit keying", () => {
  const ipProbeApp = () => {
    const app = new Hono();
    app.get("/probe", (c) => c.text(extractHeaderInfo(c).ip));
    return app;
  };

  it("prefers cf-connecting-ip over an x-forwarded-for chain", async () => {
    const response = await ipProbeApp().request("/probe", {
      headers: {
        "cf-connecting-ip": "198.51.100.7",
        "x-forwarded-for": "203.0.113.9, 10.0.0.1",
      },
    });
    // The Cloudflare edge overwrites this header, so it outranks XFF whose
    // chain a caller can seed with spoofed hops
    expect(await response.text()).toBe("198.51.100.7");
  });

  it("keys on the first hop of an x-forwarded-for chain", async () => {
    const response = await ipProbeApp().request("/probe", {
      headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
    });
    expect(await response.text()).toBe("203.0.113.9");
  });

  it("trims a lone cf-connecting-ip value", async () => {
    const response = await ipProbeApp().request("/probe", {
      headers: { "cf-connecting-ip": " 198.51.100.7 " },
    });
    expect(await response.text()).toBe("198.51.100.7");
  });

  it("falls back to the socket address without proxy headers", async () => {
    const response = await ipProbeApp().request("/probe");
    // app.request has no node socket behind it, so the fallback is unknown
    expect(await response.text()).toBe("unknown");
  });

  it("ignores forwarded headers when TRUST_PROXY is false", async () => {
    process.env.TRUST_PROXY = "false";
    try {
      vi.resetModules();
      const { extractHeaderInfo: untrusting } = await import("./request.js");
      const app = new Hono();
      app.get("/probe", (c) => c.text(untrusting(c).ip));
      const response = await app.request("/probe", {
        headers: {
          "cf-connecting-ip": "198.51.100.7",
          "x-forwarded-for": "203.0.113.9",
        },
      });
      expect(await response.text()).toBe("unknown");
    } finally {
      delete process.env.TRUST_PROXY;
    }
  });
});
