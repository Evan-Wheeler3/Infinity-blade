import { describe, expect, it } from 'vitest';
import { Duel, type PlayerCombatStats } from '../src/core/duel';
import { ASHEN_FOOTMAN, BRUTE, GATE_ARCHER, IRON_WARDEN, type EnemyDef, type StrikeDef } from '../src/data/enemies';
import { COMBAT, TIERS, TIMING } from '../src/data/tuning';

const DT = 1 / 120;

function player(over: Partial<PlayerCombatStats> = {}): PlayerCombatStats {
  return {
    maxHp: 400,
    hp: 400,
    weaponAtk: 10,
    attack: 0,
    blockReduction: 0.7,
    maxGuard: 100,
    soulGain: 1,
    parryWindow: TIMING.parryWindow,
    tonics: 1,
    secondWind: false,
    ...over,
  };
}

/** A single-attack enemy so tests know exactly what comes next. */
function dummy(strikes: StrikeDef[], extra: Partial<EnemyDef> = {}): EnemyDef {
  return { ...ASHEN_FOOTMAN, attacks: [{ name: 'Test', strikes, recovery: 1.5 }], phases: [], ...extra };
}

function step(d: Duel, seconds: number): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n && !d.over; i++) d.update(DT);
}

/** Runs until a strike is being telegraphed and only `left` seconds remain before impact. */
function untilImpactIn(d: Duel, left: number): StrikeDef {
  for (let i = 0; i < 20000; i++) {
    if (d.currentStrike && d.timeToImpact <= left) return d.currentStrike;
    d.update(DT / 4);
  }
  throw new Error('no strike came');
}

describe('Duel: defence', () => {
  it('a parry inside the window staggers the enemy and opens it up', () => {
    const d = new Duel(dummy([{ kind: 'quick', from: 'left', tell: 0.8 }]), player());
    untilImpactIn(d, 0.15);
    d.swipe('left');
    expect(d.enemyState).toBe('stagger');
    expect(d.events.some((e) => e.type === 'parry' && !e.perfect)).toBe(true);
    expect(d.player.hp).toBe(400);
  });

  it('a Perfect Parry gives Soul, a longer stagger and a riposte', () => {
    const d = new Duel(dummy([{ kind: 'quick', from: 'right', tell: 0.8 }]), player());
    untilImpactIn(d, 0.05);
    d.swipe('right');
    expect(d.soul).toBeCloseTo(COMBAT.soulPerfectParry);
    expect(d.canRiposte).toBe(true);
    const before = d.enemyHp;
    d.tap();
    const slash = d.events.find((e) => e.type === 'slash');
    expect(slash && slash.type === 'slash' && slash.riposte).toBe(true);
    expect(before - d.enemyHp).toBe(20); // 10 * 2.0 riposte
  });

  it('a swipe in the wrong direction is a whiff and the strike lands', () => {
    const d = new Duel(dummy([{ kind: 'quick', from: 'left', tell: 0.8 }]), player());
    untilImpactIn(d, 0.1);
    d.swipe('right');
    step(d, 0.2);
    expect(d.player.hp).toBe(400 - TIERS[0].dmgQuick);
  });

  it('an early swipe locks out parrying briefly', () => {
    const d = new Duel(dummy([{ kind: 'quick', from: 'up', tell: 1.0 }]), player());
    untilImpactIn(d, 0.3);
    d.swipe('up'); // too early: outside the 220 ms window
    step(d, 0.1);
    d.swipe('up'); // inside the window but still locked out
    step(d, 0.25);
    expect(d.player.hp).toBeLessThan(400);
  });

  it('unblockable strikes cannot be parried or blocked, only dodged away', () => {
    const strike: StrikeDef = { kind: 'unblockable', from: 'left', tell: 0.9 };
    const parried = new Duel(dummy([strike]), player());
    untilImpactIn(parried, 0.05);
    parried.swipe('left');
    step(parried, 0.1);
    expect(parried.player.hp).toBe(400 - TIERS[0].dmgUnblockable);

    const wrongWay = new Duel(dummy([strike]), player());
    untilImpactIn(wrongWay, 0.2);
    wrongWay.dodge('left'); // toward the strike
    step(wrongWay, 0.3);
    expect(wrongWay.player.hp).toBeLessThan(400);

    const dodged = new Duel(dummy([strike]), player());
    untilImpactIn(dodged, 0.2);
    dodged.dodge('right');
    step(dodged, 0.3);
    expect(dodged.player.hp).toBe(400);
    expect(dodged.enemyState).toBe('stagger'); // dodging a final strike opens the enemy
  });

  it('blocking cuts damage and drains Guard; a guard-break strike stuns', () => {
    const d = new Duel(dummy([{ kind: 'heavy', from: 'up', tell: 0.8 }]), player());
    d.setBlock(true);
    untilImpactIn(d, 0.01);
    step(d, 0.05);
    expect(d.player.hp).toBe(400 - Math.round(TIERS[0].dmgHeavy * 0.3));
    expect(d.guard).toBeCloseTo(40, 0);

    const b = new Duel(dummy([{ kind: 'quick', from: 'left', tell: 0.8, guardBreak: true }]), player());
    b.setBlock(true);
    untilImpactIn(b, 0.01);
    step(b, 0.05);
    expect(b.guard).toBe(0);
    expect(b.stunned).toBe(true);
    expect(b.events.some((e) => e.type === 'shieldBreak')).toBe(true);
  });

  it('a parried projectile is sent back and hurts the shooter', () => {
    const d = new Duel(GATE_ARCHER, player(), 3);
    const isProjectile = () => d.currentStrike?.kind === 'projectile';
    for (let i = 0; i < 20000 && !isProjectile(); i++) {
      d.update(DT);
      const s = d.currentStrike;
      if (s && s.kind !== 'projectile' && d.timeToImpact < 0.1) d.swipe(s.from as 'left');
    }
    untilImpactIn(d, 0.1);
    const before = d.enemyHp;
    d.swipe('down');
    expect(d.events.some((e) => e.type === 'projectileReturned')).toBe(true);
    expect(d.enemyHp).toBeLessThan(before);
  });
});

