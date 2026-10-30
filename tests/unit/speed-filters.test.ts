import { describe, expect, it } from "vitest";
import { activeFilterCount, applySpeedFilters, DEFAULT_SPEED_FILTERS } from "@/lib/analysis/speed-filters";
import type { SpeedRow } from "@/lib/analysis/speed";

const row = (p: Partial<SpeedRow>): SpeedRow => ({
  id: 1, name: "Item", icon: "", limit: 100, qty: 100, buys1h: 50, sells1h: 50, buys24h: 1000, sells24h: 1000, buyShare: 0.5,
  buyFillMin: 10, sellFillMin: 10, cycleMin: 20, tier: "very fast", netMargin: 10, profit: 1000, ownSales: 0, ownAvgHoldMs: null,
  roi: 0.02, price: 500, category: "Potions", members: true, taxExempt: false,
  rawQty: 100, capped: false, capitalUsed: 50_000, returnOnUsed: 0.02, returnOnCapital: 0.0001, returnPerHour: 0.06, outlier: null, c: undefined as never, sig: null, ...p,
});
const none = new Set<number>();
const f = (p: Partial<typeof DEFAULT_SPEED_FILTERS>) => ({ ...DEFAULT_SPEED_FILTERS, minVolume: null, sort: "cycle" as const, ...p });

describe("Flip Speed filters", () => {
  const rows = [
    row({ id: 1, name: "Fast potion" }),
    row({ id: 2, name: "Slow log", category: "Logs", tier: "slow", cycleMin: 900, buyFillMin: 400, sellFillMin: 500, price: 50_000, members: false, buyShare: 0.3 }),
    row({ id: 3, name: "Loss rune", category: "Runes", netMargin: -5, roi: -0.01, buyShare: 0.75, taxExempt: true }),
  ];
  const ids = (p: Partial<typeof DEFAULT_SPEED_FILTERS>, held = none) => applySpeedFilters(rows, f(p), held).map((r) => r.id);

  it("positive margin on by default", () => expect(ids({})).toEqual([1, 2]));
  it("speed tiers and categories", () => {
    expect(ids({ tiers: ["slow"] })).toEqual([2]);
    expect(ids({ categories: ["Potions", "Logs"] })).toEqual([1, 2]);
  });
  it("price, fill time and members", () => {
    expect(ids({ maxPrice: 1000 })).toEqual([1]);
    expect(ids({ maxSellFill: 60 })).toEqual([1]);
    expect(ids({ members: "f2p" })).toEqual([2]);
  });
  it("buy pressure bands and tax-free", () => {
    expect(ids({ pressure: "sellers" })).toEqual([2]);
    expect(ids({ pressure: "buyers", profitableOnly: false })).toEqual([3]);
    expect(ids({ taxFreeOnly: true, profitableOnly: false })).toEqual([3]);
  });
  it("only / hide what I hold", () => {
    expect(ids({ held: "only" }, new Set([2]))).toEqual([2]);
    expect(ids({ held: "hide" }, new Set([2]))).toEqual([1]);
  });
  it("sorts fastest first and counts active filters", () => {
    expect(applySpeedFilters(rows, f({ profitableOnly: false, sort: "cycle" }), none)[0]!.id).toBe(1);
    expect(applySpeedFilters(rows, f({ profitableOnly: false, sort: "buyShare" }), none)[0]!.id).toBe(3);
    expect(activeFilterCount(DEFAULT_SPEED_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_SPEED_FILTERS, query: "x", tiers: ["fast"], maxPrice: 5 })).toBe(2);
  });
});

describe("Flip Speed – within reason and returns", () => {
  it("caps the quantity to the market and flags thin items as outliers", async () => {
    const { buildSpeedRows, DEFAULT_REALISM } = await import("@/lib/analysis/speed");
    const cand = (id: number, extra: Record<string, unknown> = {}) =>
      ({ id, name: `Item ${id}`, icon: "", limit: 1000, qty: 1000, limitLeft: 1000, netMargin: 10, roi: 0.02, estBuy: 500, category: "Other", members: true, taxExempt: false, ...extra }) as never;
    const mrow = (id: number, buys: number, sells: number, high = 510, low = 500) =>
      [id, { id, high, low, highTime: 0, lowTime: 0, m5: null, h1: null, d1: { avgHigh: 510, avgLow: 500, volHigh: buys, volLow: sells, activeBlocks: 24, bothSidedBlocks: 24, cv: null, minAvg: null, maxAvg: null, firstAvg: null, lastAvg: null, avgSpread: null, cvRecent: null, cvPrior: null } }] as const;
    const rows = new Map([mrow(1, 7, 3), mrow(2, 2000, 1600), mrow(3, 5000, 5000, 900, 500)]);
    const out = buildSpeedRows([cand(1), cand(2), cand(3)], rows, new Map(), { basis: "limit", realism: DEFAULT_REALISM, capital: 10_000_000 });
    // 3 sells / 7 buys: buying 1000 is unreasonable
    expect(out[0]!.outlier).toMatch(/Only 3 sells/);
    // 25 % of 1600 = 400
    expect(out[1]!.qty).toBe(400);
    expect(out[1]!.capped).toBe(true);
    expect(out[1]!.rawQty).toBe(1000);
    expect(out[1]!.outlier).toBeNull();
    expect(out[1]!.capitalUsed).toBe(200_000);
    expect(out[1]!.returnOnUsed).toBeCloseTo(4000 / 200_000);
    expect(out[1]!.returnOnCapital).toBeCloseTo(4000 / 10_000_000);
    // price spike: last instant-buy 900 vs 510 average
    expect(out[2]!.outlier).toMatch(/away from its 24 h average/);
    // capital caps too: 10 000 gp buys 20 at 500
    const poor = buildSpeedRows([cand(2)], rows, new Map(), { basis: "limit", realism: DEFAULT_REALISM, capital: 10_000 });
    expect(poor[0]!.qty).toBe(20);
    expect(buildSpeedRows([cand(2)], rows, new Map(), { basis: "limit", realism: DEFAULT_REALISM, capital: 100 })[0]!.outlier).toMatch(/doesn’t buy even 1/);
    // without the toggle nothing is capped or flagged
    const raw = buildSpeedRows([cand(1)], rows, new Map(), { basis: "limit", realism: null });
    expect(raw[0]!.qty).toBe(1000);
    expect(raw[0]!.outlier).toBeNull();
  });

  it("hides outliers only while within reason is on", () => {
    const rows = [row({ id: 1 }), row({ id: 2, outlier: "Only 3 sells in 24 h" })];
    expect(applySpeedFilters(rows, f({}), none).map((r) => r.id)).toEqual([1]);
    expect(applySpeedFilters(rows, f({ realistic: false }), none).map((r) => r.id)).toEqual([1, 2]);
  });

  it("return filters", () => {
    const rows = [row({ id: 1, returnOnUsed: 0.01, returnOnCapital: 0.001, returnPerHour: 0.02 }), row({ id: 2, returnOnUsed: 0.05, returnOnCapital: 0.02, returnPerHour: 0.5 })];
    expect(applySpeedFilters(rows, f({ minReturnUsed: 0.03 }), none).map((r) => r.id)).toEqual([2]);
    expect(applySpeedFilters(rows, f({ minReturnCapital: 0.01 }), none).map((r) => r.id)).toEqual([2]);
    expect(applySpeedFilters(rows, f({ minReturnHour: 0.1 }), none).map((r) => r.id)).toEqual([2]);
    expect(applySpeedFilters(rows, f({ sort: "returnHour" }), none)[0]!.id).toBe(2);
  });
});
