"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { EmptyState, ErrorNote, Est, Gp, PageHeader, Skeleton } from "@/components/common/indicators";
import { ItemIcon } from "@/components/common/item-icon";
import { minutes, SplitBar, TIER_TONE } from "@/components/common/split-bar";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { AmountInput, Field, Input, Select } from "@/components/ui/input";
import { Tip } from "@/components/ui/tooltip";
import { useCandidates, useRowMap } from "@/hooks/market";
import { buildSpeedRows, ownHoldTimes, type SpeedRow } from "@/lib/analysis/speed";
import { duration, gp } from "@/lib/format";
import { useDataStore } from "@/state/data";
import { useSettings } from "@/state/settings";

type SortKey = "cycle" | "volume" | "profit" | "buyShare" | "sellShare";

export default function SpeedPage() {
  const settings = useSettings();
  const [capital, setCapital] = useState<number | null>(null);
  const { candidates, isLoading, error } = useCandidates(capital ?? undefined);
  const rows = useRowMap();
  const trades = useDataStore((s) => s.trades);
  const [sort, setSort] = useState<SortKey>("cycle");
  const [minVol, setMinVol] = useState<number | null>(1000);
  const [profitableOnly, setProfitableOnly] = useState(true);
  const [mineOnly, setMineOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [basis, setBasis] = useState<"limit" | "capital">("limit");

  const own = useMemo(() => ownHoldTimes(trades), [trades]);
  const all = useMemo(() => buildSpeedRows(candidates, rows, own, basis), [candidates, rows, own, basis]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = all.filter(
      (r) =>
        (!profitableOnly || (r.netMargin ?? 0) > 0) &&
        (!mineOnly || r.ownSales > 0) &&
        r.buys24h + r.sells24h >= (minVol ?? 0) &&
        (!q || r.name.toLowerCase().includes(q)),
    );
    const key: Record<SortKey, (r: SpeedRow) => number> = {
      cycle: (r) => -(r.cycleMin ?? Infinity),
      volume: (r) => r.buys24h + r.sells24h,
      profit: (r) => r.profit ?? -Infinity,
      buyShare: (r) => r.buyShare ?? -1,
      sellShare: (r) => (r.buyShare == null ? -1 : 1 - r.buyShare),
    };
    return list.sort((a, b) => key[sort](b) - key[sort](a)).slice(0, 300);
  }, [all, query, profitableOnly, mineOnly, minVol, sort]);

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
          <CardHeader title="Buys vs sells" description={`${shown.length} items${shown.length === 300 ? " (top 300)" : ""} · ${basis === "limit" ? "fill times for one full buy limit, so items compare fairly" : "fill times for the quantity your capital buys (limit left), like the scanner"}`} />
          <CardBody className="grid grid-cols-2 gap-3 border-b border-border sm:grid-cols-7">
            <Field label="Quantity">
              <Select value={basis} onChange={(e) => setBasis(e.target.value as "limit" | "capital")} aria-label="Quantity basis" data-testid="speed-basis">
                <option value="limit">Full buy limit</option>
                <option value="capital">What my capital buys</option>
              </Select>
            </Field>
            <Field label="Capital (gp)"><AmountInput value={capital} onChange={setCapital} placeholder={gp(settings.defaultCapital)} aria-label="Capital" disabled={basis === "limit"} /></Field>
            <Field label="Min. volume 24 h"><AmountInput value={minVol} onChange={setMinVol} aria-label="Minimum volume" /></Field>
            <Field label="Search"><Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Item name" aria-label="Search items" /></Field>
            <Field label="Sort by">
              <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort by" data-testid="speed-sort">
                <option value="cycle">Fastest flip</option>
                <option value="volume">Most volume</option>
                <option value="profit">Highest profit</option>
                <option value="buyShare">Most buy pressure</option>
                <option value="sellShare">Most sell pressure</option>
              </Select>
            </Field>
            <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={profitableOnly} onChange={(e) => setProfitableOnly(e.target.checked)} /> Positive margin only</label>
            <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} data-testid="speed-mine" /> Items I’ve flipped</label>
          </CardBody>
          {shown.length === 0 ? (
            <EmptyState title="No items match">Lower the minimum volume or untick a filter.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table w-full text-sm" data-testid="speed-table">
                <thead className="text-left text-[11px] uppercase tracking-wide text-muted">
                  <tr className="border-b border-border">
                    <th className="px-3 py-2 font-medium">Item</th>
                    <th className="px-2 py-2 font-medium">Buys vs sells 24 h</th>
                    <th className="px-2 py-2 font-medium">Last hour</th>
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
                          <span className="truncate">{r.name}</span>
                        </Link>
                      </td>
                      <td className="px-2 py-1.5"><SplitBar buys={r.buys24h} sells={r.sells24h} /></td>
                      <td className="px-2 py-1.5"><SplitBar buys={r.buys1h} sells={r.sells1h} className="min-w-[90px]" /></td>
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
