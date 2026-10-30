"use client";
import { CalendarClock, Keyboard } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState, ErrorNote, InfoNote, PageHeader, Skeleton } from "@/components/common/indicators";
import { HistoryStatusNote } from "@/components/common/history-check";
import { MarketFilterBar } from "@/components/market/filter-bar";
import { MarketTable, VIEWS, type MarketView } from "@/components/market/market-table";
import { SidePanel } from "@/components/market/side-panel";
import { SlotPlanner } from "@/components/market/slot-planner";
import { useRowActions } from "@/components/market/use-row-actions";
import { TradeEditor } from "@/components/trades/trade-editor";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tip } from "@/components/ui/tooltip";
import { useMarket } from "@/hooks/market";
import { useMarketRows, type QtyBasis } from "@/hooks/market-rows";
import { useNow } from "@/hooks/use-now";
import { DEFAULT_SPEED_FILTERS, type SpeedFilters } from "@/lib/analysis/speed-filters";
import { useLocalState } from "@/lib/ui/use-local-state";

const STEP = 100;
const VIEW_KEYS = VIEWS.map((v) => v.key);

const SHORTCUTS: Array<[string, string]> = [
  ["↑ ↓  or  J K", "Move through the list"],
  ["Enter", "Open quick view"],
  ["Esc", "Close quick view"],
  ["W", "Add / remove watchlist"],
  ["L", "Log a trade"],
  ["D", "Not interested / show again"],
  ["/", "Search"],
  ["1 – 5", "Switch view"],
];

