import { isTaxExempt } from "../tax/rules";
import { netSellPerItem, taxPerItem } from "../tax/tax";
import type { ItemMeta, MarketRow, TimeseriesPoint } from "../market/types";

/**
 * Pot decanting: buy a potion at one dose, decant it for free (Bob Barter at the GE, or Zahur in
 * Prifddinas) into another dose and sell that. Profit comes from dose variants trading at different
 * prices per dose.
 *
 * Prices follow the scanner convention: buy offer = last instant-sell + offset,
 * sell offer = last instant-buy − offset, GE tax on every sold potion.
 * Quantities are rounded so every bought dose ends up in a whole output potion (no leftovers).
 */

export interface DoseVariant {
  id: number;
  name: string;
  icon: string;
  dose: number;
  limit: number | null;
  estBuy: number | null;
  estSell: number | null;
  /** Sell price after tax */
  netSell: number | null;
  buyPerDose: number | null;
  netSellPerDose: number | null;
  /** 24 h instant-sell volume (fills your buy offers) */
  vol24hSells: number;
  /** 24 h instant-buy volume (fills your sell offers) */
  vol24hBuys: number;
  /** Age of the older of both latest prices (seconds) */
  ageSec: number | null;
  taxExempt: boolean;
}

export interface DecantFamily {
  /** Name without the dose suffix, e.g. "Prayer potion" */
  base: string;
  variants: DoseVariant[];
}

export interface DecantResult {
  inputQty: number;
  outputQty: number;
  doses: number;
  cost: number;
  revenue: number;
  tax: number;
  profit: number;
  roi: number | null;
}

export interface DecantRoute {
  family: string;
  from: DoseVariant;
  to: DoseVariant;
  /** Net profit per dose moved */
  profitPerDose: number;
  roi: number;
  /** Smallest input quantity that decants without leftover doses */
  step: number;
  /** Planned trade: limited by buy limit (left), capital and output market volume */
  plan: DecantResult;
  /** Planned output as share of the output potion's 24 h instant-buy volume */
  outputShareOfVolume: number | null;
  ageSec: number | null;
}

const DOSE_RE = /^(.+?)\s?\((\d+)\)$/;
/** Dose-suffixed items that are not decantable potions (charges, containers, mixes) */
const NOT_POTION = /(amulet|necklace|ring|bracelet|pendant|glory|skills|games|burning|waterskin|watering can|mix$)/i;

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Groups tradeable potions by base name. Families with any dose above 4 or a (0) variant are not potions. */
export function findFamilies(items: ItemMeta[]): Map<string, ItemMeta[]> {
  const byBase = new Map<string, Array<{ item: ItemMeta; dose: number }>>();
  for (const item of items) {
    const m = DOSE_RE.exec(item.name);
    if (!m) continue;
    const base = (m[1] as string).trim();
    const dose = Number(m[2]);
    const list = byBase.get(base) ?? [];
    list.push({ item, dose });
    byBase.set(base, list);
  }
  const out = new Map<string, ItemMeta[]>();
  for (const [base, list] of byBase) {
    if (NOT_POTION.test(base)) continue;
    if (list.some((v) => v.dose < 1 || v.dose > 4)) continue;
    const doses = new Set(list.map((v) => v.dose));
    if (doses.size < 2) continue;
    out.set(base, list.sort((a, b) => a.dose - b.dose).map((v) => v.item));
  }
  return out;
}

export function doseOf(name: string): number | null {
  const m = DOSE_RE.exec(name);
  return m ? Number(m[2]) : null;
}

