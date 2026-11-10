import { describe, expect, it } from 'vitest';
import { addXp, allocate, buy, derivedStats, newProfile, respec, temper } from '../src/core/profile';
import { doorsFor, duelReward, merchantStock, newClimb, TIER1_LAYOUT } from '../src/core/tower';
import { BRUTE, IRON_WARDEN } from '../src/data/enemies';
import { xpToNext } from '../src/core/formulas';

describe('profile', () => {
  it('starts with the Oath kit equipped', () => {
    const p = newProfile();
    const s = derivedStats(p);
    expect(s.weaponAtk).toBe(10);
    expect(s.maxHp).toBe(100 + 20 + 120);
    expect(s.blockReduction).toBeCloseTo(0.7);
  });

  it('levels up with 3 free points per level', () => {
    const p = newProfile();
    const gained = addXp(p, xpToNext(1) + xpToNext(2));
    expect(gained).toBe(2);
    expect(p.level).toBe(3);
    expect(p.freePoints).toBe(6);
    expect(allocate(p, 'attack')).toBe(true);
    expect(derivedStats(p).attack).toBe(2 + 1);
    respec(p);
    expect(p.freePoints).toBe(6);
  });

  it('buys, equips and tempers gear', () => {
    const p = newProfile();
    p.gold = 5000;
    expect(buy(p, 'cinder-longsword')).toBe(true);
    expect(derivedStats(p).weaponAtk).toBe(18);
    expect(buy(p, 'cinder-longsword')).toBe(false);
    const uid = p.equipped.weapon!;
    expect(temper(p, uid)).toBe(true);
    expect(p.gold).toBe(5000 - 1500 - 60);
    expect(derivedStats(p).weaponAtk).toBeCloseTo(19.1, 1);
  });
});

describe('tower', () => {
  it('follows the Cinder Gate layout and ends with the Warden', () => {
    const p = newProfile();
    const climb = newClimb(p, 42);
    for (let f = 0; f < TIER1_LAYOUT.length; f++) {
      climb.floor = f;
      expect(doorsFor(climb).map((d) => d.type)).toEqual(TIER1_LAYOUT[f]);
    }
    climb.floor = 3;
    expect(doorsFor(climb)).toEqual([{ type: 'warden', enemy: IRON_WARDEN }]);
  });

  it('duel doors on a floor are different enemies, and it is seeded', () => {
    const climb = newClimb(newProfile(), 9);
    const a = doorsFor(climb).filter((d) => d.type === 'duel').map((d) => d.enemy!.id);
    expect(new Set(a).size).toBe(a.length);
    expect(doorsFor(climb)).toEqual(doorsFor({ ...climb }));
  });

  it('a revealed secret door replaces a duel door', () => {
    const climb = { ...newClimb(newProfile(), 1), floor: 1, secretRevealed: true };
    const types = doorsFor(climb).map((d) => d.type);
    expect(types).toContain('secret');
    expect(types).not.toContain('duel');
  });

  it('elite pays 2.2x and the Warden drops his blade the first time', () => {
    const p = newProfile();
    expect(duelReward(p, BRUTE, 5).gold).toBeGreaterThan(800);
    expect(duelReward(p, IRON_WARDEN, 5).gear).toBe('wardens-edge');
  });

  it('merchant sells unowned Tier I gear, keys and one Second Wind', () => {
    const p = newProfile();
    const climb = newClimb(p, 1);
    const stock = merchantStock(p, climb);
    expect(stock.filter((s) => s.kind === 'gear')).toHaveLength(5);
    expect(stock.some((s) => s.kind === 'secondWind')).toBe(true);
    climb.secondWind = true;
    expect(merchantStock(p, climb).some((s) => s.kind === 'secondWind')).toBe(false);
  });
});
