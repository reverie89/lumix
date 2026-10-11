import { beforeAll, describe, expect, it } from "vitest";
import { initMigrations } from "./drizzle.js";
import {
  getOrCreateMeta,
  getVisitSummary,
  insertVisit,
  pruneVisits,
} from "./queries.js";
import type { EVisitInsert } from "./schema/visit.js";

beforeAll(async () => {
  await initMigrations();
});

const now = () => new Date();
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

const row = (overrides: Partial<EVisitInsert> = {}): EVisitInsert => ({
  ts: now(),
  kind: "manifest",
  provider: null,
  client: "stremio",
  status: 200,
  durationMs: 10,
  ipHash: "ip-a",
  configHash: null,
  ...overrides,
});

const dayKey = (offsetDays: number): string => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - offsetDays);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

describe("visit queries", () => {
  it("summarizes counts, distinct hashes, the daily trend and recent rows", async () => {
    // Today: two manifest loads from two visitors, one landing view, one
    // configured install
    await insertVisit(row({ ipHash: "ip-a" }));
    await insertVisit(row({ ipHash: "ip-b" }));
    await insertVisit(row({ kind: "landing", client: "web", configHash: "cfg-1" }));
    // Three days ago: one catalog request, outside today, inside the week
    await insertVisit(
      row({
        kind: "catalog",
        provider: "kisskh",
        ts: daysAgo(3),
        ipHash: "ip-c",
        configHash: "cfg-2",
      }),
    );
    // Eight days ago: outside the week window
    await insertVisit(row({ kind: "meta", ts: daysAgo(8), ipHash: "ip-d" }));
    // Forty days ago: outside retention, still present until the prune
    await insertVisit(row({ kind: "stream", ts: daysAgo(40), ipHash: "ip-e" }));

    const summary = await getVisitSummary();

    expect(summary.today.manifest).toBe(2);
    expect(summary.today.landing).toBe(1);
    expect(summary.week.manifest).toBe(2);
    expect(summary.week.catalog).toBe(1);
    expect(summary.week.meta).toBe(0);
    // Only today's rows count toward the distinct hashes
    expect(summary.uniqueToday).toBe(2);
    expect(summary.installsToday).toBe(1);
    // The trend counts manifest loads per local day, zero-filled to 14
    expect(summary.daily).toHaveLength(14);
    expect(summary.daily[13]!.day).toBe(dayKey(0));
    expect(summary.daily[13]!.count).toBe(2);
    expect(summary.daily[11]!.day).toBe(dayKey(2));
    expect(summary.daily[11]!.count).toBe(0);
    // Newest first, display fields only
    expect(summary.recent).toHaveLength(6);
    const times = summary.recent.map((r) => r.ts);
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(summary.recent.every((r) => typeof r.ts === "number")).toBe(true);
  });

  it("prunes visit rows older than the retention window", async () => {
    await insertVisit(row({ kind: "subtitle", ts: daysAgo(40) }));
    await pruneVisits();
    const summary = await getVisitSummary();
    expect(summary.week.stream).toBe(0);
    // The 3-day and 8-day rows survive; both 40-day rows are gone
    expect(summary.week.catalog).toBe(1);
    expect(summary.recent).toHaveLength(5);
    expect(summary.recent.some((r) => r.kind === "subtitle")).toBe(false);
    expect(summary.recent.some((r) => r.kind === "meta")).toBe(true);
  });

  it("creates meta rows once and reuses them", async () => {
    let calls = 0;
    const first = await getOrCreateMeta("visit_salt_test", () => {
      calls++;
      return "salt-1";
    });
    const second = await getOrCreateMeta("visit_salt_test", () => {
      calls++;
      return "ignored";
    });
    expect(first).toBe("salt-1");
    expect(second).toBe("salt-1");
    expect(calls).toBe(1);
  });
});
