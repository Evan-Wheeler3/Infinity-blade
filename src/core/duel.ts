/**
 * The duel: one player against one enemy (GDD section 4).
 *
 * Pure simulation with no rendering or DOM, so it can be unit tested and
 * later ported to the Unity build. The game calls the input methods
 * (swipe, dodge, setBlock, ...) and `update(dt)` each frame, then drains
 * `events` to drive animation, sound and UI.
 */
import { COMBAT, TIMING, TIERS } from '../data/tuning';
import type { AttackDef, EnemyDef, StrikeDef, StrikeFrom } from '../data/enemies';
import { comboMultiplier, slashDamage } from './formulas';
import { Rng } from './rng';

export type SwipeDir = 'left' | 'right' | 'up' | 'down';
export type DodgeDir = 'left' | 'right';

export interface PlayerCombatStats {
  maxHp: number;
  hp: number;
  /** Weapon attack including tempering. */
  weaponAtk: number;
  /** Attack stat. */
  attack: number;
  /** Fraction of damage a block removes (0.7 to 0.9). */
  blockReduction: number;
  maxGuard: number;
  /** Multiplier on Soul meter gains (rings, set bonuses). */
  soulGain: number;
  parryWindow: number;
  tonics: number;
  secondWind: boolean;
}

export type EnemyState = 'intro' | 'ready' | 'windup' | 'recover' | 'stagger' | 'dead';

export type DuelEvent =
  | { type: 'tell'; strike: StrikeDef; index: number; count: number; attack: string }
  | { type: 'parry'; perfect: boolean; strike: StrikeDef }
  | { type: 'dodge'; dir: DodgeDir; strike?: StrikeDef }
  | { type: 'block'; strike: StrikeDef; damage: number }
  | { type: 'shieldBreak' }
  | { type: 'playerHit'; strike: StrikeDef; damage: number }
  | { type: 'slash'; dir: SwipeDir; damage: number; combo: number; hits: number; riposte: boolean; strong: boolean }
  | { type: 'deflected'; dir: SwipeDir }
  | { type: 'whiff'; dir: SwipeDir }
  | { type: 'projectileReturned'; damage: number }
  | { type: 'enemyStagger'; duration: number }
  | { type: 'enemyRecover' }
  | { type: 'phase'; index: number; announce: string }
  | { type: 'riposteReady' }
  | { type: 'soulBurst' }
  | { type: 'soulBurstEnd' }
  | { type: 'tonic'; heal: number }
  | { type: 'secondWind'; hp: number }
  | { type: 'victory' }
  | { type: 'defeat'; killedBy: StrikeDef; attack: string };

/** Penalty after a mistimed swipe during an enemy windup, so parries can't be spammed. PROVISIONAL. */
const WHIFF_LOCKOUT = 0.25;
/** Fastest the player can chain slashes. PROVISIONAL. */
const SLASH_INTERVAL = 0.11;
/** Guard regenerates this fraction of max per second while not blocking. PROVISIONAL. */
const GUARD_REGEN = 0.2;
const INTRO_TIME = 1.0;

export class Duel {
  readonly enemy: EnemyDef;
  readonly events: DuelEvent[] = [];
  readonly player: PlayerCombatStats;

  /** Real (unscaled) time since the duel started. */
  time = 0;

  // Enemy
  enemyHp: number;
  readonly enemyMaxHp: number;
  enemyState: EnemyState = 'intro';
  /** Time left in the current enemy state, in enemy time. */
  private stateTimer = INTRO_TIME;
  private stateLength = INTRO_TIME;
  private attack: AttackDef | null = null;
  private strikeIndex = 0;
  private deck: AttackDef[] = [];
  private attacks: AttackDef[];
  private lastAttacks: string[] = [];
  private tellScale = 1;
  phaseIndex = 0;
  private staggerCount = 0;
  private readonly damageMult: number;

  // Player
  guard: number;
  soul = 0;
  blocking = false;
  combo = 0;
  private lastHitTime = -Infinity;
  private lastSlashTime = -Infinity;
  private dodgeStart = -Infinity;
  dodgeDir: DodgeDir = 'left';
  private lockoutUntil = -Infinity;
  stunnedUntil = -Infinity;
  riposteUntil = -Infinity;
  burstUntil = -Infinity;
  tonicUsed = false;
  outcome: 'pending' | 'victory' | 'defeat' = 'pending';
  /** Damage taken this duel (a no-damage win reveals the secret door). */
  damageTaken = 0;
  /** The strike that ended the duel, for the death screen. */
  killedBy: { strike: StrikeDef; attack: string } | null = null;

  private readonly rng: Rng;

