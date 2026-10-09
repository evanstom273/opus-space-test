// Procedural alien creatures: body-plan builders producing a single skinned
// mesh per creature (rigid + blended bone weights), and procedural gaits.
// Forward is -Z, up +Y, origin at ground contact (or body centre for flyers).
import * as THREE from 'three';
import { RigBuilder, G, mat, jitter } from '../render/geom.js';

const TAU = Math.PI * 2;

// --- species table ------------------------------------------------------------
export const SPECIES = {
  grazer: {
    name: 'Longneck Grazer', plan: 'quadruped', size: 1.0, walk: 2.2, run: 7.5, flee: 22, social: true,
    c: { body: 0xd2b98e, back: 0x9a4f2e, belly: 0xefe2c4, accent: 0xe3762f, dark: 0x3a2a24, glow: 0xfff1b0 },
    neck: 2.2, legLen: 1.9, bodyLen: 2.6, bodyH: 1.15, call: { base: 180, kind: 'low' },
  },
  hopper: {
    name: 'Meadow Hopper', plan: 'hopper', size: 0.7, walk: 3.2, run: 8, flee: 9, curious: true,
    c: { body: 0x7fb9c9, back: 0x3f6f8a, belly: 0xe8f2ea, accent: 0xff9a4a, dark: 0x1f2a33, glow: 0xffd28a },
    call: { base: 900, kind: 'chirp' },
  },
  skimmer: {
    name: 'Sky Skimmer', plan: 'flyer', size: 1.6, walk: 11, run: 16, alt: [25, 70],
    c: { body: 0xd9e6e1, back: 0x3a7f86, belly: 0xf2f6f0, accent: 0xe8742f, dark: 0x1d2a2e, glow: 0xffe0a0 },
    wing: 'manta', call: { base: 520, kind: 'whistle' },
  },
  duneSerpent: {
    name: 'Dune Serpent', plan: 'serpent', size: 1.2, walk: 3.5, run: 8, flee: 14, segments: 12,
    c: { body: 0xc9884e, back: 0x7a3e22, belly: 0xf0d2a0, accent: 0x2f2a28, dark: 0x1a1412, glow: 0xffb050 },
    call: { base: 140, kind: 'hiss' },
  },
  shellback: {
    name: 'Shellback Beetle', plan: 'hexapod', size: 1.1, walk: 1.8, run: 5, flee: 10,
    c: { body: 0x2f6f7a, back: 0x1d4a55, belly: 0xc9a46a, accent: 0x7fe0c8, dark: 0x1a1a1e, glow: 0x9ff0ff },
    call: { base: 300, kind: 'click' },
  },
  kite: {
    name: 'Dust Kite', plan: 'flyer', size: 1.3, walk: 10, run: 14, alt: [30, 80],
    c: { body: 0x8a4a2e, back: 0x5a2a1a, belly: 0xe8c08a, accent: 0xff7a2a, dark: 0x1e1410, glow: 0xffc070 },
    wing: 'bat', call: { base: 700, kind: 'whistle' },
  },
  woollyStrider: {
    name: 'Woolly Strider', plan: 'quadruped', size: 1.25, walk: 1.6, run: 5.5, flee: 16, social: true, woolly: true,
    c: { body: 0xe6e8ea, back: 0xb8c2cc, belly: 0xd0d8e0, accent: 0x5f8fd8, dark: 0x2a3340, glow: 0xbfe6ff },
    neck: 0.9, legLen: 1.3, bodyLen: 2.6, bodyH: 1.5, call: { base: 120, kind: 'low' },
  },
  frostJelly: {
    name: 'Frost Jelly', plan: 'floater', size: 1.3, walk: 1.2, run: 2, alt: [4, 16],
    c: { body: 0xbfe8ff, back: 0x7fc6f0, belly: 0xe8f8ff, accent: 0x9ff0ff, dark: 0x3a6a8a, glow: 0x9feaff },
    call: { base: 1200, kind: 'chime' },
  },
  magmaCrawler: {
    name: 'Magma Crawler', plan: 'hexapod', size: 1.4, walk: 1.6, run: 4.5, flee: 8, armored: true,
    c: { body: 0x2a2422, back: 0x1a1614, belly: 0x4a2a1e, accent: 0xff6a1a, dark: 0x120e0c, glow: 0xff7a2a },
    call: { base: 90, kind: 'low' },
  },
  emberMoth: {
    name: 'Ember Moth', plan: 'flyer', size: 0.9, walk: 7, run: 10, alt: [6, 30],
    c: { body: 0x3a2a24, back: 0x2a1a14, belly: 0x5a3a2a, accent: 0xff8a2a, dark: 0x140c08, glow: 0xffa040 },
    wing: 'moth', call: { base: 1500, kind: 'flutter' },
  },
  stiltWalker: {
    name: 'Stilt Walker', plan: 'strider', size: 1.3, walk: 1.8, run: 5, flee: 14,
    c: { body: 0x5a3a7a, back: 0x2a1e48, belly: 0xc8a8e0, accent: 0x5ff8e8, dark: 0x140e20, glow: 0x6ffff0 },
    call: { base: 220, kind: 'whale' },
  },
  lumenJelly: {
    name: 'Lumen Jelly', plan: 'floater', size: 1.6, walk: 1.0, run: 2, alt: [5, 22],
    c: { body: 0xff8ae8, back: 0xc04ab8, belly: 0xffd0f4, accent: 0x6ffff0, dark: 0x4a1a4a, glow: 0xff9af0 },
    call: { base: 1000, kind: 'chime' },
  },
  glowHopper: {
    name: 'Glow Hopper', plan: 'hopper', size: 0.6, walk: 3, run: 7, flee: 7, curious: true,
    c: { body: 0x3a2f5a, back: 0x22183a, belly: 0x8a7ab0, accent: 0x5ff8e8, dark: 0x100c1c, glow: 0x6ffff0 },
    call: { base: 1100, kind: 'chirp' },
  },
};

