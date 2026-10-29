import { describe, expect, it } from "vitest";
import { dueSignals, holdingSignals } from "@/lib/analysis/holding-alerts";
import type { MarketRow } from "@/lib/market/types";
import type { Trade } from "@/lib/portfolio/schemas";

const cfg = { upPct: 0.05, downPct: 0.05, suddenPct: 0.08, lossWarning: true };
const trade = (targetSell: number | null, soldQty = 0): Trade => ({
  id: "t1",
  itemId: 1,
  itemName: "Test item",
  createdAt: 0,
  updatedAt: 0,
  lots: [{ id: "l1", date: 0, quantity: 10, price: 100, fees: 0 }],
  sales: soldQty ? [{ id: "s1", date: 1, quantity: soldQty, price: 110, tax: null, fees: 0 }] : [],
  offers: [],
  notes: "",
  history: [],
  targetSell,
});
const rows = (high: number, h1High: number | null = null) =>
  new Map<number, MarketRow>([[1, { id: 1, high, low: high - 5, highTime: 0, lowTime: 0, m5: null, h1: h1High != null ? { avgHigh: h1High, avgLow: h1High - 5, volHigh: 10, volLow: 10 } : null, d1: null }]]);
const kinds = (t: Trade, r: Map<number, MarketRow>) => holdingSignals([t], r, 1, cfg).map((s) => s.kind).sort();

describe("Holding alerts", () => {
  it("rise above the expected sale price", () => {
    const s = holdingSignals([trade(110)], rows(120), 1, cfg);
    expect(s.map((x) => x.kind)).toEqual(["above"]);
    expect(s[0]!.sellNow).toBe(119);
    expect(s[0]!.change).toBeCloseTo(9 / 110);
    expect(s[0]!.profitNow).toBeGreaterThan(0);
  });

  it("reaching the expected price without a big move", () => {
    expect(kinds(trade(118), rows(120))).toEqual(["target"]);
  });

  it("drop below the expected price; no separate loss alert", () => {
    expect(kinds(trade(130), rows(96))).toEqual(["below"]);
  });

  it("without an expected price: above break-even and below cost", () => {
    expect(kinds(trade(null), rows(120))).toEqual(["above"]);
    expect(kinds(trade(null), rows(91))).toEqual(["below"]);
  });

  it("warns when selling now loses money even inside the thresholds", () => {
    // cost 100, break-even 102, sell now 100 → loss, but only −2 % below expected 102
    expect(kinds(trade(102), rows(101))).toEqual(["loss"]);
    // …but not right after the buy
    expect(holdingSignals([{ ...trade(102), lots: [{ id: "l1", date: Date.now() - 60_000, quantity: 10, price: 100, fees: 0 }] }], rows(101), 1, cfg)).toEqual([]);
  });

  it("sudden jump vs the last hour's average", () => {
    expect(kinds(trade(130), rows(140, 125))).toContain("jump");
    expect(kinds(trade(null), rows(95, 120))).toContain("crash");
  });

  it("ignores closed trades and items without a price", () => {
    expect(holdingSignals([trade(110, 10)], rows(200), 1, cfg)).toEqual([]);
    expect(holdingSignals([trade(110)], new Map(), 1, cfg)).toEqual([]);
  });

  it("cooldown suppresses repeats", () => {
    const s = holdingSignals([trade(110)], rows(120), 1, cfg);
    const now = 10 * 3_600_000;
    expect(dueSignals(s, new Map([["t1:above", now - 30 * 60_000]]), now, 60)).toEqual([]);
    expect(dueSignals(s, new Map([["t1:above", now - 61 * 60_000]]), now, 60)).toHaveLength(1);
    expect(dueSignals(s, new Map(), now, 60)).toHaveLength(1);
  });
});
