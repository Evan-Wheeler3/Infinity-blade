/**
 * Hollowspire browser prototype: game controller.
 * Owns the screens (Hearth, doors, rooms, results), runs duels and keeps the
 * HUD, stage, audio and haptics in sync with the duel's events.
 */
import './style.css';
import { Duel, type PlayerCombatStats } from './core/duel';
import { xpToNext } from './core/formulas';
import {
  addXp,
  allocate,
  buy,
  derivedStats,
  equip,
  equippedDef,
  nextTemperCost,
  respec,
  temper,
  type Profile,
} from './core/profile';
import {
  applyReward,
  doorsFor,
  duelReward,
  FLOOR_NAMES,
  merchantStock,
  newClimb,
  NODE_INFO,
  secretReward,
  VAULT_KEEPER,
  vaultReward,
  type Door,
  type Reward,
} from './core/tower';
import { ALL_ENEMIES, type EnemyDef, type StrikeDef } from './data/enemies';
import { GEAR_BY_ID, RARITY_COLOR, type Slot } from './data/gear';
import { TIMING } from './data/tuning';
import { haptic, Sfx } from './audio';
import { Gestures } from './input/gestures';
import { Stage } from './render/stage';
import { clearSave, loadProfile, saveProfile } from './storage';
import { $, fmt, h, svg } from './ui/dom';
import { DOOR_ICON, TELL_COLOR_CSS, TELL_COUNTER, TELL_NAME, TELL_SHAPE } from './ui/icons';

type DuelContext = { door: Door; enemy: EnemyDef; vaultKeeper: boolean };

const SLOTS: Slot[] = ['weapon', 'shield', 'armor', 'helm', 'ring'];
const FROM_ARROW = { left: '←', right: '→', up: '↑' } as const;

class Game {
  profile: Profile;
  private hadSave: boolean;
  private stage: Stage;
  private sfx = new Sfx();
  private gestures: Gestures;
  duel: Duel | null = null;
  private ctx: DuelContext | null = null;
  private paused = false;
  private last = performance.now();
  private realTime = 0;
  private hitStopUntil = 0;
  private slowUntil = 0;
  private endAt = -1;
  private trails: { pts: { x: number; y: number }[]; age: number }[] = [];
  private trailCtx: CanvasRenderingContext2D;
  private lagHp = 1;
  private shownHowTo = false;

