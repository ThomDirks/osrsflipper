import type { Category } from "./category";
import { RISK_ORDER, type RiskClass } from "./risk";
import type { SpeedRow, SpeedTier } from "./speed";

export type SpeedSortKey =
  | "profit"
  | "returnHour"
  | "returnUsed"
  | "returnCapital"
  | "cycle"
  | "buyFill"
  | "sellFill"
  | "score"
  | "margin"
  | "roi"
  | "volume"
  | "quality"
  | "risk"
  | "dip"
  | "stability"
  | "buyShare"
  | "sellShare";

export const SORT_OPTIONS: Array<[SpeedSortKey, string]> = [
  ["profit", "Profit within reason"],
  ["returnHour", "Return per hour"],
  ["returnUsed", "Return on capital used"],
  ["returnCapital", "Return on my capital"],
  ["cycle", "Fastest flip"],
  ["buyFill", "Fastest buy fill"],
  ["sellFill", "Fastest sell fill"],
  ["score", "Scanner score"],
  ["margin", "Highest margin"],
  ["roi", "Highest ROI"],
  ["volume", "Most volume"],
  ["quality", "Best data quality"],
  ["risk", "Lowest risk"],
  ["dip", "Biggest dip vs 7 days"],
  ["stability", "Steadiest margin"],
  ["buyShare", "Most buy pressure"],
  ["sellShare", "Most sell pressure"],
];

export type TrendFilter = "any" | "up" | "down" | "flat" | "notDown";
export type Pressure = "any" | "buyers" | "balanced" | "sellers";
export type HeldFilter = "all" | "only" | "hide";

export interface SpeedFilters {
  query: string;
  sort: SpeedSortKey;
  minVolume: number | null;
  minVolume1h: number | null;
  tiers: SpeedTier[];
  categories: Category[];
  minPrice: number | null;
  maxPrice: number | null;
  minMargin: number | null;
  /** fraction, e.g. 0.01 = 1 % */
  minRoi: number | null;
  /** minutes; null = no limit */
  maxBuyFill: number | null;
  maxSellFill: number | null;
  pressure: Pressure;
  members: "all" | "members" | "f2p";
  minLimit: number | null;
  taxFreeOnly: boolean;
  profitableOnly: boolean;
  flippedOnly: boolean;
  held: HeldFilter;
  /** fractions; null = off */
  minReturnUsed: number | null;
  minReturnCapital: number | null;
  minReturnHour: number | null;
  /** "Within reason": cap quantity to the market and hide outliers */
  realistic: boolean;
  maxShare: number;
  minPerSide: number;
  /** Scanner filters */
  minProfit: number | null;
  maxDataAgeMinutes: number | null;
  maxRisk: RiskClass | null;
  minQuality: number | null;
  maxLimit: number | null;
  hideNoLimit: boolean;
  /** Margin also positive with average prices (not from one outlier trade) */
  plausibleOnly: boolean;
  /** Signals: price vs its 7/30-day median, at most this (e.g. −0.03 = 3 % or more below) */
  maxVs7: number | null;
  maxVs30: number | null;
  rsiMin: number | null;
  rsiMax: number | null;
  trend: TrendFilter;
  /** Min days (of the last 7) with a positive margin after tax */
  minStableDays: number | null;
  /** Hours you'll be away; sizes flips to fill within it (null = playing actively) */
  timeAwayHours: number | null;
  showDismissed: boolean;
}

export const DEFAULT_SPEED_FILTERS: SpeedFilters = {
  query: "",
  sort: "profit",
  minVolume: 1000,
  minVolume1h: null,
  tiers: [],
  categories: [],
  minPrice: null,
  maxPrice: null,
  minMargin: null,
  minRoi: null,
  maxBuyFill: null,
  maxSellFill: null,
  pressure: "any",
  members: "all",
  minLimit: null,
  taxFreeOnly: false,
  profitableOnly: true,
  flippedOnly: false,
  held: "all",
  minReturnUsed: null,
  minReturnCapital: null,
  minReturnHour: null,
  realistic: true,
  maxShare: 0.25,
  minPerSide: 10,
  minProfit: null,
  maxDataAgeMinutes: null,
  maxRisk: null,
  minQuality: null,
  maxLimit: null,
  hideNoLimit: false,
  plausibleOnly: true,
  maxVs7: null,
  maxVs30: null,
  rsiMin: null,
  rsiMax: null,
  trend: "any",
  minStableDays: null,
  timeAwayHours: null,
  showDismissed: false,
};

/** Buy pressure bands on the 24 h share of instant-buys */
export const PRESSURE_BANDS: Record<Exclude<Pressure, "any">, [number, number]> = {
  buyers: [0.6, 1.01],
  balanced: [0.4, 0.6],
  sellers: [-0.01, 0.4],
};

const KEY: Record<SpeedSortKey, (r: SpeedRow) => number> = {
  cycle: (r) => -(r.cycleMin ?? Infinity),
  buyFill: (r) => -(r.buyFillMin ?? Infinity),
  sellFill: (r) => -(r.sellFillMin ?? Infinity),
  volume: (r) => r.buys24h + r.sells24h,
  profit: (r) => r.profit ?? -Infinity,
  margin: (r) => r.netMargin ?? -Infinity,
  roi: (r) => r.roi ?? -Infinity,
  returnUsed: (r) => r.returnOnUsed ?? -Infinity,
  returnCapital: (r) => r.returnOnCapital ?? -Infinity,
  returnHour: (r) => r.returnPerHour ?? -Infinity,
  score: (r) => r.c.score,
  quality: (r) => r.c.quality.score,
  risk: (r) => -r.c.risk.score,
  dip: (r) => (r.sig?.vs7 == null ? -Infinity : -r.sig.vs7),
  stability: (r) => (r.sig ? r.sig.stableDays * 10 - (r.sig.marginCv ?? 10) : -Infinity),
  buyShare: (r) => r.buyShare ?? -1,
  sellShare: (r) => (r.buyShare == null ? -1 : 1 - r.buyShare),
};

