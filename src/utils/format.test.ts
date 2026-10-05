import { describe, expect, it } from "vitest";
import {
  formatStreamFilename,
  formatStreamTitle,
  isMirrorUrl,
} from "./format.js";

describe("formatStreamTitle", () => {
  it("shows only the episode tag for series", () => {
    expect(formatStreamTitle("Lovely Runner", 2024, 1, 5)).toBe("S01E05");
  });

  it("pads season and episode numbers", () => {
    expect(formatStreamTitle("Lovely Runner", 2024, 2, 11)).toBe("S02E11");
  });

  it("keeps title // year for movies", () => {
    expect(formatStreamTitle("Exhuma", 2024)).toBe("Exhuma // 2024");
  });

  it("drops the year when it is already in the title", () => {
    expect(formatStreamTitle("Exhuma 2024", 2024)).toBe("Exhuma 2024");
  });

  it("returns the title when the year is unknown", () => {
    expect(formatStreamTitle("Exhuma")).toBe("Exhuma");
  });
});

describe("formatStreamFilename", () => {
  it("keeps title and episode for series", () => {
    expect(formatStreamFilename("Lovely Runner", 2024, 1, 5)).toBe(
      "Lovely Runner S01E05",
    );
  });

  it("keeps title and year for movies", () => {
    expect(formatStreamFilename("Exhuma", 2024)).toBe("Exhuma 2024");
  });

  it("keeps the bare title when the year is unknown", () => {
    expect(formatStreamFilename("Exhuma")).toBe("Exhuma");
  });
});

describe("isMirrorUrl", () => {
  it("accepts any http(s) URL regardless of hostname", () => {
    expect(isMirrorUrl("https://kisskh.test")).toBe(true);
    expect(isMirrorUrl("https://kisskh.test/path")).toBe(true);
    expect(isMirrorUrl("http://mirror.example")).toBe(true);
    expect(isMirrorUrl("https://api.ole.test")).toBe(true);
    // Hostnames never matter: a mirror is whatever the user inputs
    expect(isMirrorUrl("https://kisskh.example.evil.com")).toBe(true);
  });

  it("rejects non-http protocols and garbage", () => {
    expect(isMirrorUrl("ftp://kisskh.test")).toBe(false);
    expect(isMirrorUrl("kisskh.test")).toBe(false);
    expect(isMirrorUrl("not a url")).toBe(false);
  });
});
