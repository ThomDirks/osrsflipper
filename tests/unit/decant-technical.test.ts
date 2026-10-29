import { describe, expect, it } from "vitest";
import { bestPerFamily, buildDecantRoutes, calcDecant, decantStep, findFamilies } from "@/lib/analysis/decant";
import { bollinger, ema, macd, rsi, sma, stochastic, toBars } from "@/lib/analysis/technical";
import { fillMinutes, speedTier } from "@/lib/analysis/speed";
import type { ItemMeta, MarketRow } from "@/lib/market/types";

const item = (id: number, name: string, limit: number | null = 2000): ItemMeta => ({ id, name, examine: "", members: true, limit, value: null, highalch: null, icon: "" });
const row = (id: number, high: number, low: number, vol = 10_000): MarketRow => ({
  id,
  high,
  low,
  highTime: 1000,
  lowTime: 1000,
  m5: null,
  h1: null,
  d1: { avgHigh: high, avgLow: low, volHigh: vol, volLow: vol, activeBlocks: 24, bothSidedBlocks: 24, cv: null, minAvg: null, maxAvg: null, firstAvg: null, lastAvg: null, avgSpread: null, cvRecent: null, cvPrior: null },
});

describe("Decanting – families", () => {
  it("groups potions and skips charged jewellery, containers and mixes", () => {
    const fams = findFamilies([
      item(1, "Prayer potion(4)"), item(2, "Prayer potion(3)"), item(3, "Prayer potion(1)"),
      item(10, "Amulet of glory(4)"), item(11, "Amulet of glory(6)"),
      item(20, "Ring of dueling(8)"), item(21, "Ring of dueling(1)"),
      item(30, "Waterskin(4)"), item(31, "Waterskin(0)"),
      item(40, "Attack mix(2)"), item(41, "Attack mix(1)"),
      item(50, "Serum 207 (4)"), item(51, "Serum 207 (2)"),
      item(60, "Lonely potion(4)"),
    ]);
    expect([...fams.keys()].sort()).toEqual(["Prayer potion", "Serum 207"]);
    expect(fams.get("Prayer potion")!.map((i) => i.id)).toEqual([3, 2, 1]);
  });
});

describe("Decanting – maths", () => {
  it("step avoids spare doses", () => {
    expect(decantStep(3, 1)).toBe(1);
    expect(decantStep(3, 4)).toBe(4); // 4 × (3) = 12 doses = 3 × (4)
    expect(decantStep(2, 4)).toBe(2);
    expect(decantStep(4, 3)).toBe(3);
  });

  it("buy (3) → sell (1): 100 potions become 300, tax per sold potion", () => {
    const r = calcDecant({ fromDose: 3, toDose: 1, inputQty: 100, buyPrice: 900, sellPrice: 400 });
    expect(r.outputQty).toBe(300);
    expect(r.cost).toBe(90_000);
    expect(r.revenue).toBe(120_000);
    expect(r.tax).toBe(8 * 300); // floor(400 × 2 %) = 8
    expect(r.profit).toBe(120_000 - 2_400 - 90_000);
    expect(r.leftoverDose).toBe(0);
  });

  it("reports spare doses when the quantity is not a multiple of the step", () => {
    const r = calcDecant({ fromDose: 3, toDose: 4, inputQty: 5, buyPrice: 100, sellPrice: 150 });
    expect(r.outputQty).toBe(3);
    expect(r.leftoverDose).toBe(3);
  });

  it("tax-free potions (energy) pay no tax", () => {
    const r = calcDecant({ fromDose: 2, toDose: 4, inputQty: 2, buyPrice: 100, sellPrice: 250, toItemId: 3008 });
    expect(r.tax).toBe(0);
    expect(r.profit).toBe(250 - 200);
  });

  it("plans routes within buy limit, capital and output volume", () => {
    const items = [item(1, "Test potion(4)", 2000), item(2, "Test potion(2)", 2000)];
    const rows = new Map([
      [1, row(1, 1_000, 990, 4_000)],
      [2, row(2, 460, 400, 4_000)],
    ]);
    const { routes } = buildDecantRoutes(items, rows, { offset: 1, nowSec: 1060, capital: 10_000_000 });
    const best = bestPerFamily(routes)[0]!;
    expect(best.from.dose).toBe(2);
    expect(best.to.dose).toBe(4);
    // Output cap: 25 % of 4 000 instant-buys = 1 000 (4)s = 2 000 (2)s, also the buy limit
    expect(best.plan.inputQty).toBe(2000);
    expect(best.plan.outputQty).toBe(1000);
    // buy 401, sell 999, tax 19
    expect(best.plan.profit).toBe(1000 * (999 - 19) - 2000 * 401);
    expect(best.ageSec).toBe(60);
  });
});

