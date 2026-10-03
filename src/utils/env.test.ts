import { describe, expect, it } from "vitest";
import { booleanFlag } from "./env.js";

describe("booleanFlag", () => {
  it("parses only true/false/1/0", () => {
    expect(booleanFlag(false).parse("true")).toBe(true);
    expect(booleanFlag(false).parse("1")).toBe(true);
    expect(booleanFlag(true).parse("false")).toBe(false);
    expect(booleanFlag(true).parse("0")).toBe(false);
  });

  it("applies the default for unset values", () => {
    expect(booleanFlag(true).parse(undefined)).toBe(true);
    expect(booleanFlag(false).parse(undefined)).toBe(false);
  });

  it("rejects loose boolean strings instead of coercing them to true", () => {
    expect(() => booleanFlag(true).parse("FALSE")).toThrow();
    expect(() => booleanFlag(false).parse("yes")).toThrow();
    expect(() => booleanFlag(false).parse("2")).toThrow();
  });
});