  constructor(enemy: EnemyDef, player: PlayerCombatStats, seed = 1, hpScale = 1) {
    this.enemy = enemy;
    this.player = { ...player };
    this.rng = new Rng(seed);
    const tier = TIERS[enemy.tier - 1];
    const base = enemy.rank === 'warden' ? tier.wardenHp : tier.normalHp * enemy.hpMult;
    this.enemyMaxHp = Math.round(base * hpScale);
    this.enemyHp = this.enemyMaxHp;
    this.damageMult = enemy.rank === 'warden' ? COMBAT.wardenDamageMult : 1;
    this.attacks = [...enemy.attacks];
    this.guard = player.maxGuard;
  }

  // ---------------------------------------------------------------- queries

  get currentStrike(): StrikeDef | null {
    return this.enemyState === 'windup' && this.attack ? this.attack.strikes[this.strikeIndex] : null;
  }

  get currentAttack(): AttackDef | null {
    return this.attack;
  }

  get strikeCount(): number {
    return this.attack ? this.attack.strikes.length : 0;
  }

  get strikeIndexInCombo(): number {
    return this.strikeIndex;
  }

  /** 0 at the start of the current state, 1 at its end. */
  get stateProgress(): number {
    return this.stateLength > 0 ? 1 - this.stateTimer / this.stateLength : 1;
  }

  /** Enemy-time seconds until the current strike lands. */
  get timeToImpact(): number {
    return this.enemyState === 'windup' ? this.stateTimer : Infinity;
  }

  get enemyOpen(): boolean {
    return this.enemyState === 'stagger' || this.enemyState === 'recover';
  }

  get dodging(): boolean {
    return this.time - this.dodgeStart < TIMING.dodgeInvuln;
  }

  get dodgeReady(): boolean {
    return this.time - this.dodgeStart >= TIMING.dodgeCooldown;
  }

  get stunned(): boolean {
    return this.time < this.stunnedUntil;
  }

  get bursting(): boolean {
    return this.time < this.burstUntil;
  }

  get comboMult(): number {
    return comboMultiplier(this.combo);
  }

  get canRiposte(): boolean {
    return this.time < this.riposteUntil && this.enemyOpen;
  }

  get over(): boolean {
    return this.outcome !== 'pending';
  }

  // ----------------------------------------------------------------- inputs

  /** A swipe in the duel zone: a parry during a tell, a slash during an opening. */
  swipe(dir: SwipeDir): void {
    if (this.over || this.stunned || this.blocking) return;
    if (this.time < this.lockoutUntil) return;

    const strike = this.currentStrike;
    if (strike) {
      if (this.stateTimer <= this.player.parryWindow && this.parryMatches(strike, dir)) {
        this.parry(strike);
      } else {
        this.lockoutUntil = this.time + WHIFF_LOCKOUT;
        this.events.push({ type: 'whiff', dir });
      }
      return;
    }

    if (this.enemyOpen) {
      if (this.time - this.lastSlashTime < SLASH_INTERVAL) return;
      this.slash(dir, false);
      return;
    }

    if (this.enemyState === 'ready' || this.enemyState === 'intro') {
      this.events.push({ type: 'deflected', dir });
    }
  }

  /** Double-tap during the Perfect Parry flash: a guaranteed 2x hit. */
  tap(): void {
    if (this.over || !this.canRiposte) return;
    this.riposteUntil = -Infinity;
    this.slash('down', true);
  }

  dodge(dir: DodgeDir): void {
    if (this.over || this.stunned || !this.dodgeReady) return;
    this.dodgeStart = this.time;
    this.dodgeDir = dir;
    this.blocking = false;
    this.events.push({ type: 'dodge', dir });
  }

  setBlock(on: boolean): void {
    if (this.over) return;
    this.blocking = on && !this.stunned && this.guard > 0;
  }

  soulBurst(): boolean {
    if (this.over || this.soul < 1 || this.bursting) return false;
    this.soul = 0;
    this.burstUntil = this.time + TIMING.soulBurstDuration;
    this.events.push({ type: 'soulBurst' });
    return true;
  }

  drinkTonic(): boolean {
    if (this.over || this.tonicUsed || this.player.tonics <= 0 || this.player.hp >= this.player.maxHp) return false;
    this.tonicUsed = true;
    this.player.tonics -= 1;
    const heal = Math.round(this.player.maxHp * COMBAT.tonicHeal);
    this.player.hp = Math.min(this.player.maxHp, this.player.hp + heal);
    this.events.push({ type: 'tonic', heal });
    return true;
  }

  // ----------------------------------------------------------------- update

