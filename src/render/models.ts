/**
 * Low-poly, flat-shaded characters built from primitives (GDD section 12).
 * Each model exposes pivots ("rig") that the animator rotates procedurally.
 */
import * as THREE from 'three';
import type { ModelKind } from '../data/enemies';

export function flat(color: number, opts: { emissive?: number; emissiveIntensity?: number; metal?: number; rough?: number } = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    flatShading: true,
    roughness: opts.rough ?? 0.75,
    metalness: opts.metal ?? 0.15,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
  });
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

function pivot(parent: THREE.Object3D, x: number, y: number, z: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

export interface Rig {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  armR: THREE.Group;
  armL: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  /** Materials that glow with the attack tell colour. */
  tellMats: THREE.MeshStandardMaterial[];
  /** All materials, for the death fade. */
  mats: THREE.MeshStandardMaterial[];
  /** Height of the head, for camera framing and floating text. */
  height: number;
  kind: ModelKind | 'player';
  jaw?: THREE.Group;
}

type WeaponKind = 'sword' | 'greatsword' | 'bow' | 'hammer' | 'none';
type HelmKind = 'knight' | 'hood' | 'horned' | 'skull';

interface HumanoidOpts {
  scale: number;
  armor: number;
  trim: number;
  skin: number;
  helm: HelmKind;
  weapon: WeaponKind;
  shield?: 'buckler' | 'tower' | 'round';
  bulk?: number;
  eyes?: number;
  cape?: number;
}

function blade(mats: THREE.MeshStandardMaterial[], tellMats: THREE.MeshStandardMaterial[], kind: WeaponKind): THREE.Group {
  const g = new THREE.Group();
  const steel = flat(0xc9d2de, { metal: 0.6, rough: 0.35 });
  const grip = flat(0x3a2a20);
  const guard = flat(0x9a7a3a, { metal: 0.5 });
  mats.push(steel, grip, guard);
  tellMats.push(steel);
  if (kind === 'sword' || kind === 'greatsword') {
    const big = kind === 'greatsword';
    const len = big ? 1.7 : 1.05;
    const w = big ? 0.16 : 0.09;
    g.add(mesh(new THREE.BoxGeometry(0.05, 0.22, 0.05), grip, 0, -0.05, 0));
    g.add(mesh(new THREE.BoxGeometry(big ? 0.5 : 0.32, 0.05, 0.07), guard, 0, 0.07, 0));
    const b = mesh(new THREE.CylinderGeometry(w * 0.15, w, len, 4), steel, 0, 0.1 + len / 2, 0);
    b.scale.z = 0.25;
    g.add(b);
  } else if (kind === 'hammer') {
    g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.3, 6), grip, 0, 0.5, 0));
    g.add(mesh(new THREE.BoxGeometry(0.5, 0.32, 0.32), steel, 0, 1.15, 0));
  } else if (kind === 'bow') {
    const curve = new THREE.TorusGeometry(0.6, 0.03, 4, 10, Math.PI * 0.9);
    const bow = mesh(curve, grip, 0, 0.3, 0);
    bow.rotation.z = Math.PI / 2 + Math.PI * 0.05;
    g.add(bow);
    const arrow = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.8, 3), steel, 0, 0.3, 0.2);
    arrow.rotation.x = Math.PI / 2;
    g.add(arrow);
  }
  return g;
}

