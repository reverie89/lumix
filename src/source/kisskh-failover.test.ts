import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getKisskhBaseUrl,
  getKisskhMetrics,
  markKisskhUrlFail,
  markKisskhUrlSuccess,
} from "./kisskh.js";
import { KISSKH_FAIL_TTL_MS } from "../utils/constant.js";

// Unique origins per run keep the module-level metrics isolated between tests
let counter = 0;
function freshMirrors(count: number): [string, string] {
  const a = `https://mirror${++counter}.kisskh.test`;
  const b = `https://mirror${++counter}.kisskh.test`;
  if (count !== 2) throw new Error("tests always use pairs");
  return [a, b];
}

afterEach(() => {
  vi.useRealTimers();
});

describe("kisskh mirror failover", () => {
  it("records success and fail metrics per origin", () => {
    const [a, b] = freshMirrors(2);
    markKisskhUrlSuccess(`${a}/api/x`);
    markKisskhUrlSuccess(`${a}/api/y`);
    markKisskhUrlFail(`${b}/api/x`);
    const metrics = getKisskhMetrics();
    expect(metrics.get(a)?.success).toBe(2);
    expect(metrics.get(b)?.fail).toBe(1);
  });

  it("serves mirrors strictly in the user's order while they are healthy", () => {
    const [a, b] = freshMirrors(2);
    markKisskhUrlSuccess(`${b}/api/x`);
    expect(getKisskhBaseUrl([a, b])).toBe(a);
    expect(getKisskhBaseUrl([b, a])).toBe(b);
  });

  it("skips a failed mirror until its failure goes stale", () => {
    vi.useFakeTimers();
    const [failed, clean] = freshMirrors(2);
    markKisskhUrlFail(`${failed}/api/x`);
    expect(getKisskhBaseUrl([failed, clean])).toBe(clean);
    // Just before the TTL the failure still counts
    vi.setSystemTime(Date.now() + KISSKH_FAIL_TTL_MS - 1000);
    expect(getKisskhBaseUrl([failed, clean])).toBe(clean);
    // After the TTL the failure is forgotten and the first mirror
    // reclaims its user-chosen position
    vi.setSystemTime(Date.now() + KISSKH_FAIL_TTL_MS + 1000);
    expect(getKisskhBaseUrl([failed, clean])).toBe(failed);
  });

  it("falls back to the best success/fail ratio when every mirror failed within the window", () => {
    const [bad, good] = freshMirrors(2);
    markKisskhUrlFail(`${bad}/api/x`);
    markKisskhUrlFail(`${good}/api/x`);
    markKisskhUrlSuccess(`${good}/api/y`);
    // Ratio: good = (1+1)/(1+1) = 1, bad = (0+1)/(1+1) = 0.5.
    // Deterministic: the old random probe branch is gone.
    expect(getKisskhBaseUrl([bad, good])).toBe(good);
  });
});
