import type { TimeseriesPoint } from "../market/types";
import { pointPrice } from "./indicators";

/**
 * Technical indicators on /timeseries data. Periods count time steps of the chosen range
 * (5 min for 6 h, 1 h for 7 d, …), not days.
 *
 * Price per step = mid price ((avg instant-buy + avg instant-sell) / 2, or the one side traded).
 * Steps without trades are skipped (not interpolated); indicator values keep their timestamps.
 * High/low for the stochastic = avg instant-buy / avg instant-sell of the step (the closest thing
 * to a candle range the API offers).
 */

export type Series = Array<{ time: number; value: number | null }>;

export interface Bar {
  time: number;
  close: number;
  high: number;
  low: number;
  volBuy: number;
  volSell: number;
}

export function toBars(points: TimeseriesPoint[]): Bar[] {
  const out: Bar[] = [];
  for (const p of points) {
    const close = pointPrice(p);
    if (close == null) continue;
    out.push({
      time: p.timestamp,
      close,
      high: Math.max(p.avgHighPrice ?? close, p.avgLowPrice ?? close),
      low: Math.min(p.avgHighPrice ?? close, p.avgLowPrice ?? close),
      volBuy: p.highPriceVolume,
      volSell: p.lowPriceVolume,
    });
  }
  return out;
}

export function sma(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i] as number;
    if (i >= period) sum -= values[i - period] as number;
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

/** EMA seeded with the SMA of the first `period` values. */
export function ema(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = [];
  const k = 2 / (period + 1);
  let prev: number | null = null;
  let seed = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i] as number;
    if (prev == null) {
      seed += v;
      if (i === period - 1) prev = seed / period;
      out.push(prev);
    } else {
      prev = v * k + prev * (1 - k);
      out.push(prev);
    }
  }
  return out;
}

function emaNullable(values: Array<number | null>, period: number): Array<number | null> {
  const start = values.findIndex((v) => v != null);
  if (start < 0) return values.map(() => null);
  const tail = ema(values.slice(start) as number[], period);
  return [...values.slice(0, start).map(() => null), ...tail];
}

/** RSI with Wilder smoothing. */
export function rsi(values: number[], period = 14): Array<number | null> {
  const out: Array<number | null> = values.map(() => null);
  if (values.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = (values[i] as number) - (values[i - 1] as number);
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  const val = () => (loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss));
  out[period] = val();
  for (let i = period + 1; i < values.length; i++) {
    const d = (values[i] as number) - (values[i - 1] as number);
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = val();
  }
  return out;
}

export function macd(values: number[], fast = 12, slow = 26, signal = 9) {
  const f = ema(values, fast);
  const s = ema(values, slow);
  const line = values.map((_, i) => (f[i] != null && s[i] != null ? (f[i] as number) - (s[i] as number) : null));
  const sig = emaNullable(line, signal);
  const hist = line.map((v, i) => (v != null && sig[i] != null ? v - (sig[i] as number) : null));
  return { line, signal: sig, hist };
}

export function bollinger(values: number[], period = 20, mult = 2) {
  const mid = sma(values, period);
  const upper: Array<number | null> = [];
  const lower: Array<number | null> = [];
  for (let i = 0; i < values.length; i++) {
    const m = mid[i];
    if (m == null) {
      upper.push(null);
      lower.push(null);
      continue;
    }
    let sq = 0;
    for (let j = i - period + 1; j <= i; j++) sq += ((values[j] as number) - m) ** 2;
    const sd = Math.sqrt(sq / period);
    upper.push(m + mult * sd);
    lower.push(m - mult * sd);
  }
  return { mid, upper, lower };
}

