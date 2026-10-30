import { netSellPerItem } from "../tax/tax";
import type { SpeedRow } from "./speed";

export interface PlannedFlip {
  id: number;
  name: string;
  icon: string;
  qty: number;
  buy: number;
  sell: number;
  /** Planned quantity before your edits (for "reset") */
  suggestedQty: number;
  limit: number | null;
}

export interface PlanTotals {
  cost: number;
  profit: number;
  roi: number | null;
}

/**
 * Fills your free GE slots from the (already filtered and sorted) list: one item per slot, no items
 * you already hold or have offers for, nothing marked as an outlier or with no margin, and at most
 * `maxItemShare` of your capital in any single item.
 */
export function planSlots(
  rows: SpeedRow[],
  opts: { capital: number; slots: number; exclude: ReadonlySet<number>; maxItemShare: number },
): PlannedFlip[] {
  const out: PlannedFlip[] = [];
  let remaining = opts.capital;
  const perItem = opts.capital * opts.maxItemShare;
  for (const r of rows) {
    if (out.length >= opts.slots) break;
    if (opts.exclude.has(r.id) || r.outlier) continue;
    const buy = r.c?.estBuy ?? r.price;
    const sell = r.c?.estSell;
    if (buy == null || sell == null || (r.netMargin ?? 0) <= 0) continue;
    const qty = Math.min(r.qty, Math.floor(Math.min(perItem, remaining) / buy));
    if (qty < 1) continue;
    out.push({ id: r.id, name: r.name, icon: r.icon, qty, buy, sell, suggestedQty: qty, limit: r.limit });
    remaining -= qty * buy;
  }
  return out;
}

export function planTotals(plan: PlannedFlip[]): PlanTotals {
  let cost = 0, profit = 0;
  for (const p of plan) {
    cost += p.qty * p.buy;
    profit += p.qty * (netSellPerItem(p.sell, p.id) - p.buy);
  }
  return { cost, profit, roi: cost > 0 ? profit / cost : null };
}