  constructor() {
    const loaded = loadProfile();
    this.profile = loaded.profile;
    this.hadSave = loaded.existing;
    this.sfx.enabled = this.profile.settings.sound;
    this.stage = new Stage($('stage') as HTMLCanvasElement);
    this.trailCtx = ($('trail') as HTMLCanvasElement).getContext('2d')!;
    this.resizeTrail();
    window.addEventListener('resize', () => this.resizeTrail());

    this.gestures = new Gestures($('touch'), {
      swipe: (d) => this.duel?.swipe(d),
      dodge: (d) => this.duel?.dodge(d),
      tap: () => this.duel?.tap(),
      block: (on) => this.setBlock(on),
      burst: () => this.duel?.soulBurst(),
      tonic: () => this.duel?.drinkTonic(),
      pause: () => this.togglePause(),
      trail: (pts, done) => this.addTrail(pts, done),
    });
    this.bindHud();
    // Audio can only start after a user gesture.
    window.addEventListener('pointerdown', () => this.sfx.unlock(), { once: false });
    window.addEventListener('keydown', () => this.sfx.unlock(), { once: false });

    // Dev shortcut: ?duel=<enemy-id> jumps straight into a duel.
    const devDuel = new URLSearchParams(location.search).get('duel');
    const devEnemy = devDuel ? ALL_ENEMIES.find((e) => e.id === devDuel) : undefined;
    if (devEnemy) {
      (window as unknown as { __game: Game }).__game = this;
      this.shownHowTo = true;
      if (!this.profile.climb) this.profile.climb = newClimb(this.profile, 1);
      this.startDuel({ door: { type: devEnemy.rank === 'warden' ? 'warden' : devEnemy.rank === 'elite' ? 'elite' : 'duel', enemy: devEnemy }, enemy: devEnemy, vaultKeeper: false });
    } else {
      this.showTitle();
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  // -------------------------------------------------------------- plumbing

  private save(): void {
    saveProfile(this.profile);
  }

  private setScreen(content: HTMLElement, dim = false): void {
    const s = $('screen');
    s.replaceChildren(content);
    s.className = 'show' + (dim ? ' dim' : '');
    s.scrollTop = 0;
  }

  private hideScreen(): void {
    $('screen').className = '';
    $('screen').replaceChildren();
  }

  private btn(label: string, onClick: () => void, cls = 'btn', disabled = false): HTMLButtonElement {
    return h('button', {
      class: cls,
      disabled,
      onclick: () => {
        this.sfx.click();
        onClick();
      },
    }, label);
  }

  private resizeTrail(): void {
    const c = $('trail') as HTMLCanvasElement;
    const dpr = Math.min(window.devicePixelRatio, 2);
    c.width = window.innerWidth * dpr;
    c.height = window.innerHeight * dpr;
    this.trailCtx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ----------------------------------------------------------------- title

  private showTitle(): void {
    this.stage.setMode('hearth');
    this.stage.setEnemy(null);
    const p = this.profile;
    this.setScreen(
      h('div', { class: 'center' },
        h('h1', {}, 'HOLLOWSPIRE'),
        h('p', { class: 'sub' }, 'You are the last knight of the Ash Oath. The Hollow King waits at the top of a living tower. Every fall sends you back down, stronger.'),
        h('div', { class: 'row' },
          this.btn(this.hadSave ? 'Continue' : 'Take the Oath', () => this.showHearth(), 'btn primary'),
          this.btn('How to fight', () => this.showHowTo(() => this.showTitle())),
        ),
        h('p', { class: 'foot' }, this.hadSave ? `Level ${p.level} · ${fmt(p.gold)} gold · ${p.stats.climbs} climbs` : 'Prototype: Tier I, the Cinder Gate'),
      ),
    );
  }

  private showHowTo(back: () => void, cta = 'Back'): void {
    const tell = (k: keyof typeof TELL_SHAPE) =>
      h('div', {}, svgShape(k), h('span', {}, h('b', { style: `color:${TELL_COLOR_CSS[k]}` }, TELL_NAME[k]), ' · ', TELL_COUNTER[k]));
    this.setScreen(
      h('div', { class: 'wrap center' },
        h('h2', {}, 'How to fight'),
        h('div', { class: 'howto' },
          h('div', { class: 'panel' }, h('b', {}, 'Parry'), 'When an enemy winds up, an arrow shows where the strike comes from. Swipe toward it as the ring closes. The last 90 ms is a Perfect Parry: tap right after for a free 2x riposte. ', h('span', { class: 'kbd' }, '←↑→')),
          h('div', { class: 'panel' }, h('b', {}, 'Slash'), 'A parry or dodge opens the enemy. Swipe across it to slash; chained hits raise the combo up to 2.5x. Swiping at a guarded enemy is deflected. ', h('span', { class: 'kbd' }, 'arrows')),
          h('div', { class: 'panel' }, h('b', {}, 'Dodge'), 'Swipe left or right in the bottom band, or tap a chevron. Dodge away from the strike. 350 ms of invulnerability. ', h('span', { class: 'kbd' }, 'A'), ' ', h('span', { class: 'kbd' }, 'D')),
          h('div', { class: 'panel' }, h('b', {}, 'Block, Soul and Tonic'), 'Hold the shield to block; it drains Guard and breaks at zero. Fill the Soul ring with Perfect Parries and combos, then release Soul Burst for slow time and 2x damage. ', h('span', { class: 'kbd' }, 'S'), ' ', h('span', { class: 'kbd' }, 'Space'), ' ', h('span', { class: 'kbd' }, 'E')),
        ),
        h('div', { class: 'panel tells', style: 'text-align:left;max-width:640px;width:100%' }, tell('quick'), tell('heavy'), tell('unblockable'), tell('projectile')),
        h('div', { class: 'row', style: 'margin-top:18px' }, this.btn(cta, back, 'btn primary')),
      ),
    );
  }

  // ---------------------------------------------------------------- hearth

  private showHearth(): void {
    this.stage.setMode('hearth');
    this.stage.setEnemy(null);
    this.stage.playerReset();
    $('hud').hidden = true;
    this.gestures.enabled = false;
    const p = this.profile;
    const s = derivedStats(p);
    const need = xpToNext(p.level);

    const statRow = (label: string, value: string, stat?: keyof Profile['alloc']) =>
      h('div', { class: 'kv' },
        h('span', { class: 'k' }, label),
        h('span', {}, value, ' ',
          stat && p.freePoints > 0
            ? this.btn('+', () => {
                allocate(p, stat);
                this.save();
                this.showHearth();
              }, 'btn small')
            : null,
        ),
      );

    const gearRows = SLOTS.map((slot) => {
      const e = equippedDef(p, slot);
      const others = p.gear.filter((g) => GEAR_BY_ID[g.id].slot === slot && g.uid !== p.equipped[slot]);
      const cost = e ? nextTemperCost(p, e.item.uid) : Infinity;
      return h('div', {},
        h('div', { class: 'gear' },
          h('span', { class: 'slot' }, slot),
          e
            ? h('span', {},
                h('div', { class: 'name', style: `color:${RARITY_COLOR[e.def.rarity]}` }, `${e.def.name}${e.item.temper ? ` +${e.item.temper}` : ''}`),
                h('div', { class: 'meta' }, gearMeta(e.def.id, e.item.temper)),
              )
            : h('span', { class: 'meta' }, 'Empty'),
          h('span', { class: 'acts' },
            e && isFinite(cost)
              ? this.btn(`Temper ${fmt(cost)}`, () => {
                  if (temper(p, e.item.uid)) {
                    this.sfx.coins();
                    this.save();
                  }
                  this.showHearth();
                }, 'btn small', p.gold < cost)
              : null,
          ),
        ),
        ...others.map((o) =>
          h('div', { class: 'gear', style: 'opacity:.8' },
            h('span', {}),
            h('span', {}, h('div', { class: 'name', style: `color:${RARITY_COLOR[GEAR_BY_ID[o.id].rarity]}` }, GEAR_BY_ID[o.id].name), h('div', { class: 'meta' }, gearMeta(o.id, o.temper))),
            h('span', { class: 'acts' }, this.btn('Equip', () => {
              equip(p, o.uid);
              this.save();
              this.showHearth();
            }, 'btn small')),
          ),
        ),
      );
    });

    const climbing = p.climb;
    this.setScreen(
      h('div', { class: 'wrap' },
        h('div', { class: 'hearth-head' },
          h('div', {}, h('h2', {}, 'The Hearth'), h('div', { class: 'sub', style: 'margin:0' }, p.wardenDefeated ? 'The Cinder Gate\'s Hearth Fire burns. The Drowned Cloister lies beyond.' : 'The tower\'s foot. Your oath remembers every climb.')),
          h('div', { class: 'gold', style: 'font-size:20px' }, fmt(p.gold)),
        ),
        h('div', { class: 'grid2' },
          h('div', { class: 'panel' },
            h('h3', {}, `Level ${p.level}`),
            h('div', { class: 'meta', style: 'font-size:12px;color:var(--muted)' }, `${fmt(p.xp)} / ${fmt(need)} XP`),
            h('div', { class: 'xpbar' }, h('i', { style: `width:${Math.min(100, (p.xp / need) * 100)}%` })),
            p.freePoints > 0 ? h('div', { class: 'lvlup', style: 'margin-bottom:6px' }, `${p.freePoints} points to spend`) : null,
            statRow('Health', fmt(s.maxHp), 'health'),
            statRow('Attack', `${s.attack} (x${(1 + 0.02 * s.attack).toFixed(2)})`, 'attack'),
            statRow('Shield', `${s.shield} · blocks ${Math.round(s.blockReduction * 100)}%`, 'shield'),
            statRow('Weapon', `${s.weaponAtk} ATK`),
            statRow('Guard', fmt(s.maxGuard)),
            statRow('Vault keys', String(p.vaultKeys)),
            h('div', { class: 'row', style: 'margin-top:10px;justify-content:flex-start' },
              this.btn('Free respec', () => {
                respec(p);
                this.save();
                this.showHearth();
              }, 'btn small', p.alloc.attack + p.alloc.health + p.alloc.shield === 0),
            ),
          ),
          h('div', { class: 'panel' }, h('h3', {}, 'Gear'), ...gearRows),
        ),
        h('div', { class: 'row', style: 'margin-top:16px' },
          this.btn(climbing ? `Resume climb · ${FLOOR_NAMES[climbing.floor]}` : 'Climb the Spire', () => this.beginClimb(), 'btn primary'),
          this.btn('How to fight', () => this.showHowTo(() => this.showHearth())),
          this.btn('Settings', () => this.showSettings(() => this.showHearth())),
        ),
        h('p', { class: 'foot', style: 'text-align:center' }, `Climbs ${p.stats.climbs} · Falls ${p.stats.deaths} · Kills ${p.stats.kills} · Perfect Parries ${p.stats.perfectParries}`),
      ),
    );
  }

  private showSettings(back: () => void): void {
    const p = this.profile;
    const toggle = (label: string, desc: string, key: keyof Profile['settings']) =>
      h('label', { class: 'toggle' },
        h('span', {}, h('b', {}, label), h('div', { class: 'meta', style: 'font-size:12px;color:var(--muted)' }, desc)),
        h('input', {
          type: 'checkbox',
          ...(p.settings[key] ? { checked: true } : {}),
          onchange: (e: Event) => {
            p.settings[key] = (e.target as HTMLInputElement).checked;
            if (key === 'sound') this.sfx.setEnabled(p.settings.sound);
            this.save();
          },
        }),
      );
    this.setScreen(
      h('div', { class: 'wrap center' },
        h('h2', {}, 'Settings'),
        h('div', { class: 'panel', style: 'width:100%;max-width:520px' },
          toggle('Wide parry window', 'Accessibility: 300 ms instead of 220 ms.', 'wideParry'),
          toggle('Sound', 'Synthesized tells, hits and stingers.', 'sound'),
          toggle('Haptics', 'Vibration on parries and hits (where supported).', 'haptics'),
        ),
        h('div', { class: 'row', style: 'margin-top:16px' },
          this.btn('Done', back, 'btn primary'),
          this.btn('Erase save', () => {
            if (confirm('Erase all progress?')) {
              clearSave();
              location.reload();
            }
          }),
        ),
      ),
    );
  }

  // ----------------------------------------------------------------- climb

  private beginClimb(): void {
    const p = this.profile;
    if (!p.climb) {
      p.climb = newClimb(p, (Date.now() ^ (Math.random() * 1e9)) >>> 0);
      p.stats.climbs += 1;
      this.save();
    }
    this.showDoors();
  }

  private climbBar(): HTMLElement {
    const c = this.profile.climb!;
    const max = derivedStats(this.profile).maxHp;
    return h('div', {},
      h('div', { class: 'pips' }, ...[0, 1, 2, 3].map((i) => h('i', { class: i < c.floor ? 'done' : i === c.floor ? 'now' : '' }))),
      h('div', { class: 'climb-bar' },
        h('span', {}, `HP ${fmt(c.hp)} / ${fmt(max)}`),
        h('span', {}, `Tonics ${c.tonics}`),
        h('span', {}, `Keys ${this.profile.vaultKeys}`),
        c.secondWind ? h('span', { style: 'color:#7fe08a' }, 'Second Wind ready') : null,
        h('span', { class: 'gold' }, fmt(this.profile.gold)),
      ),
    );
  }

  private showDoors(): void {
    const c = this.profile.climb!;
    this.stage.setMode('hearth');
    this.stage.setEnemy(null);
    $('hud').hidden = true;
    this.gestures.enabled = false;
    const doors = doorsFor(c);
    this.setScreen(
      h('div', { class: 'wrap center' },
        h('h3', {}, 'Tier I · The Cinder Gate'),
        h('h2', {}, FLOOR_NAMES[c.floor]),
        this.climbBar(),
        h('div', { class: 'doors' },
          ...doors.map((d) => {
            const info = NODE_INFO[d.type];
            const icon = DOOR_ICON[d.type];
            const el = h('button', { class: 'door', style: `color:${icon.color}`, onclick: () => {
              this.sfx.click();
              this.enterDoor(d);
            } },
              svg(icon.svg),
              h('div', { class: 'dname' }, info.label),
              h('div', { class: `risk ${info.risk}` }, `Risk: ${info.risk}`),
              h('div', { class: 'blurb' }, info.blurb),
            );
            return el;
          }),
        ),
        h('div', { class: 'row' }, this.btn('Retreat to the Hearth', () => {
          if (confirm('Leave this climb? You keep your gold, XP and gear.')) {
            this.profile.climb = null;
            this.save();
            this.showHearth();
          }
        }, 'btn small')),
      ),
    );
  }

  private advanceFloor(to?: number): void {
    const c = this.profile.climb!;
    if (to !== undefined) {
      c.floor = to;
      c.secretRevealed = false;
    } else {
      // A revealed secret door lasts one floor.
      if (c.secretRevealed && c.floor > 0 && doorsFor(c).some((d) => d.type === 'secret')) c.secretRevealed = false;
      c.floor += 1;
    }
    this.save();
    this.showDoors();
  }

  private enterDoor(door: Door): void {
    const p = this.profile;
    const c = p.climb!;
    switch (door.type) {
      case 'duel':
      case 'elite':
      case 'warden':
        this.startDuel({ door, enemy: door.enemy!, vaultKeeper: false });
        break;
      case 'shrine': {
        const max = derivedStats(p).maxHp;
        c.hp = max;
        c.tonics = Math.max(c.tonics, p.tonicMax);
        this.sfx.tonic();
        this.save();
        this.setScreen(
          h('div', { class: 'center' },
            svg(DOOR_ICON.shrine.svg),
            h('h2', { style: 'color:#7fe08a' }, 'Shrine'),
            h('p', { class: 'sub' }, 'Cold fire washes over you. Health restored and Tonic refilled.'),
            this.btn('Continue', () => this.advanceFloor(), 'btn primary'),
          ),
        );
        break;
      }
      case 'merchant':
        this.showMerchant();
        break;
      case 'vault':
        this.showVault();
        break;
      case 'secret': {
        const r = secretReward(p, c.seed + c.floor);
        applyReward(p, r);
        this.sfx.coins();
        this.save();
        this.showReward('The Secret Door', 'A hidden stair, a forgotten cache, and a short way up.', r, 0, () => this.advanceFloor(3));
        break;
      }
    }
  }

  private showMerchant(): void {
    const p = this.profile;
    const c = p.climb!;
    const stock = merchantStock(p, c);
    this.setScreen(
      h('div', { class: 'wrap center' },
        h('h2', {}, 'Merchant'),
        h('p', { class: 'sub' }, '"Coin for steel, heir. The tower takes the rest."'),
        this.climbBar(),
        h('div', { class: 'panel', style: 'width:100%;max-width:560px;margin-top:12px' },
          ...stock.map((item) => {
            const def = item.id ? GEAR_BY_ID[item.id] : null;
            return h('div', { class: 'shop-item' },
              h('span', {},
                h('div', { class: 'name', style: def ? `color:${RARITY_COLOR[def.rarity]};font-weight:600` : 'font-weight:600' }, item.name),
                h('div', { class: 'meta', style: 'font-size:12px;color:var(--muted)' }, def ? `${gearMeta(def.id, 0)} · ${def.blurb}` : item.kind === 'key' ? 'Opens a Vault without a fight.' : 'Once per climb: revive at 40% HP.'),
              ),
              this.btn(fmt(item.price), () => {
                if (p.gold < item.price) return;
                if (item.kind === 'gear') {
                  const before = derivedStats(p).maxHp;
                  buy(p, item.id!);
                  c.hp += derivedStats(p).maxHp - before;
                } else {
                  p.gold -= item.price;
                  if (item.kind === 'key') p.vaultKeys += 1;
                  else c.secondWind = true;
                }
                this.sfx.coins();
                this.save();
                this.showMerchant();
              }, 'btn small', p.gold < item.price),
            );
          }),
        ),
        h('div', { class: 'row', style: 'margin-top:16px' }, this.btn('Leave', () => this.advanceFloor(), 'btn primary')),
      ),
    );
  }

  private showVault(): void {
    const p = this.profile;
    const c = p.climb!;
    const open = () => {
      const r = vaultReward(p, c.seed + c.floor * 13);
      applyReward(p, r);
      this.sfx.coins();
      this.save();
      this.showReward('Vault', 'The lock gives. Gold spills out across the stones.', r, 0, () => this.advanceFloor());
    };
    this.setScreen(
      h('div', { class: 'center' },
        svg(DOOR_ICON.vault.svg),
        h('h2', { style: 'color:var(--gold)' }, 'Vault'),
        h('p', { class: 'sub' }, p.vaultKeys > 0 ? 'A locked chest, and its keeper asleep beside it.' : 'A locked chest. You have no key, and its keeper is waking.'),
        h('div', { class: 'row' },
          p.vaultKeys > 0
            ? this.btn(`Use a Vault key (${p.vaultKeys})`, () => {
                p.vaultKeys -= 1;
                open();
              }, 'btn primary')
            : null,
          this.btn('Fight the keeper', () => this.startDuel({ door: { type: 'vault' }, enemy: VAULT_KEEPER, vaultKeeper: true }), p.vaultKeys > 0 ? 'btn' : 'btn primary'),
        ),
      ),
    );
  }

  // ------------------------------------------------------------------ duel

  private startDuel(ctx: DuelContext): void {
    const p = this.profile;
    if (!this.shownHowTo && p.stats.kills === 0) {
      this.shownHowTo = true;
      this.showHowTo(() => this.startDuel(ctx), 'Fight');
      return;
    }
    const c = p.climb!;
    const s = derivedStats(p);
    const stats: PlayerCombatStats = {
      maxHp: s.maxHp,
      hp: Math.min(c.hp, s.maxHp),
      weaponAtk: s.weaponAtk,
      attack: s.attack,
      blockReduction: s.blockReduction,
      maxGuard: s.maxGuard,
      soulGain: s.soulGain,
      parryWindow: s.parryWindow,
      tonics: c.tonics,
      secondWind: c.secondWind,
    };
    this.ctx = ctx;
    this.duel = new Duel(ctx.enemy, stats, (c.seed + c.floor * 101 + ctx.enemy.id.length) >>> 0);
    this.endAt = -1;
    this.lagHp = 1;
    this.stage.setEnemy(ctx.enemy.model);
    this.stage.setMode('duel');
    this.stage.playerReset();
    this.stage.clearProjectile();
    this.hideScreen();
    $('hud').hidden = false;
    document.body.classList.add('in-duel');
    $('e-name').textContent = ctx.enemy.name;
    $('e-phase').textContent = ctx.enemy.role;
    this.gestures.reset();
    this.gestures.enabled = true;
    this.banner(ctx.enemy.name, ctx.enemy.rank === 'warden' ? 'var(--unblockable)' : 'var(--ink)');
    this.hint(ctx.enemy.counterHint, 2.5);
  }

  private setBlock(on: boolean): void {
    this.duel?.setBlock(on);
    $('btn-block').classList.toggle('active', !!this.duel?.blocking);
  }

  private bindHud(): void {
    const block = $('btn-block');
    block.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.setBlock(true);
    });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) block.addEventListener(ev, () => this.setBlock(false));
    $('btn-soul').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.duel?.soulBurst();
    });
    $('btn-tonic').addEventListener('click', () => this.duel?.drinkTonic());
    $('btn-pause').addEventListener('click', () => this.togglePause());
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-dodge]')) {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.duel?.dodge(b.dataset.dodge as 'left' | 'right');
      });
    }
  }

  private togglePause(): void {
    if (!this.duel || this.duel.over) return;
    this.paused = !this.paused;
    if (!this.paused) {
      this.hideScreen();
      this.last = performance.now();
      return;
    }
    this.setBlock(false);
    this.setScreen(
      h('div', { class: 'center' },
        h('h2', {}, 'Paused'),
        h('div', { class: 'row' },
          this.btn('Resume', () => this.togglePause(), 'btn primary'),
          this.btn('How to fight', () => this.showHowTo(() => {
            this.paused = false;
            this.togglePause();
          })),
          this.btn('Retreat to the Hearth', () => {
            this.paused = false;
            this.duel = null;
            document.body.classList.remove('burst', 'in-duel');
            this.profile.climb = null;
            this.save();
            this.showHearth();
          }),
        ),
      ),
      true,
    );
  }

  private frame(now: number): void {
    requestAnimationFrame((t) => this.frame(t));
    const rawDt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.realTime += rawDt;

    let scale = 1;
    if (this.realTime < this.hitStopUntil) scale = 0;
    else if (this.realTime < this.slowUntil) scale = 0.3;
    const dt = rawDt * scale;

    const d = this.duel;
    if (d && !this.paused) {
      if (!d.over) d.update(dt);
      this.handleEvents(d);
      this.updateHud(d);
      if (this.endAt > 0 && this.realTime >= this.endAt) {
        this.endAt = -1;
        this.finishDuel(d);
      }
    }
    const view = d
      ? {
          enemyState: d.enemyState,
          strike: d.currentStrike,
          tellProgress: d.stateProgress,
          bursting: d.bursting,
          blocking: d.blocking,
          stunned: d.stunned,
        }
      : null;
    this.stage.render(this.paused ? 0 : rawDt * (scale === 0 ? 0.05 : scale), view);
    this.drawTrails(rawDt);
  }

  private handleEvents(d: Duel): void {
    const fx = this.profile.settings.haptics;
    for (const e of d.events.splice(0)) {
      switch (e.type) {
        case 'tell':
          this.sfx.tell(e.strike.kind);
          if (e.strike.kind === 'projectile') this.stage.launchProjectile(d.timeToImpact * 0.55);
          if (e.strike.kind === 'unblockable') haptic([12, 40, 12], fx);
          break;
        case 'parry':
          this.stage.enemySwing(e.strike.from, 'parried');
          this.stage.playerParry(e.strike.from, e.perfect);
          this.sfx.parry(e.perfect);
          haptic(e.perfect ? [20, 30, 40] : 25, fx);
          if (e.perfect) {
            this.profile.stats.perfectParries += 1;
            this.banner('Perfect Parry', 'var(--soul)');
            this.slowUntil = this.realTime + 0.35;
            flashClass('vignette', 'perfect');
          } else {
            this.floatAt(this.stage.enemyScreenPos(0.6), 'Parry', 'small');
          }
          break;
        case 'dodge':
          if (e.strike) {
            this.stage.enemySwing(e.strike.from, 'dodged');
            this.floatAt(this.stage.enemyScreenPos(0.6), 'Dodged', 'small');
            if (e.strike.kind === 'projectile') this.stage.clearProjectile();
          } else {
            this.stage.playerDodge(e.dir);
            this.sfx.dodge();
          }
          break;
        case 'block':
          this.stage.enemySwing(e.strike.from, 'blocked');
          this.stage.playerBlockImpact();
          this.sfx.block();
          if (e.strike.kind === 'projectile') this.stage.clearProjectile();
          haptic(15, fx);
          this.floatAt({ x: window.innerWidth * 0.3, y: window.innerHeight * 0.6 }, `-${e.damage}`, 'small');
          break;
        case 'shieldBreak':
          this.sfx.shieldBreak();
          this.banner('Guard broken', 'var(--guard)');
          haptic(60, fx);
          break;
        case 'playerHit':
          this.stage.enemySwing(e.strike.from, 'hit');
          this.stage.playerHit(e.strike.kind !== 'quick');
          if (e.strike.kind === 'projectile') this.stage.clearProjectile();
          this.sfx.hurt(e.strike.kind !== 'quick');
          haptic(e.strike.kind === 'quick' ? 30 : 70, fx);
          flashClass('vignette', 'hurt');
          this.floatAt({ x: window.innerWidth * 0.3, y: window.innerHeight * 0.55 }, `-${e.damage}`, '', 'var(--hp)');
          break;
        case 'slash': {
          this.stage.playerSlash(e.dir);
          this.stage.enemyHit(e.dir, e.strong);
          this.sfx.slash(e.strong);
          haptic(e.strong ? 18 : 8, fx);
          const pos = this.stage.enemyScreenPos(0.65);
          pos.x += (Math.random() - 0.5) * 80;
          this.floatAt(pos, e.riposte ? `RIPOSTE ${e.damage}` : String(e.damage), e.strong ? 'big' : '');
          if (e.strong) this.hitStopUntil = this.realTime + TIMING.hitStop;
          break;
        }
        case 'deflected':
          this.stage.enemyDeflect();
          this.sfx.deflected();
          this.floatAt(this.stage.enemyScreenPos(0.6), 'Guarded', 'small');
          break;
        case 'whiff':
          this.sfx.whiff();
          this.floatAt(this.stage.enemyScreenPos(0.6), 'Too early', 'small');
          break;
        case 'projectileReturned':
          this.stage.returnProjectile();
          this.floatAt(this.stage.enemyScreenPos(0.7), String(e.damage), 'big');
          break;
        case 'enemyStagger':
        case 'enemyRecover':
          break;
        case 'phase':
          this.sfx.phase();
          this.stage.shake(0.3);
          this.banner(e.announce, 'var(--ember)');
          $('e-phase').textContent = e.announce;
          break;
        case 'riposteReady':
          break;
        case 'soulBurst':
          this.sfx.burst();
          this.banner('Soul Burst', 'var(--soul)');
          document.body.classList.add('burst');
          break;
        case 'soulBurstEnd':
          document.body.classList.remove('burst');
          break;
        case 'tonic':
          this.sfx.tonic();
          this.floatAt({ x: window.innerWidth * 0.3, y: window.innerHeight * 0.55 }, `+${e.heal}`, '', '#7fe08a');
          break;
        case 'secondWind':
          this.banner('Second Wind', '#7fe08a');
          this.sfx.tonic();
          break;
        case 'victory':
          this.stage.enemyDie();
          this.stage.clearProjectile();
          this.sfx.victory();
          this.slowUntil = this.realTime + 0.6;
          this.endAt = this.realTime + 1.8;
          this.gestures.enabled = false;
          document.body.classList.remove('burst');
          break;
        case 'defeat':
          this.stage.playerDie();
          this.sfx.defeat();
          this.slowUntil = this.realTime + 0.8;
          this.endAt = this.realTime + 2.0;
          this.gestures.enabled = false;
          document.body.classList.remove('burst');
          break;
      }
    }
  }

  private updateHud(d: Duel): void {
    const p = d.player;
    setBar('p-hp', p.hp / p.maxHp);
    setBar('p-guard', d.guard / p.maxGuard);
    $('p-guard').parentElement!.classList.toggle('broken', d.stunned);
    $('p-level').textContent = `Lv ${this.profile.level}`;
    $('p-hp-text').textContent = `${fmt(p.hp)} / ${fmt(p.maxHp)}`;
    const ef = d.enemyHp / d.enemyMaxHp;
    setBar('e-hp', ef);
    this.lagHp = Math.max(ef, this.lagHp - 0.004);
    setBar('e-hp-lag', this.lagHp);
    $('gold').textContent = fmt(this.profile.gold);
    ($('soul-fill') as unknown as SVGCircleElement).style.strokeDashoffset = String(264 * (1 - d.soul));
    $('btn-soul').classList.toggle('ready', d.soul >= 1 && !d.bursting);
    const tonic = $('btn-tonic') as HTMLButtonElement;
    tonic.disabled = d.tonicUsed || p.tonics <= 0 || p.hp >= p.maxHp;
    $('tonic-count').textContent = String(p.tonics);

    // Combo counter.
    const combo = $('combo');
    if (d.combo >= 2) {
      combo.innerHTML = `${d.combo}<small>x${d.comboMult.toFixed(2)} combo</small>`;
      combo.classList.add('show');
    } else combo.classList.remove('show');

    // Telegraph: shape icon, closing ring and direction arrow.
    const strike = d.over ? null : d.currentStrike;
    const tell = $('tell');
    const arrow = $('tell-arrow');
    const chevL = document.querySelector('.chev.left')!;
    const chevR = document.querySelector('.chev.right')!;
    chevL.classList.remove('flash');
    chevR.classList.remove('flash');
    if (strike) {
      const color = TELL_COLOR_CSS[strike.kind];
      const pos = this.stage.enemyScreenPos(1.0);
      tell.hidden = false;
      tell.style.left = `${pos.x}px`;
      tell.style.top = `${Math.max(135, pos.y - 70)}px`;
      tell.style.color = color;
      const shape = $('tell-shape');
      if (shape.dataset.kind !== strike.kind) {
        shape.innerHTML = TELL_SHAPE[strike.kind];
        shape.dataset.kind = strike.kind;
      }
      const left = d.timeToImpact;
      const total = Math.max(0.001, d.timeToImpact / Math.max(0.001, 1 - d.stateProgress));
      const r = 22 + 24 * Math.max(0, Math.min(1, left / total));
      document.querySelector('#tell-ring .closing')!.setAttribute('r', r.toFixed(1));
      const live = strike.kind !== 'unblockable' && left <= d.player.parryWindow;
      document.querySelector('#tell-ring .target')!.classList.toggle('live', live);
      $('tell-label').textContent = `${TELL_NAME[strike.kind]}${d.strikeCount > 1 ? ` ${d.strikeIndexInCombo + 1}/${d.strikeCount}` : ''}`;

      if (strike.kind === 'unblockable') {
        arrow.hidden = true;
        // Dodge away from the strike.
        if (strike.from === 'left') chevR.classList.add('flash');
        else if (strike.from === 'right') chevL.classList.add('flash');
        else {
          chevL.classList.add('flash');
          chevR.classList.add('flash');
        }
      } else if (strike.kind === 'projectile') {
        arrow.hidden = true;
      } else {
        arrow.hidden = false;
        arrow.textContent = FROM_ARROW[strike.from];
        arrow.style.color = color;
        arrow.style.left = strike.from === 'left' ? '20%' : strike.from === 'right' ? '76%' : '50%';
        arrow.style.top = strike.from === 'up' ? '30%' : '40%';
      }
    } else {
      tell.hidden = true;
      arrow.hidden = true;
    }

    // Prompt for openings.
    const prompt = $('prompt');
    if (!d.over && d.canRiposte) {
      prompt.textContent = 'TAP · RIPOSTE';
      prompt.classList.add('show');
    } else if (!d.over && d.enemyOpen) {
      prompt.textContent = 'STRIKE';
      prompt.classList.add('show');
    } else prompt.classList.remove('show');

    // Teaching hints for the first few fights.
    if (this.profile.stats.kills < 3 && !d.over) {
      let text = '';
      if (strike?.kind === 'unblockable') text = 'Unblockable! Dodge away: swipe in the bottom band, or tap the glowing chevron.';
      else if (strike?.kind === 'projectile') text = 'Projectile: swipe any direction as the ring closes to send it back.';
      else if (strike) text = `Swipe ${FROM_ARROW[strike.from]} toward the strike as the ring meets the inner circle.`;
      else if (d.enemyOpen) text = 'Opening! Swipe across the enemy to slash.';
      if (text) this.hint(text, 0.2);
    }
  }

  private finishDuel(d: Duel): void {
    const p = this.profile;
    const c = p.climb;
    const ctx = this.ctx!;
    this.duel = null;
    $('hud').hidden = true;
    document.body.classList.remove('burst', 'in-duel');

    if (d.outcome === 'defeat') {
      p.stats.deaths += 1;
      p.climb = null;
      this.save();
      const k = d.killedBy;
      this.showDefeat(ctx, k?.strike ?? ctx.enemy.attacks[0].strikes[0], k?.attack ?? '', c?.floor ?? 0);
      return;
    }

    if (!c) return;
    c.hp = d.player.hp;
    c.tonics = d.player.tonics;
    c.secondWind = d.player.secondWind;
    p.stats.kills += 1;

    let reward: Reward = duelReward(p, ctx.enemy, c.seed + c.floor * 977);
    if (ctx.vaultKeeper) {
      const v = vaultReward(p, c.seed + c.floor * 13);
      reward = { gold: reward.gold + v.gold, xp: reward.xp, gear: v.gear, lines: v.lines };
    }
    applyReward(p, reward);
    const levels = addXp(p, reward.xp);

    if (ctx.door.type === 'warden') {
      p.wardenDefeated = true;
      p.climb = null;
      this.save();
      this.showReward('The Iron Warden falls', 'The Cinder Gate\'s Hearth Fire is lit. Beyond it, the Drowned Cloister waits (Tier II is not in this prototype yet).', reward, levels, () => this.showHearth(), 'Return to the Hearth');
      return;
    }

    const extra: string[] = [];
    if (ctx.door.type === 'duel' && d.damageTaken === 0 && !c.secretFound && c.floor < 2) {
      c.secretRevealed = true;
      c.secretFound = true;
      extra.push('A flawless duel. A cracked pillar reveals a secret door ahead.');
    }
    this.save();
    this.showReward('Victory', `${ctx.enemy.name} is ash.`, { ...reward, lines: [...reward.lines, ...extra] }, levels, () => this.advanceFloor());
  }

  private showReward(title: string, sub: string, r: Reward, levels: number, next: () => void, cta = 'Choose a door'): void {
    this.stage.setMode('hearth');
    this.setScreen(
      h('div', { class: 'center' },
        h('h2', { style: 'color:var(--gold)' }, title),
        h('p', { class: 'sub' }, sub),
        h('ul', { class: 'reward-list' },
          r.gold ? h('li', { class: 'gold' }, `+${fmt(r.gold)} gold`) : null,
          r.xp ? h('li', {}, `+${fmt(r.xp)} XP`) : null,
          levels ? h('li', { class: 'lvlup' }, `Level up! Now level ${this.profile.level}: ${levels * 3} points to spend at the Hearth`) : null,
          ...r.lines.map((l) => h('li', {}, l)),
        ),
        this.btn(cta, next, 'btn primary'),
      ),
    );
  }

  private showDefeat(ctx: DuelContext, strike: StrikeDef, attack: string, floor: number): void {
    const from = strike.kind === 'projectile' ? 'ahead' : strike.from === 'up' ? 'above' : `the ${strike.from}`;
    this.setScreen(
      h('div', { class: 'center' },
        h('h2', { style: 'color:var(--hp)' }, 'You have fallen'),
        h('p', { class: 'sub' }, `${ctx.enemy.name} ended this climb on ${FLOOR_NAMES[floor]}. Your gold, XP and gear are kept. The oath remembers.`),
        h('div', { class: 'death-tell', style: `color:${TELL_COLOR_CSS[strike.kind]}` },
          svgShape(strike.kind),
          h('span', { style: 'color:var(--ink);text-align:left' },
            h('b', {}, `${attack || 'Strike'}: ${TELL_NAME[strike.kind]} from ${from}`),
            h('div', { style: 'font-size:13px;color:var(--muted)' }, TELL_COUNTER[strike.kind]),
          ),
        ),
        h('p', { class: 'sub', style: 'font-size:14px' }, `Counter tip: ${ctx.enemy.counterHint}`),
        this.btn('Return to the Hearth', () => this.showHearth(), 'btn primary'),
      ),
    );
  }

  // ------------------------------------------------------------- feedback

  private banner(text: string, color: string): void {
    const b = $('banner');
    b.textContent = text;
    b.style.color = color;
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
  }

  private hintTimer = 0;
  private hint(text: string, seconds: number): void {
    const el = $('hint');
    el.textContent = text;
    el.classList.add('show');
    window.clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => el.classList.remove('show'), seconds * 1000 + 400);
  }

  private floatAt(pos: { x: number; y: number }, text: string, cls = '', color?: string): void {
    const f = h('div', { class: `f ${cls}`, style: `left:${pos.x}px;top:${pos.y}px;${color ? `color:${color}` : ''}` }, text);
    $('floaters').append(f);
    window.setTimeout(() => f.remove(), 950);
  }

  private addTrail(pts: { x: number; y: number }[], done: boolean): void {
    if (!this.duel) return;
    const copy = pts.map((p) => ({ ...p }));
    if (this.trails.length && !this.trails[this.trails.length - 1].age && !done) this.trails[this.trails.length - 1].pts = copy;
    else this.trails.push({ pts: copy, age: done ? 0.0001 : 0 });
    if (done && this.trails.length) this.trails[this.trails.length - 1].age = 0.0001;
  }

  private drawTrails(dt: number): void {
    const g = this.trailCtx;
    g.clearRect(0, 0, window.innerWidth, window.innerHeight);
    this.trails = this.trails.filter((t) => (t.age > 0 ? (t.age += dt) < 0.25 : true));
    for (const t of this.trails) {
      if (t.pts.length < 2) continue;
      const alpha = t.age > 0 ? 1 - t.age / 0.25 : 1;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      for (const [w, a, c] of [[14, 0.25, '143,252,255'], [5, 0.9, '255,255,255']] as const) {
        g.strokeStyle = `rgba(${c},${a * alpha})`;
        g.lineWidth = w;
        g.beginPath();
        t.pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
        g.stroke();
      }
    }
  }
}