/** Stochastic oscillator %K (period) and %D (SMA of %K). */
export function stochastic(bars: Bar[], period = 14, smooth = 3) {
  const k: Array<number | null> = [];
  for (let i = 0; i < bars.length; i++) {
    if (i < period - 1) {
      k.push(null);
      continue;
    }
    let hi = -Infinity, lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      hi = Math.max(hi, (bars[j] as Bar).high);
      lo = Math.min(lo, (bars[j] as Bar).low);
    }
    k.push(hi === lo ? 50 : (((bars[i] as Bar).close - lo) / (hi - lo)) * 100);
  }
  const start = k.findIndex((v) => v != null);
  const d = start < 0 ? k.map(() => null) : [...k.slice(0, start).map(() => null), ...sma(k.slice(start) as number[], smooth)];
  return { k, d };
}

/** On-balance volume using total step volume. */
export function obv(bars: Bar[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (let i = 0; i < bars.length; i++) {
    if (i > 0) {
      const b = bars[i] as Bar, p = bars[i - 1] as Bar;
      const v = b.volBuy + b.volSell;
      if (b.close > p.close) acc += v;
      else if (b.close < p.close) acc -= v;
    }
    out.push(acc);
  }
  return out;
}

export interface TechSummary {
  bars: number;
  close: number | null;
  sma20: number | null;
  sma50: number | null;
  ema20: number | null;
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHist: number | null;
  /** Last MACD/signal crossover: steps ago and direction (up = MACD crossed above its signal) */
  macdCross: { stepsAgo: number; dir: "up" | "down" } | null;
  bbUpper: number | null;
  bbLower: number | null;
  /** Position in the Bollinger band: 0 = lower band, 1 = upper band */
  percentB: number | null;
  /** Band width relative to the middle band */
  bandwidth: number | null;
  stochK: number | null;
  stochD: number | null;
  /** Share of volume that was instant-buys over the range */
  buyShare: number | null;
  /** OBV change over the range relative to total volume (−1 … 1) */
  obvTrend: number | null;
}

export interface TechSeries {
  bars: Bar[];
  sma20: Series;
  sma50: Series;
  ema20: Series;
  bbUpper: Series;
  bbLower: Series;
  rsi: Series;
  macd: Series;
  macdSignal: Series;
  macdHist: Series;
  stochK: Series;
  stochD: Series;
}

const last = <T,>(a: Array<T | null>): T | null => {
  for (let i = a.length - 1; i >= 0; i--) if (a[i] != null) return a[i] as T;
  return null;
};

export function computeTechnical(points: TimeseriesPoint[]): { series: TechSeries; summary: TechSummary } {
  const bars = toBars(points);
  const closes = bars.map((b) => b.close);
  const t = (vals: Array<number | null>): Series => bars.map((b, i) => ({ time: b.time, value: vals[i] ?? null }));
  const s20 = sma(closes, 20), s50 = sma(closes, 50), e20 = ema(closes, 20);
  const r = rsi(closes, 14);
  const m = macd(closes);
  const bb = bollinger(closes, 20, 2);
  const st = stochastic(bars, 14, 3);
  const o = obv(bars);

  let macdCross: TechSummary["macdCross"] = null;
  for (let i = m.hist.length - 1; i > 0; i--) {
    const a = m.hist[i], b = m.hist[i - 1];
    if (a == null || b == null) break;
    if (Math.sign(a) !== Math.sign(b) && a !== 0) {
      macdCross = { stepsAgo: m.hist.length - 1 - i, dir: a > 0 ? "up" : "down" };
      break;
    }
  }
  const close = closes[closes.length - 1] ?? null;
  const up = last(bb.upper), lo = last(bb.lower), mid = last(bb.mid);
  const volBuy = bars.reduce((a, b) => a + b.volBuy, 0);
  const volAll = bars.reduce((a, b) => a + b.volBuy + b.volSell, 0);
  return {
    series: {
      bars,
      sma20: t(s20),
      sma50: t(s50),
      ema20: t(e20),
      bbUpper: t(bb.upper),
      bbLower: t(bb.lower),
      rsi: t(r),
      macd: t(m.line),
      macdSignal: t(m.signal),
      macdHist: t(m.hist),
      stochK: t(st.k),
      stochD: t(st.d),
    },
    summary: {
      bars: bars.length,
      close,
      sma20: last(s20),
      sma50: last(s50),
      ema20: last(e20),
      rsi14: last(r),
      macd: last(m.line),
      macdSignal: last(m.signal),
      macdHist: last(m.hist),
      macdCross,
      bbUpper: up,
      bbLower: lo,
      percentB: close != null && up != null && lo != null && up > lo ? (close - lo) / (up - lo) : null,
      bandwidth: up != null && lo != null && mid ? (up - lo) / mid : null,
      stochK: last(st.k),
      stochD: last(st.d),
      buyShare: volAll > 0 ? volBuy / volAll : null,
      obvTrend: volAll > 0 && o.length ? (o[o.length - 1] as number) / volAll : null,
    },
  };
}

export type Tone = "pos" | "neg" | "neutral";

/** Plain-language reading of each indicator. Descriptive only, not a trade signal. */
export function readSummary(s: TechSummary): Array<{ label: string; text: string; tone: Tone }> {
  const out: Array<{ label: string; text: string; tone: Tone }> = [];
  if (s.rsi14 != null) {
    const v = s.rsi14;
    out.push({ label: "RSI 14", text: v >= 70 ? "Overbought: price rose fast, often cools off" : v <= 30 ? "Oversold: price fell fast, often bounces" : v >= 55 ? "Buyers have the upper hand" : v <= 45 ? "Sellers have the upper hand" : "Neutral", tone: v >= 70 ? "neg" : v <= 30 ? "pos" : "neutral" });
  }
  if (s.close != null && s.sma20 != null && s.sma50 != null) {
    const above20 = s.close > s.sma20, above50 = s.close > s.sma50, golden = s.sma20 > s.sma50;
    out.push({
      label: "Moving averages",
      text: above20 && above50 && golden ? "Uptrend: price above SMA 20 and 50, SMA 20 above 50" : !above20 && !above50 && !golden ? "Downtrend: price below SMA 20 and 50, SMA 20 below 50" : "Mixed: no clear trend",
      tone: above20 && above50 && golden ? "pos" : !above20 && !above50 && !golden ? "neg" : "neutral",
    });
  } else if (s.close != null && s.sma20 != null) {
    out.push({ label: "SMA 20", text: s.close > s.sma20 ? "Price above its 20-step average" : "Price below its 20-step average", tone: s.close > s.sma20 ? "pos" : "neg" });
  }
  if (s.macdHist != null) {
    const crossed = s.macdCross != null && s.macdCross.stepsAgo <= 3;
    out.push({
      label: "MACD",
      text: crossed ? (s.macdCross!.dir === "up" ? "Just crossed above its signal line (momentum turning up)" : "Just crossed below its signal line (momentum turning down)") : s.macdHist > 0 ? "Above signal line: upward momentum" : "Below signal line: downward momentum",
      tone: s.macdHist > 0 ? "pos" : "neg",
    });
  }
  if (s.percentB != null) {
    const b = s.percentB;
    out.push({ label: "Bollinger", text: b > 1 ? "Above the upper band: stretched high" : b < 0 ? "Below the lower band: stretched low" : b > 0.8 ? "Near the upper band" : b < 0.2 ? "Near the lower band" : "Inside the bands", tone: b > 0.8 ? "neg" : b < 0.2 ? "pos" : "neutral" });
  }
  if (s.stochK != null) {
    const k = s.stochK;
    out.push({ label: "Stochastic", text: k >= 80 ? "Near the top of its recent range" : k <= 20 ? "Near the bottom of its recent range" : "Mid-range", tone: k >= 80 ? "neg" : k <= 20 ? "pos" : "neutral" });
  }
  if (s.buyShare != null) {
    const b = s.buyShare;
    out.push({ label: "Buy pressure", text: `${Math.round(b * 100)}% of volume were instant-buys${b > 0.6 ? " (demand heavy)" : b < 0.4 ? " (supply heavy)" : ""}`, tone: b > 0.6 ? "pos" : b < 0.4 ? "neg" : "neutral" });
  }
  return out;
}
