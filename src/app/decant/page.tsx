"use client";
import { ArrowRight, Calculator } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Age, EmptyState, ErrorNote, Est, Gp, InfoNote, PageHeader, Pct, Skeleton } from "@/components/common/indicators";
import { ItemIcon } from "@/components/common/item-icon";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { AmountInput, Field, Input, Select } from "@/components/ui/input";
import { Tip } from "@/components/ui/tooltip";
import { useBuyLimits } from "@/hooks/buy-limits";
import { useItems, useMarket, useRowMap } from "@/hooks/market";
import { useNow } from "@/hooks/use-now";
import { bestPerFamily, buildDecantRoutes, calcDecant, decantStep, type DecantFamily, type DecantRoute } from "@/lib/analysis/decant";
import { gp, gpShort, num } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useSettings } from "@/state/settings";

type SortKey = "profit" | "perDose" | "roi";

interface CalcState {
  family: string;
  fromDose: number;
  toDose: number;
  qty: number | null;
  buy: number | null;
  sell: number | null;
}

function DoseLadder({ f, highlight }: { f: DecantFamily; highlight?: { from: number; to: number } }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {f.variants.map((v) => (
        <div
          key={v.id}
          className={cn(
            "rounded-md border px-2 py-1 text-[11px]",
            highlight?.from === v.dose ? "border-info bg-info-soft" : highlight?.to === v.dose ? "border-pos bg-pos-soft" : "border-border bg-surface-2",
          )}
        >
          <div className="font-semibold">({v.dose})</div>
          <div className="num text-muted">buy {v.buyPerDose != null ? gpShort(Math.round(v.buyPerDose)) : "–"}/dose</div>
          <div className="num text-muted">sell {v.netSellPerDose != null ? gpShort(Math.round(v.netSellPerDose)) : "–"}/dose</div>
        </div>
      ))}
    </div>
  );
}