// --- builders ---------------------------------------------------------------

function legChain(rig, parent, name, pos, l1, l2, r, c1, c2, footColor, opts = {}) {
  const u = rig.bone(name + 'U', parent, pos);
  const l = rig.bone(name + 'L', u, [0, -l1, 0]);
  const f = rig.bone(name + 'F', l, [0, -l2, 0]);
  rig.add(u, G.cap(r, Math.max(0.01, l1 - r), 4, 8), c1, { matrix: mat([0, -l1 / 2, 0]) });
  rig.add(u, G.sphere(r * 1.15, 8, 6), c1, {});
  rig.add(l, G.cap(r * 0.72, Math.max(0.01, l2 - r * 0.7), 4, 8), c2, { matrix: mat([0, -l2 / 2, 0]) });
  rig.add(l, G.sphere(r * 0.85, 8, 6), c2, {});
  if (opts.hoof !== false) rig.add(f, G.cyl(r * 0.8, r * 0.95, r * 0.9, 8), footColor, { matrix: mat([0, -r * 0.2, 0]) });
  return { u, l, f };
}

function eyes(rig, bone, z, y, x, r, color = 0x101418, glow = 0) {
  for (const s of [-1, 1]) {
    rig.add(bone, G.sphere(r, 8, 6), color, { matrix: mat([x * s, y, z]), emissive: glow });
  }
}

function buildQuadruped(sp) {
  const c = sp.c;
  const rig = new RigBuilder();
  const H = sp.legLen, L = sp.bodyLen, BH = sp.bodyH;
  const root = rig.bone('root', null, [0, 0, 0]);
  const body = rig.bone('body', root, [0, H + BH * 0.35, 0]);
  const neck1 = rig.bone('neck1', body, [0, BH * 0.25, -L * 0.45]);
  const neck2 = rig.bone('neck2', neck1, [0, sp.neck * 0.5, -sp.neck * 0.18]);
  const head = rig.bone('head', neck2, [0, sp.neck * 0.5, -sp.neck * 0.1]);
  const tail1 = rig.bone('tail1', body, [0, BH * 0.1, L * 0.48]);
  const tail2 = rig.bone('tail2', tail1, [0, -0.1, 0.6]);
  // body
  rig.add(body, G.sphere(1, 16, 12), c.body, { matrix: mat([0, 0, 0], [0, 0, 0], [BH * 0.55, BH * 0.5, L * 0.55]) });
  rig.add(body, G.sphere(1, 12, 8), c.belly, { matrix: mat([0, -BH * 0.16, 0], [0, 0, 0], [BH * 0.48, BH * 0.36, L * 0.5]) });
  if (sp.woolly) {
    // shaggy fringe of fur tufts
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * TAU;
      const z = Math.cos(a) * L * 0.42, x = Math.sin(a) * BH * 0.5;
      const cone = G.cone(0.26, 0.9, 5);
      rig.add(body, cone, i % 2 ? c.body : c.back, { matrix: mat([x, -BH * 0.32, z], [Math.PI + Math.sin(a) * 0.3, 0, Math.cos(a) * 0.2]), flat: true });
    }
    rig.add(body, G.sphere(1, 10, 8), c.back, { matrix: mat([0, BH * 0.22, 0], [0, 0, 0], [BH * 0.5, BH * 0.35, L * 0.5]), flat: true });
  } else {
    // dorsal stripes
    for (let i = 0; i < 5; i++) {
      rig.add(body, G.box(BH * 0.9, 0.08, 0.16), c.back, { matrix: mat([0, BH * 0.42, -L * 0.3 + i * L * 0.15], [0, 0, 0]) });
    }
    // dorsal frill
    for (let i = 0; i < 4; i++) rig.add(body, G.cone(0.12, 0.45, 4), c.accent, { matrix: mat([0, BH * 0.5, -L * 0.25 + i * 0.35], [-0.4, 0, 0]), flat: true });
  }
  // neck + head
  rig.add(neck1, G.cap(BH * 0.18, sp.neck * 0.45, 4, 8), sp.woolly ? c.back : c.body, { matrix: mat([0, sp.neck * 0.25, -sp.neck * 0.09], [-0.35, 0, 0]) });
  rig.add(neck2, G.cap(BH * 0.15, sp.neck * 0.45, 4, 8), c.body, { matrix: mat([0, sp.neck * 0.25, -sp.neck * 0.05], [-0.2, 0, 0]) });
  rig.add(head, G.sphere(1, 12, 10), c.body, { matrix: mat([0, 0.08, -0.25], [0.2, 0, 0], [0.24, 0.24, 0.48]) });
  rig.add(head, G.sphere(1, 10, 8), c.belly, { matrix: mat([0, -0.02, -0.55], [0.2, 0, 0], [0.16, 0.13, 0.2]) });
  eyes(rig, head, -0.32, 0.17, 0.18, 0.055);
  if (sp.woolly) {
    for (const s of [-1, 1]) rig.add(head, G.cone(0.07, 0.6, 6), 0xf2ead8, { matrix: mat([0.16 * s, -0.12, -0.55], [-1.9, 0, 0.25 * s]) });
    rig.add(head, G.sphere(1, 8, 6), c.accent, { matrix: mat([0, 0.12, -0.45], [0, 0, 0], [0.12, 0.08, 0.12]) });
  } else {
    for (const s of [-1, 1]) {
      rig.add(head, G.cyl(0.03, 0.04, 0.45, 5), c.dark, { matrix: mat([0.1 * s, 0.38, -0.1], [0.3, 0, 0.25 * s]) });
      rig.add(head, G.sphere(0.07, 6, 5), c.accent, { matrix: mat([0.16 * s, 0.6, -0.04]), emissive: 0.4 });
      rig.add(head, G.cone(0.12, 0.3, 4), c.back, { matrix: mat([0.22 * s, 0.15, 0.05], [0, 0, -1.4 * s]), flat: true });
    }
  }
  // tail
  rig.add(tail1, G.cap(0.11, 0.5, 3, 6), c.body, { matrix: mat([0, -0.05, 0.3], [1.3, 0, 0]) });
  rig.add(tail2, G.cone(0.13, 0.55, 6), sp.woolly ? c.back : c.accent, { matrix: mat([0, -0.1, 0.3], [1.6, 0, 0]) });
  // legs
  const legs = [];
  const lx = BH * 0.36, lz = L * 0.36;
  const defs = [['FL', -lx, -lz, 0], ['FR', lx, -lz, Math.PI], ['BL', -lx, lz, Math.PI], ['BR', lx, lz, 0]];
  for (const [n, x, z, ph] of defs) {
    const r = sp.woolly ? 0.2 : 0.14;
    const lc = legChain(rig, body, n, [x, -BH * 0.2, z], H * 0.52, H * 0.5, r, sp.woolly ? c.back : c.body, c.dark, c.dark);
    legs.push({ ...lc, phase: ph, side: x > 0 ? 1 : -1, front: z < 0 });
  }
  return { rig, extra: { legs, H, BH } };
}

