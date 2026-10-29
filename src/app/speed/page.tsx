"use client";
import { ChevronDown, RotateCcw, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { EmptyState, ErrorNote, Est, Gp, PageHeader, Skeleton } from "@/components/common/indicators";
import { ItemIcon } from "@/components/common/item-icon";
import { minutes, SplitBar, TIER_TONE } from "@/components/common/split-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { AmountInput, Field, Input, Select } from "@/components/ui/input";
import { Tip } from "@/components/ui/tooltip";
import { useCandidates, useRowMap } from "@/hooks/market";
import { CATEGORIES, type Category } from "@/lib/analysis/category";
import { buildSpeedRows, ownHoldTimes, type SpeedTier } from "@/lib/analysis/speed";
import { activeFilterCount, applySpeedFilters, DEFAULT_SPEED_FILTERS, type SpeedFilters, type SpeedSortKey } from "@/lib/analysis/speed-filters";
import { duration, gp } from "@/lib/format";
import { computeFifo } from "@/lib/portfolio/fifo";
import { useLocalState } from "@/lib/ui/use-local-state";
import { cn } from "@/lib/utils";
import { useDataStore } from "@/state/data";
import { useSettings } from "@/state/settings";

const TIERS: SpeedTier[] = ["very fast", "fast", "medium", "slow", "very slow"];
const FILL_LIMITS: Array<[string, number | null]> = [["Any", null], ["15 min", 15], ["30 min", 30], ["1 h", 60], ["2 h", 120], ["4 h", 240], ["8 h", 480], ["24 h", 1440]];

function Chip({ on, onClick, children, testId }: { on: boolean; onClick: () => void; children: React.ReactNode; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      data-testid={testId}
      className={cn("rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors", on ? "border-accent bg-accent-soft text-text" : "border-border text-muted hover:text-text")}
    >
      {children}
    </button>
  );
}

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

export default function SpeedPage() {
  const settings = useSettings();
  const [capital, setCapital] = useState<number | null>(null);
  const { candidates, isLoading, error } = useCandidates(capital ?? undefined);
  const rows = useRowMap();
  const trades = useDataStore((s) => s.trades);
  const [basis, setBasis] = useState<"limit" | "capital">("limit");
  const [f, setF] = useLocalState<SpeedFilters>("osrs-ge-flipper:speed-filters:v1", DEFAULT_SPEED_FILTERS);
  const [more, setMore] = useState(false);
  const set = (patch: Partial<SpeedFilters>) => setF({ ...f, ...patch });

  const own = useMemo(() => ownHoldTimes(trades), [trades]);
  const held = useMemo(() => new Set(trades.filter((t) => computeFifo(t).openQty > 0).map((t) => t.itemId)), [trades]);
  const all = useMemo(() => buildSpeedRows(candidates, rows, own, basis), [candidates, rows, own, basis]);
  const shown = useMemo(() => applySpeedFilters(all, f, held), [all, f, held]);
  const active = activeFilterCount(f);
  const catCounts = useMemo(() => {
    const m = new Map<Category, number>();
    for (const r of all) m.set(r.category, (m.get(r.category) ?? 0) + 1);
    return m;
  }, [all]);

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Flip Speed"
        description="Buys versus sells per item: how fast the market fills your buy offer and your sell offer. Instant-sells by others fill your buy; instant-buys by others fill your sell."
      />
      {error ? (
        <ErrorNote>Market data unavailable: {error.message}</ErrorNote>
      ) : isLoading ? (
        <Skeleton className="h-60" />
      ) : (
        <Card className="overflow-hidden">
          <CardHeader
            title="Buys vs sells"
            description={`${shown.length} of ${all.length} items${shown.length === 300 ? " (top 300 shown)" : ""} · ${basis === "limit" ? "fill times for one full buy limit, so items compare fairly" : "fill times for the quantity your capital buys (limit left), like the scanner"}`}
            actions={
              active > 0 ? (
                <Button size="sm" variant="ghost" onClick={() => setF({ ...DEFAULT_SPEED_FILTERS, query: f.query, sort: f.sort })} data-testid="speed-reset">
                  <RotateCcw /> Reset {active} filter{active === 1 ? "" : "s"}
                </Button>
              ) : undefined
            }
          />
          <CardBody className="space-y-3 border-b border-border">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
              <Field label="Search"><Input value={f.query} onChange={(e) => set({ query: e.target.value })} placeholder="Item name" aria-label="Search items" /></Field>
              <Field label="Sort by">
                <Select value={f.sort} onChange={(e) => set({ sort: e.target.value as SpeedSortKey })} aria-label="Sort by" data-testid="speed-sort">
                  <option value="cycle">Fastest flip</option>
                  <option value="buyFill">Fastest buy fill</option>
                  <option value="sellFill">Fastest sell fill</option>
                  <option value="volume">Most volume</option>
                  <option value="profit">Highest profit</option>
                  <option value="margin">Highest margin</option>
                  <option value="roi">Highest ROI</option>
                  <option value="buyShare">Most buy pressure</option>
                  <option value="sellShare">Most sell pressure</option>
                </Select>
              </Field>
              <Field label="Quantity">
                <Select value={basis} onChange={(e) => setBasis(e.target.value as "limit" | "capital")} aria-label="Quantity basis" data-testid="speed-basis">
                  <option value="limit">Full buy limit</option>
                  <option value="capital">What my capital buys</option>
                </Select>
              </Field>
              <Field label="Capital (gp)"><AmountInput value={capital} onChange={setCapital} placeholder={gp(settings.defaultCapital)} aria-label="Capital" disabled={basis === "limit"} /></Field>
              <Field label="Min. volume 24 h"><AmountInput value={f.minVolume} onChange={(v) => set({ minVolume: v })} aria-label="Minimum volume" /></Field>
              <Field label="My items">
                <Select value={f.held} onChange={(e) => set({ held: e.target.value as SpeedFilters["held"] })} aria-label="Items I hold" data-testid="speed-held">
                  <option value="all">All items</option>
                  <option value="only">Only what I hold</option>
                  <option value="hide">Hide what I hold</option>
                </Select>
              </Field>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[11px] uppercase tracking-wide text-faint">Speed</span>
              {TIERS.map((t) => (
                <Chip key={t} on={f.tiers.includes(t)} onClick={() => set({ tiers: toggle(f.tiers, t) })} testId={`speed-tier-${t.replace(" ", "-")}`}>{t}</Chip>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[11px] uppercase tracking-wide text-faint">Category</span>
              {CATEGORIES.filter((c) => catCounts.has(c)).map((c) => (
                <Chip key={c} on={f.categories.includes(c)} onClick={() => set({ categories: toggle(f.categories, c) })} testId={`speed-cat-${c}`}>
                  {c} <span className="text-faint">{catCounts.get(c)}</span>
                </Chip>
              ))}
            </div>

            <button type="button" onClick={() => setMore(!more)} className="flex items-center gap-1.5 text-xs font-medium text-accent" aria-expanded={more} data-testid="speed-more">
              <SlidersHorizontal className="size-3.5" /> More filters <ChevronDown className={cn("size-3.5 transition-transform", more && "rotate-180")} />
            </button>
            {more && (
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface-2 p-3 sm:grid-cols-6" data-testid="speed-more-panel">
                <Field label="Min. buy price"><AmountInput value={f.minPrice} onChange={(v) => set({ minPrice: v })} aria-label="Minimum price" /></Field>
                <Field label="Max. buy price"><AmountInput value={f.maxPrice} onChange={(v) => set({ maxPrice: v })} aria-label="Maximum price" data-testid="speed-max-price" /></Field>
                <Field label="Min. margin (gp)"><AmountInput value={f.minMargin} onChange={(v) => set({ minMargin: v })} aria-label="Minimum margin" /></Field>
                <Field label="Min. ROI (%)">
                  <Input type="number" step="0.1" value={f.minRoi == null ? "" : +(f.minRoi * 100).toFixed(3)} onChange={(e) => set({ minRoi: e.target.value === "" ? null : Number(e.target.value) / 100 })} aria-label="Minimum ROI" />
                </Field>
                <Field label="Buy fills within">
                  <Select value={f.maxBuyFill ?? ""} onChange={(e) => set({ maxBuyFill: e.target.value === "" ? null : Number(e.target.value) })} aria-label="Buy fills within">
                    {FILL_LIMITS.map(([l, v]) => <option key={l} value={v ?? ""}>{l}</option>)}
                  </Select>
                </Field>
                <Field label="Sell fills within">
                  <Select value={f.maxSellFill ?? ""} onChange={(e) => set({ maxSellFill: e.target.value === "" ? null : Number(e.target.value) })} aria-label="Sell fills within" data-testid="speed-max-sell-fill">
                    {FILL_LIMITS.map(([l, v]) => <option key={l} value={v ?? ""}>{l}</option>)}
                  </Select>
                </Field>
                <Field label="Buy pressure (24 h)">
                  <Select value={f.pressure} onChange={(e) => set({ pressure: e.target.value as SpeedFilters["pressure"] })} aria-label="Buy pressure">
                    <option value="any">Any</option>
                    <option value="buyers">Buyers heavy (&gt; 60% buys)</option>
                    <option value="balanced">Balanced (40–60%)</option>
                    <option value="sellers">Sellers heavy (&lt; 40% buys)</option>
                  </Select>
                </Field>
                <Field label="Min. volume last hour"><AmountInput value={f.minVolume1h} onChange={(v) => set({ minVolume1h: v })} aria-label="Minimum volume last hour" /></Field>
                <Field label="Min. buy limit"><AmountInput value={f.minLimit} onChange={(v) => set({ minLimit: v })} aria-label="Minimum buy limit" /></Field>
                <Field label="Members">
                  <Select value={f.members} onChange={(e) => set({ members: e.target.value as SpeedFilters["members"] })} aria-label="Members">
                    <option value="all">All</option>
                    <option value="members">Members only</option>
                    <option value="f2p">F2P only</option>
                  </Select>
                </Field>
                <div className="col-span-2 flex flex-wrap items-end gap-x-4 gap-y-1 pb-2 text-sm">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={f.profitableOnly} onChange={(e) => set({ profitableOnly: e.target.checked })} /> Positive margin</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={f.taxFreeOnly} onChange={(e) => set({ taxFreeOnly: e.target.checked })} /> Tax-free</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={f.flippedOnly} onChange={(e) => set({ flippedOnly: e.target.checked })} data-testid="speed-mine" /> Items I’ve flipped</label>
                </div>
              </div>
            )}
          </CardBody>
          {shown.length === 0 ? (
            <EmptyState title="No items match" action={active > 0 ? <Button size="sm" variant="outline" onClick={() => setF({ ...DEFAULT_SPEED_FILTERS, query: f.query, sort: f.sort })}>Reset filters</Button> : undefined}>Lower the minimum volume or loosen a filter.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table w-full text-sm" data-testid="speed-table">
                <thead className="text-left text-[11px] uppercase tracking-wide text-muted">
                  <tr className="border-b border-border">
                    <th className="px-3 py-2 font-medium">Item</th>
                    <th className="px-2 py-2 font-medium">Buys vs sells 24 h</th>
                    <th className="px-2 py-2 font-medium">Last hour</th>
                    <th className="px-2 py-2 text-right font-medium">Buy price<Est /></th>
                    <th className="px-2 py-2 text-right font-medium">Qty</th>
                    <th className="px-2 py-2 text-right font-medium"><Tip content="Time the market needs to instant-sell your quantity at the 24 h average rate (fills your buy offer). You share this with other flippers."><span className="cursor-help">Buy fills in*</span></Tip></th>
                    <th className="px-2 py-2 text-right font-medium"><Tip content="Time the market needs to instant-buy your quantity (fills your sell offer)"><span className="cursor-help">Sell fills in*</span></Tip></th>
                    <th className="px-2 py-2 font-medium">Speed</th>
                    <th className="px-2 py-2 text-right font-medium">Margin<Est /></th>
                    <th className="px-2 py-2 text-right font-medium">Profit<Est /></th>
                    <th className="px-2 py-2 text-right font-medium"><Tip content="Your own trades: number of sales and average time between buying and selling"><span className="cursor-help">Your hold</span></Tip></th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.id} className="border-b border-border/60 hover:bg-surface-2/60" data-testid="speed-row">
                      <td className="max-w-[220px] px-3 py-1.5">
                        <Link href={`/items/${r.id}`} className="flex items-center gap-2 hover:text-accent">
                          <ItemIcon icon={r.icon} name={r.name} size={20} />
                          <span className="min-w-0">
                            <span className="block truncate">{r.name}</span>
                            <span className="block text-[10px] text-faint">
                              {r.category}
                              {held.has(r.id) && <span className="ml-1 text-info">· you hold this</span>}
                              {r.taxExempt && <span className="ml-1 text-pos">· tax-free</span>}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td className="px-2 py-1.5"><SplitBar buys={r.buys24h} sells={r.sells24h} /></td>
                      <td className="px-2 py-1.5"><SplitBar buys={r.buys1h} sells={r.sells1h} className="min-w-[90px]" /></td>
                      <td className="px-2 py-1.5 text-right"><Gp value={r.price} short /></td>
                      <td className="num px-2 py-1.5 text-right text-xs">{gp(r.qty)}</td>
                      <td className="num px-2 py-1.5 text-right">{minutes(r.buyFillMin)}</td>
                      <td className="num px-2 py-1.5 text-right">{minutes(r.sellFillMin)}</td>
                      <td className="px-2 py-1.5"><Badge tone={TIER_TONE[r.tier]}>{r.tier}</Badge></td>
                      <td className="px-2 py-1.5 text-right"><Gp value={r.netMargin} colored /></td>
                      <td className="px-2 py-1.5 text-right"><Gp value={r.profit} colored short /></td>
                      <td className="px-2 py-1.5 text-right text-xs text-muted">{r.ownSales > 0 ? `${duration(r.ownAvgHoldMs)} · ${r.ownSales}×` : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="border-t border-border px-3 py-2 text-[11px] text-faint">
            * Fill times assume you get the whole market flow on that side, so they are a best case for comparing items. Speed tiers use the sum of both: very fast ≤ 30 min, fast ≤ 2 h, medium ≤ 8 h, slow ≤ 24 h.
          </p>
        </Card>
      )}
    </div>
  );
}
