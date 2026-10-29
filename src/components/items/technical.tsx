"use client";
import { useMemo, useState } from "react";
import { TimeChart, type ChartSeries } from "@/components/charts/time-chart";
import { Gp, InfoNote } from "@/components/common/indicators";
import { pointPrice } from "@/lib/analysis/indicators";
import { computeTechnical, readSummary, type TechSummary } from "@/lib/analysis/technical";
import type { TimeseriesPoint } from "@/lib/market/types";
import { cn } from "@/lib/utils";

const C = {
  buy: "#d9822b",
  sell: "#3b82c4",
  sma20: "#7b4fa6",
  sma50: "#2f8f5b",
  ema20: "#c0398a",
  band: "#9a8566",
  ref: "#9a8566",
  up: "#3a8a36",
  down: "#b3352b",
} as const;

type Overlay = "sma20" | "sma50" | "ema20" | "bb";
type Osc = "none" | "rsi" | "macd" | "stoch";

const OVERLAYS: Array<{ key: Overlay; label: string; color: string }> = [
  { key: "sma20", label: "SMA 20", color: C.sma20 },
  { key: "sma50", label: "SMA 50", color: C.sma50 },
  { key: "ema20", label: "EMA 20", color: C.ema20 },
  { key: "bb", label: "Bollinger 20/2", color: C.band },
];
const OSCS: Array<{ key: Osc; label: string }> = [
  { key: "rsi", label: "RSI 14" },
  { key: "macd", label: "MACD 12/26/9" },
  { key: "stoch", label: "Stochastic 14/3" },
  { key: "none", label: "None" },
];

function Chip({ on, onClick, color, children, testId }: { on: boolean; onClick: () => void; color?: string; children: React.ReactNode; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      data-testid={testId}
      className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors", on ? "border-accent bg-accent-soft text-text" : "border-border text-muted hover:text-text")}
    >
      {color && <span className="size-2 rounded-full" style={{ background: color }} />}
      {children}
    </button>
  );
}

