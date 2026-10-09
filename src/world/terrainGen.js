// Pure terrain generation: planet height/colour functions, cube-sphere patch
// building and deterministic scatter placement. No three.js imports so this
// module runs unchanged inside Web Workers and on the main thread.

import { Noise3, mulberry32, hash32, smoothstep, clamp } from '../core/noise.js';

export const PATCH_N = 33; // vertices per patch side

// Cube faces: normal n, axes u, v with cross(u, v) = n so grids wind CCW.
export const FACES = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];

// Map face coordinates (a, b in [-1, 1]) to a unit direction using the
// "spherified cube" mapping, which keeps cells close to uniform in size.
export function faceToDir(face, a, b, out) {
  const F = FACES[face];
  const x = F.n[0] + F.u[0] * a + F.v[0] * b;
  const y = F.n[1] + F.u[1] * a + F.v[1] * b;
  const z = F.n[2] + F.u[2] * a + F.v[2] * b;
  const x2 = x * x, y2 = y * y, z2 = z * z;
  out[0] = x * Math.sqrt(Math.max(0, 1 - y2 / 2 - z2 / 2 + (y2 * z2) / 3));
  out[1] = y * Math.sqrt(Math.max(0, 1 - z2 / 2 - x2 / 2 + (z2 * x2) / 3));
  out[2] = z * Math.sqrt(Math.max(0, 1 - x2 / 2 - y2 / 2 + (x2 * y2) / 3));
  const l = Math.hypot(out[0], out[1], out[2]);
  out[0] /= l; out[1] /= l; out[2] /= l;
  return out;
}

// --- colour helpers -------------------------------------------------------

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
export function hexLin(hex) {
  const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
}
function setC(out, c) { out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; }
function mixC(out, c, t) {
  out[0] += (c[0] - out[0]) * t;
  out[1] += (c[1] - out[1]) * t;
  out[2] += (c[2] - out[2]) * t;
}
function mulC(out, k) { out[0] *= k; out[1] *= k; out[2] *= k; }

// --- planet generators ----------------------------------------------------

class BaseGen {
  constructor(def) {
    this.def = def;
    this.R = def.radius;
    this.sea = def.seaLevel;
    this.seed = def.seed;
    this.n1 = new Noise3(def.seed * 7 + 1);
    this.n2 = new Noise3(def.seed * 7 + 2);
    this.n3 = new Noise3(def.seed * 7 + 3);
    this.n4 = new Noise3(def.seed * 7 + 4);
    this.n5 = new Noise3(def.seed * 7 + 5);
    this.cell = [0, 0];
    this.emissive = 0;
  }
  // Moisture/variation field shared by colour + scatter rules.
  moisture(x, y, z) {
    const s = this.R / 650;
    return this.n5.fbm(x * s + 3.1, y * s, z * s, 3) * 0.5 + 0.5;
  }
}

// Elysia: temperate world, teal grasslands, alien autumn forests, oceans.
class ElysiaGen extends BaseGen {
  constructor(def) {
    super(def);
    this.C = {
      deep: hexLin(0x2f4d52), shallow: hexLin(0xbfae7f), beach: hexLin(0xe2d2a0),
      grassA: hexLin(0x3a8456), grassB: hexLin(0x6e9e44), dry: hexLin(0xbfa45c),
      forest: hexLin(0x2e5c3f), rock: hexLin(0x7e7468), rockDark: hexLin(0x575049),
      snow: hexLin(0xf3f6f9), flowers: hexLin(0xd88a4a),
    };
  }
  height(x, y, z) {
    const R = this.R;
    const X = x * R, Y = y * R, Z = z * R;
    const c = this.n1.fbm(X / 1100, Y / 1100, Z / 1100, 4) * 1.3 + 0.1;
    let h = c < 0 ? c * 120 - 1.5 : c * 50;
    // flatten the coast band for beaches
    const coast = smoothstep(0.0, 0.06, Math.abs(c));
    h *= 0.35 + 0.65 * coast;
    const landMask = smoothstep(-0.02, 0.2, c);
    h += this.n2.fbm(X / 230, Y / 230, Z / 230, 4) * 22 * landMask;
    const mm = smoothstep(0.1, 0.55, this.n3.fbm(X / 1500 + 7.1, Y / 1500, Z / 1500, 2) + c * 0.35);
    const r = this.n4.ridged(X / 560, Y / 560, Z / 560, 5);
    h += r * r * 165 * mm * landMask;
    h += this.n2.noise(X / 19, Y / 19, Z / 19) * 0.7 * landMask;
    return h;
  }
  colorize(x, y, z, h, slope, out) {
    const C = this.C, R = this.R;
    const m = this.moisture(x, y, z);
    const v = this.n3.noise(x * R / 60, y * R / 60, z * R / 60);
    this.emissive = 0;
    if (h < 0) {
      setC(out, C.shallow); mixC(out, C.deep, smoothstep(-1, -25, h));
      return;
    }
    setC(out, C.grassA);
    mixC(out, C.grassB, smoothstep(0.35, 0.65, m + v * 0.15));
    mixC(out, C.dry, smoothstep(0.6, 0.85, 1 - m + v * 0.1) * 0.8);
    mixC(out, C.forest, smoothstep(0.55, 0.75, m) * 0.85);
    mixC(out, C.beach, smoothstep(3.2, 1.2, h + v * 0.8));
    const rockT = smoothstep(0.28, 0.42, slope + v * 0.05);
    if (rockT > 0) {
      const rc = [C.rock[0], C.rock[1], C.rock[2]];
      mixC(rc, C.rockDark, smoothstep(-0.3, 0.6, v));
      mixC(out, rc, rockT);
    }
    const snowLine = 120 + v * 18 - Math.abs(y) * 50;
    mixC(out, C.snow, smoothstep(snowLine, snowLine + 15, h) * (1 - smoothstep(0.45, 0.6, slope)));
    mulC(out, 0.92 + v * 0.08);
  }
}

