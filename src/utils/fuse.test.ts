import { describe, expect, it } from "vitest";
import { FuseError } from "./error.js";
import { bestMatch, matchTitle } from "./fuse.js";

const candidates = [
  { title: "The Glory" },
  { title: "Take Charge of My Heart" },
];

describe("bestMatch", () => {
  it("returns the winning item with the scores behind it", () => {
    const match = bestMatch(candidates, "The Glory");
    expect(match.item.title).toBe("The Glory");
    // Fuse score is a distance: a normalized exact match lands near 0
    expect(match.fuseScore).toBeLessThanOrEqual(0.2);
    expect(match.tokenScore).toBeGreaterThan(75);
  });

  it("matchTitle picks the same item bestMatch scores", () => {
    expect(matchTitle(candidates, "Take Charge of My Heart")[0]).toEqual(
      bestMatch(candidates, "Take Charge of My Heart").item,
    );
  });

  it("throws FuseError when nothing is close", () => {
    expect(() =>
      bestMatch(candidates, "Completely Unrelated Words Here"),
    ).toThrow(FuseError);
  });
});