function setBar(id: string, frac: number): void {
  $(id).style.transform = `scaleX(${Math.max(0, Math.min(1, frac))})`;
}

function flashClass(id: string, cls: string): void {
  const el = $(id);
  el.classList.add(cls);
  window.setTimeout(() => el.classList.remove(cls), 180);
}

function svgShape(kind: keyof typeof TELL_SHAPE): SVGSVGElement {
  const s = svg(`<g style="fill:${TELL_COLOR_CSS[kind]};stroke:${TELL_COLOR_CSS[kind]}">${TELL_SHAPE[kind]}</g>`);
  return s;
}

function gearMeta(id: string, temperLvl: number): string {
  const d = GEAR_BY_ID[id];
  const m = 1 + 0.06 * temperLvl;
  const parts: string[] = [];
  if (d.atk) parts.push(`${(d.atk * m).toFixed(1).replace(/\.0$/, '')} ATK`);
  if (d.block) parts.push(`blocks ${Math.round(d.block * 100)}%`);
  if (d.guard) parts.push(`${Math.round(d.guard * m)} Guard`);
  if (d.health) parts.push(`+${Math.round(d.health * m)} HP`);
  if (d.soulGain) parts.push(`+${Math.round((d.soulGain - 1) * 100)}% Soul`);
  return parts.join(' · ');
}

new Game();
