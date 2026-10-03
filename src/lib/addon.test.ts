import { describe, expect, it } from "vitest";
import { withProxyUrls } from "./addon.js";

describe("withProxyUrls", () => {
  it("renders the /subtitle/ proxy url against the requesting origin", () => {
    const result = withProxyUrls("https://addon.example.com", {
      subtitles: [
        {
          id: "kisskh:10903:eng",
          lang: "eng",
          url: "https://cdn.kisskh.test/sub.en.srt?v=abc",
          label: "English",
        },
      ],
      cacheMaxAge: 1800,
    });
    expect(result.subtitles[0]?.url).toBe(
      "https://addon.example.com/subtitle/https%3A%2F%2Fcdn.kisskh.test%2Fsub.en.srt%3Fv%3Dabc",
    );
    expect(result.cacheMaxAge).toBe(1800);
  });

  it("does not mutate the cached list it renders from", () => {
    const cached = {
      subtitles: [
        {
          id: "kisskh:10903:eng",
          lang: "eng",
          url: "https://cdn.kisskh.test/sub.en.srt",
          label: "English",
        },
      ],
      cacheMaxAge: 1800,
    };
    withProxyUrls("https://addon.example.com", cached);
    expect(cached.subtitles[0]?.url).toBe("https://cdn.kisskh.test/sub.en.srt");
  });
});
