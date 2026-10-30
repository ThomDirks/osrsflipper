import type { MarketRow, MonthAgg } from "../market/types";
import type { Trade } from "../portfolio/schemas";
import { computeFifo } from "../portfolio/fifo";
import type { Category } from "./category";
import type { FlipCandidate } from "./scanner";
import { itemSignals, type ItemSignals } from "./signals";

/**
 * Flip speed: how fast does the market trade both sides of an item?
 *
 * - Instant-buys (Wiki "high" volume) are other players buying: they fill YOUR sell offers.
 * - Instant-sells (Wiki "low" volume) are other players selling: they fill YOUR buy offers.
 *
 * Fill time = how long the whole market needs to trade your quantity on that side at the
 * average hourly rate of the last 24 h. You share that flow with other flippers, so real fills
 * are slower; the number is for comparing items, not a promise.
 */

export type SpeedTier = "very fast" | "fast" | "medium" | "slow" | "very slow" | "no data";

export interface SpeedRow {
  id: number;
  name: string;
  icon: string;
  limit: number | null;
  qty: number;
  buys1h: number;
  sells1h: number;
  buys24h: number;
  sells24h: number;
  /** Share of 24 h volume that were instant-buys (0 … 1) */
  buyShare: number | null;
  /** Minutes the market needs to instant-sell your quantity (fills your buy offer) */
  buyFillMin: number | null;
  /** Minutes the market needs to instant-buy your quantity (fills your sell offer) */
  sellFillMin: number | null;
  cycleMin: number | null;
  tier: SpeedTier;
  netMargin: number | null;
  profit: number | null;
  roi: number | null;
  /** Estimated buy price each */
  price: number | null;
  category: Category;
  members: boolean;
  taxExempt: boolean;
  /** Your own closed sales for this item */
  ownSales: number;
  ownAvgHoldMs: number | null;
  /** Quantity before the "within reason" cap */
  rawQty: number;
  /** true when the quantity was reduced to fit the market's volume */
  capped: boolean;
  /** gp tied up: quantity × buy price */
  capitalUsed: number | null;
  /** Profit ÷ capital used (on the planned quantity) */
  returnOnUsed: number | null;
  /** Profit ÷ your whole capital */
  returnOnCapital: number | null;
  /** Return on capital used per hour the flip takes (min. 15 min) */
  returnPerHour: number | null;
  /** Why this row is not a realistic trade (null = fine) */
  outlier: string | null;
  /** Full scanner data for this item (score, risk, quality, prices, age…) */
  c: FlipCandidate;
  /** Price-history signals (null until the 30-day baseline is loaded) */
  sig: ItemSignals | null;
}

export interface RealismOptions {
  /** Max share of the slower side's 24 h volume you plan to trade (e.g. 0.25) */
  maxShare: number;
  /** Min trades per side in 24 h */
  minPerSide: number;
  /** Max distance of the last price from its 24 h average (e.g. 0.3) */
  maxSpike: number;
  /** ROI above this is treated as a stale or one-off price (e.g. 0.5) */
  maxRoi: number;
}

export const DEFAULT_REALISM: RealismOptions = { maxShare: 0.25, minPerSide: 10, maxSpike: 0.3, maxRoi: 0.5 };

export interface SpeedBuildOptions {
  basis?: "capital" | "limit";
  /** null = no cap and no outlier check */
  realism?: RealismOptions | null;
  /** Your whole capital, for return on capital */
  capital?: number;
  /** Time away (hours): size each flip so both sides fill within it at your share of the flow */
  timeAwayHours?: number | null;
  /** 30-day baseline for signals */
  history?: Record<string, MonthAgg> | null;
}

export function speedTier(cycleMin: number | null): SpeedTier {
  if (cycleMin == null) return "no data";
  if (cycleMin <= 30) return "very fast";
  if (cycleMin <= 120) return "fast";
  if (cycleMin <= 480) return "medium";
  if (cycleMin <= 1440) return "slow";
  return "very slow";
}

export function fillMinutes(qty: number, vol24h: number): number | null {
  if (qty <= 0 || vol24h <= 0) return null;
  return (qty / (vol24h / 24)) * 60;
}

/** Hold time and number of sales per item from your own trades (FIFO). */
export function ownHoldTimes(trades: Trade[]): Map<number, { sales: number; avgHoldMs: number | null }> {
  const acc = new Map<number, { sales: number; holdSum: number; holdQty: number }>();
  for (const t of trades) {
    const s = computeFifo(t);
    if (s.soldQty <= 0) continue;
    const a = acc.get(t.itemId) ?? { sales: 0, holdSum: 0, holdQty: 0 };
    a.sales += t.sales?.length ?? 0;
    if (s.avgHoldMs != null) {
      a.holdSum += s.avgHoldMs * s.soldQty;
      a.holdQty += s.soldQty;
    }
    acc.set(t.itemId, a);
  }
  const out = new Map<number, { sales: number; avgHoldMs: number | null }>();
  for (const [id, a] of acc) out.set(id, { sales: a.sales, avgHoldMs: a.holdQty > 0 ? a.holdSum / a.holdQty : null });
  return out;
}