function DecantCalculator({ families, state, setState }: { families: DecantFamily[]; state: CalcState | null; setState: (s: CalcState) => void }) {
  if (!state) return null;
  const fam = families.find((f) => f.base === state.family);
  if (!fam) return null;
  const from = fam.variants.find((v) => v.dose === state.fromDose);
  const to = fam.variants.find((v) => v.dose === state.toDose);
  const res =
    state.qty != null && state.buy != null && state.sell != null && from && to && from.dose !== to.dose
      ? calcDecant({ fromDose: from.dose, toDose: to.dose, inputQty: state.qty, buyPrice: state.buy, sellPrice: state.sell, toItemId: to.id })
      : null;
  const step = from && to ? decantStep(from.dose, to.dose) : 1;
  const pick = (patch: Partial<CalcState>) => {
    const next = { ...state, ...patch };
    const f = families.find((x) => x.base === next.family) ?? fam;
    const nf = f.variants.find((v) => v.dose === next.fromDose) ?? f.variants[0];
    const nt = f.variants.find((v) => v.dose === next.toDose) ?? f.variants[f.variants.length - 1];
    // Picking a different potion or dose reloads the market prices for it
    if (patch.family != null || patch.fromDose != null) next.buy = nf?.estBuy ?? null;
    if (patch.family != null || patch.toDose != null) next.sell = nt?.estSell ?? null;
    if (patch.family != null) {
      next.fromDose = nf?.dose ?? 1;
      next.toDose = nt?.dose ?? 4;
    }
    setState(next);
  };

  return (
    <Card className="mb-3" data-testid="decant-calc">
      <CardHeader title="Decant calculator" description="Your own prices and quantity. Decanting is free at Bob Barter (GE) and Zahur (Prifddinas)." />
      <CardBody className="space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
          <div className="col-span-2">
            <Field label="Potion">
              <Select value={state.family} onChange={(e) => pick({ family: e.target.value })} aria-label="Potion" data-testid="decant-family">
                {families.map((f) => <option key={f.base} value={f.base}>{f.base}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Buy dose">
            <Select value={state.fromDose} onChange={(e) => pick({ fromDose: Number(e.target.value) })} aria-label="Buy dose" data-testid="decant-from">
              {fam.variants.map((v) => <option key={v.id} value={v.dose}>({v.dose})</option>)}
            </Select>
          </Field>
          <Field label="Decant into">
            <Select value={state.toDose} onChange={(e) => pick({ toDose: Number(e.target.value) })} aria-label="Decant into" data-testid="decant-to">
              {fam.variants.map((v) => <option key={v.id} value={v.dose}>({v.dose})</option>)}
            </Select>
          </Field>
          <Field label="Buy price (each)"><AmountInput value={state.buy} onChange={(v) => setState({ ...state, buy: v })} aria-label="Buy price" data-testid="decant-buy" /></Field>
          <Field label="Sell price (each)"><AmountInput value={state.sell} onChange={(v) => setState({ ...state, sell: v })} aria-label="Sell price" data-testid="decant-sell" /></Field>
          <Field label="Potions to buy" hint={step > 1 ? `Multiples of ${step} leave no spare doses` : undefined}>
            <AmountInput value={state.qty} onChange={(v) => setState({ ...state, qty: v })} aria-label="Potions to buy" data-testid="decant-qty" />
          </Field>
          {from?.limit != null && (
            <div className="flex items-end">
              <Button size="sm" variant="outline" onClick={() => setState({ ...state, qty: Math.floor(from.limit! / step) * step })}>Use buy limit ({gp(from.limit)})</Button>
            </div>
          )}
        </div>
        <DoseLadder f={fam} highlight={{ from: state.fromDose, to: state.toDose }} />
        {from && to && from.dose === to.dose ? (
          <InfoNote>Pick two different doses.</InfoNote>
        ) : res ? (
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4" data-testid="decant-result">
            <div><span className="text-muted">You get</span> <span className="num font-semibold">{gp(res.outputQty)} × ({to?.dose})</span></div>
            <div><span className="text-muted">Cost</span> <Gp value={res.cost} /></div>
            <div><span className="text-muted">Revenue</span> <Gp value={res.revenue} /></div>
            <div><span className="text-muted">GE tax</span> <Gp value={res.tax} /></div>
            <div><span className="text-muted">Profit</span> <Gp value={res.profit} colored className="font-semibold" /></div>
            <div><span className="text-muted">ROI</span> <Pct value={res.roi} /></div>
            <div><span className="text-muted">Per potion bought</span> <Gp value={res.inputQty ? Math.round(res.profit / res.inputQty) : null} colored /></div>
            {res.leftoverDose > 0 && <div className="text-warn">+ one spare ({res.leftoverDose}) potion, not counted</div>}
          </div>
        ) : (
          <InfoNote>Enter prices and a quantity.</InfoNote>
        )}
      </CardBody>
    </Card>
  );
}

export default function DecantPage() {
  const items = useItems();
  const market = useMarket();
  const rows = useRowMap();
  const settings = useSettings();
  const now = useNow(30_000);
  const { used } = useBuyLimits();
  const [capital, setCapital] = useState<number | null>(null);
  const [bestOnly, setBestOnly] = useState(true);
  const [profitableOnly, setProfitableOnly] = useState(true);
  const [sort, setSort] = useState<SortKey>("profit");
  const [query, setQuery] = useState("");
  const [calc, setCalc] = useState<CalcState | null>(null);
  const cap = capital ?? settings.defaultCapital;

  const { families, routes } = useMemo(() => {
    if (!items.data) return { families: [], routes: [] };
    return buildDecantRoutes(items.data.items, rows, { offset: settings.priceOffset, nowSec: now / 1000, capital: cap, limitUsed: used });
  }, [items.data, rows, settings.priceOffset, now, cap, used]);

  const shown = useMemo(() => {
    let list: DecantRoute[] = bestOnly ? bestPerFamily(routes) : routes;
    if (profitableOnly) list = list.filter((r) => r.plan.profit > 0);
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((r) => r.family.toLowerCase().includes(q));
    const key = (r: DecantRoute) => (sort === "profit" ? r.plan.profit : sort === "perDose" ? r.profitPerDose : r.roi);
    return [...list].sort((a, b) => key(b) - key(a));
  }, [routes, bestOnly, profitableOnly, query, sort]);

  const openCalc = (r: DecantRoute) => {
    setCalc({ family: r.family, fromDose: r.from.dose, toDose: r.to.dose, qty: r.plan.inputQty || r.step, buy: r.from.estBuy, sell: r.to.estSell });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  // Until a route is picked, the calculator starts on the best route overall
  const top = shown[0] ?? bestPerFamily(routes).sort((a, b) => b.plan.profit - a.plan.profit)[0];
  const calcState = calc ?? (top ? { family: top.family, fromDose: top.from.dose, toDose: top.to.dose, qty: top.plan.inputQty || top.step, buy: top.from.estBuy, sell: top.to.estSell } : null);

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Decanting"
        description="Buy a potion at one dose, decant it into another for free, sell for more per dose. Prices are the last instant trades ± your offset, after GE tax."
      />
      {items.error || market.error ? (
        <ErrorNote>Market data unavailable: {(items.error ?? market.error)?.message}</ErrorNote>
      ) : items.isLoading || market.isLoading ? (
        <Skeleton className="h-60" />
      ) : (
        <>
          <DecantCalculator families={families} state={calcState} setState={setCalc} />
          <Card className="overflow-hidden">
            <CardHeader
              title="Decant routes"
              description={`${shown.length} route${shown.length === 1 ? "" : "s"} · quantity limited by buy limit left, capital and 25% of the output’s 24 h instant-buy volume`}
            />
            <CardBody className="grid grid-cols-2 gap-3 border-b border-border sm:grid-cols-5">
              <Field label="Capital (gp)"><AmountInput value={capital} onChange={setCapital} placeholder={gp(settings.defaultCapital)} aria-label="Capital" /></Field>
              <Field label="Search"><Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. prayer" aria-label="Search potions" /></Field>
              <Field label="Sort by">
                <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort by">
                  <option value="profit">Profit per buy limit</option>
                  <option value="perDose">Profit per dose</option>
                  <option value="roi">ROI</option>
                </Select>
              </Field>
              <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={bestOnly} onChange={(e) => setBestOnly(e.target.checked)} data-testid="decant-best-only" /> Best route per potion</label>
              <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={profitableOnly} onChange={(e) => setProfitableOnly(e.target.checked)} /> Profitable only</label>
            </CardBody>
            {shown.length === 0 ? (
              <EmptyState title="No routes match">Turn off “Profitable only” to see every dose combination.</EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table w-full text-sm" data-testid="decant-table">
                  <thead className="text-left text-[11px] uppercase tracking-wide text-muted">
                    <tr className="border-b border-border">
                      <th className="px-3 py-2 font-medium">Potion</th>
                      <th className="px-2 py-2 font-medium">Route</th>
                      <th className="px-2 py-2 text-right font-medium">Buy each<Est /></th>
                      <th className="px-2 py-2 text-right font-medium">Sell each<Est /></th>
                      <th className="px-2 py-2 text-right font-medium"><Tip content="Net profit per dose after tax"><span className="cursor-help">Per dose<Est /></span></Tip></th>
                      <th className="px-2 py-2 text-right font-medium">ROI</th>
                      <th className="px-2 py-2 text-right font-medium"><Tip content="Potions to buy → potions you sell"><span className="cursor-help">Qty</span></Tip></th>
                      <th className="px-2 py-2 text-right font-medium">Profit<Est /></th>
                      <th className="px-2 py-2 text-right font-medium"><Tip content="24 h volume: instant-sells of the input (fill your buy) / instant-buys of the output (fill your sell)"><span className="cursor-help">Vol. in / out</span></Tip></th>
                      <th className="px-2 py-2 text-right font-medium">Data age</th>
                      <th className="px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={`${r.from.id}-${r.to.id}`} className="border-b border-border/60 hover:bg-surface-2/60" data-testid="decant-row">
                        <td className="px-3 py-1.5">
                          <span className="flex items-center gap-2">
                            <ItemIcon icon={r.to.icon} name={r.to.name} size={20} />
                            <span>
                              <span className="block">{r.family}</span>
                              {r.to.taxExempt && <span className="block text-[10px] text-pos">tax-free</span>}
                            </span>
                          </span>
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          <Link href={`/items/${r.from.id}`} className="hover:text-accent">({r.from.dose})</Link>
                          <ArrowRight className="mx-1 inline size-3 text-faint" />
                          <Link href={`/items/${r.to.id}`} className="hover:text-accent">({r.to.dose})</Link>
                        </td>
                        <td className="px-2 py-1.5 text-right"><Gp value={r.from.estBuy} /></td>
                        <td className="px-2 py-1.5 text-right"><Gp value={r.to.estSell} /></td>
                        <td className="px-2 py-1.5 text-right"><Gp value={Math.round(r.profitPerDose)} colored /></td>
                        <td className="px-2 py-1.5 text-right"><Pct value={r.roi} /></td>
                        <td className="num px-2 py-1.5 text-right text-xs">{gp(r.plan.inputQty)} → {gp(r.plan.outputQty)}</td>
                        <td className="px-2 py-1.5 text-right font-semibold"><Gp value={r.plan.profit} colored /></td>
                        <td className="num px-2 py-1.5 text-right text-xs text-muted">{num(r.from.vol24hSells)} / {num(r.to.vol24hBuys)}</td>
                        <td className="px-2 py-1.5 text-right text-xs"><Age seconds={r.ageSec} /></td>
                        <td className="px-2 py-1.5">
                          <Button size="sm" variant="ghost" onClick={() => openCalc(r)} aria-label={`Calculate ${r.family}`} data-testid="decant-open-calc"><Calculator /></Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <p className="mt-2 text-[11px] text-faint">
            Estimates from the latest observed prices, no guarantee your offers fill. Thin markets and old prices are common for low-dose potions, so check the data age and volume before buying a full limit.
          </p>
        </>
      )}
    </div>
  );
}
