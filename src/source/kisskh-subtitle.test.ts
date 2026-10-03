import { describe, expect, it } from "vitest";
import { srtToVtt } from "./kisskh-subtitle.js";

const srt = [
  "1",
  "00:01:30,340 --> 00:01:33,578",
  "=Against The Current=",
  "",
  "2",
  "00:01:33,579 --> 00:01:35,000",
  "(Adapted from a novel)",
].join("\n");

describe("srtToVtt", () => {
  it("prepends the WEBVTT header and rewrites comma timestamps to dots", () => {
    const vtt = srtToVtt(srt);
    expect(vtt.startsWith("WEBVTT\n\n")).toBe(true);
    expect(vtt).toContain("00:01:30.340 --> 00:01:33.578");
    expect(vtt).toContain("00:01:33.579 --> 00:01:35.000");
    expect(vtt).not.toContain(",340");
    expect(vtt).not.toContain(",578");
  });

  it("normalizes CRLF line endings and strips a UTF-8 BOM", () => {
    const crlf = `\uFEFF${srt.replace(/\n/g, "\r\n")}`;
    const vtt = srtToVtt(crlf);
    expect(vtt.startsWith("WEBVTT\n\n")).toBe(true);
    expect(vtt).not.toContain("\r");
    expect(vtt).not.toContain("\uFEFF");
  });

  it("rewrites only timestamps — text commas stay intact", () => {
    const vtt = srtToVtt(
      "1\n00:00:01,000 --> 00:00:02,000\nHello, world, again\n",
    );
    expect(vtt).toContain("Hello, world, again");
  });

  it("passes already-VTT text through with newline normalization only", () => {
    const vtt = "WEBVTT\r\n\r\n00:00:01.000 --> 00:00:02.000\nHi";
    expect(srtToVtt(vtt)).toBe("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi");
  });

  it("keeps non-ASCII cue text intact", () => {
    const vtt = srtToVtt("1\n00:00:01,000 --> 00:00:02,000\n=عكر التيار= ♪\n");
    expect(vtt).toContain("=عكر التيار= ♪");
  });
});
