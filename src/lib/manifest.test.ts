import { describe, expect, it } from "vitest";
import { buildManifest } from "./manifest.js";

describe("buildManifest logo", () => {
  it("stamps the logo with the requesting origin without poisoning the memo", () => {
    const first = buildManifest(undefined, "https://a.example.com");
    expect(first.logo).toBe("https://a.example.com/img/lumix.ico");
    // The default-manifest memo must not pin the first origin it served
    const second = buildManifest(undefined, "https://b.example.com");
    expect(second.logo).toBe("https://b.example.com/img/lumix.ico");
  });
});
