"use client";
import {
  AreaSeries,
  ColorType,
  createChart,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { gp, gpShort } from "@/lib/format";

export interface ChartSeries {
  name: string;
  type: "line" | "histogram" | "area";
  color: string;
  /** 0 = Hauptbereich, 1/2 = untere Bereiche (z. B. Volumen, Oszillator) */
  pane?: 0 | 1 | 2;
  /** Zeit in Unix-Sekunden; value null = Datenlücke (wird nicht interpoliert); color nur für Histogramme */
  data: Array<{ time: number; value: number | null; color?: string }>;
  /** Tooltip-Format: gp (Standard für Linien), number (2 Nachkommastellen), volume (Betrag, ganzzahlig) */
  format?: "gp" | "number" | "volume";
  dashed?: boolean;
  lineWidth?: 1 | 2;
  /** z. B. Referenzlinien (RSI 30/70) nicht im Tooltip zeigen */
  hideInTooltip?: boolean;
}

function cssVar(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function subscribeTheme(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => obs.disconnect();
}

function useTheme() {
  return useSyncExternalStore(subscribeTheme, () => document.documentElement.dataset.theme ?? "light", () => "light");
}

/**
 * Interaktiver Zeitreihen-Chart (Zoom per Mausrad/Pinch, Verschieben per Drag, Tooltip bei Hover).
 * Fehlende Werte werden als Lücke dargestellt.
 */
const defaultFormat = (v: number) => gp(v);

/** Escaping für den Tooltip (Seriennamen können Item-Namen aus externen Daten enthalten). */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}
const SAFE_COLOR = /^#[0-9a-f]{3,8}$/i;

export function TimeChart({ series, height = 320, formatValue = defaultFormat, timeVisible = true }: { series: ChartSeries[]; height?: number; formatValue?: (v: number) => string; timeVisible?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const theme = useTheme();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const text = cssVar("--muted", "#8a93a1");
    const grid = cssVar("--chart-grid", "#1f242c");
    const border = cssVar("--border", "#272d36");
    const chart: IChartApi = createChart(el, {
      height,
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: text, fontSize: 11, panes: { separatorColor: border }, attributionLogo: false },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } },
      rightPriceScale: { borderColor: border },
      timeScale: { borderColor: border, timeVisible, secondsVisible: false },
      crosshair: { mode: CrosshairMode.Normal },
      localization: {
        locale: "de-CH",
        priceFormatter: (v: number) => gpShort(v),
        timeFormatter: (t: Time) => new Date((t as number) * 1000).toLocaleString("de-CH", { dateStyle: "short", timeStyle: "short" }),
      },
    });

    const apis: Array<{ s: ChartSeries; api: ISeriesApi<SeriesType> }> = [];
    for (const s of series) {
      const data = s.data.map((d) => (d.value == null ? { time: d.time as UTCTimestamp } : d.color ? { time: d.time as UTCTimestamp, value: d.value, color: d.color } : { time: d.time as UTCTimestamp, value: d.value }));
      const volumeFormat = s.format === "volume" ? { type: "custom" as const, formatter: (v: number) => gpShort(Math.abs(v)) } : s.format === "number" ? { type: "price" as const, precision: 2, minMove: 0.01 } : undefined;
      let api: ISeriesApi<SeriesType>;
      if (s.type === "histogram") {
        api = chart.addSeries(HistogramSeries, { color: s.color, priceFormat: volumeFormat ?? { type: "volume" }, lastValueVisible: false, priceLineVisible: false }, s.pane ?? 0);
      } else if (s.type === "area") {
        api = chart.addSeries(AreaSeries, { lineColor: s.color, topColor: `${s.color}40`, bottomColor: `${s.color}05`, lineWidth: 2, priceLineVisible: false }, s.pane ?? 0);
      } else {
        api = chart.addSeries(
          LineSeries,
          {
            color: s.color,
            lineWidth: s.lineWidth ?? 2,
            lineStyle: s.dashed ? LineStyle.Dashed : LineStyle.Solid,
            priceLineVisible: false,
            lastValueVisible: !s.hideInTooltip,
            crosshairMarkerVisible: !s.hideInTooltip,
            ...(volumeFormat ? { priceFormat: volumeFormat } : {}),
          },
          s.pane ?? 0,
        );
      }
      api.setData(data as never);
      apis.push({ s, api });
    }
    // Relative pane sizes: main chart gets the most room, volume/oscillator panes share the rest
    const panes = chart.panes();
    if (panes.length === 2) {
      panes[0]?.setStretchFactor(3);
      panes[1]?.setStretchFactor(1);
    } else if (panes.length >= 3) {
      panes[0]?.setStretchFactor(2.6);
      for (let i = 1; i < panes.length; i++) panes[i]?.setStretchFactor(1);
    }
    chart.timeScale().fitContent();

    const onMove = (p: MouseEventParams) => {
      const tip = tipRef.current;
      if (!tip) return;
      if (!p.time || !p.point || p.point.x < 0 || p.point.y < 0) {
        tip.style.display = "none";
        return;
      }
      const rows = apis
        .filter(({ s }) => !s.hideInTooltip)
        .map(({ s, api }) => {
          const d = p.seriesData.get(api) as { value?: number } | undefined;
          const fmt = (v: number) =>
            s.format === "volume" ? Math.abs(v).toLocaleString("de-CH") : s.format === "number" ? v.toLocaleString("de-CH", { maximumFractionDigits: 2 }) : s.type === "histogram" && !s.format ? v.toLocaleString("de-CH") : formatValue(v);
          const v = d && typeof d.value === "number" ? fmt(d.value) : "no data";
          const color = SAFE_COLOR.test(s.color) ? s.color : "inherit";
          return `<div style="display:flex;gap:8px;justify-content:space-between"><span style="color:${color}">${esc(s.name)}</span><span class="num">${esc(v)}</span></div>`;
        })
        .join("");
      tip.innerHTML = `<div style="color:var(--muted);margin-bottom:2px">${new Date((p.time as number) * 1000).toLocaleString("de-CH", { dateStyle: "short", timeStyle: "short" })}</div>${rows}`;
      tip.style.display = "block";
      const w = el.clientWidth;
      tip.style.left = `${Math.min(Math.max(p.point.x + 12, 0), w - 190)}px`;
      tip.style.top = `${Math.max(p.point.y - 10, 0)}px`;
    };
    chart.subscribeCrosshairMove(onMove);
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
    };
  }, [series, height, formatValue, theme, timeVisible]);

  return (
    <div className="relative" style={{ height }}>
      <div ref={ref} className="h-full w-full" />
      <div
        ref={tipRef}
        className="pointer-events-none absolute z-10 hidden w-[180px] rounded-md border border-border bg-surface-3 px-2 py-1.5 text-[11px] shadow-lg"
        aria-hidden
      />
    </div>
  );
}
