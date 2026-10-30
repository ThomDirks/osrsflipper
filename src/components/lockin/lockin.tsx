"use client";
import { Zap } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { useMarketRows } from "@/hooks/market-rows";
import { DEFAULT_BIG, findBigTrades, lockinLevel } from "@/lib/analysis/big-trades";
import { DEFAULT_SPEED_FILTERS, type SpeedFilters } from "@/lib/analysis/speed-filters";
import { gpShort } from "@/lib/format";
import { useLocalState } from "@/lib/ui/use-local-state";
import { cn } from "@/lib/utils";
import { useSettings } from "@/state/settings";

export interface LockinState {
  on: boolean;
  /** When the current session started (ms) */
  since: number | null;
  minProfit: number;
  minVolatility: number;
  showUnverified: boolean;
}

export const DEFAULT_LOCKIN: LockinState = { on: false, since: null, minProfit: DEFAULT_BIG.minProfit, minVolatility: DEFAULT_BIG.minVolatility, showUnverified: false };

export function useLockin() {
  return useLocalState<LockinState>("osrs-ge-flipper:lockin:v1", DEFAULT_LOCKIN);
}

/** Rows for Big Trades: everything within reason at your whole capital (one-off buy, not split over slots). */
export const BIG_FILTERS: SpeedFilters = { ...DEFAULT_SPEED_FILTERS, minVolume: null, plausibleOnly: false, sort: "profit" };

export function useBigTrades(state: LockinState, capitalOverride: number | null = null) {
  const market = useMarketRows(BIG_FILTERS, "capital", capitalOverride);
  const trades = useMemo(
    () => findBigTrades(market.all.filter((r) => !market.dismissed.has(r.id)), { ...DEFAULT_BIG, minProfit: state.minProfit, minVolatility: state.minVolatility, capital: market.capital }),
    [market.all, market.dismissed, market.capital, state.minProfit, state.minVolatility],
  );
  return { ...market, trades, level: lockinLevel(trades) };
}

/* ---------------- sound: a synthesised hardstyle kick, no files ---------------- */

function kick(ctx: AudioContext, t: number, out: AudioNode) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(170, t);
  o.frequency.exponentialRampToValueAtTime(44, t + 0.14);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.9, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + 0.4);
}

function distortion(ctx: AudioContext) {
  const ws = ctx.createWaveShaper();
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / n) * 2 - 1;
    curve[i] = Math.tanh(x * 6);
  }
  ws.curve = curve;
  return ws;
}

/** Riser, then four distorted kicks at 150 BPM. Turning off: one falling sweep. */
export function playLockin(on: boolean) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const master = ctx.createGain();
    master.gain.value = 0.32;
    master.connect(ctx.destination);
    const t0 = ctx.currentTime + 0.02;
    if (on) {
      // noise riser
      const len = Math.floor(ctx.sampleRate * 0.8);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (i / len);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 4;
      bp.frequency.setValueAtTime(300, t0);
      bp.frequency.exponentialRampToValueAtTime(6000, t0 + 0.8);
      const ng = ctx.createGain();
      ng.gain.value = 0.35;
      src.connect(bp).connect(ng).connect(master);
      src.start(t0);
      const dist = distortion(ctx);
      dist.connect(master);
      for (let i = 0; i < 4; i++) kick(ctx, t0 + 0.8 + i * 0.4, dist);
      setTimeout(() => void ctx.close(), 3000);
    } else {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(600, t0);
      o.frequency.exponentialRampToValueAtTime(40, t0 + 0.6);
      g.gain.setValueAtTime(0.25, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
      o.connect(g).connect(master);
      o.start(t0);
      o.stop(t0 + 0.62);
      setTimeout(() => void ctx.close(), 1000);
    }
  } catch {
    /* audio not available */
  }
}

/** The tiny button in the header. */
export function LockinToggle() {
  const [s, setS] = useLockin();
  const sound = useSettings().holdingAlerts.sound;
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        const on = !s.on;
        setS({ ...s, on, since: on ? Date.now() : null });
        if (sound) playLockin(on);
        if (on) router.push("/big");
      }}
      className={cn(
        "flex size-6 items-center justify-center rounded-full transition-colors",
        s.on ? "lockin-blink bg-accent text-accent-fg" : "text-faint hover:text-accent",
      )}
      aria-pressed={s.on}
      aria-label={s.on ? "Leave lock-in mode" : "Lock-in mode: big trades"}
      title={s.on ? "Leave lock-in mode" : "Lock-in mode"}
      data-testid="lockin-toggle"
    >
      <Zap className="size-3.5" />
    </button>
  );
}

/** Sets the page attributes while lock-in is on, and shows the ticker of big verified trades. */
export function LockinLayer() {
  const [s] = useLockin();
  useEffect(() => {
    const el = document.documentElement;
    if (s.on) el.dataset.lockin = "on";
    else delete el.dataset.lockin;
    return () => {
      delete el.dataset.lockin;
    };
  }, [s.on]);
  return s.on ? <LockinTicker state={s} /> : null;
}

function LockinTicker({ state }: { state: LockinState }) {
  const { trades, level } = useBigTrades(state);
  useEffect(() => {
    document.documentElement.style.setProperty("--lock-level", String(level));
    return () => {
      document.documentElement.style.removeProperty("--lock-level");
    };
  }, [level]);
  const verified = trades.filter((t) => t.verified).slice(0, 12);
  const items = verified.length
    ? verified.map((t) => (
        <Link key={t.row.id} href={`/items/${t.row.id}`} className="inline-flex items-center gap-2 hover:underline">
          <span className="text-accent">▲</span>
          <span className="font-bold uppercase">{t.row.name}</span>
          <span className="text-pos">+{gpShort(t.row.profit)}</span>
          <span className="text-faint">{t.row.qty}× · {t.volatility != null ? `swing ${(t.volatility * 100).toFixed(0)}%` : ""}</span>
        </Link>
      ))
    : [<span key="calm" className="text-muted">NO VERIFIED BIG TRADE RIGHT NOW · MARKET IS CALM · STAY LOCKED IN</span>];
  return (
    <div className="fixed inset-x-0 bottom-14 z-30 overflow-hidden border-t border-accent/50 bg-[#0b0306] py-1 font-mono text-[11px] tracking-wide text-text md:bottom-0 md:left-60" data-testid="lockin-ticker">
      <div className="lockin-ticker-track">
        {items}
        {items}
      </div>
    </div>
  );
}
