"use client";
import * as Popover from "@radix-ui/react-popover";
import { Bell, BellRing } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCandidates, useMarket, useRowMap } from "@/hooks/market";
import { dueSignals, holdingSignals, watchSignals, type HoldingSignal } from "@/lib/analysis/holding-alerts";
import { agoFromUnix } from "@/lib/format";
import { newId } from "@/lib/storage/db";
import { cn } from "@/lib/utils";
import { useDataStore } from "@/state/data";
import { useSettings } from "@/state/settings";
import { toast } from "@/state/toasts";

const PREFIX = "hold:";

export function useHoldingSignals(): HoldingSignal[] {
  const rows = useRowMap();
  const trades = useDataStore((s) => s.trades);
  const watchlist = useDataStore((s) => s.watchlist);
  const settings = useSettings();
  const cfg = settings.holdingAlerts;
  const { candidates } = useCandidates();
  const byId = useMemo(() => (watchlist.length ? new Map(candidates.map((c) => [c.id, c])) : new Map()), [candidates, watchlist.length]);
  return useMemo(() => {
    if (!cfg.enabled) return [];
    const held = holdingSignals(trades, rows, settings.priceOffset, cfg);
    return cfg.watchlist ? [...held, ...watchSignals(watchlist, byId)] : held;
  }, [trades, rows, settings.priceOffset, cfg, watchlist, byId]);
}

/** Short two-tone chime (Web Audio, no sound file needed). */
export function playChime(tone: "pos" | "neg") {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const notes = tone === "pos" ? [660, 880] : [660, 440];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.type = "sine";
      const t0 = ctx.currentTime + i * 0.16;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.15);
      o.connect(g).connect(ctx.destination);
      o.start(t0);
      o.stop(t0 + 0.16);
    });
    setTimeout(() => void ctx.close(), 600);
  } catch {
    /* audio blocked until the user interacts with the page */
  }
}

export function showDesktopNotification(s: Pick<HoldingSignal, "key" | "title" | "detail" | "itemId">, onClick?: () => void) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
  try {
    const n = new Notification(s.title, { body: s.detail, tag: s.key });
    n.onclick = () => {
      window.focus();
      onClick?.();
      n.close();
    };
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs in the background on every market refresh (every minute, also in background tabs):
 * new holding signals become an in-app toast, a chime and, if allowed, a desktop notification.
 * The same alert for the same trade repeats at most once per cooldown.
 */
export function HoldingAlertsWatcher() {
  const signals = useHoldingSignals();
  const loaded = useDataStore((s) => s.loaded);
  const events = useDataStore((s) => s.alertEvents);
  const addAlertEvents = useDataStore((s) => s.addAlertEvents);
  const settings = useSettings();
  const market = useMarket();
  const router = useRouter();
  const fired = useRef(new Map<string, number>());

  useEffect(() => {
    if (!loaded || !market.data || !settings.holdingAlerts.enabled || signals.length === 0) return;
    const last = new Map(fired.current);
    for (const e of events) {
      if (!e.alertId.startsWith(PREFIX)) continue;
      const k = e.alertId.slice(PREFIX.length);
      last.set(k, Math.max(last.get(k) ?? 0, e.at));
    }
    const now = Date.now();
    const due = dueSignals(signals, last, now, settings.holdingAlerts.cooldownMinutes);
    if (due.length === 0) return;
    for (const s of due) fired.current.set(s.key, now);
    void addAlertEvents(due.map((s) => ({ id: newId(), alertId: PREFIX + s.key, itemId: s.itemId, at: now, text: `${s.title}. ${s.detail}` })));
    due.slice(0, 3).forEach((s) => toast(`${s.title}. ${s.detail}`, s.tone === "pos" ? "pos" : "warn"));
    if (due.length > 3) toast(`+${due.length - 3} more price alerts – see the bell at the top.`, "neutral");
    if (settings.notificationsEnabled) for (const s of due.slice(0, 5)) showDesktopNotification(s, () => router.push(`/items/${s.itemId}`));
    if (settings.holdingAlerts.sound) playChime(due.some((s) => s.tone === "neg") ? "neg" : "pos");
    // Only react to new market data / signals, not to the events we just added
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signals, loaded, market.dataUpdatedAt]);

  return null;
}

export function HoldingAlertsBell() {
  const signals = useHoldingSignals();
  const events = useDataStore((s) => s.alertEvents);
  const [open, setOpen] = useState(false);
  const recent = useMemo(() => events.filter((e) => e.alertId.startsWith(PREFIX)).slice(0, 8), [events]);
  const neg = signals.some((s) => s.tone === "neg");
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            "relative flex size-9 items-center justify-center rounded-full border border-border bg-surface shadow-card hover:bg-surface-2",
            signals.length ? (neg ? "text-neg" : "text-pos") : "text-muted",
          )}
          aria-label={signals.length ? `${signals.length} price alerts on items you hold` : "Price alerts"}
          title="Price alerts on items you hold"
          data-testid="alerts-bell"
        >
          {signals.length ? <BellRing className="size-4" /> : <Bell className="size-4" />}
          {signals.length > 0 && (
            <span className={cn("absolute -right-1 -top-1 min-w-4 rounded-full px-1 text-center text-[10px] font-bold leading-4 text-white", neg ? "bg-neg" : "bg-pos")} data-testid="alerts-count">
              {signals.length}
            </span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} className="z-50 w-[min(92vw,380px)] rounded-lg border border-border bg-surface shadow-lg animate-fade-in" data-testid="alerts-panel">
          <div className="border-b border-border px-3 py-2">
            <div className="text-sm font-semibold">Price alerts</div>
            <div className="text-[11px] text-muted">Big moves on items you hold, and watchlist targets hit. Thresholds in Settings.</div>
          </div>
          <ul className="max-h-[50vh] divide-y divide-border overflow-y-auto">
            {signals.length === 0 && <li className="px-3 py-3 text-xs text-muted">Nothing unusual right now.</li>}
            {signals.map((s) => (
              <li key={s.key} className="px-3 py-2" data-testid="alert-item">
                <div className={cn("text-sm font-medium", s.tone === "pos" ? "text-pos" : "text-neg")}>{s.title}</div>
                <div className="text-xs text-muted">{s.detail}</div>
                <Link href={`/items/${s.itemId}`} onClick={() => setOpen(false)} className="text-xs text-accent underline">
                  Open item · log sale
                </Link>
              </li>
            ))}
          </ul>
          {recent.length > 0 && (
            <div className="border-t border-border px-3 py-2">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">Recent pings</div>
              <ul className="space-y-0.5 text-[11px] text-muted">
                {recent.map((e) => (
                  <li key={e.id} className="truncate" title={e.text}>
                    <span className="text-faint">{agoFromUnix(e.at / 1000)}</span> · {e.text}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="border-t border-border px-3 py-1.5 text-right">
            <Link href="/settings#holding-alerts" onClick={() => setOpen(false)} className="text-[11px] text-accent underline">Alert settings</Link>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
