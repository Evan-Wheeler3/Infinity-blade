/**
 * Tier I tower layout, door offers and rewards (GDD sections 6, 7 and 8).
 * Pure logic: the UI calls these and applies the results to the profile.
 */
import { ASHEN_FOOTMAN, BRUTE, IRON_WARDEN, TIER1_POOL, type EnemyDef } from '../data/enemies';
import { GEAR, GEAR_BY_ID } from '../data/gear';
import { ECONOMY } from '../data/tuning';
import { derivedStats, grantGear, owns, type ClimbState, type Profile } from './profile';
import { Rng } from './rng';

export type NodeType = 'duel' | 'elite' | 'vault' | 'shrine' | 'merchant' | 'secret' | 'warden';

export interface Door {
  type: NodeType;
  /** The enemy behind a duel door (not shown to the player). */
  enemy?: EnemyDef;
}

export const FLOOR_NAMES = ['Floor A', 'Floor B', 'Floor C', 'Warden'];

/** Section 8: Cinder Gate's authored doors. */
export const TIER1_LAYOUT: NodeType[][] = [
  ['duel', 'duel', 'vault'],
  ['shrine', 'duel', 'elite'],
  ['merchant', 'duel'],
];

export const NODE_INFO: Record<NodeType, { label: string; risk: string; blurb: string }> = {
  duel: { label: 'Duel', risk: 'Low', blurb: 'One enemy from the Cinder Gate.' },
  elite: { label: 'Elite duel', risk: 'Medium', blurb: '2.2x gold and a chance at gear.' },
  vault: { label: 'Vault', risk: 'Medium', blurb: 'A locked chest. Use a key, or fight its keeper.' },
  shrine: { label: 'Shrine', risk: 'None', blurb: 'Full heal and a Tonic refill.' },
  merchant: { label: 'Merchant', risk: 'None', blurb: 'Gear, keys and Second Wind.' },
  secret: { label: 'Secret door', risk: 'Medium', blurb: 'Rare loot, then straight to the Warden.' },
  warden: { label: 'The Iron Warden', risk: 'High', blurb: 'Keeper of the Cinder Gate.' },
};

export function newClimb(p: Profile, seed: number): ClimbState {
  return {
    seed,
    floor: 0,
    hp: derivedStats(p).maxHp,
    tonics: p.tonicMax,
    secondWind: false,
    secretRevealed: false,
  };
}

export function doorsFor(climb: ClimbState): Door[] {
  if (climb.floor >= TIER1_LAYOUT.length) return [{ type: 'warden', enemy: IRON_WARDEN }];
  const rng = new Rng(climb.seed * 31 + climb.floor * 7919);
  const pool = rng.shuffle([...TIER1_POOL]);
  const doors: Door[] = TIER1_LAYOUT[climb.floor].map((type) => {
    if (type === 'duel') return { type, enemy: pool.pop()! };
    if (type === 'elite') return { type, enemy: BRUTE };
    return { type };
  });
  // The secret door replaces a duel door on the following floor (A or B -> B or C).
  if (climb.secretRevealed) {
    const i = doors.findIndex((d) => d.type === 'duel');
    if (i >= 0) doors[i] = { type: 'secret' };
    else doors.push({ type: 'secret' });
  }
  return doors;
}

/** The Vault's keeper when the player has no key. */
export const VAULT_KEEPER = ASHEN_FOOTMAN;

export interface Reward {
  gold: number;
  xp: number;
  gear?: string;
  keys?: number;
  lines: string[];
}

function tierGearDrop(p: Profile, rng: Rng): string | undefined {
  const options = GEAR.filter((g) => g.tier === 1 && !g.unsold && !owns(p, g.id));
  return options.length ? rng.pick(options).id : undefined;
}

export function duelReward(p: Profile, enemy: EnemyDef, seed: number): Reward {
  const rng = new Rng(seed);
  const jitter = rng.range(0.85, 1.15);
  let gold = ECONOMY.duelGold * jitter;
  let xp = ECONOMY.duelXp * enemy.hpMult;
  const lines: string[] = [];
  let gear: string | undefined;

  if (enemy.rank === 'elite') {
    gold *= ECONOMY.eliteGoldMult;
    if (rng.next() < 0.5) gear = tierGearDrop(p, rng);
  } else if (enemy.rank === 'warden') {
    gold = ECONOMY.wardenGold * jitter;
    xp = ECONOMY.duelXp * ECONOMY.wardenXpMult;
    gear = owns(p, 'wardens-edge') ? tierGearDrop(p, rng) : 'wardens-edge';
  }
  if (gear) lines.push(`Found: ${GEAR_BY_ID[gear].name}`);
  return { gold: Math.round(gold), xp: Math.round(xp), gear, lines };
}

export function vaultReward(p: Profile, seed: number): Reward {
  const rng = new Rng(seed ^ 0x9e3779b9);
  const gold = Math.round(ECONOMY.vaultGold * rng.range(0.9, 1.2));
  const gear = rng.next() < 0.4 ? tierGearDrop(p, rng) : undefined;
  const lines = gear ? [`Found: ${GEAR_BY_ID[gear].name}`] : [];
  return { gold, xp: 0, gear, lines };
}

export function secretReward(p: Profile, seed: number): Reward {
  const rng = new Rng(seed ^ 0x51ed27);
  const gold = Math.round(ECONOMY.vaultGold * 1.6 * rng.range(0.9, 1.1));
  const gear = tierGearDrop(p, rng);
  const lines = gear ? [`Found: ${GEAR_BY_ID[gear].name}`] : [];
  return { gold, xp: 0, gear, keys: 1, lines: [...lines, 'Found: Vault key'] };
}

/** Applies gold, gear and keys. XP is applied separately so the UI can show level-ups. */
export function applyReward(p: Profile, r: Reward): void {
  p.gold += r.gold;
  if (r.gear && !owns(p, r.gear)) grantGear(p, r.gear);
  if (r.keys) p.vaultKeys += r.keys;
}

export interface MerchantItem {
  kind: 'gear' | 'key' | 'secondWind';
  id?: string;
  name: string;
  price: number;
}

export function merchantStock(p: Profile, climb: ClimbState): MerchantItem[] {
  const items: MerchantItem[] = GEAR.filter((g) => g.tier === 1 && !g.unsold && !owns(p, g.id)).map((g) => ({
    kind: 'gear' as const,
    id: g.id,
    name: g.name,
    price: g.price,
  }));
  items.push({ kind: 'key', name: 'Vault key', price: ECONOMY.vaultKeyPerTier });
  if (!climb.secondWind) items.push({ kind: 'secondWind', name: 'Second Wind', price: ECONOMY.secondWindCost });
  return items;
}