describe("Technical indicators", () => {
  const up = Array.from({ length: 60 }, (_, i) => 100 + i);

  it("SMA and EMA", () => {
    expect(sma([1, 2, 3, 4], 2)).toEqual([null, 1.5, 2.5, 3.5]);
    const e = ema([1, 2, 3, 4, 5], 3);
    expect(e.slice(0, 2)).toEqual([null, null]);
    expect(e[2]).toBe(2);
    expect(e[3]).toBeCloseTo(3);
  });

  it("RSI is 100 in a straight rise and 50 when flat", () => {
    expect(rsi(up, 14)[59]).toBe(100);
    expect(rsi(Array(30).fill(5), 14)[29]).toBe(50);
    expect(rsi(up.slice(0, 10), 14).every((v) => v == null)).toBe(true);
  });

  it("RSI matches a known example (Wilder)", () => {
    // Classic 14-period example: first RSI ≈ 70.53
    const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
    expect(rsi(closes, 14)[14]).toBeCloseTo(70.46, 0);
  });

  it("MACD is positive in an uptrend", () => {
    const m = macd(up);
    expect(m.line[59]!).toBeGreaterThan(0);
    expect(m.signal[59]).not.toBeNull();
  });

  it("Bollinger bands collapse on a flat series", () => {
    const b = bollinger(Array(25).fill(10), 20, 2);
    expect(b.upper[24]).toBe(10);
    expect(b.lower[24]).toBe(10);
  });

  it("Stochastic is 100 at the top of the range", () => {
    const bars = toBars(up.map((p, i) => ({ timestamp: i, avgHighPrice: p + 1, avgLowPrice: p - 1, highPriceVolume: 1, lowPriceVolume: 1 })));
    const s = stochastic(bars, 14, 3);
    expect(s.k[59]!).toBeGreaterThan(90);
  });

  it("skips steps without trades", () => {
    const bars = toBars([
      { timestamp: 1, avgHighPrice: 10, avgLowPrice: 8, highPriceVolume: 1, lowPriceVolume: 1 },
      { timestamp: 2, avgHighPrice: null, avgLowPrice: null, highPriceVolume: 0, lowPriceVolume: 0 },
      { timestamp: 3, avgHighPrice: 12, avgLowPrice: null, highPriceVolume: 1, lowPriceVolume: 0 },
    ]);
    expect(bars.map((b) => b.time)).toEqual([1, 3]);
    expect(bars[0]!.close).toBe(9);
  });
});

describe("Flip speed", () => {
  it("fill time from 24 h volume", () => {
    expect(fillMinutes(100, 2400)).toBe(60); // 100 per hour
    expect(fillMinutes(100, 0)).toBeNull();
  });
  it("tiers", () => {
    expect(speedTier(20)).toBe("very fast");
    expect(speedTier(100)).toBe("fast");
    expect(speedTier(300)).toBe("medium");
    expect(speedTier(1000)).toBe("slow");
    expect(speedTier(5000)).toBe("very slow");
    expect(speedTier(null)).toBe("no data");
  });
});

describe("Decanting – history and logging", () => {
  it("aligns per-dose prices by timestamp and leaves gaps empty", async () => {
    const { alignDoseHistory } = await import("@/lib/analysis/decant");
    const input = [
      { timestamp: 1, avgHighPrice: 330, avgLowPrice: 300, highPriceVolume: 1, lowPriceVolume: 1 },
      { timestamp: 2, avgHighPrice: null, avgLowPrice: null, highPriceVolume: 0, lowPriceVolume: 0 },
    ];
    const output = [
      { timestamp: 1, avgHighPrice: 500, avgLowPrice: 480, highPriceVolume: 1, lowPriceVolume: 1 },
      { timestamp: 2, avgHighPrice: 500, avgLowPrice: 480, highPriceVolume: 1, lowPriceVolume: 1 },
    ];
    const { series, stats } = alignDoseHistory(input, output, 3, 4);
    expect(series[0]!.buyPerDose).toBe(100);
    expect(series[0]!.sellNetPerDose).toBe((500 - 10) / 4);
    expect(series[0]!.marginPerDose).toBeCloseTo(22.5);
    expect(series[1]!.marginPerDose).toBeNull();
    expect(stats.points).toBe(1);
    expect(stats.profitableShare).toBe(1);
  });

  it("logs the decant on the output potion at exact total cost", async () => {
    const { decantLot } = await import("@/lib/analysis/decant");
    const lot = decantLot({ fromId: 139, fromName: "Prayer potion(3)", inputQty: 4, buyPrice: 1001, outputQty: 3 });
    expect(lot.quantity).toBe(3);
    expect(lot.price * 3 + lot.fees).toBe(4004);
    expect(lot.price).toBe(1334);
    expect(lot.fees).toBe(2);
    expect(lot.decantFrom).toEqual({ itemId: 139, itemName: "Prayer potion(3)", quantity: 4, price: 1001 });
  });

  it("decanted buys use the buy limit of the potion you actually bought", async () => {
    const { buyLimitUsage } = await import("@/lib/portfolio/buy-limit");
    const now = Date.now();
    const trade = {
      id: "t1",
      itemId: 2434,
      itemName: "Prayer potion(4)",
      createdAt: now,
      updatedAt: now,
      lots: [{ id: "l1", date: now - 1000, quantity: 300, price: 1334, fees: 0, decantFrom: { itemId: 139, itemName: "Prayer potion(3)", quantity: 400, price: 1001 } }],
      sales: [],
      offers: [],
      notes: "",
      history: [],
    };
    const u = buyLimitUsage([trade], now);
    expect(u.get(139)?.bought).toBe(400);
    expect(u.get(139)?.itemName).toBe("Prayer potion(3)");
    expect(u.has(2434)).toBe(false);
  });
});
