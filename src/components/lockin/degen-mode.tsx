"use client";
import { Plus, RotateCcw, Volume2, VolumeX, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ItemIcon } from "@/components/common/item-icon";
import { useMarketRows } from "@/hooks/market-rows";
import { buildStrip, degenPool, pickWinner, reelPosition, spinKeyframes, type DegenItem } from "@/lib/analysis/degen";
import { DEFAULT_SPEED_FILTERS, type SpeedFilters } from "@/lib/analysis/speed-filters";
import { gp, gpShort } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DegenAudio } from "./degen-audio";

const ROW = 104;
/** No limits at all: full buy limit, no "within reason", any price */
const DEGEN_FILTERS: SpeedFilters = { ...DEFAULT_SPEED_FILTERS, realistic: false, plausibleOnly: false, minVolume: null, profitableOnly: true, sort: "profit" };
const HYPE = ["SEND IT", "NO BRAKES", "FULL PORT", "x100", "WAGMI", "ONE MORE", "DOUBLE OR NOTHING", "BANK IT"];

type Phase = "ready" | "spinning" | "edge" | "won";

/** Stable pseudo-random 0..1 per coin (render must stay pure) */
const rnd = (i: number, k: number) => {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

function Coins() {
  const coins = useMemo(
    () => Array.from({ length: 70 }, (_, i) => ({ left: rnd(i, 1) * 100, delay: rnd(i, 2) * 2.2, dur: 1.6 + rnd(i, 3) * 1.8, size: 14 + rnd(i, 4) * 22, rot: rnd(i, 5) * 720, key: i })),
    [],
  );
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {coins.map((c) => (
        <span
          key={c.key}
          className="degen-coin coin absolute rounded-full"
          style={{ left: `${c.left}%`, width: c.size, height: c.size, animationDelay: `${c.delay}s`, animationDuration: `${c.dur}s`, ["--rot" as string]: `${c.rot}deg` }}
        />
      ))}
    </div>
  );
}

