"use client";

/** Everything synthesised with Web Audio: no sound files. */
export class DegenAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private drone: { stop: () => void; gain: GainNode } | null = null;
  private roll: ReturnType<typeof setInterval> | null = null;
  private siren: { stop: () => void } | null = null;
  muted = false;

  private get c(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.36;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      this.master.connect(comp).connect(this.ctx.destination);
      return this.ctx;
    } catch {
      return null;
    }
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.36, this.ctx.currentTime, 0.02);
  }

  private noiseBuffer(sec: number) {
    const c = this.c!;
    const len = Math.floor(c.sampleRate * sec);
    const b = c.createBuffer(1, len, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  private env(g: GainNode, t: number, peak: number, attack: number, decay: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  /** Rising noise sweep */
  riser(sec = 1.2) {
    const c = this.c; if (!c) return;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuffer(sec);
    const bp = c.createBiquadFilter();
    bp.type = "bandpass"; bp.Q.value = 5;
    bp.frequency.setValueAtTime(200, t);
    bp.frequency.exponentialRampToValueAtTime(9000, t + sec);
    const g = c.createGain();
    g.gain.setValueAtTime(0.05, t);
    g.gain.linearRampToValueAtTime(0.5, t + sec);
    src.connect(bp).connect(g).connect(this.master!);
    src.start(t);
  }

  /** Wobble bass drone while spinning */
  startDrone() {
    const c = this.c; if (!c || this.drone) return;
    const t = c.currentTime;
    const o = c.createOscillator(); o.type = "sawtooth"; o.frequency.value = 55;
    const o2 = c.createOscillator(); o2.type = "square"; o2.frequency.value = 27.5;
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 9; lp.frequency.value = 400;
    const lfo = c.createOscillator(); lfo.frequency.value = 5; // wub wub
    const lfoGain = c.createGain(); lfoGain.gain.value = 900;
    lfo.connect(lfoGain).connect(lp.frequency);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.6);
    o.connect(lp); o2.connect(lp); lp.connect(g).connect(this.master!);
    [o, o2, lfo].forEach((x) => x.start(t));
    this.drone = { gain: g, stop: () => [o, o2, lfo].forEach((x) => { try { x.stop(); } catch { /* already stopped */ } }) };
  }

  /** Speed up the wobble (spin speed 0..1) */
  droneSpeed(v: number) {
    if (!this.drone || !this.ctx) return;
    this.drone.gain.gain.setTargetAtTime(0.08 + v * 0.3, this.ctx.currentTime, 0.1);
  }

  stopDrone(fade = 0.05) {
    if (!this.drone || !this.ctx) return;
    const d = this.drone;
    d.gain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, fade);
    setTimeout(() => d.stop(), 600);
    this.drone = null;
  }

  /** Snare roll, accelerating */
  startRoll() {
    const c = this.c; if (!c || this.roll) return;
    let gap = 140;
    const hit = () => {
      const t = c.currentTime;
      const s = c.createBufferSource(); s.buffer = this.noiseBuffer(0.12);
      const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 1800;
      const g = c.createGain(); this.env(g, t, 0.25, 0.002, 0.09);
      s.connect(hp).connect(g).connect(this.master!); s.start(t);
    };
    const loop = () => {
      hit();
      gap = Math.max(38, gap * 0.95);
      this.roll = setTimeout(loop, gap) as unknown as ReturnType<typeof setInterval>;
    };
    loop();
  }

  stopRoll() {
    if (this.roll) clearTimeout(this.roll as unknown as number);
    this.roll = null;
  }

  /** Air-raid siren */
  startSiren() {
    const c = this.c; if (!c || this.siren) return;
    const t = c.currentTime;
    const o = c.createOscillator(); o.type = "sawtooth";
    const lfo = c.createOscillator(); lfo.frequency.value = 0.7;
    const lg = c.createGain(); lg.gain.value = 260;
    o.frequency.value = 620;
    lfo.connect(lg).connect(o.frequency);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.08, t + 0.5);
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2400;
    o.connect(lp).connect(g).connect(this.master!);
    o.start(t); lfo.start(t);
    this.siren = { stop: () => { g.gain.setTargetAtTime(0.0001, c.currentTime, 0.05); setTimeout(() => { try { o.stop(); lfo.stop(); } catch { /* */ } }, 400); } };
  }

  stopSiren() {
    this.siren?.stop();
    this.siren = null;
  }

  /** One reel click; higher speed = higher, shorter click */
  tick(speed: number) {
    const c = this.c; if (!c) return;
    const t = c.currentTime;
    const o = c.createOscillator(); o.type = "square";
    o.frequency.setValueAtTime(700 + speed * 900, t);
    o.frequency.exponentialRampToValueAtTime(300, t + 0.04);
    const g = c.createGain(); this.env(g, t, 0.22, 0.001, 0.05);
    o.connect(g).connect(this.master!); o.start(t); o.stop(t + 0.07);
  }

  heartbeat() {
    const c = this.c; if (!c) return;
    [0, 0.22].forEach((d, i) => {
      const t = c.currentTime + d;
      const o = c.createOscillator(); o.type = "sine";
      o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
      const g = c.createGain(); this.env(g, t, i ? 0.5 : 0.8, 0.004, 0.2);
      o.connect(g).connect(this.master!); o.start(t); o.stop(t + 0.25);
    });
  }

  kick(at: number) {
    const c = this.c; if (!c) return;
    const t = c.currentTime + at;
    const o = c.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    const ws = c.createWaveShaper();
    const curve = new Float32Array(512);
    for (let i = 0; i < 512; i++) { const x = (i / 512) * 2 - 1; curve[i] = Math.tanh(x * 7); }
    ws.curve = curve;
    const g = c.createGain(); this.env(g, t, 0.9, 0.004, 0.33);
    o.connect(ws).connect(g).connect(this.master!); o.start(t); o.stop(t + 0.4);
  }

  crash(at = 0) {
    const c = this.c; if (!c) return;
    const t = c.currentTime + at;
    const s = c.createBufferSource(); s.buffer = this.noiseBuffer(2.5);
    const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 3000;
    const g = c.createGain(); this.env(g, t, 0.6, 0.003, 2.2);
    s.connect(hp).connect(g).connect(this.master!); s.start(t);
  }

  /** BWAAAP */
  airhorn(at = 0) {
    const c = this.c; if (!c) return;
    const t = c.currentTime + at;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.32, t + 0.03); g.gain.setValueAtTime(0.32, t + 0.42); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.62);
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 3200;
    lp.connect(g).connect(this.master!);
    for (const f of [466, 554, 698]) {
      const o = c.createOscillator(); o.type = "sawtooth";
      o.frequency.setValueAtTime(f * 0.9, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
      const vib = c.createOscillator(); vib.frequency.value = 7; const vg = c.createGain(); vg.gain.value = 6;
      vib.connect(vg).connect(o.frequency);
      o.connect(lp); o.start(t); vib.start(t); o.stop(t + 0.65); vib.stop(t + 0.65);
    }
  }

  coin(at = 0) {
    const c = this.c; if (!c) return;
    const t = c.currentTime + at;
    [988, 1319].forEach((f, i) => {
      const o = c.createOscillator(); o.type = "square"; o.frequency.value = f;
      const g = c.createGain(); this.env(g, t + i * 0.07, 0.12, 0.002, 0.18);
      o.connect(g).connect(this.master!); o.start(t + i * 0.07); o.stop(t + i * 0.07 + 0.22);
    });
  }

  laser(at = 0) {
    const c = this.c; if (!c) return;
    const t = c.currentTime + at;
    const o = c.createOscillator(); o.type = "sawtooth";
    o.frequency.setValueAtTime(2600, t); o.frequency.exponentialRampToValueAtTime(120, t + 0.32);
    const g = c.createGain(); this.env(g, t, 0.16, 0.002, 0.3);
    o.connect(g).connect(this.master!); o.start(t); o.stop(t + 0.36);
  }

  /** The payoff: crash, three airhorns, 8 kicks at 150 BPM, lasers and a pile of coins. */
  jackpot() {
    this.stopDrone(0.02); this.stopRoll(); this.stopSiren();
    this.crash(0);
    this.kick(0);
    [0.05, 0.75, 1.45].forEach((d) => this.airhorn(d));
    for (let i = 1; i <= 8; i++) this.kick(0.4 * i);
    for (let i = 0; i < 6; i++) this.laser(0.6 + i * 0.4 + 0.2);
    for (let i = 0; i < 18; i++) this.coin(0.3 + Math.random() * 3);
    this.crash(3.2);
  }

  stopAll() {
    this.stopDrone(); this.stopRoll(); this.stopSiren();
  }

  close() {
    this.stopAll();
    const c = this.ctx;
    this.ctx = null;
    setTimeout(() => void c?.close(), 800);
  }
}