/** basis "capital": scanner quantity (capital and limit left); "limit": a full GE buy limit */
export function buildSpeedRows(
  candidates: FlipCandidate[],
  rows: ReadonlyMap<number, MarketRow>,
  own: ReadonlyMap<number, { sales: number; avgHoldMs: number | null }>,
  optsOrBasis: SpeedBuildOptions | "capital" | "limit" = {},
): SpeedRow[] {
  const opts: SpeedBuildOptions = typeof optsOrBasis === "string" ? { basis: optsOrBasis } : optsOrBasis;
  const basis = opts.basis ?? "capital";
  const realism = opts.realism ?? null;
  const out: SpeedRow[] = [];
  for (const c of candidates) {
    const r = rows.get(c.id);
    const buys24h = r?.d1?.volHigh ?? 0;
    const sells24h = r?.d1?.volLow ?? 0;
    const rawQty = basis === "limit" ? Math.max(1, c.limit ?? c.qty) : c.qty > 0 ? c.qty : Math.max(1, c.limitLeft ?? c.limit ?? 1);
    let qty = rawQty;
    let outlier: string | null = null;
    if (realism) {
      const weaker = Math.min(buys24h, sells24h);
      const cap = Math.floor(weaker * realism.maxShare);
      // Within reason also means affordable: never more than your capital buys
      const affordable = opts.capital && c.estBuy ? Math.floor(opts.capital / c.estBuy) : Infinity;
      qty = Math.min(rawQty, cap, affordable);
      // Time away: qty / (share × sell rate) + qty / (share × buy rate) ≤ hours
      if (opts.timeAwayHours && opts.timeAwayHours > 0 && buys24h > 0 && sells24h > 0) {
        const fitsInTime = Math.floor((opts.timeAwayHours * realism.maxShare) / (24 / sells24h + 24 / buys24h));
        if (fitsInTime < qty) qty = fitsInTime;
      }
      const spike = (last: number | null | undefined, avg: number | null | undefined) => (last != null && avg != null && avg > 0 ? Math.abs(last - avg) / avg : 0);
      const off = Math.max(spike(r?.high, r?.d1?.avgHigh), spike(r?.low, r?.d1?.avgLow));
      if (weaker < realism.minPerSide) outlier = `Only ${weaker} ${buys24h <= sells24h ? "buys" : "sells"} in 24 h`;
      else if (affordable < 1) outlier = "Your capital doesn’t buy even 1";
      else if (qty < 1 && opts.timeAwayHours) outlier = `Won’t fill within ${opts.timeAwayHours} h at ${Math.round(realism.maxShare * 100)}% of the market`;
      else if (qty < 1) outlier = `Too little volume for even 1 item at ${Math.round(realism.maxShare * 100)}% of the market`;
      else if (off > realism.maxSpike) outlier = `Last price ${Math.round(off * 100)}% away from its 24 h average`;
      else if (c.roi != null && c.roi > realism.maxRoi) outlier = `ROI over ${Math.round(realism.maxRoi * 100)}% usually means a stale or one-off price`;
      qty = Math.max(qty, 1);
    }
    const buyFillMin = fillMinutes(qty, sells24h);
    const sellFillMin = fillMinutes(qty, buys24h);
    const cycleMin = buyFillMin != null && sellFillMin != null ? buyFillMin + sellFillMin : null;
    const o = own.get(c.id);
    const profit = c.netMargin != null ? c.netMargin * qty : null;
    const capitalUsed = c.estBuy != null ? c.estBuy * qty : null;
    const returnOnUsed = profit != null && capitalUsed ? profit / capitalUsed : null;
    out.push({
      id: c.id,
      name: c.name,
      icon: c.icon,
      limit: c.limit,
      qty,
      rawQty,
      capped: qty < rawQty,
      buys1h: r?.h1?.volHigh ?? 0,
      sells1h: r?.h1?.volLow ?? 0,
      buys24h,
      sells24h,
      buyShare: buys24h + sells24h > 0 ? buys24h / (buys24h + sells24h) : null,
      buyFillMin,
      sellFillMin,
      cycleMin,
      tier: speedTier(cycleMin),
      netMargin: c.netMargin,
      profit,
      roi: c.roi,
      price: c.estBuy,
      category: c.category,
      members: c.members,
      taxExempt: c.taxExempt,
      ownSales: o?.sales ?? 0,
      ownAvgHoldMs: o?.avgHoldMs ?? null,
      capitalUsed,
      returnOnUsed,
      returnOnCapital: profit != null && opts.capital ? profit / opts.capital : null,
      returnPerHour: returnOnUsed != null && cycleMin != null ? returnOnUsed / (Math.max(cycleMin, 15) / 60) : null,
      outlier,
      c,
      sig: itemSignals(c.id, opts.history?.[String(c.id)], r),
    });
  }
  return out;
}