function buildHexapod(sp) {
  const c = sp.c;
  const rig = new RigBuilder();
  const root = rig.bone('root', null, [0, 0, 0]);
  const body = rig.bone('body', root, [0, 0.75, 0]);
  const head = rig.bone('head', body, [0, 0.05, -1.0]);
  // shell
  const shell = G.sphere(1, 14, 10, 0, TAU, 0, Math.PI * 0.55);
  rig.add(body, shell, c.body, { matrix: mat([0, -0.05, 0.1], [0, 0, 0], [0.85, 0.7, 1.15]), flat: true });
  rig.add(body, G.sphere(1, 10, 8), c.belly, { matrix: mat([0, -0.12, 0.1], [0, 0, 0], [0.7, 0.3, 1.0]) });
  if (sp.armored) {
    for (let i = 0; i < 5; i++) {
      rig.add(body, G.box(1.5, 0.12, 0.18), c.back, { matrix: mat([0, 0.45 + Math.sin(i / 4 * Math.PI) * 0.15, -0.7 + i * 0.38], [0, 0, 0]), flat: true });
      rig.add(body, G.box(1.3, 0.05, 0.05), c.glow, { matrix: mat([0, 0.5 + Math.sin(i / 4 * Math.PI) * 0.15, -0.52 + i * 0.38]), emissive: 2.2 });
    }
    for (let i = 0; i < 6; i++) rig.add(body, G.cone(0.12, 0.5, 4), c.back, { matrix: mat([(i % 2 ? 0.35 : -0.35), 0.7, -0.6 + i * 0.25], [-0.3, 0, 0]), flat: true });
  } else {
    // shell seam + glossy spots
    rig.add(body, G.box(0.05, 0.05, 2.0), c.back, { matrix: mat([0, 0.68, 0.1]) });
    for (const [x, z] of [[0.4, -0.3], [-0.4, -0.3], [0.45, 0.4], [-0.45, 0.4]]) {
      rig.add(body, G.sphere(0.13, 6, 4), c.accent, { matrix: mat([x, 0.5, z], [0, 0, 0], [1, 0.4, 1]), emissive: 0.6 });
    }
  }
  rig.add(head, G.sphere(1, 10, 8), c.back, { matrix: mat([0, 0, -0.1], [0, 0, 0], [0.42, 0.3, 0.38]) });
  eyes(rig, head, -0.38, 0.1, 0.22, 0.08, sp.armored ? c.glow : 0x101010, sp.armored ? 2 : 0);
  for (const s of [-1, 1]) {
    rig.add(head, G.cone(0.05, 0.5, 5), c.dark, { matrix: mat([0.18 * s, -0.08, -0.55], [-1.5, 0, 0.3 * s]) });
    rig.add(head, G.cyl(0.015, 0.015, 0.8, 4), c.dark, { matrix: mat([0.12 * s, 0.35, -0.5], [-0.8, 0, 0.3 * s]) });
  }
  const legs = [];
  for (let i = 0; i < 3; i++) {
    for (const s of [-1, 1]) {
      const n = `L${i}${s > 0 ? 'R' : 'L'}`;
      const z = -0.55 + i * 0.6;
      const hip = rig.bone(n + 'H', body, [0.55 * s, -0.12, z]);
      const fem = rig.bone(n + 'U', hip, [0, 0, 0]);
      const tib = rig.bone(n + 'L', fem, [0.75 * s, 0.35, 0]);
      const femG = G.cap(0.07, 0.75, 3, 6);
      rig.add(fem, femG, c.dark, { matrix: mat([0.375 * s, 0.17, 0], [0, 0, -Math.atan2(0.75 * s, 0.35)]) });
      rig.add(tib, G.cap(0.055, 1.0, 3, 6), c.belly, { matrix: mat([0.15 * s, -0.5, 0], [0, 0, 0.3 * s]) });
      rig.add(tib, G.cone(0.06, 0.2, 5), c.dark, { matrix: mat([0.28 * s, -1.05, 0], [Math.PI, 0, 0.3 * s]) });
      const tri = (i + (s > 0 ? 1 : 0)) % 2;
      legs.push({ hip, u: fem, l: tib, phase: tri * Math.PI, side: s, idx: i });
    }
  }
  return { rig, extra: { legs } };
}

