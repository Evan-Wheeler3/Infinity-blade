/** Persistent player profile: level, stats, gold and gear (GDD section 5). */
import { GEAR_BY_ID, STARTING_KIT, type GearDef, type Slot } from '../data/gear';
import { PROGRESSION, TIMING } from '../data/tuning';
import { temperCost, temperMultiplier, xpToNext } from './formulas';

export interface OwnedGear {
  uid: string;
  id: string;
  temper: number;
}

export interface ClimbState {
  seed: number;
  /** 0, 1, 2 = Floors A to C; 3 = the Warden. */
  floor: number;
  hp: number;
  tonics: number;
  secondWind: boolean;
  /** A no-damage duel revealed the secret door on the next floor. */
  secretRevealed: boolean;
}

export interface Settings {
  /** Easy parry window (300 ms) from the accessibility options. */
  wideParry: boolean;
  sound: boolean;
  haptics: boolean;
}

export interface Profile {
  version: 1;
  level: number;
  xp: number;
  gold: number;
  freePoints: number;
  alloc: { health: number; attack: number; shield: number };
  gear: OwnedGear[];
  equipped: Partial<Record<Slot, string>>;
  vaultKeys: number;
  tonicMax: number;
  nextUid: number;
  wardenDefeated: boolean;
  stats: { climbs: number; deaths: number; kills: number; perfectParries: number };
  settings: Settings;
  climb: ClimbState | null;
}

export function newProfile(): Profile {
  const p: Profile = {
    version: 1,
    level: 1,
    xp: 0,
    gold: 0,
    freePoints: 0,
    alloc: { health: 0, attack: 0, shield: 0 },
    gear: [],
    equipped: {},
    vaultKeys: 1,
    tonicMax: 1,
    nextUid: 1,
    wardenDefeated: false,
    stats: { climbs: 0, deaths: 0, kills: 0, perfectParries: 0 },
    settings: { wideParry: false, sound: true, haptics: true },
    climb: null,
  };
  for (const id of STARTING_KIT) equip(p, grantGear(p, id).uid);
  return p;
}

export function grantGear(p: Profile, id: string): OwnedGear {
  const item: OwnedGear = { uid: `g${p.nextUid++}`, id, temper: 0 };
  p.gear.push(item);
  return item;
}

export function owns(p: Profile, id: string): boolean {
  return p.gear.some((g) => g.id === id);
}

export function findOwned(p: Profile, uid: string): OwnedGear | undefined {
  return p.gear.find((g) => g.uid === uid);
}

export function equippedDef(p: Profile, slot: Slot): { item: OwnedGear; def: GearDef } | null {
  const uid = p.equipped[slot];
  const item = uid ? findOwned(p, uid) : undefined;
  return item ? { item, def: GEAR_BY_ID[item.id] } : null;
}

export function equip(p: Profile, uid: string): void {
  const item = findOwned(p, uid);
  if (!item) return;
  p.equipped[GEAR_BY_ID[item.id].slot] = uid;
}

export interface DerivedStats {
  maxHp: number;
  weaponAtk: number;
  attack: number;
  shield: number;
  blockReduction: number;
  maxGuard: number;
  soulGain: number;
  parryWindow: number;
}

export function derivedStats(p: Profile): DerivedStats {
  const lvl = p.level;
  const attack = PROGRESSION.attackPerLevel * (lvl - 1) + p.alloc.attack;
  const shield = PROGRESSION.shieldPerLevel * (lvl - 1) + p.alloc.shield;
  let maxHp = PROGRESSION.baseHealth + PROGRESSION.healthPerLevel * lvl + PROGRESSION.freePointHealth * p.alloc.health;
  let weaponAtk = 0;
  let block = 0.6;
  let guard = 80;
  let soulGain = 1;
  let parryBonus = 0;

  for (const slot of Object.keys(p.equipped) as Slot[]) {
    const e = equippedDef(p, slot);
    if (!e) continue;
    const m = temperMultiplier(e.item.temper);
    const d = e.def;
    if (d.atk) weaponAtk = d.atk * m;
    if (d.health) maxHp += d.health * m;
    if (d.block) block = d.block;
    if (d.guard) guard = d.guard * m;
    if (d.soulGain) soulGain *= d.soulGain;
    if (d.parryBonus) parryBonus += d.parryBonus;
  }

  // Shield stat: reduces block damage and raises Guard capacity. PROVISIONAL rates.
  const blockReduction = Math.min(0.9, block + 0.004 * shield);
  const maxGuard = guard + 3 * shield;
  const parryWindow = (p.settings.wideParry ? TIMING.parryWindowEasy : TIMING.parryWindow) + parryBonus;

  return {
    maxHp: Math.round(maxHp),
    weaponAtk: Math.round(weaponAtk * 10) / 10,
    attack,
    shield,
    blockReduction,
    maxGuard: Math.round(maxGuard),
    soulGain,
    parryWindow,
  };
}

/** Adds XP and returns how many levels were gained. */
export function addXp(p: Profile, xp: number): number {
  p.xp += Math.round(xp);
  let gained = 0;
  while (p.level < PROGRESSION.levelCap && p.xp >= xpToNext(p.level)) {
    p.xp -= xpToNext(p.level);
    p.level += 1;
    p.freePoints += PROGRESSION.freePointsPerLevel;
    gained += 1;
  }
  return gained;
}

export function allocate(p: Profile, stat: keyof Profile['alloc']): boolean {
  if (p.freePoints <= 0) return false;
  p.freePoints -= 1;
  p.alloc[stat] += 1;
  return true;
}

/** Free respec at the Hearth. */
export function respec(p: Profile): void {
  p.freePoints += p.alloc.health + p.alloc.attack + p.alloc.shield;
  p.alloc = { health: 0, attack: 0, shield: 0 };
}

export function nextTemperCost(p: Profile, uid: string): number {
  const item = findOwned(p, uid);
  if (!item) return Infinity;
  return temperCost(GEAR_BY_ID[item.id].price, item.temper);
}

export function temper(p: Profile, uid: string): boolean {
  const item = findOwned(p, uid);
  if (!item) return false;
  const cost = nextTemperCost(p, uid);
  if (!isFinite(cost) || p.gold < cost) return false;
  p.gold -= cost;
  item.temper += 1;
  return true;
}

export function buy(p: Profile, id: string): boolean {
  const def = GEAR_BY_ID[id];
  if (!def || p.gold < def.price || owns(p, id)) return false;
  p.gold -= def.price;
  equip(p, grantGear(p, id).uid);
  return true;
}
