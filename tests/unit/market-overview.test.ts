import { describe, expect, it } from "vitest";
import { findBigTrades, lockinLevel } from "@/lib/analysis/big-trades";
import { watchSignals } from "@/lib/analysis/holding-alerts";
import { applyPreset, matchingPreset, presetDiff, STARTER_PRESETS } from "@/lib/analysis/presets";
import { itemSignals } from "@/lib/analysis/signals";
import { planSlots, planTotals } from "@/lib/analysis/slot-planner";
import { buildSpeedRows, DEFAULT_REALISM, type SpeedRow } from "@/lib/analysis/speed";
import { DEFAULT_SPEED_FILTERS } from "@/lib/analysis/speed-filters";
import type { MarketRow, MonthAgg } from "@/lib/market/types";

const month = (hi: number[], lo: number[], extra: Partial<MonthAgg> = {}): MonthAgg => ({
  days: hi.length, median30: 100, median7: 100, noise: 0.01, dailyVol: 0.02, trend7: 0, change30: 0, spikeDays: 0, spread: 10, volWeaker: 100, min: 90, max: 110, hi, lo, ...extra,
});
const mrow = (high: number, low: number, extra: Partial<MarketRow> = {}): MarketRow => ({ id: 1, high, low, highTime: 0, lowTime: 0, m5: null, h1: null, d1: null, ...extra });

describe("Signals", () => {
  it("dip vs 7/30-day median, sparkline and margin stability", () => {
    const hi = Array.from({ length: 10 }, () => 110);
    const lo = Array.from({ length: 10 }, () => 100);
    const s = itemSignals(1, month(hi, lo, { median7: 105, median30: 110 }), mrow(100, 90))!;
    expect(s.vs7).toBeCloseTo(95 / 105 - 1);
    expect(s.vs30).toBeCloseTo(95 / 110 - 1);
    expect(s.spark).toHaveLength(8); // 7 days + now
    expect(s.spark[7]).toBe(95);
    // 110 − tax 2 − 100 = 8 > 0 on all 7 days
    expect(s.stableDays).toBe(7);
    expect(s.stableOf).toBe(7);
    expect(s.marginCv).toBe(0);
    expect(s.trend).toBe("flat");
  });

  it("trend thresholds and missing history", () => {
    expect(itemSignals(1, month([1], [1], { trend7: 0.02 }), undefined)!.trend).toBe("up");
    expect(itemSignals(1, month([1], [1], { trend7: -0.02 }), undefined)!.trend).toBe("down");
    expect(itemSignals(1, undefined, undefined)).toBeNull();
  });
});

describe("Presets", () => {
  it("start from the defaults and recognise themselves", () => {
    const overnight = STARTER_PRESETS.find((p) => p.id === "overnight")!;
    const f = applyPreset(overnight, "rune");
    expect(f.timeAwayHours).toBe(8);
    expect(f.query).toBe("rune");
    expect(f.realistic).toBe(true);
    expect(matchingPreset(f, STARTER_PRESETS)?.id).toBe("overnight");
    expect(matchingPreset(DEFAULT_SPEED_FILTERS, STARTER_PRESETS)?.id).toBe("all");
    expect(presetDiff(DEFAULT_SPEED_FILTERS)).toEqual({});
    // switching presets never leaks: quick has no time away
    expect(applyPreset(STARTER_PRESETS.find((p) => p.id === "quick")!).timeAwayHours).toBeNull();
  });
});

const cand = (id: number, extra: Record<string, unknown> = {}) =>
  ({ id, name: `Item ${id}`, icon: "", limit: 10_000, qty: 10_000, limitLeft: 10_000, netMargin: 10, roi: 0.02, estBuy: 500, estSell: 520, category: "Other", members: true, taxExempt: false, ...extra }) as never;
const dayRow = (id: number, buys: number, sells: number) =>
  [id, mrow(510, 500, { id, d1: { avgHigh: 510, avgLow: 500, volHigh: buys, volLow: sells, activeBlocks: 24, bothSidedBlocks: 24, cv: null, minAvg: null, maxAvg: null, firstAvg: null, lastAvg: null, avgSpread: null, cvRecent: null, cvPrior: null } })] as const;