  update(dt: number): void {
    if (this.over) return;
    const wasBursting = this.bursting;
    this.time += dt;
    if (wasBursting && !this.bursting) this.events.push({ type: 'soulBurstEnd' });

    if (this.combo > 0 && this.time - this.lastHitTime > TIMING.comboReset) this.combo = 0;
    if (this.blocking && this.stunned) this.blocking = false;
    if (!this.blocking && !this.stunned) {
      this.guard = Math.min(this.player.maxGuard, this.guard + this.player.maxGuard * GUARD_REGEN * dt);
    }

    const enemyDt = dt * (this.bursting ? COMBAT.burstEnemyTimeScale : 1);
    this.stateTimer -= enemyDt;
    // Several transitions can happen in one long frame; cap to avoid spinning.
    for (let i = 0; i < 4 && this.stateTimer <= 0 && !this.over; i++) this.advanceState();
  }

  // --------------------------------------------------------------- internals

  private setState(state: EnemyState, length: number): void {
    this.enemyState = state;
    this.stateLength = length;
    this.stateTimer += length;
    if (this.stateTimer <= 0) this.stateTimer = Math.min(length, 0.0001);
  }

  private advanceState(): void {
    switch (this.enemyState) {
      case 'intro':
      case 'ready':
      case 'stagger':
        this.beginAttack();
        break;
      case 'windup':
        this.resolveImpact();
        break;
      case 'recover':
        this.staggerCount = 0;
        this.events.push({ type: 'enemyRecover' });
        this.setState('ready', this.readyGap());
        break;
      case 'dead':
        break;
    }
  }

  private readyGap(): number {
    return this.rng.range(TIMING.enemyReadyMin, TIMING.enemyReadyMax);
  }

  private drawAttack(): AttackDef {
    if (this.deck.length === 0) this.deck = this.rng.shuffle([...this.attacks]);
    let attack = this.deck.pop()!;
    // An attack never repeats more than twice in a row (section 9).
    const [a, b] = this.lastAttacks;
    if (a === attack.name && b === attack.name) {
      const alt = this.deck.findIndex((x) => x.name !== attack.name);
      if (alt >= 0) {
        const swap = this.deck.splice(alt, 1)[0];
        this.deck.push(attack);
        attack = swap;
      } else {
        const others = this.attacks.filter((x) => x.name !== attack.name);
        if (others.length) attack = this.rng.pick(others);
      }
    }
    this.lastAttacks = [attack.name, a];
    return attack;
  }

  /** Tell length after phase speed-ups, never below the fairness minimum. */
  private tellFor(strike: StrikeDef): number {
    return Math.max(TIMING.minTell, strike.tell * this.tellScale);
  }

  private beginAttack(): void {
    this.attack = this.drawAttack();
    this.strikeIndex = 0;
    this.beginStrike();
  }

  private beginStrike(): void {
    const attack = this.attack!;
    const strike = attack.strikes[this.strikeIndex];
    this.setState('windup', this.tellFor(strike));
    this.events.push({ type: 'tell', strike, index: this.strikeIndex, count: attack.strikes.length, attack: attack.name });
  }

  private nextStrikeOrRecover(): void {
    const attack = this.attack!;
    if (this.strikeIndex + 1 < attack.strikes.length) {
      this.strikeIndex += 1;
      this.beginStrike();
    } else {
      this.setState('recover', attack.recovery);
    }
  }

  private parryMatches(strike: StrikeDef, dir: SwipeDir): boolean {
    if (strike.kind === 'unblockable') return false;
    if (strike.kind === 'projectile') return true; // any swipe deflects a projectile
    return dir === (strike.from as SwipeDir);
  }

  private dodgeMatches(strike: StrikeDef): boolean {
    if (!this.dodging) return false;
    const from: StrikeFrom = strike.from;
    if (from === 'up' || strike.kind === 'projectile') return true;
    // Dodge away from the strike.
    return (from === 'left' && this.dodgeDir === 'right') || (from === 'right' && this.dodgeDir === 'left');
  }

  private parry(strike: StrikeDef): void {
    const perfect = this.stateTimer <= TIMING.perfectParryWindow;
    this.events.push({ type: 'parry', perfect, strike });
    if (perfect) this.gainSoul(COMBAT.soulPerfectParry);

    if (strike.kind === 'projectile') {
      const damage = Math.round(this.baseSlash(1) * 1.5);
      this.events.push({ type: 'projectileReturned', damage });
      this.damageEnemy(damage);
      if (this.over) return;
      // A returned projectile doesn't stagger; the volley continues.
      this.stateTimer = 0;
      this.nextStrikeOrRecover();
      return;
    }

    if (strike.kind === 'heavy') {
      this.stagger(TIMING.staggerHeavyParry);
    } else {
      this.stagger(perfect ? TIMING.staggerPerfect : TIMING.staggerParry);
    }
    if (perfect) {
      this.riposteUntil = this.time + TIMING.riposteWindow;
      this.events.push({ type: 'riposteReady' });
    }
  }

  private stagger(base: number): void {
    const resist = Math.max(0.4, 1 - TIMING.staggerResistStep * this.staggerCount);
    const duration = base * resist;
    this.staggerCount += 1;
    this.stateTimer = 0;
    this.setState('stagger', duration);
    this.events.push({ type: 'enemyStagger', duration });
  }