describe('Duel: offence', () => {
  it('slashes during an opening build the combo; idle enemies deflect', () => {
    const d = new Duel(dummy([{ kind: 'quick', from: 'left', tell: 0.8 }]), player());
    step(d, 0.2);
    d.swipe('left');
    expect(d.events.at(-1)?.type).toBe('deflected');

    untilImpactIn(d, 0.15);
    d.swipe('left'); // parry -> stagger
    const hp0 = d.enemyHp;
    for (let i = 0; i < 5; i++) {
      step(d, 0.15);
      d.swipe(i % 2 ? 'left' : 'right');
    }
    expect(d.combo).toBe(5);
    // 10 * (1, 1.15, 1.3, 1.45, 1.6), each hit rounded: 10 + 12 + 13 + 15 + 16
    expect(hp0 - d.enemyHp).toBe(66);
    expect(d.soul).toBeCloseTo(5 * COMBAT.soulComboSlash);
  });

  it('combo resets after 1.5 s without a hit', () => {
    const d = new Duel(dummy([{ kind: 'quick', from: 'left', tell: 0.8 }], { attacks: [{ name: 'T', strikes: [{ kind: 'quick', from: 'left', tell: 0.8 }], recovery: 4 }] }), player());
    untilImpactIn(d, 0.01);
    step(d, 0.05); // take the hit, enemy recovers for 4 s
    d.swipe('left');
    expect(d.combo).toBe(1);
    step(d, 1.6);
    expect(d.combo).toBe(0);
  });

  it('Soul Burst doubles damage and slows the enemy', () => {
    const d = new Duel(dummy([{ kind: 'quick', from: 'left', tell: 0.8 }]), player());
    d.soul = 1;
    expect(d.soulBurst()).toBe(true);
    expect(d.soul).toBe(0);
    untilImpactIn(d, 0.15);
    d.swipe('left');
    const hp0 = d.enemyHp;
    step(d, 0.15);
    d.swipe('up');
    expect(hp0 - d.enemyHp).toBe(20);
  });
});

describe('Duel: enemies and outcome', () => {
  it('Iron Warden enters phase 2 below 50% and adds attacks', () => {
    const d = new Duel(IRON_WARDEN, player());
    expect(d.enemyMaxHp).toBe(TIERS[0].wardenHp);
    d['damageEnemy'](d.enemyMaxHp * 0.55);
    expect(d.phaseIndex).toBe(1);
    expect(d.events.some((e) => e.type === 'phase')).toBe(true);
    d['damageEnemy'](d.enemyMaxHp * 0.2);
    expect(d.phaseIndex).toBe(2);
  });

  it('an attack never repeats more than twice in a row', () => {
    const d = new Duel(BRUTE, player({ maxHp: 1e9, hp: 1e9 }), 7);
    const names: string[] = [];
    for (let i = 0; i < 200000 && names.length < 300; i++) {
      d.update(DT);
      const e = d.events.pop();
      if (e?.type === 'tell' && e.index === 0) names.push(e.attack);
      d.events.length = 0;
    }
    expect(names.length).toBe(300);
    for (let i = 2; i < names.length; i++) {
      expect(names[i] === names[i - 1] && names[i] === names[i - 2]).toBe(false);
    }
  });

  it('Second Wind revives once at 40% HP', () => {
    const d = new Duel(dummy([{ kind: 'unblockable', from: 'up', tell: 0.8 }]), player({ hp: 10, secondWind: true }));
    untilImpactIn(d, 0.01);
    step(d, 0.05);
    expect(d.over).toBe(false);
    expect(d.player.hp).toBe(160);
    expect(d.player.secondWind).toBe(false);
  });

  it('a passive player dies and the death records the strike', () => {
    const d = new Duel(ASHEN_FOOTMAN, player({ hp: 50, maxHp: 50 }), 2);
    step(d, 60);
    expect(d.outcome).toBe('defeat');
    const e = d.events.find((x) => x.type === 'defeat');
    expect(e && e.type === 'defeat' && e.killedBy).toBeTruthy();
    expect(d.killedBy?.attack).toBeTruthy();
  });

  it('a bot that parries well beats every Tier I enemy with starter gear', () => {
    for (const enemy of [ASHEN_FOOTMAN, GATE_ARCHER, BRUTE, IRON_WARDEN]) {
      const d = new Duel(enemy, player({ weaponAtk: 18, attack: 5 }), 11);
      for (let i = 0; i < 120 * 600 && !d.over; i++) {
        const s = d.currentStrike;
        if (s && d.timeToImpact < 0.07) {
          if (s.kind === 'unblockable') d.dodge(s.from === 'left' ? 'right' : 'left');
          else d.swipe(s.kind === 'projectile' ? 'up' : (s.from as 'left'));
        } else if (d.enemyOpen && i % 18 === 0) {
          if (d.canRiposte) d.tap();
          else d.swipe(i % 36 ? 'left' : 'right');
        }
        d.update(DT);
      }
      expect(d.outcome, enemy.name).toBe('victory');
      expect(d.player.hp, enemy.name).toBe(400);
    }
  });
});
