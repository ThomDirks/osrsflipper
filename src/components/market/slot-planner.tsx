"use client";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Gp, InfoNote, Pct } from "@/components/common/indicators";
import { ItemIcon } from "@/components/common/item-icon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { AmountInput, Field, Select } from "@/components/ui/input";
import type { SpeedRow } from "@/lib/analysis/speed";
import { planSlots, planTotals, type PlannedFlip } from "@/lib/analysis/slot-planner";
import { gp } from "@/lib/format";
import { computeFifo } from "@/lib/portfolio/fifo";
import type { Trade } from "@/lib/portfolio/schemas";
import { newId } from "@/lib/storage/db";
import { netSellPerItem } from "@/lib/tax/tax";
import { useDataStore } from "@/state/data";
import { useSettings } from "@/state/settings";
import { toast } from "@/state/toasts";

const SHARES = [0.125, 0.25, 0.334, 0.5, 1];

/**
 * Optional helper: suggests one flip per free GE slot from the current list (same filters and sort),
 * lets you edit or drop each line, then logs them all as buy offers in one go.
 */
export function SlotPlanner({ rows, capital, open, onOpenChange }: { rows: SpeedRow[]; capital: number; open: boolean; onOpenChange: (o: boolean) => void }) {
  const settings = useSettings();
  const trades = useDataStore((s) => s.trades);
  const saveTrades = useDataStore((s) => s.saveTrades);
  const busy = useMemo(() => trades.filter((t) => computeFifo(t).openQty > 0 || t.offers.length > 0), [trades]);
  const exclude = useMemo(() => new Set(busy.map((t) => t.itemId)), [busy]);
  const freeSlots = Math.max(0, settings.geSlots - busy.length);
  const [slots, setSlots] = useState(freeSlots);
  const [budget, setBudget] = useState<number | null>(capital);
  const [share, setShare] = useState(0.25);
  const suggest = (n = slots, b = budget ?? capital, s = share) => planSlots(rows, { capital: b, slots: n, exclude, maxItemShare: s });
  const [plan, setPlan] = useState<PlannedFlip[]>(() => suggest());
  const [saving, setSaving] = useState(false);
  const totals = planTotals(plan);

  const rebuild = (n: number, b: number | null, s: number) => setPlan(suggest(n, b ?? capital, s));
  const edit = (i: number, patch: Partial<PlannedFlip>) => setPlan((p) => p.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const addNext = () => {
    const taken = new Set([...exclude, ...plan.map((p) => p.id)]);
    const next = planSlots(rows, { capital: Math.max(0, (budget ?? capital) - totals.cost), slots: 1, exclude: taken, maxItemShare: 1 })[0];
    if (next) setPlan([...plan, next]);
    else toast("No more items fit the remaining budget and filters.");
  };

  const logAll = async () => {
    setSaving(true);
    const now = Date.now();
    const list: Trade[] = plan
      .filter((p) => p.qty > 0 && p.buy > 0)
      .map((p) => ({
        id: newId(),
        itemId: p.id,
        itemName: p.name,
        createdAt: now,
        updatedAt: now,
        lots: [],
        sales: [],
        offers: [{ id: newId(), date: now, quantity: Math.floor(p.qty), price: Math.floor(p.buy) }],
        notes: "From the slot planner",
        history: [],
        targetSell: Math.floor(p.sell),
      }));
    const res = await saveTrades(list, "created", "Buy offer from the slot planner");
    setSaving(false);
    if (!res.ok) return toast(res.errors.join(" · "), "neg");
    toast(`${list.length} buy offers logged. Once they fill, click “Filled → buy” in Flip History.`, "pos");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Plan my GE slots"
        description="One flip per free slot from your current list, filters and sort. Change anything, drop what you don’t want, or just close this: nothing is logged until you click the button."
        className="max-w-4xl"
      >
        <div className="space-y-3" data-testid="slot-planner">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Slots to fill" hint={`${busy.length} of ${settings.geSlots} in use`}>
              <Select value={slots} onChange={(e) => { const n = Number(e.target.value); setSlots(n); rebuild(n, budget, share); }} aria-label="Slots to fill" data-testid="planner-slots">
                {Array.from({ length: settings.geSlots + 1 }, (_, i) => <option key={i} value={i}>{i}</option>)}
              </Select>
            </Field>
            <Field label="Budget (gp)">
              <AmountInput value={budget} onChange={(v) => { setBudget(v); rebuild(slots, v, share); }} aria-label="Budget" />
            </Field>
            <Field label="Max. in one item">
              <Select value={share} onChange={(e) => { const s = Number(e.target.value); setShare(s); rebuild(slots, budget, s); }} aria-label="Max share per item">
                {SHARES.map((s) => <option key={s} value={s}>{Math.round(s * 100)}% of budget</option>)}
              </Select>
            </Field>
            <div className="flex items-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => rebuild(slots, budget, share)}><RotateCcw /> Re-plan</Button>
            </div>
          </div>

          {freeSlots === 0 && <InfoNote tone="warn">All {settings.geSlots} GE slots are in use (open trades or offers). You can still plan, e.g. for when they finish.</InfoNote>}
          {plan.length === 0 ? (
            <InfoNote>Nothing fits: loosen the filters, raise the budget or allow more per item.</InfoNote>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-[11px] uppercase tracking-wide text-muted">
                  <tr className="border-b border-border">
                    <th className="py-1.5 pr-2 font-medium">Item</th>
                    <th className="px-2 py-1.5 font-medium">Quantity</th>
                    <th className="px-2 py-1.5 font-medium">Buy each</th>
                    <th className="px-2 py-1.5 font-medium">Expected sale</th>
                    <th className="px-2 py-1.5 text-right font-medium">Cost</th>
                    <th className="px-2 py-1.5 text-right font-medium">Profit</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {plan.map((p, i) => {
                    const profit = p.qty * (netSellPerItem(p.sell, p.id) - p.buy);
                    return (
                      <tr key={p.id} className="border-b border-border/60" data-testid="planner-row">
                        <td className="py-1.5 pr-2">
                          <span className="flex items-center gap-2"><ItemIcon icon={p.icon} name={p.name} size={18} /><span className="truncate">{p.name}</span></span>
                        </td>
                        <td className="w-28 px-2 py-1.5"><AmountInput value={p.qty} onChange={(v) => edit(i, { qty: v ?? 0 })} aria-label={`Quantity ${p.name}`} data-testid="planner-qty" /></td>
                        <td className="w-32 px-2 py-1.5"><AmountInput value={p.buy} onChange={(v) => edit(i, { buy: v ?? 0 })} aria-label={`Buy price ${p.name}`} /></td>
                        <td className="w-32 px-2 py-1.5"><AmountInput value={p.sell} onChange={(v) => edit(i, { sell: v ?? 0 })} aria-label={`Expected sale ${p.name}`} /></td>
                        <td className="px-2 py-1.5 text-right"><Gp value={p.qty * p.buy} short /></td>
                        <td className="px-2 py-1.5 text-right"><Gp value={profit} colored short /></td>
                        <td className="py-1.5 pl-1">
                          <Button size="icon" variant="ghost" onClick={() => setPlan(plan.filter((_, j) => j !== i))} aria-label={`Remove ${p.name}`} data-testid="planner-remove"><Trash2 /></Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm" data-testid="planner-totals">
            <span>{plan.length} flip{plan.length === 1 ? "" : "s"}</span>
            <span>Capital <Gp value={totals.cost} /> of {gp(budget ?? capital)}</span>
            <span>Est. profit <Gp value={totals.profit} colored /></span>
            <span>Return <Pct value={totals.roi} /></span>
            {totals.cost > (budget ?? capital) && <span className="text-neg">Over budget</span>}
          </div>

          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="outline" size="sm" onClick={addNext} disabled={plan.length >= settings.geSlots}><Plus /> Add next best</Button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Close without logging</Button>
              <Button variant="primary" onClick={logAll} disabled={saving || plan.length === 0} data-testid="planner-log">
                Log {plan.length} buy offer{plan.length === 1 ? "" : "s"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