export function buildVariant(item: ItemMeta, row: MarketRow | undefined, offset: number, nowSec: number): DoseVariant {
  const dose = doseOf(item.name) ?? 1;
  const estBuy = row?.low != null ? row.low + offset : null;
  const estSell = row?.high != null ? Math.max(1, row.high - offset) : null;
  const netSell = estSell != null ? netSellPerItem(estSell, item.id) : null;
  const times = [row?.highTime, row?.lowTime].filter((t): t is number => t != null);
  return {
    id: item.id,
    name: item.name,
    icon: item.icon,
    dose,
    limit: item.limit,
    estBuy,
    estSell,
    netSell,
    buyPerDose: estBuy != null ? estBuy / dose : null,
    netSellPerDose: netSell != null ? netSell / dose : null,
    vol24hSells: row?.d1?.volLow ?? 0,
    vol24hBuys: row?.d1?.volHigh ?? 0,
    ageSec: times.length === 2 ? nowSec - Math.min(...times) : null,
    taxExempt: isTaxExempt(item.id),
  };
}

/** Smallest number of input potions that turns into whole output potions. */
export function decantStep(fromDose: number, toDose: number): number {
  return toDose / gcd(fromDose, toDose);
}

/**
 * Exact result of decanting `inputQty` potions of `fromDose` into `toDose`.
 * Leftover doses (if inputQty is not a multiple of the step) become one smaller potion that is
 * reported in `leftoverDose` and not counted as revenue.
 */
export function calcDecant(opts: { fromDose: number; toDose: number; inputQty: number; buyPrice: number; sellPrice: number; toItemId?: number | null }): DecantResult & { leftoverDose: number } {
  const qty = Math.max(0, Math.floor(opts.inputQty));
  const doses = qty * opts.fromDose;
  const outputQty = Math.floor(doses / opts.toDose);
  const leftoverDose = doses - outputQty * opts.toDose;
  const cost = qty * Math.floor(opts.buyPrice);
  const tax = taxPerItem(opts.sellPrice, opts.toItemId) * outputQty;
  const revenue = outputQty * Math.floor(opts.sellPrice);
  const profit = revenue - tax - cost;
  return { inputQty: qty, outputQty, doses, cost, revenue, tax, profit, roi: cost > 0 ? profit / cost : null, leftoverDose };
}

export interface DecantContext {
  offset: number;
  nowSec: number;
  capital: number;
  /** Already used buy limit per item in the current 4 h window */
  limitUsed?: ReadonlyMap<number, number>;
  /** Cap planned output at this share of the output's 24 h instant-buy volume (default 25 %) */
  maxVolumeShare?: number;
}

export function buildDecantRoutes(items: ItemMeta[], rows: ReadonlyMap<number, MarketRow>, ctx: DecantContext): { families: DecantFamily[]; routes: DecantRoute[] } {
  const families: DecantFamily[] = [];
  const routes: DecantRoute[] = [];
  const maxShare = ctx.maxVolumeShare ?? 0.25;
  for (const [base, list] of findFamilies(items)) {
    const variants = list.map((it) => buildVariant(it, rows.get(it.id), ctx.offset, ctx.nowSec));
    families.push({ base, variants });
    for (const from of variants) {
      for (const to of variants) {
        if (from.id === to.id || from.estBuy == null || to.estSell == null || to.netSell == null) continue;
        const profitPerDose = (to.netSell / to.dose) - (from.estBuy / from.dose);
        const step = decantStep(from.dose, to.dose);
        const limitLeft = from.limit != null ? Math.max(0, from.limit - (ctx.limitUsed?.get(from.id) ?? 0)) : Infinity;
        const byCapital = Math.floor(ctx.capital / from.estBuy);
        // Output we can realistically sell: a share of the daily instant-buy flow, converted back to inputs
        const byVolume = Math.floor((to.vol24hBuys * maxShare * to.dose) / from.dose);
        let qty = Math.min(limitLeft, byCapital, byVolume);
        if (!Number.isFinite(qty)) qty = 0;
        qty = Math.floor(qty / step) * step;
        const plan = calcDecant({ fromDose: from.dose, toDose: to.dose, inputQty: qty, buyPrice: from.estBuy, sellPrice: to.estSell, toItemId: to.id });
        const ages = [from.ageSec, to.ageSec].filter((a): a is number => a != null);
        routes.push({
          family: base,
          from,
          to,
          profitPerDose,
          roi: profitPerDose / (from.estBuy / from.dose),
          step,
          plan,
          outputShareOfVolume: to.vol24hBuys > 0 ? plan.outputQty / to.vol24hBuys : null,
          ageSec: ages.length ? Math.max(...ages) : null,
        });
      }
    }
  }
  families.sort((a, b) => a.base.localeCompare(b.base));
  return { families, routes };
}

