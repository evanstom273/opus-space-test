// Procedural 3D props (flora, rocks, minerals) for each planet. Each builder
// returns a merged geometry in local space: base at origin, +Y up, metres.
import * as THREE from 'three';
import { part, mergeParts, mat, G, jitter } from '../render/geom.js';
import { mulberry32 } from '../core/noise.js';

// Tapered, slightly curved tube along a list of points.
function tube(points, r0, r1, radial = 7) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const segs = Math.max(4, points.length * 3);
  const g = new THREE.TubeGeometry(curve, segs, 1, radial, false);
  // taper radius along the tube
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  const frames = curve.computeFrenetFrames(segs, false);
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const c = curve.getPointAt(t);
    const r = r0 + (r1 - r0) * t;
    for (let j = 0; j <= radial; j++) {
      const idx = i * (radial + 1) + j;
      v.fromBufferAttribute(pos, idx).sub(c).multiplyScalar(r).add(c);
      pos.setXYZ(idx, v.x, v.y, v.z);
    }
  }
  g.computeVertexNormals();
  return g;
}

// Vertical colour gradient helper: recolour aColor by height between two colours.
function gradient(geo, c0, c1, y0, y1) {
  const p = geo.attributes.position, col = geo.attributes.aColor;
  const a = new THREE.Color(c0), b = new THREE.Color(c1);
  for (let i = 0; i < p.count; i++) {
    const t = THREE.MathUtils.clamp((p.getY(i) - y0) / (y1 - y0), 0, 1);
    col.setXYZ(i, a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t);
  }
  return geo;
}

