"use client";
import { ChevronDown, Moon, RotateCcw, Save, SlidersHorizontal, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { AmountInput, Field, Input, Select } from "@/components/ui/input";
import { Tip } from "@/components/ui/tooltip";
import type { QtyBasis } from "@/hooks/market-rows";
import { CATEGORIES, type Category } from "@/lib/analysis/category";
import { applyPreset, matchingPreset, presetDiff, STARTER_PRESETS, type MarketPreset } from "@/lib/analysis/presets";
import type { SpeedRow, SpeedTier } from "@/lib/analysis/speed";
import { activeFilterCount, DEFAULT_SPEED_FILTERS, SORT_OPTIONS, type SpeedFilters, type SpeedSortKey } from "@/lib/analysis/speed-filters";
import { gp } from "@/lib/format";
import { newId } from "@/lib/storage/db";
import { cn } from "@/lib/utils";
import { useSettings, useSettingsStore } from "@/state/settings";
import { toast } from "@/state/toasts";

const TIERS: SpeedTier[] = ["very fast", "fast", "medium", "slow", "very slow"];
const FILL_LIMITS: Array<[string, number | null]> = [["Any", null], ["15 min", 15], ["30 min", 30], ["1 h", 60], ["2 h", 120], ["4 h", 240], ["8 h", 480], ["24 h", 1440]];
const AWAY: Array<[string, number | null]> = [["I’m playing", null], ["1 h", 1], ["2 h", 2], ["4 h", 4], ["8 h", 8], ["12 h", 12], ["24 h", 24]];

export function Chip({ on, onClick, children, testId, title }: { on: boolean; onClick: () => void; children: React.ReactNode; testId?: string; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      data-testid={testId}
      title={title}
      className={cn("rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors", on ? "border-accent bg-accent-soft text-text" : "border-border text-muted hover:text-text")}
    >
      {children}
    </button>
  );
}

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function PctField({ label, value, onChange, hint, testId, step = "0.1", sign = 1 }: { label: string; value: number | null; onChange: (v: number | null) => void; hint?: string; testId?: string; step?: string; sign?: 1 | -1 }) {
  return (
    <Field label={label} hint={hint}>
      <Input
        type="number"
        step={step}
        value={value == null ? "" : +((value * 100) / sign).toFixed(3)}
        onChange={(e) => onChange(e.target.value === "" ? null : (Number(e.target.value) * sign) / 100)}
        aria-label={label}
        data-testid={testId}
      />
    </Field>
  );
}

export function usePresets(): MarketPreset[] {
  const own = useSettings().marketPresets;
  return useMemo(() => [...STARTER_PRESETS, ...own.map((p) => ({ ...p, filters: p.filters as Partial<SpeedFilters> }))], [own]);
}

export function MarketFilterBar({
  f,
  setF,
  basis,
  setBasis,
  capital,
  setCapital,
  all,
  outliers,
  testPrefix = "speed",
}: {
  f: SpeedFilters;
  setF: (f: SpeedFilters) => void;
  basis: QtyBasis;
  setBasis: (b: QtyBasis) => void;
  capital: number | null;
  setCapital: (v: number | null) => void;
  all: SpeedRow[];
  outliers: number;
  testPrefix?: string;
}) {
  const settings = useSettings();
  const update = useSettingsStore((s) => s.update);
  const presets = usePresets();
  const [more, setMore] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const set = (patch: Partial<SpeedFilters>) => setF({ ...f, ...patch });
  const active = activeFilterCount(f);
  const current = matchingPreset(f, presets);
  const cap = capital ?? settings.defaultCapital;
  const catCounts = useMemo(() => {
    const m = new Map<Category, number>();
    for (const r of all) m.set(r.category, (m.get(r.category) ?? 0) + 1);
    return m;
  }, [all]);

  const savePreset = () => {
    const name = (saving ?? "").trim().slice(0, 60);
    if (!name) return;
    const existing = settings.marketPresets.find((p) => p.name === name);
    const entry = { id: existing?.id ?? newId(), name, filters: presetDiff(f) as Record<string, unknown> };
    update({ marketPresets: [...settings.marketPresets.filter((p) => p.name !== name), entry] });
    setSaving(null);
    toast(`Preset “${name}” saved.`, "pos");
  };

  return (
    <div className="space-y-3">
      {/* Presets */}
      <div className="flex flex-wrap items-center gap-1.5" data-testid={`${testPrefix}-presets`}>
        <span className="mr-1 text-[11px] uppercase tracking-wide text-faint">Presets</span>
        {presets.map((p) => (
          <span key={p.id} className="inline-flex items-center">
            <Chip on={current?.id === p.id} onClick={() => setF(applyPreset(p, f.query))} testId={`preset-${p.id}`} title={p.hint}>
              {p.name}
            </Chip>
            {!p.builtIn && (
              <button
                type="button"
                className="-ml-1 rounded-full p-0.5 text-faint hover:text-neg"
                aria-label={`Delete preset ${p.name}`}
                onClick={() => {
                  update({ marketPresets: settings.marketPresets.filter((x) => x.id !== p.id) });
                  toast(`Preset “${p.name}” deleted.`);
                }}
              >
                <X className="size-3" />
              </button>
            )}
          </span>
        ))}
        {saving == null ? (
          <button type="button" onClick={() => setSaving(current && !current.builtIn ? current.name : "")} className="ml-1 inline-flex items-center gap-1 text-[11px] font-medium text-accent" data-testid="preset-save-start">
            <Save className="size-3" /> Save current as preset
          </button>
        ) : (
          <span className="ml-1 inline-flex items-center gap-1">
            <Input
              autoFocus
              value={saving}
              onChange={(e) => setSaving(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") savePreset();
                if (e.key === "Escape") setSaving(null);
              }}
              placeholder="Preset name"
              className="h-7 w-40 text-xs"
              aria-label="Preset name"
              data-testid="preset-name"
            />
            <Button size="sm" variant="primary" onClick={savePreset} disabled={!saving.trim()} data-testid="preset-save">Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setSaving(null)}>Cancel</Button>
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
        <Field label="Search"><Input value={f.query} onChange={(e) => set({ query: e.target.value })} placeholder="Name or ID  ( / )" aria-label="Search items" data-testid={`${testPrefix}-search`} /></Field>
        <Field label="Sort by">
          <Select value={f.sort} onChange={(e) => set({ sort: e.target.value as SpeedSortKey })} aria-label="Sort by" data-testid={`${testPrefix}-sort`}>
            {SORT_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
        <Field label="My capital (gp)"><AmountInput value={capital} onChange={setCapital} placeholder={gp(settings.defaultCapital)} aria-label="Capital" data-testid={`${testPrefix}-capital`} /></Field>
        <Field label="Quantity">
          <Select value={basis} onChange={(e) => setBasis(e.target.value as QtyBasis)} aria-label="Quantity basis" data-testid={`${testPrefix}-basis`}>
            <option value="capital">What my capital buys</option>
            <option value="limit">Full buy limit</option>
          </Select>
        </Field>
        <Field label="Time away" hint={f.timeAwayHours ? "Flips sized to fill while you’re gone" : undefined}>
          <Select value={f.timeAwayHours ?? ""} onChange={(e) => set({ timeAwayHours: e.target.value === "" ? null : Number(e.target.value) })} aria-label="Time away" data-testid={`${testPrefix}-away`}>
            {AWAY.map(([l, v]) => <option key={l} value={v ?? ""}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Min. volume 24 h"><AmountInput value={f.minVolume} onChange={(v) => set({ minVolume: v })} aria-label="Minimum volume" /></Field>
        <Field label="My items">
          <Select value={f.held} onChange={(e) => set({ held: e.target.value as SpeedFilters["held"] })} aria-label="Items I hold" data-testid={`${testPrefix}-held`}>
            <option value="all">All items</option>
            <option value="only">Only what I hold</option>
            <option value="hide">Hide what I hold</option>
          </Select>
        </Field>
      </div>

      <label className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm" data-testid={`${testPrefix}-realistic-row`}>
        <input type="checkbox" checked={f.realistic} onChange={(e) => set({ realistic: e.target.checked })} data-testid={`${testPrefix}-realistic`} />
        <span className="font-medium">Within reason</span>
        <span className="text-xs text-muted">
          {f.realistic
            ? `Quantity capped at ${Math.round(f.maxShare * 100)}% of the slower side’s 24 h trades and to what your capital buys${f.timeAwayHours ? `, and to what fills within ${f.timeAwayHours} h` : ""}; ${outliers} outlier${outliers === 1 ? "" : "s"} hidden (fewer than ${f.minPerSide} trades a side, price spikes, ROI over 50%).`
            : "Off: quantities ignore how much the market actually trades, and outliers are shown."}
        </span>
        {f.timeAwayHours != null && <span className="ml-auto inline-flex items-center gap-1 text-xs text-info"><Moon className="size-3.5" /> Away {f.timeAwayHours} h</span>}
      </label>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] uppercase tracking-wide text-faint">Speed</span>
        {TIERS.map((t) => (
          <Chip key={t} on={f.tiers.includes(t)} onClick={() => set({ tiers: toggle(f.tiers, t) })} testId={`${testPrefix}-tier-${t.replace(" ", "-")}`}>{t}</Chip>
        ))}
        <span className="ml-3 mr-1 text-[11px] uppercase tracking-wide text-faint">Trend</span>
        {(["any", "up", "flat", "down", "notDown"] as const).map((t) => (
          <Chip key={t} on={f.trend === t} onClick={() => set({ trend: t })} testId={`${testPrefix}-trend-${t}`}>{t === "notDown" ? "not falling" : t}</Chip>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] uppercase tracking-wide text-faint">Category</span>
        {CATEGORIES.filter((c) => catCounts.has(c)).map((c) => (
          <Chip key={c} on={f.categories.includes(c)} onClick={() => set({ categories: toggle(f.categories, c) })} testId={`${testPrefix}-cat-${c}`}>
            {c} <span className="text-faint">{catCounts.get(c)}</span>
          </Chip>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => setMore(!more)} className="flex items-center gap-1.5 text-xs font-medium text-accent" aria-expanded={more} data-testid={`${testPrefix}-more`}>
          <SlidersHorizontal className="size-3.5" /> More filters <ChevronDown className={cn("size-3.5 transition-transform", more && "rotate-180")} />
        </button>
        {active > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setF({ ...DEFAULT_SPEED_FILTERS, query: f.query, sort: f.sort })} data-testid={`${testPrefix}-reset`}>
            <RotateCcw /> Reset {active} filter{active === 1 ? "" : "s"}
          </Button>
        )}
        {settings.dismissedItems.length > 0 && (
          <Chip on={f.showDismissed} onClick={() => set({ showDismissed: !f.showDismissed })} testId={`${testPrefix}-show-dismissed`} title="Items you marked as not interested">
            Show {settings.dismissedItems.length} dismissed
          </Chip>
        )}
      </div>

      {more && (
        <div className="space-y-3 rounded-lg border border-border bg-surface-2 p-3" data-testid={`${testPrefix}-more-panel`}>
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">Profit & returns</div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
              <Field label="Min. profit per flip"><AmountInput value={f.minProfit} onChange={(v) => set({ minProfit: v })} aria-label="Minimum profit per flip" data-testid={`${testPrefix}-min-profit`} /></Field>
              <Field label="Min. margin (gp)"><AmountInput value={f.minMargin} onChange={(v) => set({ minMargin: v })} aria-label="Minimum margin" /></Field>
              <PctField label="Min. ROI (%)" value={f.minRoi} onChange={(v) => set({ minRoi: v })} testId={`${testPrefix}-min-roi`} />
              <PctField label="Min. return on capital used (%)" value={f.minReturnUsed} onChange={(v) => set({ minReturnUsed: v })} testId={`${testPrefix}-min-return-used`} />
              <PctField label="Min. return on my capital (%)" value={f.minReturnCapital} onChange={(v) => set({ minReturnCapital: v })} hint={`÷ ${gp(cap)} gp`} step="0.01" testId={`${testPrefix}-min-return-capital`} />
              <PctField label="Min. return per hour (%)" value={f.minReturnHour} onChange={(v) => set({ minReturnHour: v })} testId={`${testPrefix}-min-return-hour`} />
              <div className="flex items-end pb-2 text-sm">
                <label className="flex items-center gap-2" title="Hides items whose margin only comes from single outlier trades">
                  <input type="checkbox" checked={f.plausibleOnly} onChange={(e) => set({ plausibleOnly: e.target.checked })} data-testid={`${testPrefix}-plausible`} /> Plausible margins
                </label>
              </div>
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">Price & item</div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
              <Field label="Min. buy price"><AmountInput value={f.minPrice} onChange={(v) => set({ minPrice: v })} aria-label="Minimum price" /></Field>
              <Field label="Max. buy price"><AmountInput value={f.maxPrice} onChange={(v) => set({ maxPrice: v })} aria-label="Maximum price" data-testid={`${testPrefix}-max-price`} /></Field>
              <Field label="Buy limit min / max">
                <div className="flex gap-1">
                  <AmountInput value={f.minLimit} onChange={(v) => set({ minLimit: v })} placeholder="min" aria-label="Minimum buy limit" />
                  <AmountInput value={f.maxLimit} onChange={(v) => set({ maxLimit: v })} placeholder="max" aria-label="Maximum buy limit" />
                </div>
              </Field>
              <Field label="Members">
                <Select value={f.members} onChange={(e) => set({ members: e.target.value as SpeedFilters["members"] })} aria-label="Members">
                  <option value="all">All</option>
                  <option value="members">Members only</option>
                  <option value="f2p">F2P only</option>
                </Select>
              </Field>
              <Field label="Max. risk">
                <Select value={f.maxRisk ?? ""} onChange={(e) => set({ maxRisk: (e.target.value || null) as SpeedFilters["maxRisk"] })} aria-label="Maximum risk" data-testid={`${testPrefix}-max-risk`}>
                  <option value="">Any</option>
                  <option value="niedrig">Low</option>
                  <option value="mittel">Up to medium</option>
                </Select>
              </Field>
              <Field label="Min. data quality">
                <Select value={f.minQuality ?? ""} onChange={(e) => set({ minQuality: e.target.value === "" ? null : Number(e.target.value) })} aria-label="Minimum quality" data-testid={`${testPrefix}-min-quality`}>
                  <option value="">Any</option>
                  <option value="25">≥ 25</option>
                  <option value="50">≥ 50</option>
                  <option value="75">≥ 75</option>
                </Select>
              </Field>
              <Field label="Max. data age (min)"><AmountInput value={f.maxDataAgeMinutes} onChange={(v) => set({ maxDataAgeMinutes: v })} aria-label="Maximum data age" /></Field>
              <div className="col-span-2 flex flex-wrap items-end gap-x-4 gap-y-1 pb-2 text-sm lg:col-span-7">
                <label className="flex items-center gap-2"><input type="checkbox" checked={f.profitableOnly} onChange={(e) => set({ profitableOnly: e.target.checked })} /> Positive margin</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={f.taxFreeOnly} onChange={(e) => set({ taxFreeOnly: e.target.checked })} /> Tax-free</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={f.hideNoLimit} onChange={(e) => set({ hideNoLimit: e.target.checked })} /> Known buy limit</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={f.flippedOnly} onChange={(e) => set({ flippedOnly: e.target.checked })} data-testid={`${testPrefix}-mine`} /> Items I’ve flipped</label>
              </div>
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">Speed & volume</div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
              <Field label="Buy fills within">
                <Select value={f.maxBuyFill ?? ""} onChange={(e) => set({ maxBuyFill: e.target.value === "" ? null : Number(e.target.value) })} aria-label="Buy fills within">
                  {FILL_LIMITS.map(([l, v]) => <option key={l} value={v ?? ""}>{l}</option>)}
                </Select>
              </Field>
              <Field label="Sell fills within">
                <Select value={f.maxSellFill ?? ""} onChange={(e) => set({ maxSellFill: e.target.value === "" ? null : Number(e.target.value) })} aria-label="Sell fills within" data-testid={`${testPrefix}-max-sell-fill`}>
                  {FILL_LIMITS.map(([l, v]) => <option key={l} value={v ?? ""}>{l}</option>)}
                </Select>
              </Field>
              <Field label="Buy pressure (24 h)">
                <Select value={f.pressure} onChange={(e) => set({ pressure: e.target.value as SpeedFilters["pressure"] })} aria-label="Buy pressure">
                  <option value="any">Any</option>
                  <option value="buyers">Buyers heavy (&gt; 60%)</option>
                  <option value="balanced">Balanced (40–60%)</option>
                  <option value="sellers">Sellers heavy (&lt; 40%)</option>
                </Select>
              </Field>
              <Field label="Min. volume last hour"><AmountInput value={f.minVolume1h} onChange={(v) => set({ minVolume1h: v })} aria-label="Minimum volume last hour" /></Field>
              <Field label="Within reason: share">
                <Select value={f.maxShare} onChange={(e) => set({ maxShare: Number(e.target.value) })} disabled={!f.realistic} aria-label="Max share of volume">
                  {[0.05, 0.1, 0.25, 0.5, 1].map((v) => <option key={v} value={v}>{v * 100}% of 24 h trades</option>)}
                </Select>
              </Field>
              <Field label="Within reason: min. trades">
                <Select value={f.minPerSide} onChange={(e) => set({ minPerSide: Number(e.target.value) })} disabled={!f.realistic} aria-label="Min trades per side">
                  {[5, 10, 25, 50, 100, 500].map((v) => <option key={v} value={v}>{v} per side in 24 h</option>)}
                </Select>
              </Field>
            </div>
          </div>
          <div>
            <div className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-faint">
              Price history signals
              <Tip content="From daily prices over the last 30 days plus the current price. Items without enough history drop out once you set one of these."><span className="cursor-help normal-case text-faint">(daily data)</span></Tip>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
              <PctField label="Below 7-day avg by (%)" value={f.maxVs7} onChange={(v) => set({ maxVs7: v })} sign={-1} hint="e.g. 3 = at least 3% under" testId={`${testPrefix}-dip7`} />
              <PctField label="Below 30-day avg by (%)" value={f.maxVs30} onChange={(v) => set({ maxVs30: v })} sign={-1} />
              <Field label="RSI 14 (daily) min / max">
                <div className="flex gap-1">
                  <Input type="number" value={f.rsiMin ?? ""} onChange={(e) => set({ rsiMin: e.target.value === "" ? null : Number(e.target.value) })} placeholder="min" aria-label="RSI minimum" />
                  <Input type="number" value={f.rsiMax ?? ""} onChange={(e) => set({ rsiMax: e.target.value === "" ? null : Number(e.target.value) })} placeholder="max" aria-label="RSI maximum" data-testid={`${testPrefix}-rsi-max`} />
                </div>
              </Field>
              <Field label="Margin positive on" hint="of the last 7 days">
                <Select value={f.minStableDays ?? ""} onChange={(e) => set({ minStableDays: e.target.value === "" ? null : Number(e.target.value) })} aria-label="Stable days" data-testid={`${testPrefix}-stable`}>
                  <option value="">Any</option>
                  {[3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>at least {d} days</option>)}
                </Select>
              </Field>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
