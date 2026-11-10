/**
 * The 3D stage: the Cinder Gate arena, the two duellists and all
 * procedural animation. Driven by the game through small trigger methods
 * plus a per-frame `render(dt, view)` with the duel's state.
 */
import * as THREE from 'three';
import type { ModelKind, StrikeDef, StrikeFrom, StrikeKind } from '../data/enemies';
import type { EnemyState, SwipeDir, DodgeDir } from '../core/duel';
import { buildEnemy, buildPlayer, flat, type Rig } from './models';

export const TELL_COLORS: Record<StrikeKind, number> = {
  quick: 0x9ff4ff,
  heavy: 0xffa020,
  unblockable: 0xff2a2a,
  projectile: 0xfff0a0,
};

export interface StageView {
  enemyState: EnemyState;
  strike: StrikeDef | null;
  /** 0..1 through the current tell. */
  tellProgress: number;
  bursting: boolean;
  blocking: boolean;
  stunned: boolean;
}

const ENEMY_Z = 3.0;
/** The player stands left of centre (world +x is screen-left) so the enemy stays clear. */
const PLAYER_X = 0.9;
const lerp = THREE.MathUtils.lerp;
const damp = (a: number, b: number, k: number, dt: number) => lerp(a, b, 1 - Math.exp(-k * dt));

interface Pose {
  armRx: number;
  armRz: number;
  armLx: number;
  armLz: number;
  bodyY: number;
  bodyX: number;
  bodyZ: number;
  rootX: number;
  rootZ: number;
  crouch: number;
  legL: number;
  legR: number;
}

const ZERO_POSE: Pose = { armRx: 0, armRz: 0, armLx: 0, armLz: 0, bodyY: 0, bodyX: 0, bodyZ: 0, rootX: 0, rootZ: 0, crouch: 0, legL: 0, legR: 0 };

/** A short scripted motion layered on top of the state pose (swings, recoils). */
interface Motion {
  t: number;
  dur: number;
  pose: Partial<Pose>;
  /** 'out' eases out from the pose back to base; 'pulse' goes in and out. */
  shape: 'out' | 'pulse';
}

class Animator {
  rig: Rig;
  base: Pose = { ...ZERO_POSE };
  cur: Pose = { ...ZERO_POSE };
  motions: Motion[] = [];
  homeZ: number;
  homeX = 0;
  facing: number;
  mirror: number;

  constructor(rig: Rig, homeZ: number, facing: number, mirror: number) {
    this.rig = rig;
    this.homeZ = homeZ;
    this.facing = facing;
    this.mirror = mirror;
  }

  play(pose: Partial<Pose>, dur: number, shape: Motion['shape'] = 'out'): void {
    this.motions.push({ t: 0, dur, pose, shape });
  }

