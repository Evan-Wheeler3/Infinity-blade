/**
 * Synthesized sound effects (Web Audio), so the prototype ships no audio files.
 * GDD section 12: every tell type has its own sound, so the game is playable
 * with eyes half closed.
 */
import type { StrikeKind } from './data/enemies';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private drone: OscillatorNode[] = [];
  enabled = true;

  /** Must be called from a user gesture (browsers block audio until then). */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.startDrone();
    } catch {
      this.ctx = null;
    }
  }

  private get ok(): boolean {
    return this.enabled && !!this.ctx && !!this.master;
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, when = 0, slideTo?: number): void {
    if (!this.ok) return;
    const c = this.ctx!;
    const t = c.currentTime + when;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(dur: number, vol: number, filter: BiquadFilterType, freq: number, when = 0, q = 1): void {
    if (!this.ok || !this.noiseBuf) return;
    const c = this.ctx!;
    const t = c.currentTime + when;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  private startDrone(): void {
    if (!this.ctx || !this.master) return;
    const c = this.ctx;
    const g = c.createGain();
    g.gain.value = 0.035;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 420;
    f.connect(g).connect(this.master);
    for (const freq of [55, 82.4, 110.3]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = Math.random() * 10 - 5;
      o.connect(f);
      o.start();
      this.drone.push(o);
    }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(on ? 0.55 : 0, this.ctx.currentTime, 0.05);
  }

  tell(kind: StrikeKind): void {
    switch (kind) {
      case 'quick':
        this.tone(1320, 0.12, 'triangle', 0.18);
        break;
      case 'heavy':
        this.tone(160, 0.45, 'sawtooth', 0.14, 0, 120);
        this.tone(240, 0.4, 'triangle', 0.1);
        break;
      case 'unblockable':
        this.tone(740, 0.14, 'square', 0.12);
        this.tone(520, 0.2, 'square', 0.12, 0.14);
        this.noise(0.3, 0.12, 'bandpass', 1800, 0, 4);
        break;
      case 'projectile':
        this.tone(2200, 0.35, 'sine', 0.08, 0, 900);
        break;
    }
  }

  parry(perfect: boolean): void {
    this.noise(0.18, 0.5, 'highpass', 2500);
    this.tone(perfect ? 1760 : 1180, perfect ? 0.9 : 0.4, 'sine', 0.25);
    this.tone(perfect ? 2637 : 1770, perfect ? 0.7 : 0.3, 'sine', 0.12);
    if (perfect) {
      this.tone(523, 0.6, 'triangle', 0.14, 0.05);
      this.tone(784, 0.7, 'triangle', 0.12, 0.12);
    }
  }

  slash(strong: boolean): void {
    this.noise(0.12, 0.35, 'bandpass', 900, 0, 0.8);
    this.tone(strong ? 90 : 130, 0.16, 'sine', strong ? 0.5 : 0.3, 0.02, 50);
  }

  whiff(): void {
    this.noise(0.16, 0.18, 'bandpass', 600, 0, 0.7);
  }

  deflected(): void {
    this.tone(900, 0.12, 'square', 0.06);
    this.noise(0.06, 0.2, 'highpass', 3000);
  }

  block(): void {
    this.noise(0.15, 0.4, 'lowpass', 900);
    this.tone(320, 0.2, 'triangle', 0.2);
  }

  shieldBreak(): void {
    this.noise(0.5, 0.6, 'lowpass', 1500);
    this.tone(200, 0.6, 'sawtooth', 0.2, 0, 60);
  }

  hurt(heavy: boolean): void {
    this.noise(0.25, 0.6, 'lowpass', 400);
    this.tone(heavy ? 70 : 100, 0.3, 'sine', 0.55, 0, 40);
  }

  dodge(): void {
    this.noise(0.22, 0.2, 'bandpass', 400, 0, 0.5);
  }

  burst(): void {
    this.tone(110, 1.4, 'sawtooth', 0.15, 0, 440);
    this.tone(220, 1.2, 'triangle', 0.12, 0.2, 880);
  }

  tonic(): void {
    [660, 880, 1100].forEach((f, i) => this.tone(f, 0.4, 'sine', 0.12, i * 0.08));
  }

  victory(): void {
    [392, 494, 587, 784].forEach((f, i) => this.tone(f, 1.2, 'triangle', 0.13, i * 0.12));
  }

  defeat(): void {
    [220, 207, 196, 147].forEach((f, i) => this.tone(f, 1.4, 'sawtooth', 0.08, i * 0.3));
  }

  phase(): void {
    this.tone(82, 1.6, 'sawtooth', 0.2, 0, 41);
    this.noise(1.0, 0.25, 'lowpass', 300);
  }

  click(): void {
    this.tone(660, 0.05, 'triangle', 0.08);
  }

  coins(): void {
    [1500, 1900, 2300].forEach((f, i) => this.tone(f, 0.12, 'square', 0.04, i * 0.05));
  }
}

export function haptic(pattern: number | number[], enabled: boolean): void {
  if (!enabled) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not supported */
  }
}