function buildStrider(sp) {
  const c = sp.c;
  const rig = new RigBuilder();
  const root = rig.bone('root', null, [0, 0, 0]);
  const body = rig.bone('body', root, [0, 4.0, 0]);
  const neck = rig.bone('neck', body, [0, 0.3, -0.6]);
  const head = rig.bone('head', neck, [0, 0.7, -0.3]);
  const t1 = rig.bone('trunk1', head, [0, -0.15, -0.35]);
  const t2 = rig.bone('trunk2', t1, [0, -0.55, 0]);
  const t3 = rig.bone('trunk3', t2, [0, -0.55, 0]);
  rig.add(body, G.sphere(1, 14, 10), c.body, { matrix: mat([0, 0, 0], [0, 0, 0], [0.65, 0.55, 0.95]) });
  rig.add(body, G.sphere(1, 10, 8), c.belly, { matrix: mat([0, -0.2, 0], [0, 0, 0], [0.55, 0.38, 0.8]) });
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * TAU;
    rig.add(body, G.sphere(0.09, 6, 4), c.accent, { matrix: mat([Math.cos(a) * 0.55, 0.25, Math.sin(a) * 0.7]), emissive: 2.2 });
  }
  rig.add(body, G.cone(0.35, 1.0, 6), c.back, { matrix: mat([0, 0.1, 1.1], [1.75, 0, 0]), flat: true });
  rig.add(neck, G.cap(0.14, 0.6, 3, 6), c.body, { matrix: mat([0, 0.35, -0.15], [-0.4, 0, 0]) });
  rig.add(head, G.sphere(1, 10, 8), c.body, { matrix: mat([0, 0, -0.1], [0, 0, 0], [0.32, 0.3, 0.42]) });
  eyes(rig, head, -0.4, 0.1, 0.16, 0.07, c.glow, 2.5);
  for (const s of [-1, 1]) rig.add(head, G.cone(0.1, 0.5, 5), c.back, { matrix: mat([0.22 * s, 0.25, 0.1], [0.6, 0, -0.6 * s]), flat: true });
  rig.add(t1, G.cap(0.1, 0.45, 3, 6), c.body, { matrix: mat([0, -0.27, 0]) });
  rig.add(t2, G.cap(0.08, 0.45, 3, 6), c.body, { matrix: mat([0, -0.27, 0]) });
  rig.add(t3, G.cap(0.06, 0.4, 3, 6), c.belly, { matrix: mat([0, -0.25, 0]) });
  rig.add(t3, G.sphere(0.1, 6, 4), c.glow, { matrix: mat([0, -0.5, 0]), emissive: 2.5 });
  const legs = [];
  for (const [n, x, ph] of [['L', -0.35, 0], ['R', 0.35, Math.PI]]) {
    const lc = legChain(rig, body, n, [x, -0.2, 0.05], 1.9, 1.9, 0.1, c.body, c.dark, c.dark);
    rig.add(lc.u, G.sphere(0.2, 8, 6), c.back, {});
    legs.push({ ...lc, phase: ph });
  }
  // a third, trailing balance leg
  const lc = legChain(rig, body, 'T', [0, -0.15, 0.55], 1.95, 1.9, 0.08, c.body, c.dark, c.dark);
  legs.push({ ...lc, phase: Math.PI / 2, trailing: true });
  return { rig, extra: { legs } };
}

function buildHopper(sp) {
  const c = sp.c;
  const rig = new RigBuilder();
  const root = rig.bone('root', null, [0, 0, 0]);
  const body = rig.bone('body', root, [0, 0.55, 0]);
  const head = rig.bone('head', body, [0, 0.35, -0.3]);
  const earL = rig.bone('earL', head, [-0.1, 0.18, 0.05]);
  const earR = rig.bone('earR', head, [0.1, 0.18, 0.05]);
  const tail = rig.bone('tail', body, [0, -0.05, 0.38]);
  rig.add(body, G.sphere(1, 12, 10), c.body, { matrix: mat([0, 0, 0], [0.3, 0, 0], [0.32, 0.36, 0.42]) });
  rig.add(body, G.sphere(1, 10, 8), c.belly, { matrix: mat([0, -0.05, -0.12], [0.3, 0, 0], [0.24, 0.28, 0.3]) });
  rig.add(body, G.sphere(1, 8, 6), c.back, { matrix: mat([0, 0.18, 0.08], [0.3, 0, 0], [0.26, 0.18, 0.32]) });
  rig.add(head, G.sphere(1, 12, 10), c.body, { matrix: mat([0, 0, -0.05], [0, 0, 0], [0.22, 0.2, 0.26]) });
  eyes(rig, head, -0.2, 0.06, 0.12, 0.06, sp.c.glow, sp.id === 'glowHopper' ? 2 : 0.15);
  rig.add(head, G.sphere(0.04, 6, 4), c.dark, { matrix: mat([0, -0.03, -0.3]) });
  for (const [b, s] of [[earL, -1], [earR, 1]]) {
    rig.add(b, G.cap(0.05, 0.4, 3, 6), c.back, { matrix: mat([0.04 * s, 0.25, 0.05], [0.3, 0, 0.25 * s]) });
    rig.add(b, G.sphere(0.06, 6, 4), c.accent, { matrix: mat([0.1 * s, 0.5, 0.15]), emissive: sp.id === 'glowHopper' ? 2.5 : 0.5 });
  }
  rig.add(tail, G.cone(0.1, 0.45, 6), c.back, { matrix: mat([0, 0.05, 0.2], [1.3, 0, 0]) });
  const legs = [];
  for (const s of [-1, 1]) {
    const n = s > 0 ? 'R' : 'L';
    const th = rig.bone('thigh' + n, body, [0.2 * s, -0.08, 0.15]);
    const sh = rig.bone('shin' + n, th, [0, -0.28, 0.12]);
    const ft = rig.bone('foot' + n, sh, [0, -0.25, -0.05]);
    rig.add(th, G.sphere(1, 8, 6), c.body, { matrix: mat([0, -0.12, 0.04], [0, 0, 0], [0.12, 0.2, 0.16]) });
    rig.add(sh, G.cap(0.045, 0.22, 3, 6), c.back, { matrix: mat([0, -0.12, 0]) });
    rig.add(ft, G.rbox(0.09, 0.05, 0.26, 0.02), c.dark, { matrix: mat([0, 0, -0.08]) });
    const arm = rig.bone('arm' + n, body, [0.15 * s, 0.05, -0.28]);
    rig.add(arm, G.cap(0.035, 0.18, 3, 6), c.belly, { matrix: mat([0, -0.1, -0.02]) });
    legs.push({ th, sh, ft, arm, side: s });
  }
  return { rig, extra: { legs, earL, earR, tail } };
}