  update(dt: number, k = 14): void {
    const target: Pose = { ...this.base };
    this.motions = this.motions.filter((m) => {
      m.t += dt;
      const u = Math.min(1, m.t / m.dur);
      const w = m.shape === 'out' ? 1 - u * u : Math.sin(u * Math.PI);
      for (const key of Object.keys(m.pose) as (keyof Pose)[]) target[key] += (m.pose[key]! - 0) * w;
      return u < 1;
    });
    for (const key of Object.keys(target) as (keyof Pose)[]) this.cur[key] = damp(this.cur[key], target[key], k, dt);
    const r = this.rig;
    const c = this.cur;
    r.armR.rotation.set(c.armRx, 0, c.armRz);
    r.armL.rotation.set(c.armLx, 0, c.armLz);
    r.body.rotation.set(c.bodyX, c.bodyY, c.bodyZ);
    r.legL.rotation.x = c.legL;
    r.legR.rotation.x = c.legR;
    r.root.position.x = this.homeX + c.rootX;
    r.root.position.z = this.homeZ + c.rootZ;
    r.root.position.y = -c.crouch;
    r.root.rotation.y = this.facing;
  }
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private player: Rig;
  private playerAnim: Animator;
  private enemy: Rig | null = null;
  private enemyAnim: Animator | null = null;
  private enemyKind: ModelKind | null = null;
  private tellOriginal = new Map<THREE.MeshStandardMaterial, { color: THREE.Color; intensity: number }>();
  private embers!: THREE.Points;
  private emberVel!: Float32Array;
  private flames: THREE.Mesh[] = [];
  private fireLights: THREE.PointLight[] = [];
  private shakeAmt = 0;
  private time = 0;
  private mode: 'duel' | 'hearth' = 'hearth';
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private fovKick = 0;
  private projectile: { mesh: THREE.Mesh; t: number; dur: number; back: boolean } | null = null;
  private lastTellKey = '';
  private deathT = -1;
  private burstTint = 0;
  private moonLight!: THREE.DirectionalLight;
  private dodgeOffset = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 120);

    this.buildArena();

    this.player = buildPlayer();
    this.player.root.scale.x *= -1; // mirror so the sword arm sits on screen-right
    this.scene.add(this.player.root);
    this.playerAnim = new Animator(this.player, 0, 0, -1);
    this.playerAnim.homeX = PLAYER_X;
    this.playerAnim.base = { ...ZERO_POSE, armRx: -0.5, armRz: 0.25, armLx: -0.9, armLz: -0.35 };

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Keep the duel framed on tall (portrait) screens by widening the FOV.
    this.camera.fov = w / h < 1 ? 70 : 52;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ arena

  private buildArena(): void {
    const s = this.scene;
    s.background = new THREE.Color(0x0b0f24);
    s.fog = new THREE.FogExp2(0x101634, 0.045);

    s.add(new THREE.HemisphereLight(0x6a7ac8, 0x3a2418, 1.25));
    const moon = new THREE.DirectionalLight(0xa8bcff, 1.5);
    moon.position.set(-6, 12, 10);
    moon.castShadow = true;
    moon.shadow.mapSize.set(1024, 1024);
    moon.shadow.camera.left = -8;
    moon.shadow.camera.right = 8;
    moon.shadow.camera.top = 8;
    moon.shadow.camera.bottom = -8;
    s.add(moon);
    this.moonLight = moon;
    // Rim light from behind the enemy so silhouettes pop against the dark.
    const rim = new THREE.DirectionalLight(0xffb070, 0.9);
    rim.position.set(2, 4, 12);
    s.add(rim);

    // Moon disc.
    const moonDisc = new THREE.Mesh(new THREE.CircleGeometry(3, 16), new THREE.MeshBasicMaterial({ color: 0xdfe6ff, fog: false }));
    moonDisc.position.set(-14, 18, 40);
    moonDisc.lookAt(0, 2, 0);
    s.add(moonDisc);

    // Ground: worn flagstones.
    const ground = new THREE.Mesh(new THREE.CylinderGeometry(16, 16, 0.4, 12), flat(0x2a2830, { rough: 0.95 }));
    ground.position.y = -0.2;
    ground.receiveShadow = true;
    s.add(ground);
    const stoneM = [flat(0x35323a, { rough: 0.95 }), flat(0x3d3838, { rough: 0.95 }), flat(0x2f2c34, { rough: 0.95 })];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let x = -7; x <= 7; x++) {
      for (let z = -4; z <= 10; z++) {
        if (rnd() < 0.25) continue;
        const stone = new THREE.Mesh(new THREE.BoxGeometry(0.9 + rnd() * 0.2, 0.06, 0.9 + rnd() * 0.2), stoneM[Math.floor(rnd() * 3)]);
        stone.position.set(x + (rnd() - 0.5) * 0.15, 0.01 + rnd() * 0.02, z + (rnd() - 0.5) * 0.15);
        stone.rotation.y = (rnd() - 0.5) * 0.1;
        stone.receiveShadow = true;
        s.add(stone);
      }
    }

    // Circular wall with crenellations, broken in places.
    const wallM = flat(0x3a3b4c, { rough: 0.9 });
    const wallDark = flat(0x2a2b3a, { rough: 0.9 });
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a)) - Math.PI / 2) < 0.18) continue; // gate gap (behind enemy)
      const r = 11;
      const h = 3.5 + rnd() * 1.5 - (i % 7 === 3 ? 2 : 0);
      const seg = new THREE.Mesh(new THREE.BoxGeometry(2.6, h, 1.2), i % 2 ? wallM : wallDark);
      seg.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
      seg.rotation.y = -a + Math.PI / 2;
      seg.castShadow = true;
      seg.receiveShadow = true;
      s.add(seg);
      if (h > 3.2) {
        const merlon = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 1.2), wallM);
        merlon.position.set(Math.cos(a) * r, h + 0.3, Math.sin(a) * r);
        merlon.rotation.y = seg.rotation.y;
        s.add(merlon);
      }
    }

    // The burning gate behind the enemy.
    const gateZ = 11;
    for (const x of [-2.2, 2.2]) {
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.5, 8, 6), wallDark);
      tower.position.set(x, 4, gateZ);
      tower.castShadow = true;
      s.add(tower);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(1.6, 2.2, 6), flat(0x241c26));
      roof.position.set(x, 9.1, gateZ);
      s.add(roof);
    }
    const arch = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.4, 1.4), wallM);
    arch.position.set(0, 6, gateZ);
    s.add(arch);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(3, 5.2), new THREE.MeshBasicMaterial({ color: 0xff6a20 }));
    glow.position.set(0, 2.6, gateZ + 0.2);
    glow.rotation.y = Math.PI;
    s.add(glow);
    const gateLight = new THREE.PointLight(0xff6a2a, 30, 14, 1.6);
    gateLight.position.set(0, 2.5, gateZ - 1.5);
    s.add(gateLight);
    this.fireLights.push(gateLight);
    // Portcullis bars silhouetted against the fire.
    const barM = flat(0x141016);
    for (let i = -3; i <= 3; i++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 4.4, 0.08), barM);
      bar.position.set(i * 0.42, 3.4, gateZ - 0.1);
      s.add(bar);
    }

    // Braziers and banners.
    const ironM = flat(0x2a2424, { metal: 0.6 });
    const flameM = new THREE.MeshBasicMaterial({ color: 0xffa040 });
    const flameCore = new THREE.MeshBasicMaterial({ color: 0xfff0b0 });
    for (const [x, z] of [[-4.2, 5.5], [4.2, 5.5], [-5, -1.5], [5, -1.5]]) {
      const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.25, 1.1, 5), ironM);
      stand.position.set(x, 0.55, z);
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.25, 0.35, 6), ironM);
      bowl.position.set(x, 1.25, z);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.9, 5), flameM);
      flame.position.set(x, 1.85, z);
      const core = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 4), flameCore);
      core.position.set(x, 1.7, z);
      s.add(stand, bowl, flame, core);
      this.flames.push(flame, core);
      const light = new THREE.PointLight(0xff8a3a, 9, 9, 1.8);
      light.position.set(x, 2.2, z);
      s.add(light);
      this.fireLights.push(light);
    }
    const bannerM = flat(0x8a1a18, { rough: 0.9 });
    bannerM.side = THREE.DoubleSide;
    for (const x of [-4, 4]) {
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 3, 1, 4), bannerM);
      banner.position.set(x, 3.4, 10.3);
      banner.rotation.y = Math.PI;
      s.add(banner);
    }
    // Rubble.
    const rubbleM = flat(0x403c44);
    for (let i = 0; i < 22; i++) {
      const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.15 + rnd() * 0.35, 0), rubbleM);
      const a = rnd() * Math.PI * 2;
      const d = 6 + rnd() * 4;
      r.position.set(Math.cos(a) * d, 0.1, Math.sin(a) * d + 2);
      r.rotation.set(rnd() * 3, rnd() * 3, 0);
      r.castShadow = true;
      s.add(r);
    }

    // Embers drifting up through the courtyard.
    const n = 260;
    const pos = new Float32Array(n * 3);
    this.emberVel = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (rnd() - 0.5) * 18;
      pos[i * 3 + 1] = rnd() * 8;
      pos[i * 3 + 2] = rnd() * 16 - 4;
      this.emberVel[i] = 0.3 + rnd() * 0.8;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.embers = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ color: 0xff9a40, size: 0.09, map: dotTexture(), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    s.add(this.embers);
  }

  // ----------------------------------------------------------------- actors

  setEnemy(kind: ModelKind | null): void {
    if (this.enemy) {
      this.scene.remove(this.enemy.root);
      this.enemy = null;
      this.enemyAnim = null;
    }
    this.enemyKind = kind;
    this.deathT = -1;
    this.lastTellKey = '';
    this.tellOriginal.clear();
    if (!kind) return;
    const rig = buildEnemy(kind);
    rig.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    for (const m of rig.tellMats) this.tellOriginal.set(m, { color: m.emissive.clone(), intensity: m.emissiveIntensity });
    this.scene.add(rig.root);
    this.enemy = rig;
    this.enemyAnim = new Animator(rig, ENEMY_Z + (kind === 'warden' ? 0.5 : kind === 'brute' ? 0.3 : 0), Math.PI, 1);
    this.enemyAnim.base = this.guardPose(kind);
  }

  setMode(mode: 'duel' | 'hearth'): void {
    this.mode = mode;
  }

  private guardPose(kind: ModelKind): Pose {
    if (kind === 'hound') return { ...ZERO_POSE, crouch: 0.05 };
    if (kind === 'archer') return { ...ZERO_POSE, armLx: -0.5, armLz: 0.2, armRx: -0.3 };
    return { ...ZERO_POSE, armRx: -0.7, armRz: 0.35, armLx: -0.8, armLz: -0.4 };
  }

  /** Pose for the windup of a strike from a side, scaled by tell progress. */
  private windupPose(kind: ModelKind, from: StrikeFrom, strikeKind: StrikeKind, p: number): Pose {
    const e = p * p * (3 - 2 * p); // smoothstep
    const base = this.guardPose(kind);
    if (kind === 'hound') {
      const side = from === 'left' ? 1 : from === 'right' ? -1 : 0;
      return { ...base, crouch: 0.05 + 0.18 * e, bodyX: 0.25 * e, bodyY: 0.35 * side * e, rootZ: 0.3 * e };
    }
    if (strikeKind === 'projectile') {
      return { ...base, armLx: -1.55, armLz: 0.1, armRx: -1.5, armRz: -0.4 * e, bodyY: -0.3 * e };
    }
    // Screen-left for the player is the enemy's local -x.
    if (from === 'up') return { ...base, armRx: lerp(-0.7, -2.9, e), armRz: 0.1, bodyX: -0.2 * e, legR: -0.2 * e };
    if (from === 'right') return { ...base, armRx: lerp(-0.7, -1.6, e), armRz: lerp(0.35, 2.1, e), bodyY: 0.55 * e, bodyX: -0.1 * e };
    return { ...base, armRx: lerp(-0.7, -1.7, e), armRz: lerp(0.35, -1.9, e), bodyY: -0.6 * e, bodyX: -0.1 * e };
  }

  /** The follow-through after a strike lands (or is defended). */
  enemySwing(from: StrikeFrom, result: 'hit' | 'parried' | 'blocked' | 'dodged'): void {
    const a = this.enemyAnim;
    if (!a || !this.enemyKind) return;
    if (this.enemyKind === 'hound') {
      a.play({ rootZ: -1.6, bodyX: 0.3 }, 0.35, 'pulse');
      if (this.enemy?.jaw) this.enemy.jaw.rotation.x = 0.6;
      return;
    }
    const sweep = from === 'up' ? { armRx: 1.6, bodyX: 0.35 } : from === 'right' ? { armRz: -2.6, bodyY: -1.0 } : { armRz: 2.4, bodyY: 1.0 };
    if (result === 'parried') {
      a.play({ ...scale(sweep, 0.35), bodyX: -0.4, rootZ: 0.4 }, 0.5, 'pulse');
    } else {
      a.play({ ...sweep, rootZ: -0.6 }, 0.32, 'pulse');
    }
  }

  enemyHit(dir: SwipeDir, strong: boolean): void {
    const a = this.enemyAnim;
    if (!a) return;
    const side = dir === 'left' ? 1 : dir === 'right' ? -1 : 0;
    a.play({ bodyZ: 0.25 * side, bodyX: -0.25, rootZ: strong ? 0.35 : 0.15 }, strong ? 0.35 : 0.22, 'pulse');
    this.flashTell(0xffffff, strong ? 3 : 1.6, 0.08);
  }

  enemyDeflect(): void {
    this.enemyAnim?.play({ armLx: -1.4, bodyX: 0.1 }, 0.25, 'pulse');
  }

  enemyDie(): void {
    this.deathT = 0;
  }

  playerSlash(dir: SwipeDir): void {
    const a = this.playerAnim;
    if (dir === 'left') a.play({ armRz: -2.2, armRx: -1.0, bodyY: 0.6 }, 0.22, 'pulse');
    else if (dir === 'right') a.play({ armRz: 1.6, armRx: -1.3, bodyY: -0.6 }, 0.22, 'pulse');
    else if (dir === 'up') a.play({ armRx: -2.6, bodyX: -0.15 }, 0.22, 'pulse');
    else a.play({ armRx: -2.4, bodyX: 0.35, rootZ: 0.25 }, 0.26, 'pulse');
  }

  playerParry(from: StrikeFrom, perfect: boolean): void {
    const z = from === 'left' ? 1.4 : from === 'right' ? -1.0 : 0;
    this.playerAnim.play({ armRx: from === 'up' ? -2.7 : -1.6, armRz: z, bodyX: -0.1 }, perfect ? 0.45 : 0.3, 'pulse');
    this.shake(perfect ? 0.08 : 0.05);
    if (perfect) this.fovKick = -6;
  }

  playerDodge(dir: DodgeDir): void {
    // Screen-left is world +x.
    const x = dir === 'left' ? 1.3 : -1.3;
    this.playerAnim.play({ rootX: x, bodyZ: dir === 'left' ? 0.3 : -0.3, crouch: 0.2 }, 0.45, 'pulse');
    this.dodgeOffset = x;
  }

  playerHit(heavy: boolean): void {
    this.playerAnim.play({ bodyX: 0.35, rootZ: -0.3 }, 0.3, 'pulse');
    this.shake(heavy ? 0.25 : 0.14);
  }

  playerBlockImpact(): void {
    this.playerAnim.play({ rootZ: -0.2, bodyX: 0.15 }, 0.2, 'pulse');
    this.shake(0.07);
  }

  playerDie(): void {
    this.playerAnim.base = { ...this.playerAnim.base, bodyX: 0.9, crouch: 0.5, armRx: 0.2 };
  }

  playerReset(): void {
    this.playerAnim.base = { ...ZERO_POSE, armRx: -0.5, armRz: 0.25, armLx: -0.9, armLz: -0.35 };
  }

  launchProjectile(dur: number): void {
    if (this.projectile) this.scene.remove(this.projectile.mesh);
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 0.9, 4),
      new THREE.MeshBasicMaterial({ color: TELL_COLORS.projectile }),
    );
    m.rotation.x = Math.PI / 2;
    this.scene.add(m);
    this.projectile = { mesh: m, t: 0, dur: Math.max(0.15, dur), back: false };
  }

  returnProjectile(): void {
    if (this.projectile) {
      this.projectile.back = true;
      this.projectile.t = 0;
      this.projectile.dur = 0.22;
      (this.projectile.mesh.material as THREE.MeshBasicMaterial).color.setHex(0x8ffcff);
    }
  }

  clearProjectile(): void {
    if (this.projectile) this.scene.remove(this.projectile.mesh);
    this.projectile = null;
  }

  shake(amount: number): void {
    this.shakeAmt = Math.max(this.shakeAmt, amount);
  }

  private flashTell(color: number, intensity: number, _dur: number): void {
    if (!this.enemy) return;
    for (const m of this.enemy.tellMats) {
      m.emissive.setHex(color);
      m.emissiveIntensity = intensity;
    }
  }

  /** Screen position (CSS px) of a point above the enemy's head, for floating text. */
  enemyScreenPos(heightFrac = 1): { x: number; y: number } {
    const v = new THREE.Vector3(0, (this.enemy?.height ?? 2) * heightFrac, this.enemyAnim?.homeZ ?? ENEMY_Z);
    if (this.enemy) v.x = this.enemy.root.position.x;
    v.project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
  }

  // ----------------------------------------------------------------- render

  render(dt: number, view: StageView | null): void {
    this.time += dt;
    const t = this.time;

    // Fire flicker.
    this.flames.forEach((f, i) => {
      f.scale.y = 1 + Math.sin(t * 13 + i * 1.7) * 0.12 + Math.sin(t * 7.3 + i) * 0.08;
      f.rotation.y = t * (i % 2 ? 2 : -1.5);
    });
    this.fireLights.forEach((l, i) => {
      l.intensity = (i === 0 ? 30 : 9) * (0.88 + Math.sin(t * 11 + i * 2.1) * 0.08 + Math.sin(t * 23 + i) * 0.04);
    });

    // Embers.
    const pos = this.embers.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      let y = pos.getY(i) + this.emberVel[i] * dt;
      if (y > 8) y = 0;
      pos.setY(i, y);
      pos.setX(i, pos.getX(i) + Math.sin(t * 0.8 + i) * 0.15 * dt);
    }
    pos.needsUpdate = true;

    // Soul Burst tints the world toward cold cyan.
    this.burstTint = damp(this.burstTint, view?.bursting ? 1 : 0, 5, dt);
    (this.scene.background as THREE.Color).setRGB(0.043 + 0.02 * this.burstTint, 0.059 + 0.08 * this.burstTint, 0.14 + 0.12 * this.burstTint);
    this.moonLight.intensity = 1.5 + this.burstTint * 0.8;

    this.updateEnemy(dt, view);
    this.updatePlayer(dt, view);
    this.updateProjectile(dt);
    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
  }

  private updatePlayer(dt: number, view: StageView | null): void {
    const a = this.playerAnim;
    const blocking = !!view?.blocking;
    const stunned = !!view?.stunned;
    const base = { ...ZERO_POSE, armRx: -0.5, armRz: 0.25, armLx: -0.9, armLz: -0.35 };
    if (blocking) Object.assign(base, { armLx: -1.5, armLz: 0.6, bodyY: -0.15 });
    if (stunned) Object.assign(base, { bodyX: 0.35, armLx: -0.2, armLz: -0.9, crouch: 0.1 });
    if (a.base.bodyX < 0.8) a.base = base; // keep the death pose once dead
    a.update(dt, 16);
    // Idle breathing.
    this.player.body.position.y = 0.95 + Math.sin(this.time * 2.2) * 0.012;
    this.dodgeOffset = damp(this.dodgeOffset, 0, 4, dt);
  }

  private updateEnemy(dt: number, view: StageView | null): void {
    const a = this.enemyAnim;
    const rig = this.enemy;
    if (!a || !rig || !this.enemyKind) return;

    if (this.deathT >= 0) {
      this.deathT += dt;
      const u = Math.min(1, this.deathT / 1.4);
      rig.root.rotation.x = lerp(0, -1.45, u * u);
      rig.root.position.y = -u * 0.3;
      for (const m of rig.mats) {
        m.transparent = true;
        m.opacity = 1 - Math.max(0, (this.deathT - 0.9) / 1.2);
      }
      return;
    }

    const kind = this.enemyKind;
    const state = view?.enemyState ?? 'ready';
    if (state === 'windup' && view?.strike) {
      a.base = this.windupPose(kind, view.strike.from, view.strike.kind, view.tellProgress);
      const key = `${view.strike.kind}`;
      this.lastTellKey = key;
      const glow = 0.4 + view.tellProgress * 2.6;
      for (const m of rig.tellMats) {
        m.emissive.setHex(TELL_COLORS[view.strike.kind]);
        m.emissiveIntensity = glow;
      }
    } else {
      if (this.lastTellKey) {
        this.lastTellKey = '';
      }
      for (const [m, orig] of this.tellOriginal) {
        m.emissive.lerp(orig.color, 1 - Math.exp(-10 * dt));
        m.emissiveIntensity = damp(m.emissiveIntensity, orig.intensity, 10, dt);
      }
      if (state === 'stagger') {
        a.base = { ...this.guardPose(kind), bodyX: -0.35, armRz: 0.9, armLz: -0.9, armRx: 0.2, armLx: 0.2, rootZ: 0.25, crouch: 0.05 };
        a.base.bodyZ = Math.sin(this.time * 9) * 0.06;
      } else if (state === 'recover') {
        a.base = { ...this.guardPose(kind), armRx: 0.1, armRz: 0.3, bodyX: 0.18, crouch: 0.04 };
      } else {
        a.base = this.guardPose(kind);
        a.base.bodyY = Math.sin(this.time * 1.3) * 0.08;
      }
    }
    if (rig.jaw) rig.jaw.rotation.x = damp(rig.jaw.rotation.x, state === 'windup' ? 0.35 : 0.05, 8, dt);
    a.update(dt, state === 'windup' ? 20 : 12);
    rig.body.position.y = (kind === 'hound' ? 0.62 : 0.95) + Math.sin(this.time * 2.4) * 0.015;
  }

  private updateProjectile(dt: number): void {
    const p = this.projectile;
    if (!p) return;
    p.t += dt;
    const u = Math.min(1, p.t / p.dur);
    const from = new THREE.Vector3(0.1, 1.55, ENEMY_Z - 0.4);
    const to = new THREE.Vector3(PLAYER_X, 1.35, 0.3);
    const a = p.back ? to : from;
    const b = p.back ? from : to;
    p.mesh.position.lerpVectors(a, b, u);
    p.mesh.position.y += Math.sin(u * Math.PI) * 0.25;
    if (u >= 1) this.clearProjectile();
  }

  private updateCamera(dt: number): void {
    let pos: THREE.Vector3;
    let look: THREE.Vector3;
    if (this.mode === 'duel') {
      pos = new THREE.Vector3(-0.3 + this.dodgeOffset * 0.35, 2.3, -3.2);
      look = new THREE.Vector3(-0.1 + this.dodgeOffset * 0.2, 1.15, ENEMY_Z);
      if (this.enemyKind === 'warden') {
        pos.y += 0.35;
        look.y += 0.55;
      }
    } else {
      const a = this.time * 0.08;
      pos = new THREE.Vector3(Math.sin(a) * 6.5, 2.6, Math.cos(a) * 6.5 + 2);
      look = new THREE.Vector3(0, 1.4, 2);
    }
    if (this.camPos.lengthSq() === 0) {
      this.camPos.copy(pos);
      this.camLook.copy(look);
    }
    this.camPos.lerp(pos, 1 - Math.exp(-5 * dt));
    this.camLook.lerp(look, 1 - Math.exp(-5 * dt));
    this.camera.position.copy(this.camPos);
    if (this.shakeAmt > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeAmt;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeAmt;
      this.shakeAmt *= Math.exp(-14 * dt);
    }
    this.camera.lookAt(this.camLook);
    this.fovKick = damp(this.fovKick, 0, 6, dt);
    const baseFov = this.camera.aspect < 1 ? 70 : 52;
    this.camera.fov = baseFov + this.fovKick;
    this.camera.updateProjectionMatrix();
  }
}

function dotTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

function scale(p: Partial<Pose>, k: number): Partial<Pose> {
  const out: Partial<Pose> = {};
  for (const key of Object.keys(p) as (keyof Pose)[]) out[key] = p[key]! * k;
  return out;
}