/** Best route (highest planned profit, then profit per dose) per family. */
export function bestPerFamily(routes: DecantRoute[]): DecantRoute[] {
  const best = new Map<string, DecantRoute>();
  for (const r of routes) {
    const cur = best.get(r.family);
    if (!cur || r.plan.profit > cur.plan.profit || (r.plan.profit === cur.plan.profit && r.profitPerDose > cur.profitPerDose)) best.set(r.family, r);
  }
  return [...best.values()];
}

export interface DosePoint {
  time: number;
  /** Avg instant-sell of the input ÷ its dose: what buying costs per dose */
  buyPerDose: number | null;
  /** (Avg instant-buy of the output − tax) ÷ its dose: what selling earns per dose */
  sellNetPerDose: number | null;
  marginPerDose: number | null;
}

export interface DoseHistoryStats {
  points: number;
  avgMargin: number | null;
  minMargin: number | null;
  maxMargin: number | null;
  /** Share of time steps (with both prices) where the route was profitable */
  profitableShare: number | null;
}

/**
 * Lines up the input's and output's /timeseries by timestamp and converts both to per-dose prices.
 * Steps where either side has no trades stay empty (not interpolated).
 */
export function alignDoseHistory(
  input: TimeseriesPoint[],
  output: TimeseriesPoint[],
  fromDose: number,
  toDose: number,
  toItemId?: number | null,
): { series: DosePoint[]; stats: DoseHistoryStats } {
  const outByTs = new Map(output.map((p) => [p.timestamp, p]));
  const times = [...new Set([...input.map((p) => p.timestamp), ...output.map((p) => p.timestamp)])].sort((a, b) => a - b);
  const inByTs = new Map(input.map((p) => [p.timestamp, p]));
  const series: DosePoint[] = [];
  const margins: number[] = [];
  for (const t of times) {
    const i = inByTs.get(t);
    const o = outByTs.get(t);
    const buyPerDose = i?.avgLowPrice != null ? i.avgLowPrice / fromDose : null;
    const sellNetPerDose = o?.avgHighPrice != null ? (o.avgHighPrice - taxPerItem(o.avgHighPrice, toItemId)) / toDose : null;
    const marginPerDose = buyPerDose != null && sellNetPerDose != null ? sellNetPerDose - buyPerDose : null;
    if (marginPerDose != null) margins.push(marginPerDose);
    series.push({ time: t, buyPerDose, sellNetPerDose, marginPerDose });
  }
  const n = margins.length;
  return {
    series,
    stats: {
      points: n,
      avgMargin: n ? margins.reduce((a, b) => a + b, 0) / n : null,
      minMargin: n ? Math.min(...margins) : null,
      maxMargin: n ? Math.max(...margins) : null,
      profitableShare: n ? margins.filter((m) => m > 0).length / n : null,
    },
  };
}

/**
 * Trade-log entry for a decant: logged on the OUTPUT potion (that's what you sell later),
 * at your cost per output potion. Integer prices: the rounding remainder goes into fees so the
 * total cost is exact. The source records what you really bought (for the buy limit).
 */
export function decantLot(opts: { fromId: number; fromName: string; inputQty: number; buyPrice: number; outputQty: number }) {
  const cost = Math.floor(opts.inputQty) * Math.floor(opts.buyPrice);
  const price = Math.max(1, Math.floor(cost / opts.outputQty));
  const fees = Math.max(0, cost - price * opts.outputQty);
  return {
    quantity: opts.outputQty,
    price,
    fees,
    decantFrom: { itemId: opts.fromId, itemName: opts.fromName, quantity: Math.floor(opts.inputQty), price: Math.floor(opts.buyPrice) },
  };
}
