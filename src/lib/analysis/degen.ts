import type { SpeedRow } from "./speed";

/**
 * Degen mode: a slot reel over the biggest single flips on the market, ignoring your capital and
 * every "within reason" limit. One full buy limit × net margin. Pure entertainment.
 */

export interface DegenItem {
  id: number;
  name: string;
  icon: string;
  qty: number;
  buy: number;
  sell: number;
  margin: number;
  /** One full buy limit × net margin */
  profit: number;
  row: SpeedRow;
}

/** The biggest flips by profit for a full buy limit (positive margin, both sides traded today). */
export function degenPool(rows: SpeedRow[], size = 40): DegenItem[] {
  const out: DegenItem[] = [];
  for (const r of rows) {
    const buy = r.c?.estBuy, sell = r.c?.estSell, m = r.netMargin;
    if (buy == null || sell == null || m == null || m <= 0 || r.buys24h < 1 || r.sells24h < 1) continue;
    const qty = Math.max(1, r.limit ?? r.qty);
    out.push({ id: r.id, name: r.name, icon: r.icon, qty, buy, sell, margin: m, profit: m * qty, row: r });
  }
  return out.sort((a, b) => b.profit - a.profit).slice(0, size);
}

/** Weighted towards the top: rank 1 is most likely, but anything in the pool can hit. */
export function pickWinner(pool: DegenItem[], rand: () => number = Math.random): DegenItem | null {
  if (pool.length === 0) return null;
  const weights = pool.map((_, i) => 1 / (i + 1));
  let x = rand() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) {
    x -= weights[i]!;
    if (x <= 0) return pool[i]!;
  }
  return pool[pool.length - 1]!;
}

/**
 * The reel strip: random items, the winner at `winnerAt`, and the single biggest item of the pool
 * right after it so the reel can creep towards it and fall back (the edge).
 */
export function buildStrip(pool: DegenItem[], winner: DegenItem, length = 64, rand: () => number = Math.random): { strip: DegenItem[]; winnerAt: number } {
  const winnerAt = length - 4;
  const strip: DegenItem[] = [];
  for (let i = 0; i < length; i++) strip.push(pool[Math.floor(rand() * pool.length)]!);
  strip[winnerAt] = winner;
  const biggest = pool.find((p) => p.id !== winner.id) ?? winner;
  strip[winnerAt + 1] = biggest;
  strip[winnerAt - 1] = pool[Math.min(pool.length - 1, 1 + Math.floor(rand() * 3))]!;
  return { strip, winnerAt };
}

export interface Keyframe {
  t: number;
  pos: number;
  ease: "in" | "out" | "inOut" | "linear";
}

/** The spin: wind-up, full speed, long slowdown, creep one slot at a time, nudge past and fall back. */
export function spinKeyframes(winnerAt: number): Keyframe[] {
  return [
    { t: 0, pos: 0, ease: "linear" },
    { t: 1.0, pos: 4, ease: "in" },
    { t: 4.2, pos: winnerAt - 16, ease: "linear" },
    { t: 7.2, pos: winnerAt - 2, ease: "out" },
    { t: 8.3, pos: winnerAt - 1, ease: "inOut" },
    { t: 9.6, pos: winnerAt, ease: "inOut" },
    { t: 10.4, pos: winnerAt + 0.42, ease: "out" },
    { t: 11.1, pos: winnerAt, ease: "in" },
  ];
}

const EASE = {
  linear: (x: number) => x,
  in: (x: number) => x * x * x,
  out: (x: number) => 1 - (1 - x) ** 4,
  inOut: (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2),
};

export function reelPosition(frames: Keyframe[], t: number): number {
  if (t <= frames[0]!.t) return frames[0]!.pos;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1]!, b = frames[i]!;
    if (t <= b.t) return a.pos + (b.pos - a.pos) * EASE[b.ease]((t - a.t) / (b.t - a.t));
  }
  return frames[frames.length - 1]!.pos;
}
