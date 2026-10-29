"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { TimeChart, type ChartSeries } from "@/components/charts/time-chart";
import { Age, EmptyState, ErrorNote, Gp, InfoNote, Pct, Skeleton } from "@/components/common/indicators";
import { ItemIcon } from "@/components/common/item-icon";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRowMap, useTimeseries } from "@/hooks/market";
import { alignDoseHistory, type DoseVariant } from "@/lib/analysis/decant";
import { gp, gpShort, num } from "@/lib/format";
import type { Lookback } from "@/lib/market/types";
import { cn } from "@/lib/utils";

const RANGES: Lookback[] = ["24h", "7d", "30d", "6m", "1y"];
const RANGE_LABEL: Record<string, string> = { "24h": "24 h", "7d": "7 d", "30d": "30 d", "6m": "6 m", "1y": "1 y" };
const C = { buy: "#3b82c4", sell: "#d9822b", up: "#3a8a36", down: "#b3352b" };

function PriceCard({ v, role, nowSec }: { v: DoseVariant; role: "buy" | "sell"; nowSec: number }) {
  const rows = useRowMap();
  const r = rows.get(v.id);
  return (
    <div className={cn("rounded-lg border p-3", role === "buy" ? "border-info/50 bg-info-soft" : "border-accent/50 bg-accent-soft")} data-testid={`compare-${role}`}>
      <div className="mb-2 flex items-center gap-2">
        <ItemIcon icon={v.icon} name={v.name} size={24} />
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">{role === "buy" ? "You buy" : "You sell"}</div>
          <Link href={`/items/${v.id}`} className="block truncate font-semibold hover:text-accent">{v.name}</Link>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-muted">Last instant-buy</dt>
        <dd className="num text-right">{gp(r?.high)} <span className="text-faint">(<Age seconds={r?.highTime != null ? nowSec - r.highTime : null} />)</span></dd>
        <dt className="text-muted">Last instant-sell</dt>
        <dd className="num text-right">{gp(r?.low)} <span className="text-faint">(<Age seconds={r?.lowTime != null ? nowSec - r.lowTime : null} />)</span></dd>
        <dt className="text-muted">{role === "buy" ? "Your buy offer" : "Your sell offer"}</dt>
        <dd className="text-right font-semibold"><Gp value={role === "buy" ? v.estBuy : v.estSell} /></dd>
        <dt className="text-muted">{role === "buy" ? "Cost per dose" : "Net per dose (after tax)"}</dt>
        <dd className="num text-right font-semibold">{gp(role === "buy" ? (v.buyPerDose != null ? Math.round(v.buyPerDose) : null) : v.netSellPerDose != null ? Math.round(v.netSellPerDose) : null)}</dd>
        <dt className="text-muted">Volume 24 h</dt>
        <dd className="num text-right">{gpShort(v.vol24hBuys)} buys · {gpShort(v.vol24hSells)} sells</dd>
        <dt className="text-muted">Buy limit</dt>
        <dd className="num text-right">{v.limit != null ? `${gp(v.limit)} / 4 h` : "–"}</dd>
      </dl>
    </div>
  );
}

export function RouteCompare({ from, to, nowSec }: { from: DoseVariant; to: DoseVariant; nowSec: number }) {
  const [range, setRange] = useState<Lookback>("7d");
  const tsIn = useTimeseries(from.id, range);
  const tsOut = useTimeseries(to.id, range);
  const loading = tsIn.isLoading || tsOut.isLoading;
  const error = tsIn.error ?? tsOut.error;

  const { series, stats } = useMemo(
    () => alignDoseHistory(tsIn.data?.points ?? [], tsOut.data?.points ?? [], from.dose, to.dose, to.id),
    [tsIn.data, tsOut.data, from.dose, to.dose, to.id],
  );
  const chart = useMemo<ChartSeries[]>(
    () =>
      series.length === 0
        ? []
        : [
            { name: `Buy (${from.dose}) per dose`, type: "line", color: C.buy, data: series.map((p) => ({ time: p.time, value: p.buyPerDose })) },
            { name: `Sell (${to.dose}) per dose, net`, type: "line", color: C.sell, data: series.map((p) => ({ time: p.time, value: p.sellNetPerDose })) },
            {
              name: "Margin per dose",
              type: "histogram",
              color: C.up,
              pane: 1,
              format: "number",
              data: series.map((p) => ({ time: p.time, value: p.marginPerDose, color: p.marginPerDose != null && p.marginPerDose < 0 ? C.down : C.up })),
            },
          ],
    [series, from.dose, to.dose],
  );
  const now = from.buyPerDose != null && to.netSellPerDose != null ? to.netSellPerDose - from.buyPerDose : null;
  const vsAvg = now != null && stats.avgMargin != null && stats.avgMargin !== 0 ? (now - stats.avgMargin) / Math.abs(stats.avgMargin) : null;

  return (
    <div className="space-y-3" data-testid="route-compare">
      <div className="grid gap-3 md:grid-cols-2">
        <PriceCard v={from} role="buy" nowSec={nowSec} />
        <PriceCard v={to} role="sell" nowSec={nowSec} />
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold">Price history per dose</div>
          <Tabs value={range} onValueChange={(v) => setRange(v as Lookback)}>
            <TabsList aria-label="Time range">
              {RANGES.map((l) => (
                <TabsTrigger key={l} value={l} data-testid={`compare-range-${l}`}>{RANGE_LABEL[l]}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        {error ? (
          <ErrorNote>Historical data unavailable: {error.message}</ErrorNote>
        ) : loading ? (
          <Skeleton className="h-[300px]" />
        ) : chart.length === 0 ? (
          <EmptyState title="No history in this range" />
        ) : (
          <>
            <TimeChart series={chart} height={320} />
            <p className="mt-1 text-[11px] text-faint">
              Blue: what the ({from.dose}) cost per dose (avg instant-sell). Orange: what the ({to.dose}) paid per dose after tax (avg instant-buy). Bars: the gap between them. Steps where one side didn’t trade stay empty.
            </p>
          </>
        )}
      </div>

      {stats.points > 0 && (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-5" data-testid="compare-stats">
          <div><dt className="text-[11px] uppercase tracking-wide text-muted">Margin/dose now</dt><dd><Gp value={now != null ? Math.round(now) : null} colored /></dd></div>
          <div><dt className="text-[11px] uppercase tracking-wide text-muted">Average ({RANGE_LABEL[range]})</dt><dd><Gp value={stats.avgMargin != null ? Math.round(stats.avgMargin) : null} colored /></dd></div>
          <div><dt className="text-[11px] uppercase tracking-wide text-muted">Low / high</dt><dd className="num">{gpShort(stats.minMargin != null ? Math.round(stats.minMargin) : null)} / {gpShort(stats.maxMargin != null ? Math.round(stats.maxMargin) : null)}</dd></div>
          <div><dt className="text-[11px] uppercase tracking-wide text-muted">Profitable</dt><dd><Pct value={stats.profitableShare} colored={false} /> <span className="text-xs text-faint">of {num(stats.points)} steps</span></dd></div>
          <div><dt className="text-[11px] uppercase tracking-wide text-muted">Now vs average</dt><dd><Pct value={vsAvg} sign /></dd></div>
        </dl>
      )}
      {stats.profitableShare != null && stats.profitableShare < 0.5 && (
        <InfoNote tone="warn">This route was profitable less than half the time in this range. Today’s gap may be a short spike.</InfoNote>
      )}
    </div>
  );
}
