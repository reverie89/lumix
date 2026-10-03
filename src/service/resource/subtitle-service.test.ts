import { describe, expect, it } from "vitest";
import { SubtitleRow, toSubtitle } from "./subtitle-service.js";

const row = (overrides: {
  lang?: string;
  ttl?: number | null;
  updatedAt?: Date;
  url?: string;
}): SubtitleRow =>
  ({
    subtitle: {
      updatedAt: overrides.updatedAt ?? new Date(),
      ttl: overrides.ttl ?? 60 * 60 * 1000,
      url: overrides.url ?? "https://cdn.kisskh.test/sub.en.srt?v=abc",
      lang: overrides.lang ?? "eng",
    },
    provider_content: { provider: "kisskh" },
  }) as unknown as SubtitleRow;

describe("toSubtitle", () => {
  it("gives every track a unique id derived from its lang", () => {
    const eng = toSubtitle("kisskh:10903", row({ lang: "eng" }));
    const ara = toSubtitle("kisskh:10903", row({ lang: "ara" }));
    expect(eng?.id).toBe("kisskh:10903:eng");
    expect(ara?.id).toBe("kisskh:10903:ara");
    expect(eng?.id).not.toBe(ara?.id);
  });

  it("labels tracks with the language name and falls back to the provider", () => {
    expect(toSubtitle("kisskh:1", row({ lang: "eng" }))?.label).toBe("English");
    expect(toSubtitle("kisskh:1", row({ lang: "zzz" }))?.label).toBe("kisskh");
  });

  it("keeps the raw upstream url (the handler layer renders the proxy url)", () => {
    const track = toSubtitle(
      "kisskh:1",
      row({ url: "https://cdn.kisskh.test/sub.en.srt?v=abc" }),
    );
    expect(track?.url).toBe("https://cdn.kisskh.test/sub.en.srt?v=abc");
  });

  it("drops rows whose ttl has passed", () => {
    const expired = toSubtitle(
      "kisskh:1",
      row({
        ttl: 1000,
        updatedAt: new Date(Date.now() - 60 * 1000),
      }),
    );
    expect(expired).toBeUndefined();
  });
});