// Kharif: desert world of dunes, layered mesas, canyons and salt flats.
class KharifGen extends BaseGen {
  constructor(def) {
    super(def);
    this.C = {
      sand: hexLin(0xd99a5b), sandLight: hexLin(0xecbd80), sandDark: hexLin(0xb06f3e),
      s1: hexLin(0x9c4628), s2: hexLin(0xc97a4a), s3: hexLin(0x763522), s4: hexLin(0xe3b48a),
      top: hexLin(0xb46a3e), salt: hexLin(0xf0e6d4), canyon: hexLin(0x8a462b),
    };
  }
  plateau(X, Y, Z) {
    return this.n2.fbm(X / 470, Y / 470, Z / 470, 4) + 0.02;
  }
  height(x, y, z) {
    const R = this.R;
    const X = x * R, Y = y * R, Z = z * R;
    let h = this.n1.fbm(X / 900, Y / 900, Z / 900, 3) * 32;
    const m = this.plateau(X, Y, Z);
    const p1 = smoothstep(0.17, 0.215, m);
    const p2 = smoothstep(0.36, 0.40, m);
    h += p1 * 68 + p2 * 42;
    // eroded cliff faces
    const cliff = p1 * (1 - p1) * 4 + p2 * (1 - p2) * 4;
    h += cliff * this.n3.noise(X / 9, Y / 9, Z / 9) * 4;
    const cv = Math.abs(this.n3.fbm(X / 700 + 2, Y / 700, Z / 700, 3));
    const canyon = 1 - smoothstep(0.0, 0.055, cv);
    h -= canyon * 50 * (1 - p1 * 0.6);
    const dunes = smoothstep(-0.15, 0.25, this.n4.fbm(X / 750, Y / 750, Z / 750, 2)) * (1 - p1) * (1 - canyon);
    if (dunes > 0.001) {
      const warp = this.n4.fbm(X / 170, Y / 170, Z / 170, 2) * 3.2;
      const dc = (X * 0.8 + Y * 0.21 + Z * 0.56) / 44 + warp;
      const f = dc - Math.floor(dc);
      const prof = f < 0.72 ? smoothstep(0, 1, f / 0.72) : smoothstep(0, 1, (1 - f) / 0.28);
      h += prof * 15 * dunes;
    }
    h += this.n1.noise(X / 5, Y / 5, Z / 5) * 0.18;
    return h;
  }
  colorize(x, y, z, h, slope, out) {
    const C = this.C, R = this.R;
    const X = x * R, Y = y * R, Z = z * R;
    const v = this.n3.noise(X / 50, Y / 50, Z / 50);
    this.emissive = 0;
    setC(out, C.sand);
    mixC(out, C.sandLight, smoothstep(0.05, 0.25, v) * 0.6);
    mixC(out, C.sandDark, smoothstep(0.12, 0.3, slope) * 0.5);
    const m = this.plateau(X, Y, Z);
    const plat = smoothstep(0.2, 0.22, m);
    mixC(out, C.top, plat * 0.7);
    const rockT = smoothstep(0.32, 0.5, slope);
    if (rockT > 0) {
      const b = Math.sin(h * 0.42 + v * 1.5) * 0.5 + 0.5;
      const b2 = Math.sin(h * 0.13 + 1.3) * 0.5 + 0.5;
      const sc = [C.s1[0], C.s1[1], C.s1[2]];
      mixC(sc, C.s2, smoothstep(0.3, 0.7, b));
      mixC(sc, C.s3, smoothstep(0.6, 0.9, b2) * 0.7);
      mixC(sc, C.s4, smoothstep(0.85, 0.97, b) * 0.8);
      mixC(out, sc, rockT);
    }
    mixC(out, C.canyon, smoothstep(-20, -38, h) * 0.6);
    mixC(out, C.salt, smoothstep(-40, -46, h + v * 3));
    mulC(out, 0.94 + v * 0.06);
  }
}

