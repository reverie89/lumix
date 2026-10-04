import { afterEach, describe, expect, it, vi } from "vitest";
import { MirrorFailover } from "./mirror-failover.js";

const FAIL_TTL_MS = 10 * 60 * 1000;
// A fresh instance per test: the metrics map belongs to the instance, so no
// cross-test isolation tricks are needed
const make = () => new MirrorFailover(FAIL_TTL_MS, "https://fallback.test");

let counter = 0;
function freshMirrors(): [string, string] {
  return [`https://mirror${++counter}.test`, `https://mirror${++counter}.test`];
}

afterEach(() => {
  vi.useRealTimers();
});

describe("mirror failover", () => {
  it("records success and fail metrics per origin", () => {
    const failover = make();
    const [a, b] = freshMirrors();
    failover.markSuccess(`${a}/api/x`);
    failover.markSuccess(`${a}/api/y`);
    failover.markFail(`${b}/api/x`);
    const metrics = failover.getMetrics();
    expect(metrics.get(a)?.success).toBe(2);
    expect(metrics.get(b)?.fail).toBe(1);
  });

  it("serves mirrors strictly in the user's order while they are healthy", () => {
    const failover = make();
    const [a, b] = freshMirrors();
    failover.markSuccess(`${b}/api/x`);
    expect(failover.select([a, b])).toBe(a);
    expect(failover.select([b, a])).toBe(b);
  });

  it("skips a failed mirror until its failure goes stale", () => {
    vi.useFakeTimers();
    const failover = make();
    const [failed, clean] = freshMirrors();
    failover.markFail(`${failed}/api/x`);
    expect(failover.select([failed, clean])).toBe(clean);
    // Just before the TTL the failure still counts
    vi.setSystemTime(Date.now() + FAIL_TTL_MS - 1000);
    expect(failover.select([failed, clean])).toBe(clean);
    // After the TTL the failure is forgotten and the first mirror
    // reclaims its user-chosen position
    vi.setSystemTime(Date.now() + FAIL_TTL_MS + 1000);
    expect(failover.select([failed, clean])).toBe(failed);
  });

  it("falls back to the best success/fail ratio when every mirror failed within the window", () => {
    const failover = make();
    const [bad, good] = freshMirrors();
    failover.markFail(`${bad}/api/x`);
    failover.markFail(`${good}/api/x`);
    failover.markSuccess(`${good}/api/y`);
    // Ratio: good = (1+1)/(1+1) = 1, bad = (0+1)/(1+1) = 0.5.
    // Deterministic: the old random probe branch is gone.
    expect(failover.select([bad, good])).toBe(good);
  });

  it("keys metrics on the origin, not the full request url", () => {
    const failover = make();
    const [a, b] = freshMirrors();
    // Marks arrive with full request urls; a mirror entered with a path must
    // still be recognized as failed
    failover.markFail(`${a}/api/Deep/List?page=2`);
    expect(failover.select([a, b])).toBe(b);
    expect(failover.select([`${a}/path`, b])).toBe(b);
  });
});