export function buildHumanoid(o: HumanoidOpts, kind: Rig['kind']): Rig {
  const mats: THREE.MeshStandardMaterial[] = [];
  const tellMats: THREE.MeshStandardMaterial[] = [];
  const armorM = flat(o.armor, { metal: 0.35, rough: 0.6 });
  const trimM = flat(o.trim, { metal: 0.5, rough: 0.5 });
  const skinM = flat(o.skin);
  const eyeM = flat(0x000000, { emissive: o.eyes ?? 0xffa040, emissiveIntensity: 2.2 });
  mats.push(armorM, trimM, skinM, eyeM);
  const bulk = o.bulk ?? 1;

  const root = new THREE.Group();
  const body = pivot(root, 0, 0.95, 0);

  // Torso: a tapered 6-sided chest over a belt.
  const chest = mesh(new THREE.CylinderGeometry(0.34 * bulk, 0.24 * bulk, 0.62, 6), armorM, 0, 0.36, 0);
  body.add(chest);
  body.add(mesh(new THREE.CylinderGeometry(0.25 * bulk, 0.27 * bulk, 0.14, 6), trimM, 0, 0.02, 0));
  body.add(mesh(new THREE.CylinderGeometry(0.27 * bulk, 0.33 * bulk, 0.3, 6), armorM, 0, -0.15, 0));

  // Pauldrons: spiky cones read well as silhouettes.
  for (const s of [-1, 1]) {
    const p = mesh(new THREE.ConeGeometry(0.17 * bulk, 0.3, 5), trimM, s * 0.38 * bulk, 0.66, 0);
    p.rotation.z = -s * 1.1;
    body.add(p);
  }

  if (o.cape !== undefined) {
    const capeM = flat(o.cape);
    capeM.side = THREE.DoubleSide;
    mats.push(capeM);
    const cape = mesh(new THREE.PlaneGeometry(0.62 * bulk, 1.15, 1, 3), capeM, 0, 0.1, -0.24 * bulk);
    cape.rotation.x = 0.12;
    body.add(cape);
  }

  // Head and helm.
  const head = pivot(body, 0, 0.78, 0);
  if (o.helm === 'knight' || o.helm === 'horned') {
    head.add(mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.34, 6), armorM, 0, 0.12, 0));
    head.add(mesh(new THREE.BoxGeometry(0.3, 0.035, 0.05), eyeM, 0, 0.14, 0.17));
    if (o.helm === 'horned') {
      for (const s of [-1, 1]) {
        const horn = mesh(new THREE.ConeGeometry(0.07, 0.5, 4), flat(0xe8dcc0), s * 0.22, 0.38, 0);
        horn.rotation.z = -s * 0.7;
        head.add(horn);
      }
    } else {
      head.add(mesh(new THREE.ConeGeometry(0.06, 0.22, 4), trimM, 0, 0.38, -0.02));
    }
  } else if (o.helm === 'hood') {
    head.add(mesh(new THREE.ConeGeometry(0.24, 0.5, 6), armorM, 0, 0.18, -0.02));
    head.add(mesh(new THREE.SphereGeometry(0.13, 5, 4), flat(0x0a0a10), 0, 0.08, 0.07));
    head.add(mesh(new THREE.BoxGeometry(0.16, 0.03, 0.03), eyeM, 0, 0.1, 0.17));
  } else {
    head.add(mesh(new THREE.DodecahedronGeometry(0.18, 0), skinM, 0, 0.12, 0));
    for (const s of [-1, 1]) head.add(mesh(new THREE.BoxGeometry(0.05, 0.04, 0.03), eyeM, s * 0.07, 0.14, 0.16));
  }

  // Arms: shoulder pivots so a rotation swings the whole arm.
  const mkArm = (s: number) => {
    const arm = pivot(body, s * 0.42 * bulk, 0.55, 0);
    arm.add(mesh(new THREE.CylinderGeometry(0.09 * bulk, 0.08 * bulk, 0.5, 5), armorM, 0, -0.25, 0));
    arm.add(mesh(new THREE.CylinderGeometry(0.08 * bulk, 0.07 * bulk, 0.42, 5), trimM, 0, -0.66, 0));
    arm.add(mesh(new THREE.BoxGeometry(0.13, 0.13, 0.13), skinM, 0, -0.9, 0));
    return arm;
  };
  const armR = mkArm(1);
  const armL = mkArm(-1);

  if (o.weapon !== 'none') {
    const w = blade(mats, tellMats, o.weapon);
    w.position.set(0, -0.92, 0.04);
    w.rotation.x = Math.PI / 2;
    if (o.weapon === 'bow') {
      w.rotation.set(0, 0, 0);
      armL.add(w);
    } else {
      armR.add(w);
    }
  }

  if (o.shield) {
    const big = o.shield === 'tower';
    const sh =
      o.shield === 'round'
        ? mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.06, 8), trimM)
        : mesh(new THREE.BoxGeometry(big ? 0.75 : 0.45, big ? 1.15 : 0.55, 0.07), trimM);
    if (o.shield === 'round') sh.rotation.x = Math.PI / 2;
    sh.position.set(-0.05, -0.7, 0.18);
    const boss = mesh(new THREE.OctahedronGeometry(big ? 0.12 : 0.08, 0), armorM, -0.05, -0.7, 0.24);
    armL.add(sh, boss);
  }

  const mkLeg = (s: number) => {
    const leg = pivot(root, s * 0.15 * bulk, 0.8, 0);
    leg.add(mesh(new THREE.CylinderGeometry(0.11 * bulk, 0.09 * bulk, 0.45, 5), armorM, 0, -0.22, 0));
    leg.add(mesh(new THREE.CylinderGeometry(0.09 * bulk, 0.1 * bulk, 0.4, 5), trimM, 0, -0.58, 0));
    leg.add(mesh(new THREE.BoxGeometry(0.16 * bulk, 0.08, 0.26), armorM, 0, -0.78, 0.05));
    return leg;
  };
  const legL = mkLeg(-1);
  const legR = mkLeg(1);

  root.scale.setScalar(o.scale);
  return { root, body, head, armR, armL, legL, legR, tellMats, mats, height: 1.95 * o.scale, kind };
}