function ScannerInner() {
  const params = useSearchParams();
  const router = useRouter();
  const [f, setF] = useLocalState<SpeedFilters>("osrs-ge-flipper:market-filters:v1", DEFAULT_SPEED_FILTERS);
  const [prefs, setPrefs] = useLocalState<{ basis: QtyBasis; view: MarketView }>("osrs-ge-flipper:market-prefs:v1", { basis: "capital", view: "overview" });
  const urlView = params.get("view") as MarketView | null;
  const view: MarketView = urlView && VIEW_KEYS.includes(urlView) ? urlView : prefs.view;
  const setView = (v: MarketView) => {
    setPrefs({ ...prefs, view: v });
    if (urlView) router.replace("/scanner");
  };
  const [capital, setCapital] = useState<number | null>(null);
  const [show, setShow] = useState(STEP);
  const [selected, setSelected] = useState<number | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [planning, setPlanning] = useState(false);
  const { all, shown, held, dismissed, outliers, isLoading, error, capital: cap } = useMarketRows(f, prefs.basis, capital);
  const market = useMarket();
  const now = useNow(30_000);
  const actions = useRowActions();
  const visible = shown.slice(0, show);
  const byId = useMemo(() => new Map(all.map((r) => [r.id, r])), [all]);
  const openRow = open != null ? byId.get(open) : undefined;
  const listRef = useRef<HTMLDivElement>(null);

  // Keyboard shortcuts (ignored while typing in a field or a dialog is open)
  const state = useRef({ visible, selected, open, view });
  useEffect(() => {
    state.current = { visible, selected, open, view };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
        if (e.key === "Escape") t.blur();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector("[role=dialog]")) return;
      const { visible: list, selected: sel, open: op } = state.current;
      const idx = list.findIndex((r) => r.id === sel);
      const cur = idx >= 0 ? list[idx] : undefined;
      const move = (d: number) => {
        const next = list[Math.min(list.length - 1, Math.max(0, (idx < 0 ? -1 : idx) + d))];
        if (!next) return;
        setSelected(next.id);
        if (op != null) setOpen(next.id);
        listRef.current?.querySelector(`[data-item-id="${next.id}"]`)?.scrollIntoView({ block: "nearest" });
      };
      const k = e.key.toLowerCase();
      if (k === "arrowdown" || k === "j") { e.preventDefault(); move(1); }
      else if (k === "arrowup" || k === "k") { e.preventDefault(); move(-1); }
      else if (k === "enter" && cur) { e.preventDefault(); setOpen(cur.id); }
      else if (k === "escape") setOpen(null);
      else if (k === "w" && cur) void actions.watch(cur);
      else if (k === "l" && cur) actions.log(cur);
      else if (k === "d" && cur) actions.dismiss(cur);
      else if (k === "/") { e.preventDefault(); (document.querySelector('[data-testid="scanner-search"]') as HTMLInputElement | null)?.focus(); }
      else if (/^[1-5]$/.test(k)) setView(VIEW_KEYS[Number(k) - 1]!);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions.watched.size, prefs]);

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Flip Scanner"
        description="Every traded item with profit, speed, returns and price-history signals in one list. Pick a preset, filter, then click a row for the quick view."
        actions={
          <div className="flex items-center gap-2">
            <Tip content={<ul className="space-y-0.5">{SHORTCUTS.map(([k, d]) => <li key={k}><span className="num font-semibold">{k}</span> · {d}</li>)}</ul>}>
              <span className="inline-flex cursor-help items-center gap-1 text-xs text-muted"><Keyboard className="size-4" /> Shortcuts</span>
            </Tip>
            <Button variant="outline" onClick={() => setPlanning(true)} data-testid="open-planner">
              <CalendarClock /> Plan my slots
            </Button>
          </div>
        }
      />

      <Card className="mb-3">
        <CardBody>
          <MarketFilterBar f={f} setF={(n) => { setF(n); setShow(STEP); }} basis={prefs.basis} setBasis={(b) => setPrefs({ ...prefs, basis: b })} capital={capital} setCapital={setCapital} all={all} outliers={outliers} testPrefix="scanner" />
        </CardBody>
      </Card>

      <div className="mb-2 empty:hidden"><HistoryStatusNote /></div>
      {market.data && market.data.meta.day.blocksLoaded < 24 && (
        <div className="mb-2"><InfoNote tone="warn">The 24h history is still loading ({market.data.meta.day.blocksLoaded}/24 hours). Volume, risk and quality are less reliable until then.</InfoNote></div>
      )}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
          <Tabs value={view} onValueChange={(v) => setView(v as MarketView)}>
            <TabsList aria-label="View">
              {VIEWS.map((v, i) => (
                <TabsTrigger key={v.key} value={v.key} title={`${v.hint} (${i + 1})`} data-testid={`view-${v.key}`}>{v.label}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <span className="text-xs text-muted" data-testid="scanner-count">
            {shown.length.toLocaleString("de-CH")} of {all.length.toLocaleString("de-CH")} items
          </span>
        </div>
        <div ref={listRef}>
          {error && !all.length ? (
            <div className="p-4"><ErrorNote>Market data could not be loaded: {error.message}. No substitute data is shown.</ErrorNote></div>
          ) : isLoading ? (
            <div className="space-y-2 p-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-7 w-full" />)}</div>
          ) : visible.length === 0 ? (
            <EmptyState title="No items match the filters" action={<Button size="sm" variant="outline" onClick={() => setF({ ...DEFAULT_SPEED_FILTERS, query: f.query, sort: f.sort })}>Reset filters</Button>}>
              Loosen a filter or pick another preset.
            </EmptyState>
          ) : (
            <MarketTable
              rows={visible}
              view={view}
              selected={selected}
              onSelect={setSelected}
              onOpen={(id) => { setSelected(id); setOpen(id); }}
              watched={actions.watched}
              held={held}
              dismissed={dismissed}
              onWatch={(r) => void actions.watch(r)}
              onDismiss={actions.dismiss}
            />
          )}
        </div>
        {shown.length > show && (
          <div className="border-t border-border px-3 py-2 text-center">
            <Button size="sm" variant="outline" onClick={() => setShow(show + STEP)} data-testid="show-more">Show {Math.min(STEP, shown.length - show)} more</Button>
          </div>
        )}
        <p className="border-t border-border px-3 py-2 text-[11px] text-faint">
          * Fill times assume you get the whole market flow on that side, a best case for comparing items. Estimates from the last observed prices, no guarantee your offers fill. Method: see Methodology.
        </p>
      </Card>

      {openRow && (
        <SidePanel
          row={openRow}
          nowSec={now / 1000}
          watched={actions.watched.has(openRow.id)}
          dismissed={dismissed.has(openRow.id)}
          held={held.has(openRow.id)}
          onClose={() => setOpen(null)}
          onLog={() => actions.log(openRow)}
          onWatch={() => void actions.watch(openRow)}
          onDismiss={() => actions.dismiss(openRow)}
        />
      )}
      {planning && <SlotPlanner rows={shown} capital={cap} open onOpenChange={setPlanning} />}
      {actions.editing && <TradeEditor key={actions.editing.draft.id + actions.editing.mode} initial={actions.editing.draft} mode={actions.editing.mode} open onOpenChange={(o) => !o && actions.setEditing(null)} />}
    </div>
  );
}

export default function ScannerPage() {
  return (
    <Suspense fallback={null}>
      <ScannerInner />
    </Suspense>
  );
}