export function PriceChart({ points, height = 520 }: { points: TimeseriesPoint[]; height?: number }) {
  const [overlays, setOverlays] = useState<Set<Overlay>>(() => new Set<Overlay>(["sma20"]));
  const [osc, setOsc] = useState<Osc>("rsi");
  const tech = useMemo(() => computeTechnical(points), [points]);

  const series = useMemo<ChartSeries[]>(() => {
    if (!points.length) return [];
    const both = points.filter((p) => p.avgHighPrice != null && p.avgLowPrice != null).length;
    const out: ChartSeries[] = [];
    if (both >= Math.min(5, points.length / 4)) {
      out.push({ name: "Avg instant-buy", type: "line", color: C.buy, data: points.map((p) => ({ time: p.timestamp, value: p.avgHighPrice })) });
      out.push({ name: "Avg instant-sell", type: "line", color: C.sell, data: points.map((p) => ({ time: p.timestamp, value: p.avgLowPrice })) });
    } else {
      out.push({ name: "Avg price", type: "line", color: C.buy, data: points.map((p) => ({ time: p.timestamp, value: pointPrice(p) })) });
    }
    const s = tech.series;
    if (overlays.has("sma20")) out.push({ name: "SMA 20", type: "line", color: C.sma20, lineWidth: 1, data: s.sma20 });
    if (overlays.has("sma50")) out.push({ name: "SMA 50", type: "line", color: C.sma50, lineWidth: 1, data: s.sma50 });
    if (overlays.has("ema20")) out.push({ name: "EMA 20", type: "line", color: C.ema20, lineWidth: 1, data: s.ema20 });
    if (overlays.has("bb")) {
      out.push({ name: "BB upper", type: "line", color: C.band, lineWidth: 1, dashed: true, data: s.bbUpper });
      out.push({ name: "BB lower", type: "line", color: C.band, lineWidth: 1, dashed: true, data: s.bbLower });
    }
    // Buys up, sells down: one glance shows which side trades more
    out.push({ name: "Instant-buys", type: "histogram", color: C.buy, pane: 1, format: "volume", data: points.map((p) => ({ time: p.timestamp, value: p.highPriceVolume })) });
    out.push({ name: "Instant-sells", type: "histogram", color: C.sell, pane: 1, format: "volume", data: points.map((p) => ({ time: p.timestamp, value: -p.lowPriceVolume })) });
    const ref = (v: number, name: string): ChartSeries => ({ name, type: "line", color: C.ref, pane: 2, lineWidth: 1, dashed: true, hideInTooltip: true, format: "number", data: s.bars.map((b) => ({ time: b.time, value: v })) });
    if (osc === "rsi") {
      out.push({ name: "RSI 14", type: "line", color: C.sma20, pane: 2, format: "number", data: s.rsi });
      out.push(ref(70, "70"), ref(30, "30"));
    } else if (osc === "macd") {
      out.push({ name: "MACD hist.", type: "histogram", color: C.up, pane: 2, format: "number", data: s.macdHist.map((d) => ({ ...d, color: d.value != null && d.value < 0 ? C.down : C.up })) });
      out.push({ name: "MACD", type: "line", color: C.sell, pane: 2, lineWidth: 1, format: "number", data: s.macd });
      out.push({ name: "Signal", type: "line", color: C.buy, pane: 2, lineWidth: 1, format: "number", data: s.macdSignal });
    } else if (osc === "stoch") {
      out.push({ name: "%K", type: "line", color: C.sell, pane: 2, lineWidth: 1, format: "number", data: s.stochK });
      out.push({ name: "%D", type: "line", color: C.buy, pane: 2, lineWidth: 1, format: "number", data: s.stochD });
      out.push(ref(80, "80"), ref(20, "20"));
    }
    return out;
  }, [points, tech, overlays, osc]);

  const toggle = (k: Overlay) =>
    setOverlays((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-faint">Overlays</span>
          {OVERLAYS.map((o) => (
            <Chip key={o.key} on={overlays.has(o.key)} onClick={() => toggle(o.key)} color={o.color} testId={`overlay-${o.key}`}>{o.label}</Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-faint">Lower panel</span>
          {OSCS.map((o) => (
            <Chip key={o.key} on={osc === o.key} onClick={() => setOsc(o.key)} testId={`osc-${o.key}`}>{o.label}</Chip>
          ))}
        </div>
      </div>
      <TimeChart series={series} height={osc === "none" ? Math.round(height * 0.82) : height} />
      <p className="mt-1 text-[11px] text-faint">Middle panel: instant-buys up (orange), instant-sells down (blue). Indicator periods count chart steps, not days.</p>
    </div>
  );
}

function fmt(v: number | null, digits = 1) {
  return v == null ? "–" : v.toLocaleString("de-CH", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function TechnicalSummary({ points }: { points: TimeseriesPoint[] }) {
  const { summary } = useMemo(() => computeTechnical(points), [points]);
  const read = readSummary(summary);
  const s: TechSummary = summary;
  return (
    <div className="space-y-2 text-sm" data-testid="technical">
      {s.bars < 26 && <InfoNote tone="warn">Only {s.bars} steps with trades. Indicators need about 26 (MACD) to 50 (SMA 50); pick a longer range.</InfoNote>}
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
        <dt className="text-muted">SMA 20 / 50</dt>
        <dd className="num text-right"><Gp value={s.sma20 != null ? Math.round(s.sma20) : null} short /> / <Gp value={s.sma50 != null ? Math.round(s.sma50) : null} short /></dd>
        <dt className="text-muted">EMA 20</dt>
        <dd className="text-right"><Gp value={s.ema20 != null ? Math.round(s.ema20) : null} /></dd>
        <dt className="text-muted">RSI 14</dt>
        <dd className="num text-right" data-testid="tech-rsi">{fmt(s.rsi14)}</dd>
        <dt className="text-muted">MACD / signal</dt>
        <dd className="num text-right">{fmt(s.macd, 0)} / {fmt(s.macdSignal, 0)}</dd>
        <dt className="text-muted">Bollinger %B · width</dt>
        <dd className="num text-right">{s.percentB != null ? `${Math.round(s.percentB * 100)}%` : "–"} · {s.bandwidth != null ? `${(s.bandwidth * 100).toFixed(1)}%` : "–"}</dd>
        <dt className="text-muted">Stochastic %K / %D</dt>
        <dd className="num text-right">{fmt(s.stochK, 0)} / {fmt(s.stochD, 0)}</dd>
        <dt className="text-muted">On-balance volume</dt>
        <dd className="num text-right">{s.obvTrend != null ? `${s.obvTrend > 0 ? "+" : ""}${Math.round(s.obvTrend * 100)}% of volume` : "–"}</dd>
      </dl>
      {read.length > 0 && (
        <ul className="space-y-0.5 border-t border-border pt-2 text-xs">
          {read.map((r) => (
            <li key={r.label} className={cn(r.tone === "pos" ? "text-pos" : r.tone === "neg" ? "text-neg" : "text-muted")}>
              <span className="font-semibold">{r.label}:</span> {r.text}
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-faint">Describes past prices. Not a prediction or advice.</p>
    </div>
  );
}
