import { DEFAULT_SPEED_FILTERS, type SpeedFilters } from "./speed-filters";

/**
 * Filter presets for the Flip Scanner and Top 10. A preset only lists what differs from the
 * defaults; applying it starts from the defaults, so presets never leak into each other.
 * Each preset carries its own sort.
 */
export interface MarketPreset {
  id: string;
  name: string;
  /** One line shown under the chip */
  hint?: string;
  builtIn?: boolean;
  filters: Partial<SpeedFilters>;
}

export const STARTER_PRESETS: MarketPreset[] = [
  {
    id: "all",
    name: "Everything",
    hint: "Defaults: profit within reason",
    builtIn: true,
    filters: {},
  },
  {
    id: "quick",
    name: "Quick flips",
    hint: "Both sides fill fast, best return per hour",
    builtIn: true,
    filters: { sort: "returnHour", tiers: ["very fast", "fast"], minVolume: 5000, maxDataAgeMinutes: 30 },
  },
  {
    id: "overnight",
    name: "Overnight",
    hint: "Sized to fill within 8 h, steady prices",
    builtIn: true,
    filters: { sort: "profit", timeAwayHours: 8, trend: "notDown", minStableDays: 5, maxRisk: "mittel" },
  },
  {
    id: "highvalue",
    name: "High value",
    hint: "≥ 1M profit per flip at a realistic quantity",
    builtIn: true,
    filters: { sort: "profit", minProfit: 1_000_000, minPrice: 1_000_000 },
  },
  {
    id: "taxfree",
    name: "Tax-free",
    hint: "No GE tax on the sale",
    builtIn: true,
    filters: { sort: "profit", taxFreeOnly: true },
  },
  {
    id: "dips",
    name: "Dips",
    hint: "≥ 3% below the 7-day average, not overbought",
    builtIn: true,
    filters: { sort: "dip", maxVs7: -0.03, rsiMax: 45 },
  },
  {
    id: "steady",
    name: "Steady margins",
    hint: "Positive margin on 6 of the last 7 days",
    builtIn: true,
    filters: { sort: "profit", minStableDays: 6 },
  },
];

export function applyPreset(p: MarketPreset, keepQuery = ""): SpeedFilters {
  return { ...DEFAULT_SPEED_FILTERS, ...p.filters, query: keepQuery };
}

/** Only the fields that differ from the defaults (what gets saved in a user preset). */
export function presetDiff(f: SpeedFilters): Partial<SpeedFilters> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(DEFAULT_SPEED_FILTERS) as Array<keyof SpeedFilters>) {
    if (k === "query") continue;
    if (JSON.stringify(f[k]) !== JSON.stringify(DEFAULT_SPEED_FILTERS[k])) out[k] = f[k];
  }
  return out as Partial<SpeedFilters>;
}

/** Which preset the current filters match exactly (ignoring search), if any. */
export function matchingPreset(f: SpeedFilters, presets: MarketPreset[]): MarketPreset | null {
  const cur = JSON.stringify(presetDiff(f));
  return presets.find((p) => JSON.stringify(presetDiff(applyPreset(p))) === cur) ?? null;
}
