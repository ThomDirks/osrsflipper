import type { MarketRow } from "../market/types";
import type { Trade } from "../portfolio/schemas";
import { computeFifo } from "../portfolio/fifo";
import type { FlipCandidate } from "./scanner";

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
  /** Your own closed sales for this item */
  ownSales: number;
  ownAvgHoldMs: number | null;
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
export function buildSpeedRows(candidates: FlipCandidate[], rows: ReadonlyMap<number, MarketRow>, own: ReadonlyMap<number, { sales: number; avgHoldMs: number | null }>, basis: "capital" | "limit" = "capital"): SpeedRow[] {
  const out: SpeedRow[] = [];
  for (const c of candidates) {
    const r = rows.get(c.id);
    const buys24h = r?.d1?.volHigh ?? 0;
    const sells24h = r?.d1?.volLow ?? 0;
    const qty = basis === "limit" ? Math.max(1, c.limit ?? c.qty) : c.qty > 0 ? c.qty : Math.max(1, c.limitLeft ?? c.limit ?? 1);
    const buyFillMin = fillMinutes(qty, sells24h);
    const sellFillMin = fillMinutes(qty, buys24h);
    const cycleMin = buyFillMin != null && sellFillMin != null ? buyFillMin + sellFillMin : null;
    const o = own.get(c.id);
    out.push({
      id: c.id,
      name: c.name,
      icon: c.icon,
      limit: c.limit,
      qty,
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
      profit: c.netMargin != null ? c.netMargin * qty : null,
      ownSales: o?.sales ?? 0,
      ownAvgHoldMs: o?.avgHoldMs ?? null,
    });
  }
  return out;
}