// Borea: frozen world, glaciers, ice spires and a frozen ocean.
class BoreaGen extends BaseGen {
  constructor(def) {
    super(def);
    this.C = {
      snow: hexLin(0xeef4fa), snowBlue: hexLin(0xcfe1f2), ice: hexLin(0x9ccbe8),
      iceDeep: hexLin(0x5c9cc9), rock: hexLin(0x46505f), rockDark: hexLin(0x2b313b),
      floor: hexLin(0x3a5a74),
    };
  }
  height(x, y, z) {
    const R = this.R;
    const X = x * R, Y = y * R, Z = z * R;
    const c = this.n1.fbm(X / 820, Y / 820, Z / 820, 4) * 1.2 + 0.1;
    let h = c < 0 ? c * 60 - 1 : c * 38;
    const coast = smoothstep(0.0, 0.05, Math.abs(c));
    h *= 0.4 + 0.6 * coast;
    const mask = smoothstep(0.0, 0.25, c);
    const r = this.n2.ridged(X / 270, Y / 270, Z / 270, 5);
    const region = smoothstep(-0.15, 0.35, this.n3.fbm(X / 1200, Y / 1200, Z / 1200, 2));
    h += Math.pow(r, 2.4) * 150 * mask * region;
    const s = this.n4.ridged(X / 48, Y / 48, Z / 48, 2);
    h += Math.pow(s, 6) * 22 * mask;
    h += this.n3.noise(X / 8, Y / 26, Z / 8) * 0.45 * mask;
    return h;
  }
  colorize(x, y, z, h, slope, out) {
    const C = this.C, R = this.R;
    const v = this.n3.noise(x * R / 45, y * R / 45, z * R / 45);
    this.emissive = 0;
    if (h < 0) { setC(out, C.floor); return; }
    setC(out, C.snow);
    mixC(out, C.snowBlue, smoothstep(-0.2, 0.5, v) * 0.6);
    mixC(out, C.ice, smoothstep(0.22, 0.36, slope + v * 0.05));
    mixC(out, C.iceDeep, smoothstep(0.38, 0.55, slope) * 0.8);
    const rockT = smoothstep(0.55, 0.7, slope + v * 0.1) * smoothstep(20, 60, h);
    const rc = [C.rock[0], C.rock[1], C.rock[2]];
    mixC(rc, C.rockDark, smoothstep(0, 0.6, v));
    mixC(out, rc, rockT);
  }
}

// Ignis: volcanic world with lava seas, glowing fissures and volcano cones.
class IgnisGen extends BaseGen {
  constructor(def) {
    super(def);
    const rand = mulberry32(def.seed * 31 + 9);
    this.volcanoes = [];
    for (let i = 0; i < 7; i++) {
      const u = rand() * 2 - 1, t = rand() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      this.volcanoes.push({
        d: [s * Math.cos(t), u, s * Math.sin(t)],
        r: 230 + rand() * 200, h: 90 + rand() * 90, cr: 40 + rand() * 30, cd: 35 + rand() * 25,
      });
    }
    this.C = {
      basalt: hexLin(0x2a2522), basalt2: hexLin(0x3b322c), ash: hexLin(0x77706a),
      rust: hexLin(0x6a3322), hot: hexLin(0x9a3a18), floor: hexLin(0x1a1412),
    };
  }
  height(x, y, z) {
    const R = this.R;
    const X = x * R, Y = y * R, Z = z * R;
    let h = this.n1.fbm(X / 650, Y / 650, Z / 650, 4) * 42 + 13;
    h += this.n2.ridged(X / 95, Y / 95, Z / 95, 3) * 13;
    this.n3.cellular(X / 150, Y / 150, Z / 150, this.cell);
    const edge = this.cell[1] - this.cell[0];
    const channel = 1 - smoothstep(0.0, 0.11, edge);
    h -= channel * 24 * smoothstep(-6, 22, h);
    for (const v of this.volcanoes) {
      const d0 = x * v.d[0] + y * v.d[1] + z * v.d[2];
      if (d0 < 0.7) continue;
      const d = Math.acos(Math.min(1, d0)) * R;
      if (d > v.r) continue;
      const t = 1 - d / v.r;
      const cone = Math.pow(t, 1.7) * v.h;
      const crater = smoothstep(v.cr, v.cr * 0.35, d) * v.cd;
      h += cone - crater;
    }
    return h;
  }
  colorize(x, y, z, h, slope, out) {
    const C = this.C, R = this.R;
    const X = x * R, Y = y * R, Z = z * R;
    const v = this.n4.noise(X / 40, Y / 40, Z / 40);
    setC(out, C.basalt);
    mixC(out, C.basalt2, smoothstep(-0.2, 0.4, v));
    mixC(out, C.rust, smoothstep(0.3, 0.7, this.n5.noise(X / 160, Y / 160, Z / 160)) * 0.6);
    mixC(out, C.ash, smoothstep(55, 110, h) * (1 - smoothstep(0.35, 0.6, slope)) * 0.85);
    let emit = 0;
    // glow near the lava shore
    emit = Math.max(emit, smoothstep(5, 0, h) * 0.9);
    // glowing fissures in the basalt plains
    this.n3.cellular(X / 38, Y / 38, Z / 38, this.cell);
    const crack = 1 - smoothstep(0.0, 0.05, this.cell[1] - this.cell[0]);
    emit = Math.max(emit, crack * smoothstep(40, 10, h) * 0.75);
    // volcano crater glow
    for (const vv of this.volcanoes) {
      const d0 = x * vv.d[0] + y * vv.d[1] + z * vv.d[2];
      if (d0 < 0.95) continue;
      const d = Math.acos(Math.min(1, d0)) * R;
      emit = Math.max(emit, smoothstep(vv.cr * 0.8, vv.cr * 0.2, d));
    }
    if (h < 0) { setC(out, C.floor); emit = 0; }
    if (emit > 0) mixC(out, C.hot, emit * 0.7);
    this.emissive = emit;
  }
}