function Counter({ to }: { to: number }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const x = Math.min(1, (now - start) / 2200);
      setV(Math.round(to * (1 - (1 - x) ** 3)));
      if (x < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <>{v.toLocaleString("de-CH")}</>;
}

export function DegenMode({ onClose, onLog }: { onClose: () => void; onLog: (item: DegenItem) => void }) {
  const { all, isLoading } = useMarketRows(DEGEN_FILTERS, "limit", 1e13);
  const pool = useMemo(() => degenPool(all), [all]);
  const [phase, setPhase] = useState<Phase>("ready");
  const [strip, setStrip] = useState<DegenItem[]>([]);
  const [winner, setWinner] = useState<DegenItem | null>(null);
  const [pos, setPos] = useState(1);
  const [hype, setHype] = useState(HYPE[0]!);
  const [muted, setMuted] = useState(false);
  const audio = useRef<DegenAudio | null>(null);
  const raf = useRef(0);

  useEffect(() => () => {
    cancelAnimationFrame(raf.current);
    audio.current?.close();
  }, []);

  // Idle strip so the reel isn't empty before the first spin
  const idle = useMemo(() => (pool.length ? Array.from({ length: 5 }, (_, i) => pool[i % pool.length]!) : []), [pool]);
  const shownStrip = strip.length ? strip : idle;

  const spin = () => {
    const w = pickWinner(pool);
    if (!w) return;
    audio.current ??= new DegenAudio();
    const a = audio.current;
    a.setMuted(muted);
    const { strip: s, winnerAt } = buildStrip(pool, w);
    const frames = spinKeyframes(winnerAt);
    const end = frames[frames.length - 1]!.t;
    setStrip(s);
    setWinner(w);
    setPhase("spinning");
    a.riser(1.1);
    a.startDrone();
    setTimeout(() => a.startSiren(), 900);
    let last = 0;
    let lastPos = 0;
    let nextBeat = 7.4;
    let hypeAt = 0;
    let edged = false;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = (now - t0) / 1000;
      const p = reelPosition(frames, t);
      const speed = Math.min(1, Math.abs(p - lastPos) * 4);
      lastPos = p;
      setPos(p);
      if (Math.floor(p) !== last) {
        last = Math.floor(p);
        a.tick(speed);
      }
      a.droneSpeed(speed);
      if (t > hypeAt) {
        hypeAt = t + 0.4;
        setHype(HYPE[Math.floor(Math.random() * HYPE.length)]!);
      }
      if (t > 7.2 && !edged) {
        // The edge: drone and siren cut, drum roll and heartbeat take over
        edged = true;
        a.stopDrone(0.08);
        a.stopSiren();
        a.startRoll();
        setPhase("edge");
      }
      if (edged && t > nextBeat && t < end) {
        a.heartbeat();
        nextBeat += 0.85;
      }
      if (t < end) raf.current = requestAnimationFrame(step);
      else {
        setPos(winnerAt);
        setPhase("won");
        a.jackpot();
      }
    };
    raf.current = requestAnimationFrame(step);
  };

  const toggleMute = () => {
    const m = !muted;
    setMuted(m);
    audio.current?.setMuted(m);
  };

  const spinning = phase === "spinning" || phase === "edge";

  return (
    <div
      className={cn("fixed inset-0 z-[90] flex flex-col items-center justify-center overflow-hidden bg-[#050106] p-4 text-white", spinning && "degen-strobe", phase === "won" && "degen-shake degen-win")}
      role="dialog"
      aria-modal="true"
      aria-label="Degen mode"
      data-testid="degen"
    >
      <div className="absolute right-4 top-4 flex gap-2">
        <button type="button" onClick={toggleMute} className="rounded-full border border-white/20 p-2 hover:bg-white/10" aria-label={muted ? "Sound on" : "Mute"} data-testid="degen-mute">
          {muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
        </button>
        <button type="button" onClick={() => { cancelAnimationFrame(raf.current); audio.current?.stopAll(); onClose(); }} className="rounded-full border border-white/20 p-2 hover:bg-white/10" aria-label="Close degen mode" data-testid="degen-close">
          <X className="size-5" />
        </button>
      </div>

      <div className="degen-title select-none text-center font-mono font-black uppercase leading-none">
        <div className="text-[10px] tracking-[0.6em] text-white/60">lock-in · bonus round</div>
        <div className="lockin-glitch mt-2 text-6xl tracking-tighter sm:text-8xl">Degen mode</div>
      </div>
      <p className="mt-2 max-w-lg text-center text-xs text-white/50">
        The biggest single flips on the market: one full buy limit, any price, no limits, no reason. Not advice. It will edge you.
      </p>

      {/* Reel */}
      <div className="relative mt-6 w-full max-w-xl">
        <div className="degen-payline pointer-events-none absolute inset-x-0 top-1/2 z-10 -translate-y-1/2 rounded-xl border-4 border-[#ffd43b]" style={{ height: ROW + 8 }} />
        <div className="absolute -left-3 top-1/2 z-10 -translate-y-1/2 text-3xl text-[#ffd43b]">▶</div>
        <div className="absolute -right-3 top-1/2 z-10 -translate-y-1/2 text-3xl text-[#ffd43b]">◀</div>
        <div className="relative overflow-hidden rounded-2xl border-2 border-[#ff1f45]/70 bg-[#0e0610]" style={{ height: ROW * 3 }} data-testid="degen-reel">
          <div className="absolute inset-x-0 top-0 z-[5] h-16 bg-gradient-to-b from-[#0e0610] to-transparent" />
          <div className="absolute inset-x-0 bottom-0 z-[5] h-16 bg-gradient-to-t from-[#0e0610] to-transparent" />
          <div style={{ transform: `translateY(${-(pos - 1) * ROW}px)`, filter: phase === "spinning" ? "blur(1.5px)" : undefined }}>
            {shownStrip.map((it, i) => (
              <div key={i} className="flex items-center gap-4 px-6" style={{ height: ROW }}>
                <ItemIcon icon={it.icon} name={it.name} size={48} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-xl font-black uppercase">{it.name}</div>
                  <div className="font-mono text-xs text-white/50">{gp(it.qty)} × {gpShort(it.margin)} margin</div>
                </div>
                <div className="font-mono text-2xl font-black text-[#3dff8e]">+{gpShort(it.profit)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-5 h-8 font-mono text-2xl font-black uppercase tracking-widest">
        {spinning && <span className={cn(phase === "edge" ? "lockin-blink text-[#ff1f45]" : "text-[#ffd43b]")}>{phase === "edge" ? "come on… come on…" : hype}</span>}
      </div>

      {phase === "won" && winner && (
        <>
          <Coins />
          <div className="relative z-20 mt-2 flex flex-col items-center text-center" data-testid="degen-result">
            <div className="font-mono text-sm uppercase tracking-[0.5em] text-[#ffd43b]">Jackpot</div>
            <div className="font-mono text-5xl font-black text-[#3dff8e] sm:text-7xl" data-testid="degen-profit">+<Counter to={winner.profit} /></div>
            <div className="mt-1 font-mono text-sm text-white/70">
              {winner.name}: buy {gp(winner.qty)} at {gp(winner.buy)}, sell at {gp(winner.sell)} · needs {gpShort(winner.qty * winner.buy)} gp
            </div>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => onLog(winner)} className="inline-flex items-center gap-1.5 rounded-lg bg-[#3dff8e] px-4 py-2 font-mono font-black uppercase text-black hover:brightness-110" data-testid="degen-log">
                <Plus className="size-4" /> Log it
              </button>
              <button type="button" onClick={spin} className="inline-flex items-center gap-1.5 rounded-lg border-2 border-[#ffd43b] px-4 py-2 font-mono font-black uppercase text-[#ffd43b] hover:bg-[#ffd43b]/10" data-testid="degen-again">
                <RotateCcw className="size-4" /> Spin again
              </button>
            </div>
          </div>
        </>
      )}

      {phase === "ready" && (
        <button
          type="button"
          onClick={spin}
          disabled={isLoading || pool.length === 0}
          className="degen-spin mt-2 rounded-full border-4 border-[#ffd43b] bg-[#ff1f45] px-12 py-4 font-mono text-3xl font-black uppercase tracking-widest text-white shadow-[0_0_60px_rgba(255,31,69,0.7)] hover:brightness-125 disabled:opacity-40"
          data-testid="degen-spin"
        >
          {isLoading ? "Loading…" : pool.length === 0 ? "Nothing to roll" : "Spin"}
        </button>
      )}
    </div>
  );
}
