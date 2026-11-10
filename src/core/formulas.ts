/** Formulas from GDD section 14. Pure functions, no engine dependencies. */
import { COMBAT, PROGRESSION } from '../data/tuning';

export interface DamageInput {
  /** Weapon attack including tempering. */
  weapon: number;
  /** Attack stat. */
  attack: number;
  /** Combo multiplier. */
  combo: number;
  /** Product of situational modifiers (weak point, Guard-broken, riposte, Soul Burst). */
  mods?: number;
  /** Enemy armor reduction, 0 to 0.5. */
  armor?: number;
}

/** D = W * (1 + 0.02A) * C * M * (1 - R) */
export function slashDamage({ weapon, attack, combo, mods = 1, armor = 0 }: DamageInput): number {
  const r = Math.min(0.5, Math.max(0, armor));
  return weapon * (1 + 0.02 * attack) * combo * mods * (1 - r);
}

/** C = min(2.5, 1 + 0.15 (n - 1)), n = consecutive unbroken hits (n >= 1). */
export function comboMultiplier(n: number): number {
  if (n <= 1) return 1;
  return Math.min(COMBAT.comboMax, 1 + COMBAT.comboStep * (n - 1));
}

/** XP needed to go from level L to L + 1: 90 * L^1.6 */
export function xpToNext(level: number): number {
  return Math.round(90 * Math.pow(level, 1.6));
}

/** Gold to temper a piece with price P from +n to +n+1: 0.04 * P * 1.4^n, n = 0..9 */
export function temperCost(price: number, n: number): number {
  if (n < 0 || n >= PROGRESSION.temperMax) return Infinity;
  return Math.round(0.04 * price * Math.pow(1.4, n));
}

/** Total gold to temper from +0 to +target. */
export function temperTotal(price: number, target: number): number {
  let sum = 0;
  for (let n = 0; n < target; n++) sum += temperCost(price, n);
  return sum;
}

/** Stat multiplier for a tempered piece: each step adds 6% of base. */
export function temperMultiplier(level: number): number {
  return 1 + PROGRESSION.temperStep * level;
}

/** Rebirth cycle scaling (c = cycle number, 1-based). */
export function cycleScaling(c: number): { hp: number; dmg: number; cap: number } {
  return {
    hp: 1 + 0.85 * (c - 1),
    dmg: 1 + 0.5 * (c - 1),
    cap: Math.min(100, 50 + 15 * (c - 1)),
  };
}
