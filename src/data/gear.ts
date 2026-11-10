/** Gear for the starting kit and Tier I (GDD section 5). Prices follow the section 6 table. */
import { GEAR_PRICES } from './tuning';

export type Slot = 'weapon' | 'shield' | 'armor' | 'helm' | 'ring';
export type Rarity = 'common' | 'fine' | 'rare' | 'epic' | 'legend';
export type WeaponClass = 'longsword' | 'greatblade' | 'daggers' | 'spear' | 'axe' | 'katana';

export interface GearDef {
  id: string;
  name: string;
  slot: Slot;
  tier: number;
  rarity: Rarity;
  price: number;
  weaponClass?: WeaponClass;
  /** Weapon attack (W). */
  atk?: number;
  /** Shield: fraction of damage removed by a block. */
  block?: number;
  /** Shield: Guard capacity. */
  guard?: number;
  /** Bonus max HP. */
  health?: number;
  /** Multiplier on Soul gain (1 = none). */
  soulGain?: number;
  /** Seconds added to the parry window. */
  parryBonus?: number;
  /** Not sold anywhere (starting kit, boss drops). */
  unsold?: boolean;
  blurb: string;
}

const price = (slot: Slot, tier: number) => GEAR_PRICES[slot][tier - 1];

export const GEAR: GearDef[] = [
  // Starting kit
  { id: 'oath-blade', name: 'Oath Blade', slot: 'weapon', tier: 0, rarity: 'common', price: 300, weaponClass: 'longsword', atk: 10, unsold: true, blurb: 'Every heir is given the same blade.' },
  { id: 'oath-buckler', name: 'Oath Buckler', slot: 'shield', tier: 0, rarity: 'common', price: 240, block: 0.7, guard: 100, unsold: true, blurb: 'Light, dented, honest.' },
  { id: 'oath-mail', name: 'Oath Mail', slot: 'armor', tier: 0, rarity: 'common', price: 300, health: 120, unsold: true, blurb: 'Ash-grey links over quilted cloth.' },

  // Tier I: Cinder Gate (Fine)
  { id: 'cinder-longsword', name: 'Cinder Longsword', slot: 'weapon', tier: 1, rarity: 'fine', price: price('weapon', 1), weaponClass: 'longsword', atk: 18, blurb: 'Forged in the gatehouse before it burned.' },
  { id: 'gatehouse-shield', name: 'Gatehouse Shield', slot: 'shield', tier: 1, rarity: 'fine', price: price('shield', 1), block: 0.78, guard: 130, parryBonus: 0.01, blurb: 'Light shield. Holds against the Brute.' },
  { id: 'cinder-plate', name: 'Cinder Plate', slot: 'armor', tier: 1, rarity: 'fine', price: price('armor', 1), health: 200, blurb: 'Blackened plate, still warm.' },
  { id: 'ember-helm', name: 'Ember Helm', slot: 'helm', tier: 1, rarity: 'fine', price: price('helm', 1), health: 90, soulGain: 1.05, blurb: 'Glows faintly when you parry well.' },
  { id: 'ring-of-embers', name: 'Ring of Embers', slot: 'ring', tier: 1, rarity: 'fine', price: price('ring', 1), soulGain: 1.15, blurb: '+15% Soul gain.' },

  // Iron Warden drop
  { id: 'wardens-edge', name: "Warden's Edge", slot: 'weapon', tier: 1, rarity: 'rare', price: 2400, weaponClass: 'longsword', atk: 24, unsold: true, blurb: 'Taken from the Iron Warden. Heavier than it looks.' },
];

export const GEAR_BY_ID: Record<string, GearDef> = Object.fromEntries(GEAR.map((g) => [g.id, g]));

export const STARTING_KIT = ['oath-blade', 'oath-buckler', 'oath-mail'];

export const RARITY_COLOR: Record<Rarity, string> = {
  common: '#a7adb8',
  fine: '#5fd17a',
  rare: '#5aa8ff',
  epic: '#b57cff',
  legend: '#ffc548',
};
