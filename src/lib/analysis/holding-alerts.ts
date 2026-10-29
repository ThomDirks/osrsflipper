import { breakEvenSellPrice } from "../calc/profit";
import { computeFifo, estimateOpenSale, recommendedSellPrice } from "../portfolio/fifo";
import type { Trade } from "../portfolio/schemas";
import type { MarketRow } from "../market/types";

/**
 * Holding alerts: for every trade you still hold items of, compare the price you could sell at
 * right now (last instant-buy − offset) with
 * - your expected sale price (set when logging the buy), or break-even/cost if you set none,
 * - the average instant-buy of the last completed hour (sudden moves),
 * - break-even (selling now would lose money; from 15 min after the latest buy).
 */

export type HoldingAlertKind = "target" | "above" | "below" | "loss" | "jump" | "crash";

export interface HoldingAlertConfig {
  upPct: number;
  downPct: number;
  suddenPct: number;
  lossWarning: boolean;
}

export interface HoldingSignal {
  /** Stable key per trade and kind (for cooldowns) */
  key: string;
  tradeId: string;
  itemId: number;
  itemName: string;
  kind: HoldingAlertKind;
  tone: "pos" | "neg";
  title: string;
  detail: string;
  openQty: number;
  sellNow: number;
  reference: number | null;
  /** Relative change vs the reference of this alert */
  change: number | null;
  /** Estimated profit (+) or loss (−) if you sold all open items now, after tax */
  profitNow: number | null;
}

const pct = (v: number) => `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
const gp = (v: number) => Math.round(v).toLocaleString("de-CH");

/** No loss warning in the first minutes after a buy: thin margins would otherwise ping immediately */
export const LOSS_GRACE_MS = 15 * 60_000;

export function holdingSignals(trades: Trade[], rows: ReadonlyMap<number, MarketRow>, offset: number, cfg: HoldingAlertConfig, now = Date.now()): HoldingSignal[] {
  const out: HoldingSignal[] = [];
  for (const t of trades) {
    const s = computeFifo(t);
    if (s.openQty <= 0) continue;
    const row = rows.get(t.itemId);
    const sellNow = recommendedSellPrice(row?.high, offset);
    if (sellNow == null) continue;
    const cost = s.openCostBasis / s.openQty;
    const breakEven = breakEvenSellPrice(cost, t.itemId);
    const est = estimateOpenSale(s, sellNow);
    const profitNow = est?.profit ?? null;
    const base = { tradeId: t.id, itemId: t.itemId, itemName: t.itemName, openQty: s.openQty, sellNow, profitNow };
    const push = (kind: HoldingAlertKind, tone: "pos" | "neg", title: string, detail: string, reference: number | null, change: number | null) =>
      out.push({ ...base, key: `${t.id}:${kind}`, kind, tone, title, detail, reference, change });
    const pnl = profitNow != null ? ` Selling your ${s.openQty} now: ${profitNow >= 0 ? "profit" : "loss"} ${gp(Math.abs(profitNow))} gp.` : "";

    // 1) Against your expected sale price (or break-even / cost without one)
    const target = t.targetSell ?? null;
    if (target != null) {
      const ch = (sellNow - target) / target;
      if (ch >= cfg.upPct) push("above", "pos", `${t.itemName} is ${pct(ch)} above your expected price`, `Sell price now ${gp(sellNow)} vs expected ${gp(target)}.${pnl}`, target, ch);
      else if (ch >= 0) push("target", "pos", `${t.itemName} reached your expected price`, `Sell price now ${gp(sellNow)} (expected ${gp(target)}).${pnl}`, target, ch);
      else if (ch <= -cfg.downPct) push("below", "neg", `${t.itemName} dropped ${pct(ch)} below your expected price`, `Sell price now ${gp(sellNow)} vs expected ${gp(target)}.${pnl}`, target, ch);
    } else if (breakEven != null) {
      const up = (sellNow - breakEven) / breakEven;
      const down = (sellNow - cost) / cost;
      if (up >= cfg.upPct) push("above", "pos", `${t.itemName} is ${pct(up)} above break-even`, `Sell price now ${gp(sellNow)}, break-even ${gp(breakEven)}.${pnl}`, breakEven, up);
      else if (down <= -cfg.downPct) push("below", "neg", `${t.itemName} dropped ${pct(down)} below what you paid`, `Sell price now ${gp(sellNow)}, your cost ${gp(cost)}.${pnl}`, cost, down);
    }

    // 2) Selling now would lose money
    const lastBuy = t.lots.reduce((m, l) => Math.max(m, l.date), 0);
    if (cfg.lossWarning && now - lastBuy >= LOSS_GRACE_MS && breakEven != null && sellNow < breakEven && !out.some((x) => x.tradeId === t.id && x.kind === "below")) {
      push("loss", "neg", `${t.itemName}: selling now would lose money`, `Sell price now ${gp(sellNow)}, break-even ${gp(breakEven)}.${pnl}`, breakEven, (sellNow - breakEven) / breakEven);
    }

    // 3) Sudden move vs the last hour's average instant-buy
    const ref = row?.h1?.avgHigh ?? row?.d1?.avgHigh ?? null;
    if (ref != null && ref > 0 && row?.high != null) {
      const ch = (row.high - ref) / ref;
      const window = row.h1?.avgHigh != null ? "the last hour" : "the last 24 h";
      if (ch >= cfg.suddenPct) push("jump", "pos", `${t.itemName} jumped ${pct(ch)}`, `Last instant-buy ${gp(row.high)} vs ${gp(ref)} average over ${window}. You hold ${s.openQty}.${pnl}`, ref, ch);
      else if (ch <= -cfg.suddenPct) push("crash", "neg", `${t.itemName} fell ${pct(ch)}`, `Last instant-buy ${gp(row.high)} vs ${gp(ref)} average over ${window}. You hold ${s.openQty}.${pnl}`, ref, ch);
    }
  }
  // Most urgent first: drops/losses, then by size of the move
  return out.sort((a, b) => (a.tone === b.tone ? Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0) : a.tone === "neg" ? -1 : 1));
}

/** Signals that should notify now: not seen for this key within the cooldown. */
export function dueSignals(signals: HoldingSignal[], lastFired: ReadonlyMap<string, number>, now: number, cooldownMinutes: number): HoldingSignal[] {
  return signals.filter((s) => {
    const last = lastFired.get(s.key);
    return last == null || now - last >= cooldownMinutes * 60_000;
  });
}