function buildFlyer(sp) {
  const c = sp.c;
  const rig = new RigBuilder();
  const root = rig.bone('root', null, [0, 0, 0]);
  const body = rig.bone('body', root, [0, 0, 0]);
  const head = rig.bone('head', body, [0, 0.05, -0.75]);
  const tail1 = rig.bone('tail1', body, [0, 0, 0.7]);
  const tail2 = rig.bone('tail2', tail1, [0, 0, 0.6]);
  const kind = sp.wing;
  rig.add(body, G.sphere(1, 12, 8), c.body, { matrix: mat([0, 0, 0], [0, 0, 0], kind === 'manta' ? [0.45, 0.22, 0.9] : [0.22, 0.22, 0.75]) });
  rig.add(body, G.sphere(1, 10, 6), c.back, { matrix: mat([0, 0.08, 0], [0, 0, 0], kind === 'manta' ? [0.4, 0.16, 0.8] : [0.2, 0.18, 0.65]) });
  rig.add(head, G.sphere(1, 10, 8), c.body, { matrix: mat([0, 0, -0.1], [0, 0, 0], [0.2, 0.16, 0.28]) });
  eyes(rig, head, -0.2, 0.06, 0.13, 0.045, kind === 'moth' ? c.glow : 0x101010, kind === 'moth' ? 2 : 0);
  if (kind === 'moth') {
    for (const s of [-1, 1]) rig.add(head, G.cyl(0.01, 0.01, 0.5, 4), c.accent, { matrix: mat([0.08 * s, 0.25, -0.2], [-0.6, 0, 0.4 * s]), emissive: 1 });
  } else {
    rig.add(head, G.cone(0.06, 0.3, 5), c.dark, { matrix: mat([0, -0.02, -0.42], [-Math.PI / 2, 0, 0]) });
  }
  rig.add(tail1, G.cone(0.14, 0.7, 6), c.body, { matrix: mat([0, 0, 0.3], [Math.PI / 2, 0, 0]) });
  rig.add(tail2, G.cone(0.06, 0.8, 5), c.accent, { matrix: mat([0, 0, 0.35], [Math.PI / 2, 0, 0]), emissive: kind === 'moth' ? 1.5 : 0 });
  if (kind !== 'moth') rig.add(tail2, G.box(0.5, 0.02, 0.25), c.accent, { matrix: mat([0, 0, 0.7]) });
  const wings = [];
  for (const s of [-1, 1]) {
    const n = s > 0 ? 'R' : 'L';
    const w1 = rig.bone('wing1' + n, body, [0.18 * s, 0.05, -0.1]);
    const w2 = rig.bone('wing2' + n, w1, [1.0 * s, 0, 0.1]);
    const span1 = 1.05, span2 = kind === 'manta' ? 1.1 : 1.3;
    // membrane wings: flattened shapes
    const sh1 = new THREE.Shape();
    if (kind === 'manta') {
      sh1.moveTo(0, -0.55); sh1.lineTo(span1, -0.2); sh1.lineTo(span1, 0.45); sh1.lineTo(0, 0.6);
    } else if (kind === 'moth') {
      sh1.moveTo(0, -0.3); sh1.quadraticCurveTo(span1 * 0.7, -0.9, span1, -0.4); sh1.lineTo(span1, 0.5); sh1.quadraticCurveTo(span1 * 0.5, 0.9, 0, 0.4);
    } else {
      sh1.moveTo(0, -0.35); sh1.lineTo(span1, -0.3); sh1.lineTo(span1, 0.3); sh1.lineTo(0, 0.5);
    }
    const g1 = new THREE.ShapeGeometry(sh1);
    g1.rotateX(Math.PI / 2);
    if (s < 0) g1.scale(-1, 1, 1);
    rig.add(w1, g1, kind === 'moth' ? c.accent : c.belly, { emissive: kind === 'moth' ? 0.9 : 0 });
    const sh2 = new THREE.Shape();
    if (kind === 'manta') {
      sh2.moveTo(0, -0.2); sh2.lineTo(span2, 0.35); sh2.lineTo(span2 * 0.9, 0.5); sh2.lineTo(0, 0.45);
    } else if (kind === 'moth') {
      sh2.moveTo(0, -0.4); sh2.quadraticCurveTo(span2 * 0.8, -0.8, span2, 0.0); sh2.quadraticCurveTo(span2 * 0.6, 0.7, 0, 0.5);
    } else {
      sh2.moveTo(0, -0.3); sh2.lineTo(span2, -0.1); sh2.lineTo(span2 * 0.7, 0.15); sh2.lineTo(span2 * 0.45, 0.05); sh2.lineTo(span2 * 0.3, 0.3); sh2.lineTo(0, 0.3);
    }
    const g2 = new THREE.ShapeGeometry(sh2);
    g2.rotateX(Math.PI / 2);
    if (s < 0) g2.scale(-1, 1, 1);
    rig.add(w2, g2, kind === 'moth' ? c.glow : c.back, { emissive: kind === 'moth' ? 1.4 : 0 });
    rig.add(w1, G.cyl(0.04, 0.03, span1, 5), c.dark, { matrix: mat([span1 / 2 * s, 0, -0.3], [0, 0, Math.PI / 2]) });
    if (kind === 'manta') rig.add(w2, G.sphere(0.07, 6, 4), c.accent, { matrix: mat([span2 * 0.85 * s, 0.02, 0.42]), emissive: 0.6 });
    wings.push({ w1, w2, side: s });
  }
  return { rig, extra: { wings, tail1, tail2 }, doubleSide: true };
}