const B = {
  // ---------------- Elysia ----------------
  spireTree() {
    const P = [];
    const trunk = tube([[0, -1.5, 0], [0, 3, 0.1], [0.3, 7, -0.1], [0.1, 11.5, 0.2]], 0.42, 0.12, 7);
    P.push(part(trunk, 0x4a3330, { flat: true }));
    const tiers = [[4.2, 2.6, 1.4], [6.3, 2.1, 1.2], [8.2, 1.6, 1.0], [9.8, 1.15, 0.85], [11.1, 0.7, 0.7]];
    const cols = [0xc9472e, 0xd9602c, 0xe07c30, 0xe39a3a, 0xeab34a];
    tiers.forEach(([y, r, h], i) => {
      const cone = new THREE.ConeGeometry(r, h, 7, 1);
      P.push(part(cone, cols[i], { matrix: mat([0.15 * Math.sin(i * 2), y, 0.12 * Math.cos(i * 3)], [0, i * 0.5, 0]), flat: true }));
      const under = new THREE.ConeGeometry(r * 0.85, h * 0.35, 7, 1);
      P.push(part(under, 0x7a2a22, { matrix: mat([0.15 * Math.sin(i * 2), y - h * 0.6, 0.12 * Math.cos(i * 3)], [Math.PI, i * 0.5, 0]), flat: true }));
    });
    return { geo: mergeParts(P), collider: { r: 0.5, h: 10 }, wind: 0.0016 };
  },
  bulbTree() {
    const P = [];
    const trunk = tube([[0, -1, 0], [0.2, 2.5, 0], [-0.1, 4.5, 0.1]], 0.55, 0.32, 8);
    P.push(part(trunk, 0x5a3c2c, { flat: true }));
    const rand = mulberry32(5);
    const blobs = [[0, 6, 0, 2.6], [1.6, 5.4, 0.6, 1.7], [-1.5, 5.6, -0.4, 1.8], [0.3, 7.4, -0.8, 1.6], [-0.5, 5.2, 1.5, 1.5], [0.8, 5.0, -1.5, 1.4]];
    blobs.forEach(([x, y, z, r], i) => {
      P.push(part(jitter(G.ico(r, i < 2 ? 1 : 0), 0.25, rand() * 10), rand() < 0.5 ? 0xe3b23a : 0xd99a2e, { matrix: mat([x, y, z]), flat: true }));
    });
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const x = Math.cos(a) * 2.2, z = Math.sin(a) * 2.2;
      P.push(part(G.cyl(0.02, 0.02, 0.9, 3), 0x5a3c2c, { matrix: mat([x, 4.7, z]) }));
      P.push(part(G.ico(0.2, 0), 0xffd58a, { matrix: mat([x, 4.2, z], [0, 0, 0], [1, 1.3, 1]), emissive: 0.9, flat: true }));
    }
    return { geo: mergeParts(P), collider: { r: 0.6, h: 6 }, wind: 0.001 };
  },
  boulder(seed = 1) {
    const g = jitter(G.ico(1.3, 1), 0.45, seed, 1.3);
    g.scale(1.2, 0.8, 1.0);
    const p = part(g, 0x7d756b, { flat: true, vary: 0.06 });
    gradient(p, 0x5f5952, 0x8f877b, -0.6, 0.9);
    return { geo: mergeParts([p]), collider: { r: 1.2, h: 1.0, top: true } };
  },
  grass() {
    const P = [];
    const rand = mulberry32(3);
    for (let i = 0; i < 6; i++) {
      const h = 0.3 + rand() * 0.38;
      const blade = new THREE.ConeGeometry(0.04, h, 3, 1, true);
      blade.translate(0, h / 2, 0);
      const a = rand() * Math.PI * 2, r = rand() * 0.25;
      const p = part(blade, 0x3f8a58, { matrix: mat([Math.cos(a) * r, 0, Math.sin(a) * r], [(rand() - 0.5) * 0.6, rand() * 3, (rand() - 0.5) * 0.6]) });
      gradient(p, 0x2a6644, 0x9cc46a, 0, 0.65);
      P.push(p);
    }
    return { geo: mergeParts(P), wind: 0.09, noOutline: true, noShadow: true };
  },
  lantern() {
    const P = [];
    const stem = tube([[0, 0, 0], [0.05, 0.4, 0], [0.18, 0.7, 0], [0.3, 0.75, 0]], 0.03, 0.015, 5);
    P.push(part(stem, 0x2f6b48));
    P.push(part(G.sphere(0.09, 8, 6), 0xffc070, { matrix: mat([0.32, 0.66, 0], [0, 0, 0], [1, 1.3, 1]), emissive: 1.4 }));
    P.push(part(G.cone(0.13, 0.12, 6), 0x2f6b48, { matrix: mat([0.32, 0.78, 0]) }));
    for (let i = 0; i < 3; i++) {
      const leaf = G.cone(0.06, 0.35, 3);
      P.push(part(leaf, 0x3f8a58, { matrix: mat([0, 0.15, 0], [0.6, i * 2.1, 0]) }));
    }
    return { geo: mergeParts(P), wind: 0.25, noShadow: true };
  },

  // ---------------- Kharif ----------------
  pillarCactus() {
    const P = [];
    const segs = 5;
    for (let i = 0; i < segs; i++) {
      const r = 0.55 - i * 0.04;
      P.push(part(G.cyl(r * 0.92, r, 1.4, 8), i % 2 ? 0x7f9a62 : 0x6f8a56, { matrix: mat([0, -0.6 + i * 1.35 + 0.7, 0]), flat: true }));
      P.push(part(G.cyl(r * 1.05, r * 1.05, 0.12, 8), 0x55693f, { matrix: mat([0, -0.6 + i * 1.35 + 1.38, 0]), flat: true }));
    }
    P.push(part(G.sphere(0.4, 8, 6), 0x7f9a62, { matrix: mat([0, 6.2, 0]), flat: true }));
    P.push(part(G.sphere(0.18, 6, 4), 0xff6a8a, { matrix: mat([0, 6.6, 0]), emissive: 0.2 }));
    for (const [s, y] of [[1, 2.4], [-1, 3.4]]) {
      const arm = tube([[0, y, 0], [0.9 * s, y + 0.1, 0], [1.2 * s, y + 0.8, 0], [1.25 * s, y + 1.8, 0]], 0.32, 0.26, 7);
      P.push(part(arm, 0x7f9a62, { flat: true }));
      P.push(part(G.sphere(0.27, 6, 4), 0x7f9a62, { matrix: mat([1.25 * s, y + 1.8, 0]), flat: true }));
    }
    return { geo: mergeParts(P), collider: { r: 0.6, h: 6 } };
  },
  hoodooRock() {
    const P = [];
    const rand = mulberry32(11);
    const cols = [0xa04a2c, 0xc97a4a, 0x7b3a24, 0xe0b088];
    let y = -1.5;
    const stack = [[2.4, 2.5], [1.8, 2.2], [1.5, 2.0], [1.2, 1.8], [2.6, 1.0]];
    stack.forEach(([r, h], i) => {
      const g = jitter(new THREE.CylinderGeometry(r * 0.9, r, h, 9, 2), 0.25, rand() * 9, 1.0);
      P.push(part(g, cols[i % cols.length], { matrix: mat([rand() * 0.3, y + h / 2, rand() * 0.3]), flat: true }));
      y += h * 0.95;
    });
    return { geo: mergeParts(P), collider: { r: 2.2, h: 9 } };
  },
  boneArch() {
    const P = [];
    const ribs = 6;
    for (let i = 0; i < ribs; i++) {
      const s = 1 - Math.abs(i - (ribs - 1) / 2) / ribs * 0.9;
      const g = new THREE.TorusGeometry(7 * s, 0.45 * (0.7 + s * 0.3), 7, 18, Math.PI * 1.05);
      P.push(part(g, 0xeee3cf, { matrix: mat([0, -1.2, (i - ribs / 2) * 2.6], [0, 0, -0.025]), flat: true }));
    }
    const spine = tube([[0, 6.5, -9], [0, 7.6, -3], [0, 7.8, 3], [0, 6.2, 9]], 0.6, 0.45, 7);
    P.push(part(spine, 0xe6d8bf, { flat: true }));
    for (let i = 0; i < 8; i++) P.push(part(G.cone(0.35, 1.2, 5), 0xd8c8a8, { matrix: mat([0, 8.2, -8 + i * 2.2]), flat: true }));
    // skull
    P.push(part(jitter(G.ico(2.2, 1), 0.3, 3), 0xeee3cf, { matrix: mat([0, 1.0, -11.5], [0.3, 0, 0], [1, 0.8, 1.3]), flat: true }));
    P.push(part(G.sphere(0.5, 6, 4), 0x2a1a14, { matrix: mat([0.9, 1.6, -12.8]) }));
    P.push(part(G.sphere(0.5, 6, 4), 0x2a1a14, { matrix: mat([-0.9, 1.6, -12.8]) }));
    return { geo: mergeParts(P), collider: null };
  },
  desertRock(seed = 2) {
    const g = jitter(G.ico(1.4, 1), 0.5, seed, 1.1);
    g.scale(1.4, 0.6, 1.1);
    const p = part(g, 0xb0603a, { flat: true });
    gradient(p, 0x8a4228, 0xd08a58, -0.7, 0.8);
    return { geo: mergeParts([p]), collider: { r: 1.4, h: 0.8, top: true } };
  },
  dryShrub() {
    const P = [];
    const rand = mulberry32(7);
    for (let i = 0; i < 9; i++) {
      const h = 0.5 + rand() * 0.6;
      const g = new THREE.CylinderGeometry(0.01, 0.035, h, 4);
      g.translate(0, h / 2, 0);
      P.push(part(g, 0x9a7a4a, { matrix: mat([0, 0, 0], [(rand() - 0.5) * 1.4, rand() * 6, (rand() - 0.5) * 1.4]) }));
    }
    P.push(part(G.sphere(0.07, 5, 4), 0xff8a3a, { matrix: mat([0.15, 0.5, 0.1]), emissive: 0.3 }));
    return { geo: mergeParts(P), wind: 0.05, noShadow: true };
  },

  // ---------------- Borea ----------------
  iceCrystal() {
    const P = [];
    const rand = mulberry32(13);
    for (let i = 0; i < 6; i++) {
      const h = 2 + rand() * 4.5, r = 0.35 + rand() * 0.45;
      const g = new THREE.CylinderGeometry(r, r, h, 6);
      g.translate(0, h / 2, 0);
      const tip = new THREE.ConeGeometry(r, r * 1.6, 6);
      tip.translate(0, h + r * 0.8, 0);
      const m = mat([(rand() - 0.5) * 1.6, -0.6, (rand() - 0.5) * 1.6], [(rand() - 0.5) * 0.9, rand() * 3, (rand() - 0.5) * 0.9]);
      const c = rand() < 0.5 ? 0x9fd6f0 : 0xc6ecff;
      P.push(part(g, c, { matrix: m, flat: true, emissive: 0.08 }));
      P.push(part(tip, 0xe6f8ff, { matrix: m, flat: true, emissive: 0.12 }));
    }
    return { geo: mergeParts(P), collider: { r: 1.2, h: 5 }, gloss: 0.6 };
  },
  frostTree() {
    const P = [];
    const rand = mulberry32(17);
    const trunk = tube([[0, -1, 0], [0.1, 2, 0], [-0.1, 4, 0.1], [0, 6, 0]], 0.32, 0.1, 6);
    P.push(part(trunk, 0x6c7a8c, { flat: true }));
    const branch = (base, dir, len, r, depth) => {
      const end = base.clone().addScaledVector(dir, len);
      P.push(part(tube([base.toArray(), base.clone().lerp(end, 0.5).add(new THREE.Vector3(0, 0.2, 0)).toArray(), end.toArray()], r, r * 0.5, 5), 0x8a98ab, { flat: true }));
      P.push(part(G.sphere(r * 2.2, 5, 4), 0xeef6ff, { matrix: mat(end.toArray()), flat: true }));
      if (depth > 0) {
        for (let k = 0; k < 2; k++) {
          const nd = dir.clone().add(new THREE.Vector3(rand() - 0.5, rand() * 0.6, rand() - 0.5)).normalize();
          branch(end, nd, len * 0.6, r * 0.6, depth - 1);
        }
      }
    };
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + rand();
      branch(new THREE.Vector3(0, 2.5 + i * 0.6, 0), new THREE.Vector3(Math.cos(a), 0.7, Math.sin(a)).normalize(), 2.0 - i * 0.2, 0.12, 1);
    }
    return { geo: mergeParts(P), collider: { r: 0.4, h: 6 }, wind: 0.0008 };
  },
  snowRock(seed = 3) {
    const g = jitter(G.ico(1.3, 1), 0.45, seed, 1.2);
    g.scale(1.2, 0.85, 1.0);
    const p = part(g, 0x4a5464, { flat: true });
    const pos = p.attributes.position, col = p.attributes.aColor;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) > 0.25) col.setXYZ(i, 0.9, 0.93, 0.97);
    }
    return { geo: mergeParts([p]), collider: { r: 1.2, h: 1.1, top: true } };
  },
  iceShards() {
    const P = [];
    const rand = mulberry32(19);
    for (let i = 0; i < 4; i++) {
      const h = 0.3 + rand() * 0.6;
      const g = new THREE.ConeGeometry(0.08 + rand() * 0.06, h, 5);
      g.translate(0, h / 2, 0);
      P.push(part(g, 0xbfe6ff, { matrix: mat([(rand() - 0.5) * 0.6, 0, (rand() - 0.5) * 0.6], [(rand() - 0.5), 0, (rand() - 0.5)]), flat: true, emissive: 0.15 }));
    }
    return { geo: mergeParts(P), noShadow: true };
  },

  // ---------------- Ignis ----------------
  basaltColumns() {
    const P = [];
    const rand = mulberry32(23);
    for (let i = 0; i < 9; i++) {
      const h = 1.5 + rand() * 6;
      const g = new THREE.CylinderGeometry(0.6, 0.6, h, 6);
      g.translate(0, h / 2 - 1, 0);
      const x = (i % 3 - 1) * 1.05 + (Math.floor(i / 3) % 2) * 0.5, z = (Math.floor(i / 3) - 1) * 0.92;
      P.push(part(g, rand() < 0.5 ? 0x2c2724 : 0x3a322d, { matrix: mat([x, 0, z]), flat: true }));
    }
    return { geo: mergeParts(P), collider: { r: 1.8, h: 4 } };
  },
  emberStalk() {
    const P = [];
    const rand = mulberry32(29);
    for (let i = 0; i < 4; i++) {
      const h = 2 + rand() * 3;
      const x = (rand() - 0.5) * 1.2, z = (rand() - 0.5) * 1.2;
      P.push(part(tube([[x, -0.3, z], [x * 1.2, h * 0.5, z], [x * 1.5 + 0.2, h, z * 1.4]], 0.14, 0.07, 5), 0x3b2a26, { flat: true }));
      P.push(part(G.sphere(0.28, 7, 5), 0xff7a22, { matrix: mat([x * 1.5 + 0.2, h + 0.15, z * 1.4], [0, 0, 0], [1, 1.4, 1]), emissive: 2.2 }));
    }
    return { geo: mergeParts(P), collider: { r: 0.5, h: 3 }, wind: 0.01 };
  },
  obsidianShard(seed = 5) {
    const P = [];
    const rand = mulberry32(31);
    for (let i = 0; i < 3; i++) {
      const h = 1.5 + rand() * 3;
      const g = jitter(new THREE.ConeGeometry(0.6 + rand() * 0.4, h, 4), 0.15, i + seed);
      g.translate(0, h / 2 - 0.4, 0);
      P.push(part(g, 0x15121a, { matrix: mat([(rand() - 0.5) * 1.5, 0, (rand() - 0.5) * 1.5], [(rand() - 0.5) * 0.7, rand() * 3, (rand() - 0.5) * 0.7]), flat: true }));
    }
    return { geo: mergeParts(P), collider: { r: 1.0, h: 2.5 }, gloss: 1.0 };
  },
  ashPebbles() {
    const P = [];
    const rand = mulberry32(37);
    for (let i = 0; i < 4; i++) {
      const g = jitter(G.ico(0.15 + rand() * 0.15, 0), 0.08, i);
      P.push(part(g, 0x3a3330, { matrix: mat([(rand() - 0.5) * 0.8, 0, (rand() - 0.5) * 0.8]), flat: true }));
    }
    return { geo: mergeParts(P), noShadow: true };
  },

  // ---------------- Umbra ----------------
  giantMushroom() {
    const P = [];
    const stem = G.lathe([[0.0, -1], [0.9, -1], [0.75, 0.5], [0.55, 4], [0.5, 8], [0.7, 9.2], [0, 9.3]], 10);
    P.push(part(stem, 0xd8c8e8, { flat: true }));
    const cap = G.lathe([[0, 9.3], [2.0, 9.3], [4.8, 9.0], [5.6, 8.9], [5.3, 9.6], [4.0, 11.0], [2.0, 12.0], [0, 12.2]], 14);
    const cp = part(cap, 0x8a3d9e, { flat: true });
    gradient(cp, 0x5a2a74, 0xa94fb0, 9, 12);
    P.push(cp);
    // glowing gills ring and cap spots
    P.push(part(G.torus(3.6, 0.35, 5, 18), 0x48f0d8, { matrix: mat([0, 9.1, 0], [Math.PI / 2, 0, 0]), emissive: 1.8 }));
    const rand = mulberry32(41);
    for (let i = 0; i < 9; i++) {
      const a = rand() * Math.PI * 2, r = 1.5 + rand() * 3.2;
      const y = 12.1 - (r / 5.3) * (r / 5.3) * 2.6;
      P.push(part(G.sphere(0.3 + rand() * 0.25, 6, 4), 0x7ffff0, { matrix: mat([Math.cos(a) * r, y, Math.sin(a) * r], [0, 0, 0], [1, 0.5, 1]), emissive: 1.6 }));
    }
    return { geo: mergeParts(P), collider: { r: 0.9, h: 9 }, wind: 0.0003 };
  },
  lumenStalk() {
    const P = [];
    const rand = mulberry32(43);
    for (let i = 0; i < 5; i++) {
      const h = 1.5 + rand() * 3;
      const x = (rand() - 0.5) * 1.4, z = (rand() - 0.5) * 1.4;
      P.push(part(tube([[x, -0.2, z], [x, h * 0.6, z + 0.2], [x + 0.3, h, z + 0.1]], 0.07, 0.04, 5), 0x2a4a5a));
      P.push(part(G.sphere(0.2, 7, 5), rand() < 0.5 ? 0x5ff8ff : 0xff7ae8, { matrix: mat([x + 0.3, h + 0.1, z + 0.1]), emissive: 2.4 }));
    }
    return { geo: mergeParts(P), wind: 0.02, noShadow: false };
  },
  umbraRock(seed = 7) {
    const g = jitter(G.ico(1.3, 1), 0.5, seed, 1.2);
    g.scale(1.1, 0.9, 1.0);
    const p = part(g, 0x2c3352, { flat: true });
    gradient(p, 0x1d2238, 0x3b4470, -0.8, 1.0);
    return { geo: mergeParts([p]), collider: { r: 1.2, h: 1.1, top: true } };
  },
  tendril() {
    const P = [];
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      pts.push([Math.sin(t * 7) * 0.25 * t, t * 1.3, Math.cos(t * 7) * 0.25 * t]);
    }
    P.push(part(tube(pts, 0.06, 0.02, 5), 0x234e58));
    P.push(part(G.sphere(0.06, 5, 4), 0x6ffff2, { matrix: mat(pts[10]), emissive: 2.5 }));
    const pts2 = pts.map(([x, y, z]) => [-x * 0.8 + 0.2, y * 0.7, -z * 0.8]);
    P.push(part(tube(pts2, 0.05, 0.02, 5), 0x234e58));
    P.push(part(G.sphere(0.05, 5, 4), 0xff7ae8, { matrix: mat(pts2[10]), emissive: 2.5 }));
    return { geo: mergeParts(P), wind: 0.12, noShadow: true };
  },
  glowCap() {
    const P = [];
    const rand = mulberry32(47);
    for (let i = 0; i < 4; i++) {
      const h = 0.15 + rand() * 0.35;
      const x = (rand() - 0.5) * 0.5, z = (rand() - 0.5) * 0.5;
      P.push(part(G.cyl(0.03, 0.04, h, 5), 0xd8c8e8, { matrix: mat([x, h / 2, z]) }));
      P.push(part(G.lathe([[0, 0], [0.15, 0], [0.12, 0.06], [0, 0.12]], 7), 0x8ffff0, { matrix: mat([x, h, z]), emissive: 1.6 }));
    }
    return { geo: mergeParts(P), noShadow: true };
  },
};

