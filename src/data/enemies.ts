/**
 * Enemy definitions for Tier I: Cinder Gate (GDD sections 8, 9 and 10).
 * Tell times are in seconds and must respect the fairness rules in section 4
 * (tests/enemies.test.ts checks them).
 */

export type StrikeKind = 'quick' | 'heavy' | 'unblockable' | 'projectile';
/** Where a strike comes from, as seen by the player. */
export type StrikeFrom = 'left' | 'right' | 'up';

export interface StrikeDef {
  kind: StrikeKind;
  from: StrikeFrom;
  /** Telegraph length before impact, seconds. */
  tell: number;
  /** Blocking this strike empties the Guard meter (Brute shield bash). */
  guardBreak?: boolean;
}

export interface AttackDef {
  name: string;
  strikes: StrikeDef[];
  /** Opening after the combo finishes without being interrupted. */
  recovery: number;
}

export interface PhaseDef {
  /** Phase starts when HP falls below this fraction. */
  below: number;
  /** Multiplies tell lengths (0.87 = 15% faster). Clamped to the fairness minimum. */
  tellScale: number;
  /** Attacks added to the deck for this phase. */
  addAttacks: AttackDef[];
  announce: string;
}

export type ModelKind = 'footman' | 'hound' | 'archer' | 'brute' | 'warden';

export interface EnemyDef {
  id: string;
  name: string;
  tier: number;
  role: string;
  rank: 'normal' | 'elite' | 'warden';
  /** Multiplier on the tier's normal enemy HP (ignored for wardens, which use wardenHp). */
  hpMult: number;
  /** Armor damage reduction, 0 to 0.5. */
  armor: number;
  attacks: AttackDef[];
  phases: PhaseDef[];
  counterHint: string;
  model: ModelKind;
  /** Short line for the entrance card. */
  intro: string;
}

const q = (from: StrikeFrom, tell: number): StrikeDef => ({ kind: 'quick', from, tell });
const h = (from: StrikeFrom, tell: number): StrikeDef => ({ kind: 'heavy', from, tell });
const u = (from: StrikeFrom, tell: number): StrikeDef => ({ kind: 'unblockable', from, tell });
const p = (tell: number): StrikeDef => ({ kind: 'projectile', from: 'up', tell });

/** Elites and Wardens speed up 15% below 30% HP and gain one new attack (section 9). */
const enrage = (attack: AttackDef): PhaseDef => ({
  below: 0.3,
  tellScale: 1 / 1.15,
  addAttacks: [attack],
  announce: 'Enraged',
});

export const ASHEN_FOOTMAN: EnemyDef = {
  id: 'ashen-footman',
  name: 'Ashen Footman',
  tier: 1,
  role: 'Grunt',
  rank: 'normal',
  hpMult: 1.0,
  armor: 0,
  model: 'footman',
  counterHint: 'Parry the second hit.',
  intro: 'A gate guard still burning at the edges.',
  attacks: [
    { name: 'Cross Cut', strikes: [q('left', 0.8), q('right', 0.7)], recovery: 1.5 },
    { name: 'Rising Chop', strikes: [q('up', 0.85), h('up', 0.75)], recovery: 1.6 },
    { name: 'Lunge', strikes: [q('right', 0.9)], recovery: 1.2 },
  ],
  phases: [],
};

export const EMBER_HOUND: EnemyDef = {
  id: 'ember-hound',
  name: 'Ember Hound',
  tier: 1,
  role: 'Fast',
  rank: 'normal',
  hpMult: 0.8,
  armor: 0,
  model: 'hound',
  counterHint: 'Short tells. Dodge sideways.',
  intro: 'It smells the oath on you.',
  attacks: [
    { name: 'Snap', strikes: [q('left', 0.55)], recovery: 1.0 },
    { name: 'Snap', strikes: [q('right', 0.55)], recovery: 1.0 },
    { name: 'Frenzy', strikes: [q('left', 0.65), q('right', 0.6), q('left', 0.6)], recovery: 1.3 },
    { name: 'Pounce', strikes: [h('up', 0.75)], recovery: 1.4 },
  ],
  phases: [],
};

export const GATE_ARCHER: EnemyDef = {
  id: 'gate-archer',
  name: 'Gate Archer',
  tier: 1,
  role: 'Ranged',
  rank: 'normal',
  hpMult: 0.8,
  armor: 0,
  model: 'archer',
  counterHint: 'Parry arrows back at the archer.',
  intro: 'The wall still has one sentry.',
  attacks: [
    { name: 'Loose', strikes: [p(0.9)], recovery: 0.9 },
    { name: 'Volley', strikes: [p(0.8), p(0.7), p(0.65)], recovery: 1.2 },
    { name: 'Dash Cut', strikes: [q('left', 0.7), q('right', 0.6)], recovery: 1.4 },
  ],
  phases: [],
};

export const BRUTE: EnemyDef = {
  id: 'brute',
  name: 'Brute',
  tier: 1,
  role: 'Heavy (elite)',
  rank: 'elite',
  hpMult: 2.2,
  armor: 0.1,
  model: 'brute',
  counterHint: 'Dodge the smash. Its shield bash breaks your Guard.',
  intro: 'Something the gate fed until it stopped fitting through it.',
  attacks: [
    { name: 'Overhead Smash', strikes: [h('up', 1.05)], recovery: 1.8 },
    { name: 'Shield Bash', strikes: [{ kind: 'quick', from: 'left', tell: 0.8, guardBreak: true }, h('right', 0.85)], recovery: 1.6 },
    { name: 'Hammer Swing', strikes: [q('right', 0.75), q('left', 0.7), h('up', 0.9)], recovery: 1.7 },
  ],
  phases: [enrage({ name: 'Ground Splitter', strikes: [u('right', 0.95)], recovery: 1.8 })],
};

export const IRON_WARDEN: EnemyDef = {
  id: 'iron-warden',
  name: 'The Iron Warden',
  tier: 1,
  role: 'Tier Warden',
  rank: 'warden',
  hpMult: 1,
  armor: 0.1,
  model: 'warden',
  counterHint: 'Slow, readable swings. Learn the parry timing.',
  intro: 'Keeper of the Cinder Gate. He has turned back every heir before you.',
  attacks: [
    { name: 'Greatsword Arc', strikes: [h('left', 1.1)], recovery: 1.8 },
    { name: 'Greatsword Arc', strikes: [h('right', 1.1)], recovery: 1.8 },
    { name: 'Twin Arc', strikes: [q('left', 0.95), q('right', 0.85)], recovery: 1.6 },
    { name: 'Shield Bash', strikes: [{ kind: 'quick', from: 'up', tell: 0.9, guardBreak: true }], recovery: 1.4 },
  ],
  phases: [
    {
      below: 0.5,
      tellScale: 0.85,
      announce: 'The Warden hurls his shield aside',
      addAttacks: [
        { name: 'Shield Throw', strikes: [p(0.9)], recovery: 1.2 },
        { name: 'Ironfall', strikes: [q('right', 0.9), q('left', 0.8), u('up', 1.0)], recovery: 1.9 },
      ],
    },
    enrage({ name: 'Gatebreaker', strikes: [h('up', 1.0), u('left', 0.9)], recovery: 2.0 }),
  ],
};

export const TIER1_POOL: EnemyDef[] = [ASHEN_FOOTMAN, EMBER_HOUND, GATE_ARCHER];
export const ALL_ENEMIES: EnemyDef[] = [ASHEN_FOOTMAN, EMBER_HOUND, GATE_ARCHER, BRUTE, IRON_WARDEN];
