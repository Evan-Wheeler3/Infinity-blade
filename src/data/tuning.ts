/**
 * Balance values from the Hollowspire GDD (sections 4, 5, 6 and 14).
 * Values marked PROVISIONAL are not specified in the GDD and were picked
 * for this prototype; tune them once playtest data exists.
 */

export const TIMING = {
  /** Section 4: parry window, default and accessibility variants (seconds). */
  parryWindow: 0.22,
  parryWindowEasy: 0.3,
  parryWindowIronbound: 0.18,
  perfectParryWindow: 0.09,
  dodgeInvuln: 0.35,
  dodgeCooldown: 0.6,
  comboReset: 1.5,
  soulBurstDuration: 6,
  hitStop: 0.06,
  /** Fairness rule: every attack has at least this much telegraph. */
  minTell: 0.45,
  maxTell: 1.2,
  /** Final strike of a combo is never more than 25% faster than the first. */
  maxComboSpeedup: 0.25,
  /** PROVISIONAL: how long the riposte prompt stays open after a Perfect Parry. */
  riposteWindow: 0.6,
  /**
   * PROVISIONAL: opening lengths after a successful defence. Sized so an
   * opening fits about 4 to 6 slashes, matching the GDD's "56 slashes in
   * 10 to 12 openings" for the King.
   */
  staggerParry: 1.1,
  staggerPerfect: 1.7,
  staggerHeavyParry: 0.6,
  staggerDodgeFinal: 0.9,
  /** Section 9: each stagger shortens the next by 15% until reset. */
  staggerResistStep: 0.15,
  /** PROVISIONAL: player stagger when the shield breaks. */
  shieldBreakStun: 1.0,
  /** PROVISIONAL: gap between an enemy recovering and its next combo. */
  enemyReadyMin: 0.7,
  enemyReadyMax: 1.4,
};

export const COMBAT = {
  comboStep: 0.15,
  comboMax: 2.5,
  weakPointMult: 1.6,
  guardBrokenMult: 1.5,
  riposteMult: 2.0,
  soulBurstMult: 2.0,
  /** Soul meter gains (fraction of a full meter). */
  soulPerfectParry: 0.12,
  soulComboSlash: 0.02,
  soulKill: 0.1, // PROVISIONAL: GDD says "and kills" without a number
  tonicHeal: 0.35,
  /** Guard costs as a fraction of max Guard. */
  guardCostQuick: 0.2, // PROVISIONAL
  guardCostHeavy: 0.6,
  /** Enemy time scale during Soul Burst slow time. PROVISIONAL. */
  burstEnemyTimeScale: 0.45,
  /** Wardens deal about 1.25x their tier's standard damage. */
  wardenDamageMult: 1.25,
};

export const PROGRESSION = {
  levelCap: 50,
  baseHealth: 100,
  healthPerLevel: 20,
  attackPerLevel: 1,
  shieldPerLevel: 1,
  magicPerLevel: 1,
  freePointsPerLevel: 3,
  /** PROVISIONAL: what one free point buys in each stat. */
  freePointHealth: 20,
  /** Tempering: each step adds 6% of base stats. */
  temperStep: 0.06,
  temperMax: 10,
};

/** Section 14 tier tuning table (first cycle). */
export interface TierTuning {
  normalHp: number;
  eliteHp: number;
  wardenHp: number;
  bestWeaponAtk: number;
  dmgQuick: number;
  dmgHeavy: number;
  dmgUnblockable: number;
  playerHpWithGear: number;
}

export const TIERS: TierTuning[] = [
  { normalHp: 240, eliteHp: 530, wardenHp: 1200, bestWeaponAtk: 18, dmgQuick: 20, dmgHeavy: 60, dmgUnblockable: 90, playerHpWithGear: 420 },
  { normalHp: 900, eliteHp: 1980, wardenHp: 4500, bestWeaponAtk: 46, dmgQuick: 45, dmgHeavy: 140, dmgUnblockable: 210, playerHpWithGear: 700 },
  { normalHp: 2800, eliteHp: 6160, wardenHp: 14000, bestWeaponAtk: 100, dmgQuick: 70, dmgHeavy: 220, dmgUnblockable: 330, playerHpWithGear: 1000 },
  { normalHp: 6000, eliteHp: 13200, wardenHp: 30000, bestWeaponAtk: 190, dmgQuick: 90, dmgHeavy: 290, dmgUnblockable: 430, playerHpWithGear: 1250 },
  { normalHp: 9000, eliteHp: 19800, wardenHp: 45000, bestWeaponAtk: 320, dmgQuick: 100, dmgHeavy: 380, dmgUnblockable: 560, playerHpWithGear: 1500 },
];

/** Section 6 economy. Drop amounts are PROVISIONAL (the GDD gives shares, not amounts). */
export const ECONOMY = {
  sellReturn: 0.25,
  ironboundGoldBonus: 0.25,
  eliteGoldMult: 2.2,
  vaultKeyPerTier: 400,
  tonicRefillPerTier: 100,
  secondWindCost: 2500,
  /** PROVISIONAL Tier I drop amounts, scaled by tier index below. */
  duelGold: 450,
  vaultGold: 900,
  wardenGold: 1200,
  /** PROVISIONAL XP rewards for Tier I. */
  duelXp: 160,
  wardenXpMult: 5,
  tierGoldGrowth: 3.8,
  tierXpGrowth: 3.0,
};

/** Section 6 gear price table (gold). Index = tier - 1. */
export const GEAR_PRICES = {
  weapon: [1500, 6000, 22000, 85000, 320000],
  shield: [1200, 4800, 17600, 68000, 256000],
  armor: [1500, 6000, 22000, 85000, 320000],
  helm: [900, 3600, 13200, 51000, 192000],
  ring: [750, 3000, 11000, 42500, 160000],
};
