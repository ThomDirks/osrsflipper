import type { SpeedRow } from "./speed";

/**
 * Big Trades: rare, volatile items where one flip at a realistic quantity makes a huge profit,
 * and the numbers hold up. A gap on a volatile item is often one weird trade; each check below
 * guards against a specific kind of fake signal.
 */

export interface BigCheck {
  key: "fresh" | "twoSided" | "holds" | "volume" | "plausible" | "volatile";
  label: string;
  ok: boolean;
  detail: string;
}

export interface BigTrade {
  row: SpeedRow;
  checks: BigCheck[];
  /** All checks passed */
  verified: boolean;
  /** Highest of hourly (24 h) and daily (30 d) price variation */
  volatility: number | null;
  /** Profit ÷ your capital */
  ofCapital: number | null;
}

export interface BigOptions {
  minProfit: number;
  /** Price variation that counts as volatile (e.g. 0.03 = 3 %) */
  minVolatility: number;
  /** Max age of the older price (minutes) */
  maxAgeMin: number;
  capital: number;
}

export const DEFAULT_BIG: Omit<BigOptions, "capital"> = { minProfit: 5_000_000, minVolatility: 0.03, maxAgeMin: 30 };

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

export function bigTradeChecks(r: SpeedRow, o: BigOptions): { checks: BigCheck[]; volatility: number | null } {
  const c = r.c;
  const age = c.ageSec;
  const cons = c.netMarginConservative;
  const weaker = Math.min(r.buys24h, r.sells24h);
  const dayVol = r.sig?.dailyVol ?? null;
  const volatility = Math.max(c.cv24h ?? 0, dayVol ?? 0) || null;
  const checks: BigCheck[] = [
    { key: "fresh", label: "Prices are fresh", ok: age != null && age <= o.maxAgeMin * 60, detail: age != null ? `older side ${Math.round(age / 60)} min old` : "no price" },
    { key: "twoSided", label: "Both sides traded this hour", ok: r.buys1h > 0 && r.sells1h > 0, detail: `${r.buys1h} buys · ${r.sells1h} sells in the last hour` },
    {
      key: "holds",
      label: "Gap holds at average prices",
      ok: cons != null && r.netMargin != null && cons > 0 && cons >= r.netMargin * 0.5,
      detail: cons != null ? `margin ${Math.round(cons).toLocaleString("de-CH")} with last hour’s averages` : "no averages",
    },
    { key: "volume", label: "Real volume behind it", ok: weaker >= Math.max(5, r.qty * 2), detail: `${weaker} trades on the slower side in 24 h for ${r.qty} items` },
    { key: "plausible", label: "Not one weird trade", ok: !r.outlier && c.quality.components.plausibility >= 10, detail: r.outlier ?? `data quality ${c.quality.score}` },
    { key: "volatile", label: "Actually volatile", ok: volatility != null && volatility >= o.minVolatility, detail: volatility != null ? `price swings ${pct(volatility)}` : "no swing data" },
  ];
  return { checks, volatility };
}

export function findBigTrades(rows: SpeedRow[], o: BigOptions): BigTrade[] {
  const out: BigTrade[] = [];
  for (const r of rows) {
    if (r.profit == null || r.profit < o.minProfit || (r.netMargin ?? 0) <= 0) continue;
    const { checks, volatility } = bigTradeChecks(r, o);
    out.push({ row: r, checks, verified: checks.every((x) => x.ok), volatility, ofCapital: o.capital > 0 ? r.profit / o.capital : null });
  }
  return out.sort((a, b) => Number(b.verified) - Number(a.verified) || (b.row.profit ?? 0) - (a.row.profit ?? 0));
}

/** Lock-in level 1 to 5 from the best verified trade relative to your capital. */
export function lockinLevel(trades: BigTrade[]): 1 | 2 | 3 | 4 | 5 {
  const best = trades.find((t) => t.verified)?.ofCapital ?? 0;
  if (best >= 0.5) return 5;
  if (best >= 0.25) return 4;
  if (best >= 0.1) return 3;
  if (best >= 0.03) return 2;
  return 1;
}

export const LEVEL_NAME: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: "Warming up",
  2: "Heating up",
  3: "Locked in",
  4: "Full send",
  5: "Holy shit",
};