  private resolveImpact(): void {
    const strike = this.currentStrike!;
    const isFinal = this.strikeIndex === this.strikeCount - 1;
    const tier = TIERS[this.enemy.tier - 1];
    const raw =
      (strike.kind === 'heavy' ? tier.dmgHeavy : strike.kind === 'unblockable' ? tier.dmgUnblockable : tier.dmgQuick) *
      this.damageMult;

    if (this.dodgeMatches(strike)) {
      this.events.push({ type: 'dodge', dir: this.dodgeDir, strike });
      if (isFinal) {
        this.stagger(TIMING.staggerDodgeFinal);
        return;
      }
      this.nextStrikeOrRecover();
      return;
    }

    if (this.blocking && strike.kind !== 'unblockable') {
      const damage = Math.round(raw * (1 - this.player.blockReduction));
      const cost = strike.guardBreak ? 1 : strike.kind === 'heavy' ? COMBAT.guardCostHeavy : COMBAT.guardCostQuick;
      this.guard = Math.max(0, this.guard - cost * this.player.maxGuard);
      this.events.push({ type: 'block', strike, damage });
      this.hurtPlayer(strike, damage, false);
      if (this.guard <= 0.001) {
        this.guard = 0;
        this.blocking = false;
        this.stunnedUntil = this.time + TIMING.shieldBreakStun;
        this.events.push({ type: 'shieldBreak' });
      }
    } else {
      this.hurtPlayer(strike, Math.round(raw), true);
    }
    // A Second Wind revive moves the enemy back to 'ready'; don't continue the combo then.
    if (!this.over && this.enemyState === 'windup') this.nextStrikeOrRecover();
  }

  private hurtPlayer(strike: StrikeDef, damage: number, clean: boolean): void {
    if (damage > 0) {
      this.player.hp = Math.max(0, this.player.hp - damage);
      this.damageTaken += damage;
    }
    if (clean) {
      this.events.push({ type: 'playerHit', strike, damage });
      this.combo = 0;
      this.staggerCount = 0;
    }
    if (this.player.hp <= 0) {
      if (this.player.secondWind) {
        this.player.secondWind = false;
        this.player.hp = Math.round(this.player.maxHp * 0.4);
        this.events.push({ type: 'secondWind', hp: this.player.hp });
        // The enemy resets so the revive isn't punished instantly.
        this.stateTimer = 0;
        this.setState('ready', 1.5);
        return;
      }
      this.outcome = 'defeat';
      this.killedBy = { strike, attack: this.attack?.name ?? '' };
      this.events.push({ type: 'defeat', killedBy: strike, attack: this.killedBy.attack });
    }
  }

  private baseSlash(comboMult: number, mods = 1): number {
    return slashDamage({
      weapon: this.player.weaponAtk,
      attack: this.player.attack,
      combo: comboMult,
      mods: mods * (this.bursting ? COMBAT.soulBurstMult : 1),
      armor: this.enemy.armor,
    });
  }

  private slash(dir: SwipeDir, riposte: boolean): void {
    if (this.time - this.lastHitTime > TIMING.comboReset) this.combo = 0;
    this.combo += 1;
    this.lastHitTime = this.time;
    this.lastSlashTime = this.time;
    const mult = comboMultiplier(this.combo);
    const damage = Math.max(1, Math.round(this.baseSlash(mult, riposte ? COMBAT.riposteMult : 1)));
    const strong = riposte || this.bursting || this.combo % 5 === 0;
    this.events.push({ type: 'slash', dir, damage, combo: mult, hits: this.combo, riposte, strong });
    this.gainSoul(COMBAT.soulComboSlash);
    this.damageEnemy(damage);
  }

  private gainSoul(amount: number): void {
    this.soul = Math.min(1, this.soul + amount * this.player.soulGain);
  }

  private damageEnemy(damage: number): void {
    this.enemyHp = Math.max(0, this.enemyHp - damage);
    if (this.enemyHp <= 0) {
      this.enemyState = 'dead';
      this.outcome = 'victory';
      this.gainSoul(COMBAT.soulKill);
      this.events.push({ type: 'victory' });
      return;
    }
    this.checkPhase();
  }

  private checkPhase(): void {
    const frac = this.enemyHp / this.enemyMaxHp;
    while (this.phaseIndex < this.enemy.phases.length && frac < this.enemy.phases[this.phaseIndex].below) {
      const phase = this.enemy.phases[this.phaseIndex];
      this.phaseIndex += 1;
      this.tellScale *= phase.tellScale;
      this.attacks = [...this.attacks, ...phase.addAttacks];
      this.deck = [];
      this.events.push({ type: 'phase', index: this.phaseIndex, announce: phase.announce });
    }
  }
}
