"use client";
import { EyeOff, RotateCcw, Star } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Age, Est, Gp, Pct, QualityBadge, RiskBadge } from "@/components/common/indicators";
import { ItemIcon } from "@/components/common/item-icon";
import { minutes, SplitBar, TIER_TONE } from "@/components/common/split-bar";
import { Badge } from "@/components/ui/badge";
import { Tip } from "@/components/ui/tooltip";
import type { SpeedRow } from "@/lib/analysis/speed";
import { duration, gp, gpShort, num, pct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Sparkline } from "./sparkline";

export type MarketView = "overview" | "profit" | "speed" | "returns" | "signals";

export const VIEWS: Array<{ key: MarketView; label: string; hint: string }> = [
  { key: "overview", label: "Overview", hint: "The essentials of each flip" },
  { key: "profit", label: "Profit", hint: "Prices, tax, margin and profit" },
  { key: "speed", label: "Speed", hint: "Buys vs sells and fill times" },
  { key: "returns", label: "Returns", hint: "Return on capital used, on your capital and per hour" },
  { key: "signals", label: "Signals", hint: "7-day trend, dips, RSI, margin stability" },
];

interface Col {
  key: string;
  label: ReactNode;
  tip?: ReactNode;
  right?: boolean;
  cell: (r: SpeedRow) => ReactNode;
}

const qtyCell = (r: SpeedRow) =>
  r.capped ? (
    <Tip content={`Capped from ${gp(r.rawQty)} to ${gp(r.qty)} to stay within reason (market volume, your capital${r.c ? "" : ""})`}>
      <span className="cursor-help text-warn" data-testid="speed-qty-capped">{gp(r.qty)}*</span>
    </Tip>
  ) : (
    gp(r.qty)
  );

const trendCell = (r: SpeedRow) => {
  const t = r.sig?.trend;
  if (!t) return <span className="text-faint">–</span>;
  return <span className={cn(t === "up" ? "text-pos" : t === "down" ? "text-neg" : "text-muted")}>{t === "up" ? "↗ up" : t === "down" ? "↘ down" : "→ flat"}</span>;
};

const rsiCell = (r: SpeedRow) => {
  const v = r.sig?.rsi;
  if (v == null) return <span className="text-faint">–</span>;
  return <span className={cn(v >= 70 ? "text-neg" : v <= 30 ? "text-pos" : "")} title={v >= 70 ? "Overbought" : v <= 30 ? "Oversold" : undefined}>{Math.round(v)}</span>;
};

const stableCell = (r: SpeedRow) =>
  r.sig && r.sig.stableOf > 0 ? (
    <Tip content={`Margin after tax was positive on ${r.sig.stableDays} of the last ${r.sig.stableOf} days${r.sig.marginCv != null ? `; day-to-day variation ${Math.round(r.sig.marginCv * 100)}%` : ""}`}>
      <span className={cn("cursor-help", r.sig.stableDays >= 6 ? "text-pos" : r.sig.stableDays <= 3 ? "text-neg" : "")}>{r.sig.stableDays}/{r.sig.stableOf}</span>
    </Tip>
  ) : (
    <span className="text-faint">–</span>
  );