function buildFloater(sp) {
  const c = sp.c;
  const rig = new RigBuilder();
  const root = rig.bone('root', null, [0, 0, 0]);
  const bell = rig.bone('bell', root, [0, 0, 0]);
  const pts = [[0, 1.3], [0.55, 1.2], [0.95, 0.85], [1.15, 0.35], [1.1, 0.0], [0.85, 0.15], [0.4, 0.3], [0, 0.35]];
  rig.add(bell, G.lathe(pts.slice().reverse(), 16), c.body, { emissive: 0.35 });
  rig.add(bell, G.lathe([[0, -0.3], [0.38, -0.2], [0.48, 0.15], [0, 0.4]], 12), c.accent, { emissive: 1.6 });
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * TAU;
    rig.add(bell, G.sphere(0.07, 6, 4), c.glow, { matrix: mat([Math.cos(a) * 1.08, 0.06, Math.sin(a) * 1.08]), emissive: 2.5 });
  }
  const tentacles = [];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = i / n * TAU + 0.2;
    const r = i % 2 ? 0.75 : 0.4;
    let prev = bell;
    const chain = [];
    let off = [Math.cos(a) * r, 0.1, Math.sin(a) * r];
    for (let k = 0; k < 4; k++) {
      const b = rig.bone(`t${i}_${k}`, prev, k === 0 ? off : [0, -0.6, 0]);
      const g = G.cyl(0.06 - k * 0.012, 0.05 - k * 0.012, 0.62, 6);
      g.translate(0, -0.31, 0);
      rig.add(b, g, k % 2 ? c.back : c.belly, { emissive: 0.5, blendTo: k < 3 ? undefined : undefined });
      chain.push(b);
      prev = b;
    }
    rig.add(prev, G.sphere(0.07, 6, 4), c.glow, { matrix: mat([0, -0.6, 0]), emissive: 2.5 });
    tentacles.push({ chain, phase: i * 1.3 });
  }
  return { rig, extra: { bell, tentacles } };
}

function buildSerpent(sp) {
  const c = sp.c;
  const rig = new RigBuilder();
  const root = rig.bone('root', null, [0, 0, 0]);
  const segs = [];
  const N = sp.segments;
  for (let i = 0; i < N; i++) {
    // flat hierarchy: each segment bone is a direct child of root, posed from a path
    const b = rig.bone('seg' + i, root, [0, 0.35, i * 0.7]);
    const t = i / (N - 1);
    const r = (i === 0 ? 0.5 : 0.48 * (1 - t * 0.75)) * 1.0;
    rig.add(b, G.sphere(1, 12, 8), c.body, { matrix: mat([0, 0, 0], [0, 0, 0], [r, r * 0.8, 0.55]) });
    rig.add(b, G.sphere(1, 10, 6), c.back, { matrix: mat([0, r * 0.35, 0], [0, 0, 0], [r * 0.85, r * 0.5, 0.5]), flat: true });
    rig.add(b, G.box(r * 1.2, 0.06, 0.12), c.accent, { matrix: mat([0, r * 0.62, 0]) });
    if (i > 0 && i % 2 === 0) for (const s of [-1, 1]) rig.add(b, G.cone(0.08, 0.35 * (1 - t * 0.5), 4), c.back, { matrix: mat([r * 0.7 * s, r * 0.5, 0], [0, 0, -0.9 * s]), flat: true });
    segs.push(b);
  }
  const head = segs[0];
  rig.add(head, G.sphere(1, 12, 8), c.back, { matrix: mat([0, 0.05, -0.45], [0, 0, 0], [0.45, 0.32, 0.45]) });
  for (const s of [-1, 1]) {
    rig.add(head, G.cone(0.08, 0.55, 5), c.belly, { matrix: mat([0.2 * s, -0.08, -0.85], [-Math.PI / 2, 0, -0.35 * s]) });
    rig.add(head, G.sphere(0.07, 6, 4), c.glow, { matrix: mat([0.24 * s, 0.18, -0.65]), emissive: 1.8 });
  }
  return { rig, extra: { segs } };
}

