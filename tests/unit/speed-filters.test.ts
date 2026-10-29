import { describe, expect, it } from "vitest";
import { activeFilterCount, applySpeedFilters, DEFAULT_SPEED_FILTERS } from "@/lib/analysis/speed-filters";
import type { SpeedRow } from "@/lib/analysis/speed";

const row = (p: Partial<SpeedRow>): SpeedRow => ({
  id: 1, name: "Item", icon: "", limit: 100, qty: 100, buys1h: 50, sells1h: 50, buys24h: 1000, sells24h: 1000, buyShare: 0.5,
  buyFillMin: 10, sellFillMin: 10, cycleMin: 20, tier: "very fast", netMargin: 10, profit: 1000, ownSales: 0, ownAvgHoldMs: null,
  roi: 0.02, price: 500, category: "Potions", members: true, taxExempt: false, ...p,
});
const none = new Set<number>();
const f = (p: Partial<typeof DEFAULT_SPEED_FILTERS>) => ({ ...DEFAULT_SPEED_FILTERS, minVolume: null, ...p });

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