const COLS: Record<string, Col> = {
  inst: { key: "inst", label: "Inst. buy / sell", tip: "Last instant-buy (someone bought) / instant-sell (someone sold)", right: true, cell: (r) => <span className="num text-xs">{gpShort(r.c.latestHigh)} / {gpShort(r.c.latestLow)}</span> },
  estBuy: { key: "estBuy", label: <>Buy<Est /></>, right: true, cell: (r) => <Gp value={r.c.estBuy} /> },
  estSell: { key: "estSell", label: <>Sell<Est /></>, right: true, cell: (r) => <Gp value={r.c.estSell} /> },
  tax: { key: "tax", label: "Tax", right: true, cell: (r) => (r.taxExempt ? <span className="text-pos">free</span> : <Gp value={r.c.taxPerItem} />) },
  margin: { key: "margin", label: <>Margin<Est /></>, tip: "Net margin per item after GE tax", right: true, cell: (r) => <Gp value={r.netMargin} colored /> },
  marginCons: { key: "marginCons", label: "Margin (avg prices)", tip: "Margin using last hour’s average prices instead of single trades", right: true, cell: (r) => <Gp value={r.c.netMarginConservative} colored /> },
  roi: { key: "roi", label: "ROI", right: true, cell: (r) => <Pct value={r.roi} /> },
  qty: { key: "qty", label: "Qty", right: true, cell: qtyCell },
  capitalUsed: { key: "capitalUsed", label: "Capital used", right: true, cell: (r) => <Gp value={r.capitalUsed} short /> },
  profit: { key: "profit", label: <>Profit<Est /></>, tip: "Net margin × quantity (within reason when the toggle is on)", right: true, cell: (r) => <span className="font-semibold"><Gp value={r.profit} colored short /></span> },
  potential: { key: "potential", label: "Pot. / limit", tip: "Net margin × full buy limit", right: true, cell: (r) => <Gp value={r.c.potentialPerLimit} short /> },
  split24: { key: "split24", label: "Buys vs sells 24 h", cell: (r) => <SplitBar buys={r.buys24h} sells={r.sells24h} /> },
  split1: { key: "split1", label: "Last hour", cell: (r) => <SplitBar buys={r.buys1h} sells={r.sells1h} className="min-w-[90px]" /> },
  buyFill: { key: "buyFill", label: "Buy fills in*", tip: "Time the market needs to instant-sell your quantity at the 24 h rate", right: true, cell: (r) => <span className="num">{minutes(r.buyFillMin)}</span> },
  sellFill: { key: "sellFill", label: "Sell fills in*", tip: "Time the market needs to instant-buy your quantity", right: true, cell: (r) => <span className="num">{minutes(r.sellFillMin)}</span> },
  speed: { key: "speed", label: "Speed", cell: (r) => <Badge tone={TIER_TONE[r.tier]}>{r.tier}</Badge> },
  hold: { key: "hold", label: "Your hold", tip: "Your own trades: average time between buy and sale", right: true, cell: (r) => <span className="text-xs text-muted">{r.ownSales > 0 ? `${duration(r.ownAvgHoldMs)} · ${r.ownSales}×` : "–"}</span> },
  retUsed: { key: "retUsed", label: "On used", tip: "Profit ÷ capital used", right: true, cell: (r) => <Pct value={r.returnOnUsed} /> },
  retMine: { key: "retMine", label: "On mine", tip: "Profit ÷ your whole capital", right: true, cell: (r) => <span className="num">{pct(r.returnOnCapital)}</span> },
  retHour: { key: "retHour", label: "Per hour", tip: "Return on capital used ÷ hours both sides take (min. 15 min)", right: true, cell: (r) => <span className="num font-medium">{pct(r.returnPerHour)}</span> },
  spark: { key: "spark", label: "7 days", tip: "Daily average price over the last 7 days, dot = now", cell: (r) => <Sparkline values={r.sig?.spark ?? []} /> },
  vs7: { key: "vs7", label: "vs 7 d", tip: "Price now vs its 7-day median", right: true, cell: (r) => <Pct value={r.sig?.vs7} sign /> },
  vs30: { key: "vs30", label: "vs 30 d", tip: "Price now vs its 30-day median", right: true, cell: (r) => <Pct value={r.sig?.vs30} sign /> },
  rsi: { key: "rsi", label: "RSI", tip: "RSI 14 on daily prices: ≥ 70 overbought, ≤ 30 oversold", right: true, cell: rsiCell },
  trend: { key: "trend", label: "Trend", tip: "7-day trend: more than ±0.5% per day", cell: trendCell },
  stable: { key: "stable", label: "Margin days", tip: "Days of the last 7 with a positive margin after tax", right: true, cell: stableCell },
  risk: { key: "risk", label: "Risk", cell: (r) => <RiskBadge r={r.c.risk} /> },
  quality: { key: "quality", label: "Quality", cell: (r) => <QualityBadge q={r.c.quality} compact /> },
  age: { key: "age", label: "Data age", right: true, cell: (r) => <span className="text-xs"><Age seconds={r.c.ageSec} /></span> },
  score: {
    key: "score",
    label: "Score",
    tip: "Scanner score: margin, volume, risk and data quality",
    cell: (r) => (
      <span className="inline-flex items-center gap-1.5">
        <span className="h-1.5 w-8 overflow-hidden rounded bg-surface-3"><span className="block h-full bg-accent" style={{ width: `${r.c.score}%` }} /></span>
        <span className="num text-xs">{r.c.score}</span>
      </span>
    ),
  },
  vol: { key: "vol", label: "Vol. 1h / 24h", right: true, cell: (r) => <span className="num text-xs">{num(r.buys1h + r.sells1h)} / {gpShort(r.buys24h + r.sells24h)}</span> },
};

const VIEW_COLS: Record<MarketView, string[]> = {
  overview: ["inst", "margin", "qty", "profit", "retHour", "speed", "spark", "risk", "score"],
  profit: ["estBuy", "estSell", "tax", "margin", "marginCons", "roi", "qty", "capitalUsed", "profit", "potential", "age"],
  speed: ["split24", "split1", "qty", "buyFill", "sellFill", "speed", "vol", "hold"],
  returns: ["capitalUsed", "profit", "retUsed", "retMine", "retHour", "speed", "qty"],
  signals: ["spark", "vs7", "vs30", "rsi", "trend", "stable", "risk", "quality", "age"],
};