// Umbra: dusky fungal world with terraced hills and bioluminescent moss.
class UmbraGen extends BaseGen {
  constructor(def) {
    super(def);
    this.C = {
      moss: hexLin(0x4a2e69), moss2: hexLin(0x6c3d88), magenta: hexLin(0xa04a8e),
      rock: hexLin(0x2c3352), rock2: hexLin(0x1f2440), shore: hexLin(0x2c6070),
      floor: hexLin(0x173944), glow: hexLin(0x3ad6c0),
    };
  }
  height(x, y, z) {
    const R = this.R;
    const X = x * R, Y = y * R, Z = z * R;
    const c = this.n1.fbm(X / 900, Y / 900, Z / 900, 4) * 1.15 + 0.16;
    let h = c < 0 ? c * 80 - 1 : c * 40;
    const coast = smoothstep(0.0, 0.05, Math.abs(c));
    h *= 0.4 + 0.6 * coast;
    const mask = smoothstep(0.0, 0.2, c);
    let t = (this.n2.fbm(X / 320, Y / 320, Z / 320, 4) * 0.5 + 0.5) * 120 * mask;
    const step = 16;
    const tt = t / step, fl = Math.floor(tt), fr = tt - fl;
    t = (fl + smoothstep(0.3, 0.7, fr)) * step;
    h += t * 0.9;
    h += this.n3.noise(X / 22, Y / 22, Z / 22) * 1.1 * mask;
    return h;
  }
  colorize(x, y, z, h, slope, out) {
    const C = this.C, R = this.R;
    const X = x * R, Y = y * R, Z = z * R;
    const v = this.n4.noise(X / 55, Y / 55, Z / 55);
    this.emissive = 0;
    if (h < 0) { setC(out, C.floor); return; }
    setC(out, C.moss);
    mixC(out, C.moss2, smoothstep(-0.3, 0.5, v));
    mixC(out, C.magenta, smoothstep(0.55, 0.85, this.moisture(x, y, z)) * 0.6);
    mixC(out, C.shore, smoothstep(3, 0.5, h));
    const rockT = smoothstep(0.3, 0.45, slope + v * 0.04);
    const rc = [C.rock[0], C.rock[1], C.rock[2]];
    mixC(rc, C.rock2, smoothstep(0, 0.7, v));
    mixC(out, rc, rockT);
    this.n3.cellular(X / 16, Y / 16, Z / 16, this.cell);
    const spot = smoothstep(0.32, 0.12, this.cell[0]) * (1 - rockT) * smoothstep(0.5, 0.75, this.n5.noise(X / 120, Y / 120, Z / 120) * 0.5 + 0.5);
    if (spot > 0) { mixC(out, C.glow, spot); this.emissive = spot * 0.9; }
  }
}

const GENS = { elysia: ElysiaGen, kharif: KharifGen, borea: BoreaGen, ignis: IgnisGen, umbra: UmbraGen };

