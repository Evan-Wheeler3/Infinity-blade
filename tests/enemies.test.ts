import { describe, expect, it } from 'vitest';
import { ALL_ENEMIES } from '../src/data/enemies';
import { TIMING } from '../src/data/tuning';

describe('fairness rules (GDD section 4)', () => {
  for (const enemy of ALL_ENEMIES) {
    const attacks = [...enemy.attacks, ...enemy.phases.flatMap((p) => p.addAttacks)];
    const fastestScale = enemy.phases.reduce((s, p) => s * p.tellScale, 1);

    it(`${enemy.name}: every tell is at least 0.45 s, even fully sped up`, () => {
      for (const a of attacks) for (const s of a.strikes) {
        expect(s.tell).toBeLessThanOrEqual(TIMING.maxTell);
        expect(s.tell * fastestScale).toBeGreaterThanOrEqual(TIMING.minTell - 1e-9);
      }
    });

    it(`${enemy.name}: the final strike is never >25% faster than the first`, () => {
      for (const a of attacks) {
        const first = a.strikes[0].tell;
        const last = a.strikes[a.strikes.length - 1].tell;
        expect(last).toBeGreaterThanOrEqual(first * (1 - TIMING.maxComboSpeedup) - 1e-9);
      }
    });
  }
});