describe("Time away sizing", () => {
  it("sizes the flip so both sides fill within the hours away at your share of the flow", () => {
    const rows = new Map([dayRow(1, 2400, 2400)]); // 100 per hour each side
    const [r] = buildSpeedRows([cand(1)], rows, new Map(), { basis: "limit", realism: DEFAULT_REALISM, capital: 1e9, timeAwayHours: 8 });
    // 8 h × 25 % / (1/100 + 1/100 per hour) = 100
    expect(r!.qty).toBe(100);
    const [tooShort] = buildSpeedRows([cand(1)], new Map([dayRow(1, 24, 24)]), new Map(), { basis: "limit", realism: { ...DEFAULT_REALISM, minPerSide: 1 }, capital: 1e9, timeAwayHours: 1 });
    expect(tooShort!.outlier).toMatch(/Won’t fill within 1 h/);
  });
});

const sRow = (id: number, qty: number, price: number, margin: number, extra: Partial<SpeedRow> = {}): SpeedRow =>
  ({ id, name: `Item ${id}`, icon: "", limit: 1000, qty, netMargin: margin, price, outlier: null, c: { estBuy: price, estSell: price + margin + 50 }, ...extra }) as SpeedRow;

describe("Slot planner", () => {
  it("fills free slots in order, skips held and outliers, respects budget and per-item cap", () => {
    const rows = [sRow(1, 100, 1000, 50), sRow(2, 100, 1000, 40, { outlier: "x" }), sRow(3, 100, 1000, 30), sRow(4, 100, 1000, 20), sRow(5, 100, 1000, 10)];
    const plan = planSlots(rows, { capital: 100_000, slots: 2, exclude: new Set([3]), maxItemShare: 0.25 });
    expect(plan.map((p) => p.id)).toEqual([1, 4]);
    expect(plan[0]!.qty).toBe(25); // 25 % of 100k at 1000 each
    expect(planTotals(plan).cost).toBe(50_000);
    expect(planSlots(rows, { capital: 500, slots: 8, exclude: new Set(), maxItemShare: 1 })).toEqual([]);
  });
});

describe("Big trades", () => {
  const big = (extra: Partial<SpeedRow> = {}, c: Record<string, unknown> = {}) =>
    ({
      id: 1, name: "Rare thing", icon: "", qty: 2, profit: 20_000_000, netMargin: 10_000_000, buys1h: 3, sells1h: 2, buys24h: 40, sells24h: 30, outlier: null, roi: 0.1,
      sig: { dailyVol: 0.08 },
      c: { ageSec: 300, netMarginConservative: 8_000_000, cv24h: 0.05, quality: { score: 90, components: { plausibility: 20 } }, ...c },
      ...extra,
    }) as unknown as SpeedRow;

  it("verifies a real one and names the failed check on a fake one", () => {
    const [real] = findBigTrades([big()], { minProfit: 5_000_000, minVolatility: 0.03, maxAgeMin: 30, capital: 40_000_000 });
    expect(real!.verified).toBe(true);
    expect(real!.ofCapital).toBe(0.5);
    expect(lockinLevel([real!])).toBe(5);
    // the gap only exists in one trade: at average prices it's gone
    const [fake] = findBigTrades([big({}, { netMarginConservative: -1 })], { minProfit: 5_000_000, minVolatility: 0.03, maxAgeMin: 30, capital: 40_000_000 });
    expect(fake!.verified).toBe(false);
    expect(fake!.checks.find((c) => !c.ok)!.key).toBe("holds");
    expect(lockinLevel([fake!])).toBe(1);
  });

  it("ignores flips below the profit bar", () => {
    expect(findBigTrades([big({ profit: 1_000_000 })], { minProfit: 5_000_000, minVolatility: 0.03, maxAgeMin: 30, capital: 1e8 })).toEqual([]);
  });
});

describe("Watchlist alerts", () => {
  it("fires when a watched item hits its targets", () => {
    const w = [{ itemId: 7, addedAt: 0, favorite: false, note: "", targetBuy: 100, targetSell: 200, targetMargin: 5, targetRoi: null }];
    const byId = new Map([[7, { name: "Thing", latestLow: 95, latestHigh: 150, netMargin: 6, roi: 0.05 }]]);
    const s = watchSignals(w, byId);
    expect(s.map((x) => x.kind).sort()).toEqual(["watchBuy", "watchMargin"]);
    expect(s[0]!.key).toMatch(/^watch:7:/);
  });
});