export function applySpeedFilters(rows: SpeedRow[], f: SpeedFilters, held: ReadonlySet<number>, limit = 300, dismissed: ReadonlySet<number> = new Set()): SpeedRow[] {
  const q = f.query.trim().toLowerCase();
  const tiers = new Set(f.tiers);
  const cats = new Set(f.categories);
  const out = rows.filter((r) => {
    if (q && !r.name.toLowerCase().includes(q) && String(r.id) !== q) return false;
    if (!f.showDismissed && dismissed.has(r.id)) return false;
    if (r.buys24h + r.sells24h < (f.minVolume ?? 0)) return false;
    if (f.minVolume1h != null && r.buys1h + r.sells1h < f.minVolume1h) return false;
    if (tiers.size && !tiers.has(r.tier)) return false;
    if (cats.size && !cats.has(r.category)) return false;
    if (f.minPrice != null && (r.price == null || r.price < f.minPrice)) return false;
    if (f.maxPrice != null && (r.price == null || r.price > f.maxPrice)) return false;
    if (f.minMargin != null && (r.netMargin == null || r.netMargin < f.minMargin)) return false;
    if (f.minRoi != null && (r.roi == null || r.roi < f.minRoi)) return false;
    if (f.maxBuyFill != null && (r.buyFillMin == null || r.buyFillMin > f.maxBuyFill)) return false;
    if (f.maxSellFill != null && (r.sellFillMin == null || r.sellFillMin > f.maxSellFill)) return false;
    if (f.pressure !== "any") {
      const [lo, hi] = PRESSURE_BANDS[f.pressure];
      if (r.buyShare == null || r.buyShare < lo || r.buyShare >= hi) return false;
    }
    if (f.members === "members" && !r.members) return false;
    if (f.members === "f2p" && r.members) return false;
    if (f.minLimit != null && (r.limit == null || r.limit < f.minLimit)) return false;
    if (f.taxFreeOnly && !r.taxExempt) return false;
    if (f.profitableOnly && (r.netMargin ?? 0) <= 0) return false;
    if (f.flippedOnly && r.ownSales === 0) return false;
    if (f.held === "only" && !held.has(r.id)) return false;
    if (f.held === "hide" && held.has(r.id)) return false;
    if (f.realistic && r.outlier) return false;
    if (f.minReturnUsed != null && (r.returnOnUsed == null || r.returnOnUsed < f.minReturnUsed)) return false;
    if (f.minReturnCapital != null && (r.returnOnCapital == null || r.returnOnCapital < f.minReturnCapital)) return false;
    if (f.minReturnHour != null && (r.returnPerHour == null || r.returnPerHour < f.minReturnHour)) return false;
    // Scanner filters (r.c may be missing in hand-built test rows)
    const c = r.c;
    if (f.minProfit != null && (r.profit == null || r.profit < f.minProfit)) return false;
    if (c && f.maxDataAgeMinutes != null && (c.ageSec == null || c.ageSec > f.maxDataAgeMinutes * 60)) return false;
    if (c && f.maxRisk && RISK_ORDER[c.risk.riskClass] > RISK_ORDER[f.maxRisk]) return false;
    if (c && f.minQuality != null && c.quality.score < f.minQuality) return false;
    if (f.maxLimit != null && (r.limit == null || r.limit > f.maxLimit)) return false;
    if (f.hideNoLimit && r.limit == null) return false;
    if (c && f.plausibleOnly && (c.netMarginConservative == null || c.netMarginConservative <= 0)) return false;
    // Signals: items without a baseline are left out once a signal filter is set
    const sg = r.sig;
    if (f.maxVs7 != null && (sg?.vs7 == null || sg.vs7 > f.maxVs7)) return false;
    if (f.maxVs30 != null && (sg?.vs30 == null || sg.vs30 > f.maxVs30)) return false;
    if (f.rsiMin != null && (sg?.rsi == null || sg.rsi < f.rsiMin)) return false;
    if (f.rsiMax != null && (sg?.rsi == null || sg.rsi > f.rsiMax)) return false;
    if (f.trend !== "any") {
      if (sg?.trend == null) return false;
      if (f.trend === "notDown" ? sg.trend === "down" : sg.trend !== f.trend) return false;
    }
    if (f.minStableDays != null && (sg == null || sg.stableDays < f.minStableDays)) return false;
    return true;
  });
  const key = KEY[f.sort];
  return out.sort((a, b) => key(b) - key(a)).slice(0, limit);
}

/** Filters that differ from the defaults (search and sort don't count). */
export function activeFilterCount(f: SpeedFilters): number {
  const d = DEFAULT_SPEED_FILTERS;
  const keys = Object.keys(d) as Array<keyof SpeedFilters>;
  return keys.filter((k) => k !== "query" && k !== "sort" && k !== "timeAwayHours" && JSON.stringify(f[k]) !== JSON.stringify(d[k])).length;
}