const PLANS = {
  quadruped: buildQuadruped, hexapod: buildHexapod, strider: buildStrider, hopper: buildHopper,
  flyer: buildFlyer, floater: buildFloater, serpent: buildSerpent,
};

// Build a species prototype once; instances clone its skeleton and share geometry.
export function buildSpeciesProto(id, material, outlineMaterial, materialDouble) {
  const sp = { ...SPECIES[id], id };
  const { rig, extra, doubleSide } = PLANS[sp.plan](sp);
  const built = rig.build(doubleSide ? materialDouble : material, outlineMaterial);
  built.mesh.scale.setScalar(sp.size);
  return { sp, built, extra, doubleSide };
}

export function instantiate(proto, material, outlineMaterial) {
  const src = proto.built;
  const srcRoot = src.skeleton.bones[0];
  const rootClone = srcRoot.clone(true);
  const byName = {};
  rootClone.traverse((o) => { if (o.isBone) byName[o.name] = o; });
  const bones = src.skeleton.bones.map((b) => byName[b.name]);
  const skeleton = new THREE.Skeleton(bones, src.skeleton.boneInverses.map((m) => m.clone()));
  const geo = src.mesh.geometry;
  const mesh = new THREE.SkinnedMesh(geo, material);
  mesh.add(rootClone);
  mesh.bind(skeleton, new THREE.Matrix4());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const rad = 5 * proto.sp.size;
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), rad);
  if (outlineMaterial) {
    const o = new THREE.SkinnedMesh(geo, outlineMaterial);
    o.bind(skeleton, new THREE.Matrix4());
    o.boundingSphere = mesh.boundingSphere;
    mesh.add(o);
  }
  // map the prototype's helper references (legs, wings...) onto the clone's bones
  const remap = (v) => {
    if (v && v.isBone) return byName[v.name];
    if (Array.isArray(v)) return v.map(remap);
    if (v && typeof v === 'object') {
      const o = {};
      for (const k in v) o[k] = remap(v[k]);
      return o;
    }
    return v;
  };
  const extra = remap(proto.extra);
  mesh.scale.setScalar(proto.sp.size);
  return { mesh, bones: byName, extra };
}

// --- procedural animation per plan ---------------------------------------------
const lerpRot = (b, x, y, z, k) => {
  b.rotation.x += (x - b.rotation.x) * k;
  b.rotation.y += (y - b.rotation.y) * k;
  b.rotation.z += (z - b.rotation.z) * k;
};

