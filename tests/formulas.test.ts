import { describe, expect, it } from 'vitest';
import { comboMultiplier, cycleScaling, slashDamage, temperTotal, xpToNext } from '../src/core/formulas';

describe('GDD section 14 formulas', () => {
  it('combo multiplier steps 0.15 per hit and caps at 2.5', () => {
    expect(comboMultiplier(1)).toBe(1);
    expect(comboMultiplier(2)).toBeCloseTo(1.15);
    expect(comboMultiplier(11)).toBeCloseTo(2.5);
    expect(comboMultiplier(40)).toBe(2.5);
  });

  it('XP curve matches the worked examples', () => {
    expect(xpToNext(10)).toBeGreaterThan(3500);
    expect(xpToNext(10)).toBeLessThan(3700);
    expect(Math.round(xpToNext(25) / 100) * 100).toBe(15500);
    // The GDD's prose example says ~47,000 at level 49; the formula itself gives ~45,500.
    expect(xpToNext(49)).toBeGreaterThan(45000);
    expect(xpToNext(49)).toBeLessThan(46000);
  });

  it('tempering totals match the GDD (+10 ~ 2.8x, +6 ~ 0.65x price)', () => {
    expect(temperTotal(10000, 10) / 10000).toBeCloseTo(2.8, 1);
    expect(temperTotal(10000, 6) / 10000).toBeCloseTo(0.65, 1);
  });

  it('damage formula applies attack, combo, mods and capped armor', () => {
    expect(slashDamage({ weapon: 10, attack: 0, combo: 1 })).toBe(10);
    expect(slashDamage({ weapon: 10, attack: 50, combo: 1 })).toBe(20);
    expect(slashDamage({ weapon: 10, attack: 0, combo: 2, mods: 1.5, armor: 0.9 })).toBe(15);
  });

  it('cycle scaling', () => {
    expect(cycleScaling(1)).toEqual({ hp: 1, dmg: 1, cap: 50 });
    expect(cycleScaling(2).hp).toBeCloseTo(1.85);
    expect(cycleScaling(10).cap).toBe(100);
  });
});
