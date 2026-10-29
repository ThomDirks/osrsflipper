import type { Category } from "./category";
import type { SpeedRow, SpeedTier } from "./speed";

export type SpeedSortKey = "cycle" | "buyFill" | "sellFill" | "volume" | "profit" | "margin" | "roi" | "buyShare" | "sellShare";
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
}

export const DEFAULT_SPEED_FILTERS: SpeedFilters = {
  query: "",
  sort: "cycle",
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
  buyShare: (r) => r.buyShare ?? -1,
  sellShare: (r) => (r.buyShare == null ? -1 : 1 - r.buyShare),
};

export function applySpeedFilters(rows: SpeedRow[], f: SpeedFilters, held: ReadonlySet<number>, limit = 300): SpeedRow[] {
  const q = f.query.trim().toLowerCase();
  const tiers = new Set(f.tiers);
  const cats = new Set(f.categories);
  const out = rows.filter((r) => {
    if (q && !r.name.toLowerCase().includes(q)) return false;
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
    return true;
  });
  const key = KEY[f.sort];
  return out.sort((a, b) => key(b) - key(a)).slice(0, limit);
}

/** Filters that differ from the defaults (search and sort don't count). */
export function activeFilterCount(f: SpeedFilters): number {
  const d = DEFAULT_SPEED_FILTERS;
  const keys = Object.keys(d) as Array<keyof SpeedFilters>;
  return keys.filter((k) => k !== "query" && k !== "sort" && JSON.stringify(f[k]) !== JSON.stringify(d[k])).length;
}
