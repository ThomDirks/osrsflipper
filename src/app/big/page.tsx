"use client";
import { Check, Dices, Plus, X, Zap } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ErrorNote, Skeleton } from "@/components/common/indicators";
import { ItemIcon } from "@/components/common/item-icon";
import { playLockin, useBigTrades, useLockin } from "@/components/lockin/lockin";
import { DegenMode } from "@/components/lockin/degen-mode";
import { useRowActions } from "@/components/market/use-row-actions";
import { TradeEditor } from "@/components/trades/trade-editor";
import { Button } from "@/components/ui/button";
import { AmountInput, Field, Select } from "@/components/ui/input";
import { useNow } from "@/hooks/use-now";
import { LEVEL_NAME, type BigTrade } from "@/lib/analysis/big-trades";
import { gp, gpShort } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useSettings } from "@/state/settings";

const PROFITS = [100_000, 1_000_000, 5_000_000, 10_000_000, 25_000_000, 50_000_000, 100_000_000];
const VOLS = [0.01, 0.03, 0.05, 0.1, 0.2];

function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

function TradeCard({ t, rank, onLog }: { t: BigTrade; rank: number; onLog: () => void }) {
  const r = t.row;
  return (
    <li
      className={cn(
        "relative overflow-hidden rounded-xl border p-4",
        t.verified ? "border-accent/60 bg-surface shadow-[0_0_0_1px_var(--accent-soft),0_8px_32px_-8px_rgba(255,20,60,0.35)]" : "border-border bg-surface/60 opacity-75",
      )}
      data-testid="big-trade"
    >
      <div className="flex items-start gap-3">
        <span className="font-mono text-2xl font-black leading-none text-faint">#{rank}</span>
        <ItemIcon icon={r.icon} name={r.name} size={32} />
        <div className="min-w-0 flex-1">
          <Link href={`/items/${r.id}`} className="block truncate text-base font-extrabold uppercase tracking-wide hover:text-accent">{r.name}</Link>
          <div className="text-[11px] text-muted">
            {gp(r.qty)} × buy {gp(r.c.estBuy)} → sell {gp(r.c.estSell)} · uses {gpShort(r.capitalUsed)}
          </div>
        </div>
        <span
          className={cn(
            "-rotate-6 rounded border-2 px-1.5 py-0.5 font-mono text-[10px] font-black tracking-widest",
            t.verified ? "border-pos text-pos" : "border-warn text-warn",
          )}
          data-testid="big-stamp"
        >
          {t.verified ? "VERIFIED" : "UNVERIFIED"}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-1">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-muted">Profit, one flip</div>
          <div className="font-mono text-4xl font-black leading-none text-pos">+{gpShort(r.profit)}</div>
        </div>
        <div className="font-mono text-sm">
          <div className="text-muted">{t.ofCapital != null ? `${(t.ofCapital * 100).toFixed(1)}% of your capital` : ""}</div>
          <div className="text-muted">ROI {r.roi != null ? `${(r.roi * 100).toFixed(1)}%` : "–"} · swing {t.volatility != null ? `${(t.volatility * 100).toFixed(1)}%` : "–"}</div>
        </div>
      </div>

      <ul className="mt-3 grid gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2" data-testid="big-checks">
        {t.checks.map((c) => (
          <li key={c.key} className="flex items-start gap-1.5" title={c.detail}>
            {c.ok ? <Check className="mt-0.5 size-3.5 shrink-0 text-pos" /> : <X className="mt-0.5 size-3.5 shrink-0 text-neg" />}
            <span>
              <span className={c.ok ? "" : "text-neg"}>{c.label}</span> <span className="text-faint">· {c.detail}</span>
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex gap-2">
        <Button size="sm" variant="primary" onClick={onLog} data-testid="big-log"><Plus /> Log it</Button>
        <Button size="sm" variant="ghost" asChild><Link href={`/items/${r.id}`}>Chart</Link></Button>
      </div>
    </li>
  );
}

export default function BigTradesPage() {
  const [s, setS] = useLockin();
  const settings = useSettings();
  const [capital, setCapital] = useState<number | null>(null);
  const [degen, setDegen] = useState(false);
  const { trades, level, isLoading, error, capital: cap, historyLoaded } = useBigTrades(s, capital);
  const actions = useRowActions();
  const now = useNow(1000);
  const verified = trades.filter((t) => t.verified);
  const shown = s.showUnverified ? trades : verified;
  const best = verified[0]?.row.profit ?? 0;
  const total = verified.slice(0, settings.geSlots).reduce((a, t) => a + (t.row.profit ?? 0), 0);

  const toggle = () => {
    const on = !s.on;
    setS({ ...s, on, since: on ? Date.now() : null });
    if (settings.holdingAlerts.sound) playLockin(on);
  };

  return (
    <div className="animate-fade-in space-y-4 pb-10">
      {/* Hero */}
      <section className={cn("relative overflow-hidden rounded-2xl border p-5", s.on ? "border-accent/60 bg-[#0b0306]" : "border-border bg-surface")} data-testid="big-hero">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.35em] text-muted">Big Trades {s.on ? "· lock-in active" : ""}</div>
            <h1 className="mt-1 font-mono text-4xl font-black uppercase leading-none tracking-tight sm:text-5xl">
              <span className={cn(s.on && "lockin-glitch")} data-testid="lockin-level">Level {level}</span>
            </h1>
            <div className={cn("mt-1 font-mono text-lg font-bold uppercase tracking-widest", s.on ? "text-accent" : "text-muted")}>{LEVEL_NAME[level]}</div>
            <div className="lockin-meter mt-3 flex gap-1" aria-hidden>
              {[1, 2, 3, 4, 5].map((n) => (
                <span key={n} data-on={s.on && n <= level} className={cn("h-2.5 w-10 rounded-sm", n <= level ? (n >= 4 ? "bg-accent" : n === 3 ? "bg-warn" : "bg-pos") : "bg-surface-3")} />
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 font-mono text-sm sm:grid-cols-4">
            <div><div className="text-[10px] uppercase tracking-widest text-muted">Verified</div><div className="text-2xl font-black">{verified.length}</div></div>
            <div><div className="text-[10px] uppercase tracking-widest text-muted">Best flip</div><div className="text-2xl font-black text-pos">{best ? `+${gpShort(best)}` : "–"}</div></div>
            <div><div className="text-[10px] uppercase tracking-widest text-muted">Top {settings.geSlots} combined</div><div className="text-2xl font-black text-pos">{total ? `+${gpShort(total)}` : "–"}</div></div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted">{s.on ? "Locked in" : "Status"}</div>
              <div className="text-2xl font-black">{s.on && s.since ? clock(now - s.since) : "idle"}</div>
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <Button variant={s.on ? "outline" : "primary"} onClick={toggle} className={cn(!s.on && "font-black uppercase tracking-widest")} data-testid="big-lockin">
            <Zap /> {s.on ? "Leave lock-in" : "Lock in"}
          </Button>
          {s.on && <span className="lockin-blink font-mono text-xs font-bold text-accent">● 150 BPM</span>}
          {s.on && (
            <button
              type="button"
              onClick={() => setDegen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border-2 border-warn px-3 py-1.5 font-mono text-sm font-black uppercase tracking-widest text-warn hover:bg-warn-soft"
              data-testid="open-degen"
            >
              <Dices className="size-4" /> Degen mode
            </button>
          )}
          <div className="ml-auto grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Min. profit per flip">
              <Select value={s.minProfit} onChange={(e) => setS({ ...s, minProfit: Number(e.target.value) })} aria-label="Minimum profit" data-testid="big-min-profit">
                {PROFITS.map((p) => <option key={p} value={p}>{gpShort(p)}</option>)}
              </Select>
            </Field>
            <Field label="Min. price swing">
              <Select value={s.minVolatility} onChange={(e) => setS({ ...s, minVolatility: Number(e.target.value) })} aria-label="Minimum volatility" data-testid="big-min-vol">
                {VOLS.map((v) => <option key={v} value={v}>{v * 100}%</option>)}
              </Select>
            </Field>
            <Field label="Capital (gp)"><AmountInput value={capital} onChange={setCapital} placeholder={gp(settings.defaultCapital)} aria-label="Capital" /></Field>
            <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={s.showUnverified} onChange={(e) => setS({ ...s, showUnverified: e.target.checked })} data-testid="big-unverified" /> Show unverified ({trades.length - verified.length})</label>
          </div>
        </div>
      </section>

      <p className="text-xs text-muted">
        One-off flips on volatile items that make at least {gpShort(s.minProfit)} at a realistic quantity with your {gpShort(cap)} gp. <b className="text-text">Verified</b> means every check holds: fresh prices, both sides trading this hour, the gap still there at the last hour’s average prices, real volume behind your quantity, no single weird trade, and the item actually swings. Big gaps vanish fast, and volatile items can drop just as hard. Size it so a loss doesn’t hurt.
        {!historyLoaded && " The 30-day history is still loading, so daily swings aren’t in yet."}
      </p>

      {error ? (
        <ErrorNote>Market data unavailable: {error.message}</ErrorNote>
      ) : isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-56" />)}</div>
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center" data-testid="big-empty">
          <div className="font-mono text-xl font-black uppercase tracking-widest">Nothing life-changing right now</div>
          <p className="mt-1 text-sm text-muted">
            {trades.length > verified.length ? `${trades.length - verified.length} candidate${trades.length - verified.length === 1 ? "" : "s"} failed a check. Tick “Show unverified” to see why.` : `No item makes ${gpShort(s.minProfit)} in one flip with your capital. Lower the minimum profit or the swing, or stay locked in and wait.`}
          </p>
        </div>
      ) : (
        <ol className="grid gap-3 lg:grid-cols-2" data-testid="big-list">
          {shown.slice(0, 30).map((t, i) => <TradeCard key={t.row.id} t={t} rank={i + 1} onLog={() => actions.log(t.row)} />)}
        </ol>
      )}
      {degen && (
        <DegenMode
          onClose={() => setDegen(false)}
          onLog={(it) => {
            setDegen(false);
            actions.log({ ...it.row, qty: it.qty });
          }}
        />
      )}
      {actions.editing && <TradeEditor key={actions.editing.draft.id + actions.editing.mode} initial={actions.editing.draft} mode={actions.editing.mode} open onOpenChange={(o) => !o && actions.setEditing(null)} />}
    </div>
  );
}