export function createGen(def) {
  const G = GENS[def.gen];
  const gen = new G(def);
  gen.scatter = SCATTER_RULES[def.gen] || [];
  gen.spawns = SPAWN_RULES[def.gen] || [];
  return gen;
}

// --- scatter + spawn rules (placement only; visuals live on the main thread) ---
// density: candidates per hectare. test returns acceptance probability.

const SCATTER_RULES = {
  elysia: [
    { id: 'spireTree', tier: 0, density: 24, scale: [0.8, 1.35], align: 0.15, sink: 1.5,
      test: (g, b) => b.h > 2.5 && b.slope < 0.3 ? smoothstep(0.45, 0.7, b.m) * 0.95 : 0 },
    { id: 'bulbTree', tier: 0, density: 6, scale: [0.7, 1.3], align: 0.1, sink: 1.0,
      test: (g, b) => b.h > 2.5 && b.slope < 0.3 && b.h < 150 ? 0.25 + smoothstep(0.3, 0.5, b.m) * 0.4 : 0 },
    { id: 'boulder', tier: 0, density: 8, scale: [0.6, 2.4], align: 0.8, sink: 0.6,
      test: (g, b) => b.h > 1 ? 0.15 + smoothstep(0.2, 0.45, b.slope) * 0.8 : 0 },
    { id: 'grass', tier: 1, density: 1500, scale: [0.7, 1.4], align: 0.7, sink: 0.05,
      test: (g, b) => b.h > 2.2 && b.slope < 0.32 && b.h < 170 ? 0.85 : 0 },
    { id: 'lantern', tier: 1, density: 70, scale: [0.7, 1.3], align: 0.6, sink: 0.05,
      test: (g, b) => b.h > 3 && b.slope < 0.25 ? smoothstep(0.25, 0.5, b.m) * 0.7 : 0 },
  ],
  kharif: [
    { id: 'pillarCactus', tier: 0, density: 7, scale: [0.6, 1.4], align: 0.1, sink: 0.8,
      test: (g, b) => b.slope < 0.25 && b.h > -30 ? 0.6 : 0 },
    { id: 'hoodooRock', tier: 0, density: 2.5, scale: [0.7, 1.6], align: 0.2, sink: 1.5,
      test: (g, b) => b.slope < 0.35 ? 0.7 : 0 },
    { id: 'boneArch', tier: 0, density: 0.35, scale: [0.8, 1.3], align: 0.3, sink: 2.0,
      test: (g, b) => b.slope < 0.2 ? 0.8 : 0 },
    { id: 'desertRock', tier: 0, density: 5, scale: [0.5, 2.0], align: 0.8, sink: 0.5,
      test: (g, b) => 0.3 + smoothstep(0.25, 0.5, b.slope) * 0.6 },
    { id: 'dryShrub', tier: 1, density: 90, scale: [0.6, 1.5], align: 0.5, sink: 0.05,
      test: (g, b) => b.slope < 0.3 ? 0.55 : 0 },
  ],
  borea: [
    { id: 'iceCrystal', tier: 0, density: 7, scale: [0.6, 1.8], align: 0.5, sink: 1.0,
      test: (g, b) => b.h > 1 ? 0.35 + smoothstep(0.15, 0.4, b.slope) * 0.5 : 0 },
    { id: 'frostTree', tier: 0, density: 12, scale: [0.7, 1.3], align: 0.1, sink: 1.0,
      test: (g, b) => b.h > 2 && b.h < 90 && b.slope < 0.25 ? smoothstep(0.4, 0.65, b.m) : 0 },
    { id: 'snowRock', tier: 0, density: 5, scale: [0.6, 2.2], align: 0.8, sink: 0.6,
      test: (g, b) => b.h > 0.5 ? 0.4 : 0 },
    { id: 'iceShards', tier: 1, density: 60, scale: [0.5, 1.4], align: 0.6, sink: 0.1,
      test: (g, b) => b.h > 1 && b.slope < 0.35 ? 0.5 : 0 },
  ],
  ignis: [
    { id: 'basaltColumns', tier: 0, density: 4, scale: [0.6, 1.5], align: 0.3, sink: 1.5,
      test: (g, b) => b.h > 4 ? 0.5 + smoothstep(0.2, 0.4, b.slope) * 0.4 : 0 },
    { id: 'emberStalk', tier: 0, density: 9, scale: [0.6, 1.4], align: 0.2, sink: 0.5,
      test: (g, b) => b.h > 3 && b.h < 70 && b.slope < 0.3 ? smoothstep(0.35, 0.6, b.m) : 0 },
    { id: 'obsidianShard', tier: 0, density: 6, scale: [0.5, 1.8], align: 0.5, sink: 0.8,
      test: (g, b) => b.h > 2 ? 0.5 : 0 },
    { id: 'ashPebbles', tier: 1, density: 70, scale: [0.6, 1.6], align: 0.9, sink: 0.05,
      test: (g, b) => b.h > 2 && b.slope < 0.4 ? 0.6 : 0 },
  ],
  umbra: [
    { id: 'giantMushroom', tier: 0, density: 10, scale: [0.6, 1.5], align: 0.1, sink: 1.0,
      test: (g, b) => b.h > 2 && b.slope < 0.3 ? 0.25 + smoothstep(0.35, 0.6, b.m) * 0.7 : 0 },
    { id: 'lumenStalk', tier: 0, density: 14, scale: [0.6, 1.4], align: 0.2, sink: 0.4,
      test: (g, b) => b.h > 1 && b.slope < 0.35 ? 0.6 : 0 },
    { id: 'umbraRock', tier: 0, density: 5, scale: [0.6, 2.0], align: 0.8, sink: 0.6,
      test: (g, b) => 0.2 + smoothstep(0.2, 0.45, b.slope) * 0.7 },
    { id: 'tendril', tier: 1, density: 120, scale: [0.6, 1.4], align: 0.5, sink: 0.05,
      test: (g, b) => b.h > 1.5 && b.slope < 0.3 ? 0.6 : 0 },
    { id: 'glowCap', tier: 1, density: 80, scale: [0.6, 1.5], align: 0.6, sink: 0.05,
      test: (g, b) => b.h > 1.5 && b.slope < 0.3 ? smoothstep(0.3, 0.6, b.m) : 0 },
  ],
};