export const FLORA_INFO = {
  spireTree: { name: 'Ember Spire', kind: 'flora' },
  bulbTree: { name: 'Lanternwood', kind: 'flora' },
  boulder: { name: null },
  grass: { name: 'Teal Sedge', kind: 'flora' },
  lantern: { name: 'Glowbell', kind: 'flora' },
  pillarCactus: { name: 'Pillar Succulent', kind: 'flora' },
  hoodooRock: { name: 'Wind-carved Hoodoo', kind: 'mineral' },
  boneArch: { name: 'Titan Ribs (fossil)', kind: 'mineral' },
  desertRock: { name: null },
  dryShrub: { name: 'Thornbrush', kind: 'flora' },
  iceCrystal: { name: 'Rime Crystal', kind: 'mineral' },
  frostTree: { name: 'Frostbranch', kind: 'flora' },
  snowRock: { name: null },
  iceShards: { name: null },
  basaltColumns: { name: 'Basalt Organ', kind: 'mineral' },
  emberStalk: { name: 'Ember Stalk', kind: 'flora' },
  obsidianShard: { name: 'Obsidian Blade', kind: 'mineral' },
  ashPebbles: { name: null },
  giantMushroom: { name: 'Umbral Parasol', kind: 'flora' },
  lumenStalk: { name: 'Lumen Reed', kind: 'flora' },
  umbraRock: { name: null },
  tendril: { name: 'Coil Tendril', kind: 'flora' },
  glowCap: { name: 'Glowcap', kind: 'flora' },
};

export function buildProp(id) {
  const b = B[id];
  if (!b) throw new Error(`unknown prop ${id}`);
  return b();
}
