import type { MarketRow, MonthAgg } from "../market/types";
import { netSellPerItem } from "../tax/tax";
import { rsi } from "./technical";

/**
 * Price-history signals per item from the 30-day daily baseline (one point per day) plus the
 * current price. Daily granularity: the bulk data the app loads for every item has no hourly history.
 */

export type Trend = "up" | "down" | "flat";

export interface ItemSignals {
  /** Last 7 daily mid prices + the current mid price (oldest first, gaps skipped) */
  spark: number[];
  /** Current mid price vs the 7-day / 30-day median (−0.05 = 5 % below) */
  vs7: number | null;
  vs30: number | null;
  /** RSI 14 on daily mid prices including today */
  rsi: number | null;
  trend: Trend | null;
  /** Of the last 7 days with both prices: how many had a positive margin after tax */
  stableDays: number;
  stableOf: number;
  /** Coefficient of variation of those daily margins (lower = steadier); null if mean ≤ 0 */
  marginCv: number | null;
  /** Std. dev. of daily log returns over 30 days */
  dailyVol: number | null;
}

/** ±0.5 % per day counts as a trend */
export const TREND_PER_DAY = 0.005;

export function currentMid(row: MarketRow | undefined): number | null {
  if (!row) return null;
  if (row.high != null && row.low != null) return (row.high + row.low) / 2;
  return row.high ?? row.low ?? null;
}

export function itemSignals(id: number, h: MonthAgg | undefined, row: MarketRow | undefined): ItemSignals | null {
  if (!h) return null;
  const hi = h.hi ?? [];
  const lo = h.lo ?? [];
  const mids: number[] = [];
  for (let i = 0; i < Math.max(hi.length, lo.length); i++) {
    const a = hi[i] ?? null, b = lo[i] ?? null;
    if (a != null && b != null) mids.push((a + b) / 2);
    else if (a != null || b != null) mids.push((a ?? b) as number);
  }
  const now = currentMid(row);
  const spark = [...mids.slice(-7), ...(now != null ? [now] : [])];
  const closes = now != null ? [...mids, now] : mids;
  const r = rsi(closes, 14);
  const margins: number[] = [];
  for (let i = Math.max(0, hi.length - 7); i < hi.length; i++) {
    const a = hi[i], b = lo[i];
    if (a != null && b != null) margins.push(netSellPerItem(a, id) - b);
  }
  const mean = margins.length ? margins.reduce((x, y) => x + y, 0) / margins.length : 0;
  const sd = margins.length > 1 ? Math.sqrt(margins.reduce((x, y) => x + (y - mean) ** 2, 0) / margins.length) : null;
  return {
    spark,
    vs7: now != null && h.median7 ? now / h.median7 - 1 : null,
    vs30: now != null && h.median30 ? now / h.median30 - 1 : null,
    rsi: r[r.length - 1] ?? null,
    trend: h.trend7 == null ? null : h.trend7 > TREND_PER_DAY ? "up" : h.trend7 < -TREND_PER_DAY ? "down" : "flat",
    stableDays: margins.filter((m) => m > 0).length,
    stableOf: margins.length,
    marginCv: mean > 0 && sd != null ? sd / mean : null,
    dailyVol: h.dailyVol,
  };
}