// Creature herds spawned per tier-0 cell.
const SPAWN_RULES = {
  elysia: [
    { id: 'grazer', chance: 0.32, herd: [2, 5], test: (b) => b.h > 3 && b.slope < 0.3 },
    { id: 'hopper', chance: 0.35, herd: [3, 6], test: (b) => b.h > 2 && b.slope < 0.35 },
    { id: 'skimmer', chance: 0.18, herd: [2, 4], test: () => true },
  ],
  kharif: [
    { id: 'duneSerpent', chance: 0.22, herd: [1, 1], test: (b) => b.slope < 0.3 },
    { id: 'shellback', chance: 0.32, herd: [2, 4], test: (b) => b.slope < 0.35 },
    { id: 'kite', chance: 0.12, herd: [1, 3], test: () => true },
  ],
  borea: [
    { id: 'woollyStrider', chance: 0.3, herd: [2, 4], test: (b) => b.h > 1 && b.slope < 0.3 },
    { id: 'frostJelly', chance: 0.25, herd: [2, 5], test: () => true },
  ],
  ignis: [
    { id: 'magmaCrawler', chance: 0.32, herd: [1, 3], test: (b) => b.h > 2 && b.slope < 0.4 },
    { id: 'emberMoth', chance: 0.25, herd: [2, 5], test: () => true },
  ],
  umbra: [
    { id: 'stiltWalker', chance: 0.3, herd: [1, 3], test: (b) => b.h > 1 && b.slope < 0.3 },
    { id: 'lumenJelly', chance: 0.3, herd: [2, 5], test: () => true },
    { id: 'glowHopper', chance: 0.25, herd: [3, 6], test: (b) => b.h > 1 && b.slope < 0.35 },
  ],
};

// --- sampling helpers -------------------------------------------------------

// Height + slope + surface normal at a direction, using small finite differences.
const _t1 = [0, 0, 0], _t2 = [0, 0, 0];
export function sampleSurface(gen, x, y, z, out) {
  const R = gen.R;
  const h = gen.height(x, y, z);
  // tangent basis
  let ax = 0, ay = 1, az = 0;
  if (Math.abs(y) > 0.9) { ax = 1; ay = 0; az = 0; }
  // t1 = normalize(cross(a, d)), t2 = cross(d, t1)
  let t1x = ay * z - az * y, t1y = az * x - ax * z, t1z = ax * y - ay * x;
  const l1 = Math.hypot(t1x, t1y, t1z); t1x /= l1; t1y /= l1; t1z /= l1;
  const t2x = y * t1z - z * t1y, t2y = z * t1x - x * t1z, t2z = x * t1y - y * t1x;
  const e = 0.6 / R;
  let dx = x + t1x * e, dy = y + t1y * e, dz = z + t1z * e;
  let l = Math.hypot(dx, dy, dz);
  const h1 = gen.height(dx / l, dy / l, dz / l);
  dx = x + t2x * e; dy = y + t2y * e; dz = z + t2z * e;
  l = Math.hypot(dx, dy, dz);
  const h2 = gen.height(dx / l, dy / l, dz / l);
  const g1 = (h1 - h) / 0.6, g2 = (h2 - h) / 0.6;
  let nx = x - t1x * g1 - t2x * g2;
  let ny = y - t1y * g1 - t2y * g2;
  let nz = z - t1z * g1 - t2z * g2;
  const ln = Math.hypot(nx, ny, nz);
  nx /= ln; ny /= ln; nz /= ln;
  out.h = h;
  out.nx = nx; out.ny = ny; out.nz = nz;
  out.slope = 1 - (nx * x + ny * y + nz * z);
  return out;
}