export function MarketTable({
  rows,
  view,
  selected,
  onSelect,
  onOpen,
  watched,
  held,
  dismissed,
  onWatch,
  onDismiss,
}: {
  rows: SpeedRow[];
  view: MarketView;
  selected: number | null;
  onSelect: (id: number) => void;
  onOpen: (id: number) => void;
  watched: ReadonlySet<number>;
  held: ReadonlySet<number>;
  dismissed: ReadonlySet<number>;
  onWatch: (r: SpeedRow) => void;
  onDismiss: (r: SpeedRow) => void;
}) {
  const cols = VIEW_COLS[view].map((k) => COLS[k]!);
  return (
    <>
      {/* Desktop: table with sticky item column */}
      <div className="hidden max-h-[calc(100vh-14rem)] overflow-auto md:block">
        <table className="data-table w-full text-sm" data-testid="scanner-table">
          <thead className="text-left text-[11px] uppercase tracking-wide text-muted">
            <tr className="border-b border-border">
              <th className="sticky left-0 top-0 z-20 bg-surface px-3 py-2 font-medium">Item</th>
              {cols.map((c) => (
                <th key={c.key} className={cn("sticky top-0 z-10 bg-surface px-2 py-2 font-medium whitespace-nowrap", c.right && "text-right")}>
                  {c.tip ? <Tip content={c.tip}><span className="cursor-help">{c.label}</span></Tip> : c.label}
                </th>
              ))}
              <th className="sticky top-0 z-10 bg-surface px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const sel = selected === r.id;
              const isDismissed = dismissed.has(r.id);
              return (
                <tr
                  key={r.id}
                  onClick={() => (sel ? onOpen(r.id) : onSelect(r.id))}
                  onDoubleClick={() => onOpen(r.id)}
                  className={cn("group cursor-pointer border-b border-border/60", sel ? "bg-accent-soft" : "hover:bg-surface-2/60", isDismissed && "opacity-50")}
                  aria-selected={sel}
                  data-testid="scanner-row"
                  data-item-id={r.id}
                >
                  <td className={cn("sticky left-0 z-[5] max-w-[240px] px-3 py-1.5", sel ? "bg-[color-mix(in_srgb,var(--accent)_14%,var(--surface))]" : "bg-surface group-hover:bg-surface-2")}>
                    <div className="flex items-center gap-2">
                      <ItemIcon icon={r.icon} name={r.name} size={20} />
                      <span className="min-w-0">
                        <Link href={`/items/${r.id}`} onClick={(e) => e.stopPropagation()} className="block truncate hover:text-accent">{r.name}</Link>
                        <span className="block text-[10px] text-faint">
                          {r.category}
                          {held.has(r.id) && <span className="ml-1 text-info">· you hold this</span>}
                          {r.taxExempt && <span className="ml-1 text-pos">· tax-free</span>}
                          {r.outlier && <span className="ml-1 text-warn" title={r.outlier}>· outlier</span>}
                        </span>
                      </span>
                    </div>
                  </td>
                  {cols.map((c) => (
                    <td key={c.key} className={cn("px-2 py-1.5", c.right && "text-right")}>{c.cell(r)}</td>
                  ))}
                  <td className="px-1 py-1.5">
                    <div className="flex justify-end gap-0.5 opacity-60 group-hover:opacity-100">
                      <button type="button" onClick={(e) => { e.stopPropagation(); onWatch(r); }} className={cn("rounded p-1", watched.has(r.id) ? "text-accent" : "text-faint hover:text-accent")} aria-label={watched.has(r.id) ? "Remove from watchlist" : "Add to watchlist"} title="Watchlist (W)">
                        <Star className={cn("size-3.5", watched.has(r.id) && "fill-current")} />
                      </button>
                      <button type="button" onClick={(e) => { e.stopPropagation(); onDismiss(r); }} className="rounded p-1 text-faint hover:text-neg" aria-label={isDismissed ? "Show again" : "Not interested"} title={isDismissed ? "Show again (D)" : "Not interested (D)"} data-testid="row-dismiss">
                        {isDismissed ? <RotateCcw className="size-3.5" /> : <EyeOff className="size-3.5" />}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile: cards */}
      <ul className="divide-y divide-border md:hidden" data-testid="scanner-cards">
        {rows.map((r) => (
          <li key={r.id} className="px-3 py-2" onClick={() => onOpen(r.id)}>
            <div className="flex items-center gap-2">
              <ItemIcon icon={r.icon} name={r.name} size={22} />
              <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
              <Badge tone={TIER_TONE[r.tier]}>{r.tier}</Badge>
            </div>
            <div className="mt-1 grid grid-cols-3 gap-1 text-xs">
              <span className="text-muted">Margin <Gp value={r.netMargin} colored /></span>
              <span className="text-muted">Qty {qtyCell(r)}</span>
              <span className="text-muted">Profit <Gp value={r.profit} colored short /></span>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
