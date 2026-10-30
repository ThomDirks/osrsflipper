"use client";
import { EyeOff, Plus, RotateCcw, Star, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Age, ErrorNote, Gp, Pct, QualityBadge, RiskBadge, Skeleton } from "@/components/common/indicators";
import { ItemIcon } from "@/components/common/item-icon";
import { minutes, SplitBar, TIER_TONE } from "@/components/common/split-bar";
import { PriceChart, TechnicalSummary } from "@/components/items/technical";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTimeseries } from "@/hooks/market";
import type { SpeedRow } from "@/lib/analysis/speed";
import { gp, pct } from "@/lib/format";
import type { Lookback } from "@/lib/market/types";
import { cn } from "@/lib/utils";
import { Sparkline } from "./sparkline";

const RANGES: Lookback[] = ["6h", "24h", "7d", "30d"];

/** Quick view beside the table: chart, indicators, buys vs sells and actions, without leaving the list. */
export function SidePanel({
  row,
  nowSec,
  watched,
  dismissed,
  held,
  onClose,
  onLog,
  onWatch,
  onDismiss,
}: {
  row: SpeedRow;
  nowSec: number;
  watched: boolean;
  dismissed: boolean;
  held: boolean;
  onClose: () => void;
  onLog: () => void;
  onWatch: () => void;
  onDismiss: () => void;
}) {
  const [range, setRange] = useState<Lookback>("24h");
  const ts = useTimeseries(row.id, range);
  const c = row.c;
  const points = ts.data?.points ?? [];
  return (
    <aside
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[560px] flex-col border-l border-border bg-surface shadow-2xl animate-fade-in"
      aria-label={`${row.name} quick view`}
      data-testid="side-panel"
    >
      <div className="flex items-start gap-3 border-b border-border px-4 py-3">
        <ItemIcon icon={row.icon} name={row.name} size={32} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-extrabold tracking-tight">{row.name}</div>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
            <span>{row.category}</span>
            <Badge tone={TIER_TONE[row.tier]}>{row.tier}</Badge>
            <RiskBadge r={c.risk} />
            <QualityBadge q={c.quality} compact />
            {held && <Badge tone="info">you hold this</Badge>}
            {row.taxExempt && <Badge tone="pos">tax-free</Badge>}
          </div>
        </div>
        <button type="button" onClick={onClose} className="rounded p-1 text-muted hover:text-text" aria-label="Close quick view (Esc)" data-testid="side-panel-close">
          <X className="size-5" />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" onClick={onLog} data-testid="panel-log">
            <Plus /> Log trade (L)
          </Button>
          <Button variant="outline" size="sm" onClick={onWatch}>
            <Star className={cn(watched && "fill-current text-accent")} /> {watched ? "Watching" : "Watch"} (W)
          </Button>
          <Button variant="ghost" size="sm" onClick={onDismiss} data-testid="panel-dismiss">
            {dismissed ? <RotateCcw /> : <EyeOff />} {dismissed ? "Show again" : "Not interested"} (D)
          </Button>
          <Link href={`/items/${row.id}`} className="ml-auto self-center text-xs text-accent underline">Full item page</Link>
        </div>

        {row.outlier && <ErrorNote>Outlier: {row.outlier}</ErrorNote>}

        <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
          <div><dt className="text-[10px] uppercase tracking-wide text-muted">Buy at</dt><dd className="font-semibold"><Gp value={c.estBuy} /></dd><dd className="text-[10px] text-faint">inst. sell {gp(c.latestLow)} · <Age seconds={c.lowTime != null ? nowSec - c.lowTime : null} /></dd></div>
          <div><dt className="text-[10px] uppercase tracking-wide text-muted">Sell at</dt><dd className="font-semibold"><Gp value={c.estSell} /></dd><dd className="text-[10px] text-faint">inst. buy {gp(c.latestHigh)} · <Age seconds={c.highTime != null ? nowSec - c.highTime : null} /></dd></div>
          <div><dt className="text-[10px] uppercase tracking-wide text-muted">Margin</dt><dd className="font-semibold"><Gp value={row.netMargin} colored /></dd><dd className="text-[10px] text-faint">ROI {pct(row.roi)} · tax {row.taxExempt ? "0" : gp(c.taxPerItem)}</dd></div>
          <div><dt className="text-[10px] uppercase tracking-wide text-muted">Quantity</dt><dd className="font-semibold">{gp(row.qty)}{row.capped && <span className="text-warn">*</span>}</dd><dd className="text-[10px] text-faint">limit {row.limit != null ? gp(row.limit) : "–"}</dd></div>
          <div><dt className="text-[10px] uppercase tracking-wide text-muted">Profit</dt><dd className="font-semibold"><Gp value={row.profit} colored /></dd><dd className="text-[10px] text-faint">uses {gp(row.capitalUsed)} gp</dd></div>
          <div><dt className="text-[10px] uppercase tracking-wide text-muted">Return</dt><dd className="font-semibold"><Pct value={row.returnOnUsed} /></dd><dd className="text-[10px] text-faint">{pct(row.returnPerHour)} / h · {pct(row.returnOnCapital)} of yours</dd></div>
        </dl>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-muted">Buys vs sells 24 h</div>
            <SplitBar buys={row.buys24h} sells={row.sells24h} />
          </div>
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-muted">Last hour</div>
            <SplitBar buys={row.buys1h} sells={row.sells1h} />
          </div>
          <div className="text-xs text-muted">Buy fills in <span className="num text-text">{minutes(row.buyFillMin)}</span> · sell in <span className="num text-text">{minutes(row.sellFillMin)}</span></div>
          <div className="text-xs text-muted">{row.ownSales > 0 ? `You’ve sold this ${row.ownSales}×` : "You haven’t flipped this yet"}</div>
        </div>

        {row.sig && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs">
            <Sparkline values={row.sig.spark} width={110} height={28} />
            <span>vs 7 d <Pct value={row.sig.vs7} sign /></span>
            <span>vs 30 d <Pct value={row.sig.vs30} sign /></span>
            <span>RSI {row.sig.rsi != null ? Math.round(row.sig.rsi) : "–"}</span>
            <span>trend {row.sig.trend ?? "–"}</span>
            <span>margin + on {row.sig.stableDays}/{row.sig.stableOf} days</span>
          </div>
        )}

        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-semibold">Price history</div>
            <Tabs value={range} onValueChange={(v) => setRange(v as Lookback)}>
              <TabsList aria-label="Time range">
                {RANGES.map((l) => <TabsTrigger key={l} value={l}>{l}</TabsTrigger>)}
              </TabsList>
            </Tabs>
          </div>
          {ts.error ? <ErrorNote>History unavailable: {ts.error.message}</ErrorNote> : ts.isLoading ? <Skeleton className="h-[300px]" /> : <PriceChart points={points} height={340} />}
        </div>
        {points.length > 0 && <TechnicalSummary points={points} />}
      </div>
    </aside>
  );
}