// --- patch building ---------------------------------------------------------

export function buildPatch(gen, face, x0, y0, size, skirtDepth) {
  const N = PATCH_N, G = N + 2;
  const R = gen.R;
  const pos = new Float64Array(G * G * 3);
  const dirs = new Float64Array(G * G * 3);
  const hts = new Float64Array(G * G);
  const d = [0, 0, 0];
  const step = size / (N - 1);
  for (let j = 0; j < G; j++) {
    for (let i = 0; i < G; i++) {
      faceToDir(face, x0 + (i - 1) * step, y0 + (j - 1) * step, d);
      const h = gen.height(d[0], d[1], d[2]);
      const k = j * G + i;
      hts[k] = h;
      dirs[k * 3] = d[0]; dirs[k * 3 + 1] = d[1]; dirs[k * 3 + 2] = d[2];
      const r = R + h;
      pos[k * 3] = d[0] * r; pos[k * 3 + 1] = d[1] * r; pos[k * 3 + 2] = d[2] * r;
    }
  }
  // centre of the patch (on the sphere at the centre height)
  const cIdx = ((N >> 1) + 1) * G + ((N >> 1) + 1);
  const cx = pos[cIdx * 3], cy = pos[cIdx * 3 + 1], cz = pos[cIdx * 3 + 2];

  const vCount = N * N + 4 * N;
  const positions = new Float32Array(vCount * 3);
  const normals = new Float32Array(vCount * 3);
  const colors = new Float32Array(vCount * 4);
  const col = [0, 0, 0];
  let minH = Infinity, maxH = -Infinity, maxR2 = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = (j + 1) * G + (i + 1);
      const kL = k - 1, kR = k + 1, kD = k - G, kU = k + G;
      const ax = pos[kR * 3] - pos[kL * 3], ay = pos[kR * 3 + 1] - pos[kL * 3 + 1], az = pos[kR * 3 + 2] - pos[kL * 3 + 2];
      const bx = pos[kU * 3] - pos[kD * 3], by = pos[kU * 3 + 1] - pos[kD * 3 + 1], bz = pos[kU * 3 + 2] - pos[kD * 3 + 2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const ln = Math.hypot(nx, ny, nz) || 1;
      nx /= ln; ny /= ln; nz /= ln;
      const o = j * N + i;
      const px = pos[k * 3] - cx, py = pos[k * 3 + 1] - cy, pz = pos[k * 3 + 2] - cz;
      positions[o * 3] = px; positions[o * 3 + 1] = py; positions[o * 3 + 2] = pz;
      normals[o * 3] = nx; normals[o * 3 + 1] = ny; normals[o * 3 + 2] = nz;
      const dx = dirs[k * 3], dy = dirs[k * 3 + 1], dz = dirs[k * 3 + 2];
      const h = hts[k];
      const slope = 1 - (nx * dx + ny * dy + nz * dz);
      gen.colorize(dx, dy, dz, h, slope, col);
      // fine mottling so close-up ground reads as textured
      const mott = 1 + gen.n1.noise(dx * R / 5.5, dy * R / 5.5, dz * R / 5.5) * 0.1 + gen.n2.noise(dx * R / 17, dy * R / 17, dz * R / 17) * 0.07;
      colors[o * 4] = col[0] * mott; colors[o * 4 + 1] = col[1] * mott; colors[o * 4 + 2] = col[2] * mott;
      colors[o * 4 + 3] = gen.emissive || 0;
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
      const r2 = px * px + py * py + pz * pz;
      if (r2 > maxR2) maxR2 = r2;
    }
  }
  // skirts: duplicate edge vertices pushed toward the planet centre
  let o = N * N;
  const edges = [];
  for (let i = 0; i < N; i++) edges.push(i);                 // bottom row
  for (let i = 0; i < N; i++) edges.push((N - 1) * N + i);   // top row
  for (let j = 0; j < N; j++) edges.push(j * N);             // left column
  for (let j = 0; j < N; j++) edges.push(j * N + N - 1);     // right column
  for (const src of edges) {
    const i = src % N, j = (src / N) | 0;
    const k = (j + 1) * G + (i + 1);
    const dx = dirs[k * 3], dy = dirs[k * 3 + 1], dz = dirs[k * 3 + 2];
    positions[o * 3] = positions[src * 3] - dx * skirtDepth;
    positions[o * 3 + 1] = positions[src * 3 + 1] - dy * skirtDepth;
    positions[o * 3 + 2] = positions[src * 3 + 2] - dz * skirtDepth;
    normals[o * 3] = normals[src * 3]; normals[o * 3 + 1] = normals[src * 3 + 1]; normals[o * 3 + 2] = normals[src * 3 + 2];
    colors[o * 4] = colors[src * 4]; colors[o * 4 + 1] = colors[src * 4 + 1];
    colors[o * 4 + 2] = colors[src * 4 + 2]; colors[o * 4 + 3] = colors[src * 4 + 3];
    o++;
  }

  const result = {
    center: [cx, cy, cz],
    positions, normals, colors,
    minH, maxH,
    radius: Math.sqrt(maxR2) + skirtDepth,
    water: null,
  };

  if (gen.def.hasSea && minH < gen.sea + 0.5) {
    const wp = new Float32Array(N * N * 3);
    const wd = new Float32Array(N * N);
    const wr = R + gen.sea;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = (j + 1) * G + (i + 1);
        const oo = j * N + i;
        wp[oo * 3] = dirs[k * 3] * wr - cx;
        wp[oo * 3 + 1] = dirs[k * 3 + 1] * wr - cy;
        wp[oo * 3 + 2] = dirs[k * 3 + 2] * wr - cz;
        wd[oo] = gen.sea - hts[k];
      }
    }
    result.water = { positions: wp, depth: wd };
  }
  return result;
}