export function animateCreature(cr, dt) {
  const sp = cr.sp, ex = cr.extra, B = cr.bones;
  const k = Math.min(1, dt * 10);
  const spd = cr.speed;
  cr.t += dt;
  switch (sp.plan) {
    case 'quadruped': {
      const stride = sp.legLen * 1.4;
      cr.phase += (spd / stride) * TAU * dt * 0.5;
      const gait = Math.min(1, spd / sp.walk);
      const run = THREE.MathUtils.clamp((spd - sp.walk) / (sp.run - sp.walk), 0, 1);
      for (const L of ex.legs) {
        const ph = cr.phase + L.phase + (run > 0.5 && !L.front ? 0.6 : 0);
        const sw = Math.sin(ph) * (0.45 + run * 0.25) * gait;
        lerpRot(L.u, sw, 0, 0, k);
        lerpRot(L.l, -Math.max(0, Math.sin(ph + 1.1)) * 0.8 * gait + (L.front ? 0 : 0.1), 0, 0, k);
      }
      B.body.position.y = ex.H + ex.BH * 0.35 + Math.abs(Math.cos(cr.phase)) * 0.06 * gait;
      B.body.rotation.x = Math.sin(cr.phase * 2) * 0.02 * gait;
      const graze = cr.mode === 'graze' ? 1 : 0;
      cr.graze += (graze - cr.graze) * Math.min(1, dt * 2);
      lerpRot(B.neck1, -cr.graze * 1.1 + 0.05 * Math.sin(cr.t * 0.7), Math.sin(cr.t * 0.4) * 0.2 * (1 - gait), 0, k);
      lerpRot(B.neck2, -cr.graze * 0.6 + run * 0.4, 0, 0, k);
      lerpRot(B.head, cr.graze * 0.5 + Math.sin(cr.t * 3) * 0.05 * cr.graze, cr.look, 0, k);
      lerpRot(B.tail1, 0.3 + Math.sin(cr.t * 2) * 0.1, Math.sin(cr.t * 1.3 + cr.phase) * 0.35, 0, k);
      lerpRot(B.tail2, 0.2, Math.sin(cr.t * 1.6) * 0.3, 0, k);
      break;
    }
    case 'hexapod': {
      cr.phase += (spd / 0.9) * TAU * dt * 0.5;
      const gait = Math.min(1, spd / sp.walk + 0.0);
      for (const L of ex.legs) {
        const ph = cr.phase + L.phase;
        const swing = Math.sin(ph) * 0.45 * gait;
        const lift = Math.max(0, Math.cos(ph)) * 0.45 * gait;
        lerpRot(L.hip, 0, swing * -L.side, 0, k);
        lerpRot(L.u, 0, 0, L.side * lift, k);
      }
      B.body.position.y = 0.75 + Math.sin(cr.phase * 2) * 0.03 * gait;
      lerpRot(B.head, Math.sin(cr.t * 1.1) * 0.1, Math.sin(cr.t * 0.6) * 0.3 + cr.look, 0, k);
      break;
    }
    case 'strider': {
      cr.phase += (spd / 3.2) * TAU * dt * 0.5;
      const gait = Math.min(1, spd / sp.walk);
      for (const L of ex.legs) {
        const ph = cr.phase + L.phase;
        const sw = Math.sin(ph) * 0.4 * gait * (L.trailing ? 0.4 : 1);
        lerpRot(L.u, sw + (L.trailing ? -0.35 : 0), 0, 0, k);
        lerpRot(L.l, -Math.max(0, Math.sin(ph + 1.2)) * 0.7 * gait + (L.trailing ? 0.5 : 0), 0, 0, k);
      }
      B.body.position.y = 4.0 + Math.abs(Math.cos(cr.phase)) * 0.12 * gait - 0.05;
      B.body.rotation.z = Math.sin(cr.phase) * 0.06 * gait;
      lerpRot(B.neck, 0.1 + Math.sin(cr.t * 0.5) * 0.1, Math.sin(cr.t * 0.3) * 0.3 + cr.look, 0, k);
      lerpRot(B.trunk1, 0.2 + Math.sin(cr.t * 1.3) * 0.25, 0, Math.sin(cr.t * 0.9) * 0.2, k);
      lerpRot(B.trunk2, 0.3 + Math.sin(cr.t * 1.3 + 0.8) * 0.3, 0, 0, k);
      lerpRot(B.trunk3, 0.3 + Math.sin(cr.t * 1.3 + 1.6) * 0.3, 0, 0, k);
      break;
    }
    case 'hopper': {
      // hops: vertical arc when moving
      if (spd > 0.3) cr.hop += dt * (2.2 + spd * 0.25);
      else cr.hop = Math.ceil(cr.hop) - 0.0001 > cr.hop ? cr.hop + dt * 2.5 : cr.hop;
      const f = cr.hop % 1;
      const air = spd > 0.3 || f > 0.02 ? Math.sin(f * Math.PI) : 0;
      cr.yOffset = air * (0.35 + spd * 0.06) * sp.size;
      for (const L of ex.legs) {
        lerpRot(L.th, -0.4 - air * 0.9 + (1 - air) * 0.3, 0, 0, Math.min(1, dt * 20));
        lerpRot(L.sh, 0.9 * (1 - air) + air * 0.2, 0, 0, Math.min(1, dt * 20));
        lerpRot(L.ft, -0.4 * (1 - air), 0, 0, k);
        lerpRot(L.arm, 0.3 + air * 0.8, 0, 0, k);
      }
      lerpRot(B.body, -0.2 * air, 0, 0, k);
      lerpRot(ex.earL, -0.2 + air * 0.6 + Math.sin(cr.t * 4) * 0.05, 0, 0, k);
      lerpRot(ex.earR, -0.2 + air * 0.6 + Math.sin(cr.t * 4 + 1) * 0.05, 0, 0, k);
      lerpRot(B.head, Math.sin(cr.t * 0.8) * 0.15, Math.sin(cr.t * 0.5) * 0.5 * (1 - air) + cr.look, 0, k);
      lerpRot(ex.tail, 0.2 + air * 0.4, Math.sin(cr.t * 3) * 0.2, 0, k);
      break;
    }
    case 'flyer': {
      const glide = cr.glide;
      const flapRate = sp.wing === 'moth' ? 9 : 4.5;
      cr.phase += dt * flapRate * (1 - glide * 0.85);
      const flap = Math.sin(cr.phase) * (sp.wing === 'manta' ? 0.55 : 0.75) * (1 - glide * 0.85);
      for (const W of ex.wings) {
        lerpRot(W.w1, 0, 0, (flap + glide * 0.05) * W.side * -1, Math.min(1, dt * 18));
        lerpRot(W.w2, 0, 0, (Math.sin(cr.phase - 0.8) * 0.4 * (1 - glide)) * W.side * -1, Math.min(1, dt * 18));
      }
      lerpRot(ex.tail1, Math.sin(cr.phase * 0.5) * 0.15, Math.sin(cr.t) * 0.1, 0, k);
      lerpRot(ex.tail2, Math.sin(cr.phase * 0.5 - 0.6) * 0.2, 0, 0, k);
      cr.yOffset = -Math.sin(cr.phase) * 0.15 * (1 - glide);
      break;
    }
    case 'floater': {
      const pulse = Math.sin(cr.t * 1.4 + cr.seed);
      ex.bell.scale.set(1 + pulse * 0.07, 1 - pulse * 0.08, 1 + pulse * 0.07);
      for (const T of ex.tentacles) {
        T.chain.forEach((b, i) => {
          b.rotation.x = Math.sin(cr.t * 1.2 + T.phase + i * 0.7) * (0.15 + i * 0.06);
          b.rotation.z = Math.cos(cr.t * 0.9 + T.phase + i * 0.5) * (0.12 + i * 0.05);
        });
      }
      cr.yOffset = Math.sin(cr.t * 0.7 + cr.seed) * 0.6 + pulse * 0.15;
      break;
    }
    case 'serpent': {
      // segments follow a body-local slither wave; the root follows the path
      cr.phase += dt * (1.5 + spd * 0.9);
      const amp = 0.35 + Math.min(1, spd / sp.walk) * 0.25;
      ex.segs.forEach((b, i) => {
        const z = i * 0.7;
        const x = Math.sin(cr.phase - i * 0.65) * amp * Math.min(1, i / 3 + 0.25);
        b.position.set(x, 0.35 + (i === 0 ? Math.max(0, Math.sin(cr.t * 0.7)) * 0.4 * (spd < 0.2 ? 1 : 0) : 0), z);
        const dx = Math.cos(cr.phase - i * 0.65) * amp * -0.65;
        b.rotation.y = Math.atan2(-dx, 0.7) * 0.9;
      });
      break;
    }
  }
}