function buildHound(): Rig {
  const mats: THREE.MeshStandardMaterial[] = [];
  const furM = flat(0x2a1a16, { rough: 0.9 });
  const emberM = flat(0x401008, { emissive: 0xff5a1a, emissiveIntensity: 1.2 });
  const eyeM = flat(0x000000, { emissive: 0xffd040, emissiveIntensity: 3 });
  const toothM = flat(0xf0e6d0);
  mats.push(furM, emberM, eyeM, toothM);

  const root = new THREE.Group();
  const body = pivot(root, 0, 0.62, 0);
  const torso = mesh(new THREE.CylinderGeometry(0.26, 0.2, 1.0, 6), furM, 0, 0, 0);
  torso.rotation.x = Math.PI / 2;
  body.add(torso);
  // Ember spine ridge.
  for (let i = 0; i < 5; i++) {
    const spike = mesh(new THREE.ConeGeometry(0.06, 0.22, 4), emberM, 0, 0.26, -0.35 + i * 0.17);
    spike.rotation.x = -0.4;
    body.add(spike);
  }
  const head = pivot(body, 0, 0.12, 0.55);
  head.add(mesh(new THREE.BoxGeometry(0.3, 0.24, 0.34), furM, 0, 0, 0.1));
  head.add(mesh(new THREE.BoxGeometry(0.2, 0.12, 0.26), furM, 0, -0.02, 0.36));
  for (const s of [-1, 1]) {
    head.add(mesh(new THREE.BoxGeometry(0.05, 0.04, 0.02), eyeM, s * 0.09, 0.06, 0.28));
    const ear = mesh(new THREE.ConeGeometry(0.06, 0.18, 4), emberM, s * 0.1, 0.18, 0.02);
    head.add(ear);
  }
  const jaw = pivot(head, 0, -0.1, 0.25);
  jaw.add(mesh(new THREE.BoxGeometry(0.18, 0.05, 0.24), furM, 0, 0, 0.1));
  for (const s of [-1, 1]) jaw.add(mesh(new THREE.ConeGeometry(0.02, 0.07, 3), toothM, s * 0.06, 0.05, 0.2));

  const legs: THREE.Group[] = [];
  for (const [x, z] of [[-0.16, 0.35], [0.16, 0.35], [-0.16, -0.35], [0.16, -0.35]]) {
    const leg = pivot(root, x, 0.55, z);
    leg.add(mesh(new THREE.CylinderGeometry(0.06, 0.04, 0.55, 4), furM, 0, -0.27, 0));
    legs.push(leg);
  }
  const tail = mesh(new THREE.ConeGeometry(0.05, 0.5, 4), emberM, 0, 0.1, -0.7);
  tail.rotation.x = -2.2;
  body.add(tail);

  root.scale.setScalar(1.35);
  // armL/armR drive the front legs so the shared animator still works.
  return {
    root,
    body,
    head,
    armL: legs[0],
    armR: legs[1],
    legL: legs[2],
    legR: legs[3],
    tellMats: [emberM],
    mats,
    height: 1.35,
    kind: 'hound',
    jaw,
  };
}

export function buildEnemy(kind: ModelKind): Rig {
  switch (kind) {
    case 'footman':
      return buildHumanoid({ scale: 1, armor: 0x3b3a44, trim: 0x6d5a48, skin: 0x5a4a44, helm: 'knight', weapon: 'sword', shield: 'round', eyes: 0xff7a2a, cape: 0x6a1a14 }, kind);
    case 'archer':
      return buildHumanoid({ scale: 0.97, armor: 0x34382e, trim: 0x5c5040, skin: 0x5a4a44, helm: 'hood', weapon: 'bow', eyes: 0xffb040, bulk: 0.85 }, kind);
    case 'brute':
      return buildHumanoid({ scale: 1.45, armor: 0x4a3a34, trim: 0x7a6040, skin: 0x7a5a4a, helm: 'skull', weapon: 'hammer', shield: 'round', bulk: 1.5, eyes: 0xff4020 }, kind);
    case 'warden':
      return buildHumanoid({ scale: 1.75, armor: 0x4c5260, trim: 0x8a7650, skin: 0x40404a, helm: 'horned', weapon: 'greatsword', shield: 'tower', bulk: 1.3, eyes: 0xffa030, cape: 0x3a1010 }, kind);
    case 'hound':
      return buildHound();
  }
}

export function buildPlayer(): Rig {
  return buildHumanoid(
    { scale: 0.95, armor: 0x6b7489, trim: 0xc09a5a, skin: 0x6a5048, helm: 'knight', weapon: 'sword', shield: 'buckler', eyes: 0x6fe0ff },
    'player',
  );
}