// --- scatter placement --------------------------------------------------------

const _b = { h: 0, nx: 0, ny: 0, nz: 0, slope: 0, m: 0 };

export function buildScatter(gen, tier, face, level, x0, y0, size, wantSpawns) {
  const rules = gen.scatter.filter((r) => r.tier === tier);
  const R = gen.R;
  // approximate cell area in m^2
  const edge = R * size * (Math.PI / 4);
  const areaHa = (edge * edge) / 10000;
  const d = [0, 0, 0];
  const out = {};
  const seedBase = hash32(gen.seed, face, level, Math.round(x0 * 1e6), Math.round(y0 * 1e6), tier);
  for (let ri = 0; ri < rules.length; ri++) {
    const rule = rules[ri];
    const rand = mulberry32(seedBase ^ hash32(ri * 977 + 13));
    const count = Math.round(rule.density * areaHa);
    const data = [];
    for (let c = 0; c < count; c++) {
      const a = x0 + rand() * size, bb = y0 + rand() * size;
      const pAccept = rand(), sRand = rand(), yaw = rand() * Math.PI * 2, extra = rand();
      faceToDir(face, a, bb, d);
      sampleSurface(gen, d[0], d[1], d[2], _b);
      if (gen.def.hasSea && _b.h < gen.sea + 0.3) continue;
      _b.m = gen.moisture(d[0], d[1], d[2]);
      const p = rule.test(gen, _b);
      if (pAccept > p) continue;
      const r = R + _b.h - rule.sink;
      // up vector blends between radial and surface normal
      let ux = d[0] + (_b.nx - d[0]) * rule.align;
      let uy = d[1] + (_b.ny - d[1]) * rule.align;
      let uz = d[2] + (_b.nz - d[2]) * rule.align;
      const ul = Math.hypot(ux, uy, uz);
      ux /= ul; uy /= ul; uz /= ul;
      const scale = rule.scale[0] + (rule.scale[1] - rule.scale[0]) * sRand * sRand;
      data.push(d[0] * r, d[1] * r, d[2] * r, ux, uy, uz, scale, yaw, extra);
    }
    out[rule.id] = new Float32Array(data);
  }
  const spawns = [];
  if (wantSpawns && gen.spawns.length) {
    const rand = mulberry32(seedBase ^ 0x9e3779b9);
    for (const sp of gen.spawns) {
      if (rand() > sp.chance) continue;
      const a = x0 + (0.2 + rand() * 0.6) * size, bb = y0 + (0.2 + rand() * 0.6) * size;
      faceToDir(face, a, bb, d);
      sampleSurface(gen, d[0], d[1], d[2], _b);
      if (gen.def.hasSea && _b.h < gen.sea + 0.5 && sp.id !== 'skimmer' && !/jelly|moth|kite/i.test(sp.id)) continue;
      if (!sp.test(_b)) continue;
      const n = sp.herd[0] + Math.floor(rand() * (sp.herd[1] - sp.herd[0] + 1));
      spawns.push({ id: sp.id, dir: [d[0], d[1], d[2]], count: n, seed: Math.floor(rand() * 1e9) });
    }
  }
  return { types: out, spawns };
}

export { smoothstep, clamp };
