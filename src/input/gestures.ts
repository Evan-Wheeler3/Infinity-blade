/**
 * One-thumb gestures (GDD section 3) plus keyboard for desktop play.
 *
 * - Swipe in the duel zone: slash or parry, by direction. A swipe fires as
 *   soon as the finger passes the distance threshold, not on release, to
 *   keep swipe-to-hit latency low.
 * - Swipe left/right in the bottom band (or tap a chevron): dodge.
 * - Tap during the Perfect Parry flash: riposte.
 * - Hold the shield button: block. Soul ring and Tonic are buttons.
 */
import type { DodgeDir, SwipeDir } from '../core/duel';

export interface InputHandlers {
  swipe(dir: SwipeDir): void;
  dodge(dir: DodgeDir): void;
  tap(): void;
  block(on: boolean): void;
  burst(): void;
  tonic(): void;
  pause(): void;
  /** Called with points of the current finger trail, for the slash trail effect. */
  trail(points: { x: number; y: number }[], done: boolean): void;
}

const SWIPE_PX = 34;
const TAP_PX = 14;
const TAP_MS = 260;
/** Fraction of screen height, from the bottom, that counts as the dodge band. */
export const DODGE_BAND = 0.2;

interface Stroke {
  id: number;
  x0: number;
  y0: number;
  t0: number;
  fired: boolean;
  points: { x: number; y: number }[];
}

export class Gestures {
  private strokes = new Map<number, Stroke>();
  enabled = false;
  private keysDown = new Set<string>();

  constructor(private el: HTMLElement, private h: InputHandlers) {
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', (e) => this.up(e));
    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
  }

  private down(e: PointerEvent): void {
    if (!this.enabled) return;
    this.el.setPointerCapture?.(e.pointerId);
    this.strokes.set(e.pointerId, { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now(), fired: false, points: [{ x: e.clientX, y: e.clientY }] });
  }

  private move(e: PointerEvent): void {
    const s = this.strokes.get(e.pointerId);
    if (!s || !this.enabled) return;
    s.points.push({ x: e.clientX, y: e.clientY });
    if (s.points.length > 24) s.points.shift();
    const dx = e.clientX - s.x0;
    const dy = e.clientY - s.y0;
    if (!s.fired && Math.hypot(dx, dy) >= SWIPE_PX) {
      s.fired = true;
      this.fire(s, dx, dy);
    }
    if (!this.isDodgeStroke(s)) this.h.trail(s.points, false);
  }

  private up(e: PointerEvent): void {
    const s = this.strokes.get(e.pointerId);
    this.strokes.delete(e.pointerId);
    if (!s || !this.enabled) return;
    const dx = e.clientX - s.x0;
    const dy = e.clientY - s.y0;
    const dist = Math.hypot(dx, dy);
    if (!s.fired) {
      if (dist < TAP_PX && performance.now() - s.t0 < TAP_MS) this.h.tap();
      else if (dist >= SWIPE_PX * 0.6) this.fire(s, dx, dy);
    }
    this.h.trail(s.points, true);
  }

  private isDodgeStroke(s: Stroke): boolean {
    return s.y0 > window.innerHeight * (1 - DODGE_BAND);
  }

  private fire(s: Stroke, dx: number, dy: number): void {
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    if (this.isDodgeStroke(s) && horizontal) {
      this.h.dodge(dx < 0 ? 'left' : 'right');
      return;
    }
    const dir: SwipeDir = horizontal ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
    this.h.swipe(dir);
  }

  private key(e: KeyboardEvent, down: boolean): void {
    const k = e.key.toLowerCase();
    if (k === 'escape' && down) {
      this.h.pause();
      return;
    }
    if (!this.enabled) return;
    if (down && this.keysDown.has(k)) return; // ignore auto-repeat
    if (down) this.keysDown.add(k);
    else this.keysDown.delete(k);

    const map: Record<string, SwipeDir> = { arrowleft: 'left', arrowright: 'right', arrowup: 'up', arrowdown: 'down', j: 'left', l: 'right', i: 'up', k: 'down' };
    if (k === 's' || k === 'shift') {
      this.h.block(down);
      e.preventDefault();
      return;
    }
    if (!down) return;
    if (map[k]) {
      this.h.swipe(map[k]);
      e.preventDefault();
    } else if (k === 'a') this.h.dodge('left');
    else if (k === 'd') this.h.dodge('right');
    else if (k === ' ') {
      this.h.burst();
      e.preventDefault();
    } else if (k === 'e') this.h.tonic();
    else if (k === 'r' || k === 'enter') this.h.tap();
  }

  reset(): void {
    this.strokes.clear();
    this.keysDown.clear();
  }
}
