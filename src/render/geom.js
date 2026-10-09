// Procedural modelling toolkit: colour-baked part merging, smooth outline
// normals, and a rig builder producing one skinned mesh per character.
import * as THREE from 'three';
import { hexLin } from '../world/terrainGen.js';

const _c = new THREE.Color();

function linColor(color) {
  if (Array.isArray(color)) return color;
  if (typeof color === 'number') return hexLin(color);
  return [color.r, color.g, color.b];
}

// Prepare a geometry part: apply transform, make non-indexed, bake colour.
export function part(geometry, color, opts = {}) {
  let g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  if (opts.matrix) {
    g.applyMatrix4(opts.matrix);
    if (opts.matrix.determinant() < 0) flipWinding(g);
  }
  if (opts.flat) {
    g.deleteAttribute('normal');
    g.computeVertexNormals();
  }
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 4);
  const c = linColor(color);
  const e = opts.emissive ?? 0;
  const varyAmt = opts.vary ?? 0;
  for (let i = 0; i < n; i++) {
    let k = 1;
    if (varyAmt) {
      const y = g.attributes.position.getY(i);
      k = 1 + Math.sin(y * 7.1 + i * 0.001) * varyAmt;
    }
    col[i * 4] = c[0] * k; col[i * 4 + 1] = c[1] * k; col[i * 4 + 2] = c[2] * k; col[i * 4 + 3] = e;
  }
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 4));
  for (const k of Object.keys(g.attributes)) {
    if (!['position', 'normal', 'aColor'].includes(k)) g.deleteAttribute(k);
  }
  if (opts.bone !== undefined) g.userData.bone = opts.bone;
  if (opts.weights) g.userData.weights = opts.weights;
  return g;
}

// Reverse triangle winding of a non-indexed geometry (after mirroring).
function flipWinding(g) {
  for (const name of Object.keys(g.attributes)) {
    const at = g.attributes[name];
    const isz = at.itemSize, arr = at.array;
    for (let t = 0; t < at.count; t += 3) {
      for (let k = 0; k < isz; k++) {
        const i1 = (t + 1) * isz + k, i2 = (t + 2) * isz + k;
        const tmp = arr[i1]; arr[i1] = arr[i2]; arr[i2] = tmp;
      }
    }
  }
}

// Build a transform matrix from position / rotation(euler) / scale arrays.
export function mat(pos = [0, 0, 0], rot = [0, 0, 0], scl = [1, 1, 1]) {
  const m = new THREE.Matrix4();
  m.compose(
    new THREE.Vector3(...pos),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2])),
    Array.isArray(scl) ? new THREE.Vector3(...scl) : new THREE.Vector3(scl, scl, scl),
  );
  return m;
}

// Merge prepared parts into one geometry (non-indexed).
export function mergeParts(parts) {
  let total = 0;
  for (const p of parts) total += p.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 4);
  let o = 0;
  for (const p of parts) {
    const n = p.attributes.position.count;
    pos.set(p.attributes.position.array, o * 3);
    nor.set(p.attributes.normal.array, o * 3);
    col.set(p.attributes.aColor.array, o * 4);
    o += n;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 4));
  addOutlineNormals(g);
  g.computeBoundingSphere();
  return g;
}

// Smooth normals keyed by position so inverted-hull outlines don't crack at
// hard edges.
export function addOutlineNormals(g) {
  const pos = g.attributes.position.array;
  const nor = g.attributes.normal.array;
  const n = pos.length / 3;
  const map = new Map();
  const keys = new Array(n);
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos[i * 3] * 1000)},${Math.round(pos[i * 3 + 1] * 1000)},${Math.round(pos[i * 3 + 2] * 1000)}`;
    keys[i] = k;
    let acc = map.get(k);
    if (!acc) { acc = [0, 0, 0]; map.set(k, acc); }
    acc[0] += nor[i * 3]; acc[1] += nor[i * 3 + 1]; acc[2] += nor[i * 3 + 2];
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = map.get(keys[i]);
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    out[i * 3] = a[0] / l; out[i * 3 + 1] = a[1] / l; out[i * 3 + 2] = a[2] / l;
  }
  g.setAttribute('aONormal', new THREE.BufferAttribute(out, 3));
}

// Mesh + inverted-hull outline child sharing the same geometry.
export function outlined(geometry, material, outlineMaterial) {
  const mesh = new THREE.Mesh(geometry, material);
  if (outlineMaterial) {
    const o = new THREE.Mesh(geometry, outlineMaterial);
    o.castShadow = false;
    o.receiveShadow = false;
    mesh.add(o);
    mesh.userData.outline = o;
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// --- rig builder ---------------------------------------------------------------

export class RigBuilder {
  constructor() {
    this.bones = [];
    this.parts = [];
  }

  bone(name, parent, pos = [0, 0, 0]) {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(pos[0], pos[1], pos[2]);
    if (parent) parent.add(b);
    b.userData.index = this.bones.length;
    b.userData.rest = b.position.clone();
    this.bones.push(b);
    return b;
  }

  // geometry is expressed in the bone's local space.
  add(bone, geometry, color, opts = {}) {
    const g = part(geometry, color, opts);
    g.userData.bone = bone;
    if (opts.blendTo) {
      g.userData.blendTo = opts.blendTo;
      g.userData.blendAxis = opts.blendAxis ?? 1;
      g.userData.blendRange = opts.blendRange ?? [0, 1];
    }
    this.parts.push(g);
    return g;
  }

  build(material, outlineMaterial) {
    const root = this.bones[0];
    root.updateMatrixWorld(true);
    const transformed = [];
    const skinIdx = [], skinW = [];
    for (const g of this.parts) {
      const bone = g.userData.bone;
      const gg = g.clone();
      // blend weights computed in bone-local space before transforming
      const n = gg.attributes.position.count;
      const bi = bone.userData.index;
      const blendTo = g.userData.blendTo;
      for (let i = 0; i < n; i++) {
        if (blendTo) {
          const v = gg.attributes.position.array[i * 3 + g.userData.blendAxis];
          const [a, b] = g.userData.blendRange;
          const t = THREE.MathUtils.clamp((v - a) / (b - a), 0, 1);
          skinIdx.push(bi, blendTo.userData.index, 0, 0);
          skinW.push(1 - t, t, 0, 0);
        } else {
          skinIdx.push(bi, 0, 0, 0);
          skinW.push(1, 0, 0, 0);
        }
      }
      gg.applyMatrix4(bone.matrixWorld);
      transformed.push(gg);
    }
    const geo = mergeParts(transformed);
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIdx, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinW, 4));
    const mesh = new THREE.SkinnedMesh(geo, material);
    mesh.add(root);
    mesh.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(this.bones);
    mesh.bind(skeleton);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    if (outlineMaterial) {
      const o = new THREE.SkinnedMesh(geo, outlineMaterial);
      o.bind(skeleton, mesh.bindMatrix);
      o.frustumCulled = false;
      mesh.add(o);
      mesh.userData.outline = o;
    }
    const byName = {};
    for (const b of this.bones) byName[b.name] = b;
    return { mesh, bones: byName, skeleton };
  }
}

// Common primitive shortcuts
export const G = {
  box: (w, h, d) => new THREE.BoxGeometry(w, h, d),
  rbox: (w, h, d, r = 0.05) => roundedBox(w, h, d, r),
  sphere: (r, ws = 16, hs = 12) => new THREE.SphereGeometry(r, ws, hs),
  cap: (r, len, cs = 6, rs = 12) => new THREE.CapsuleGeometry(r, len, cs, rs),
  cyl: (rt, rb, h, s = 12) => new THREE.CylinderGeometry(rt, rb, h, s),
  cone: (r, h, s = 12) => new THREE.ConeGeometry(r, h, s),
  ico: (r, d = 1) => new THREE.IcosahedronGeometry(r, d),
  dodec: (r) => new THREE.DodecahedronGeometry(r, 0),
  torus: (r, t, rs = 8, ts = 20) => new THREE.TorusGeometry(r, t, rs, ts),
  lathe: (pts, s = 16) => new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p[0], p[1])), s),
};

// Rounded box via a subdivided box whose vertices are pushed onto a rounded shape.
export function roundedBox(w, h, d, r) {
  const g = new THREE.BoxGeometry(w, h, d, 4, 4, 4);
  const p = g.attributes.position;
  const hw = w / 2 - r, hh = h / 2 - r, hd = d / 2 - r;
  const v = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    c.set(THREE.MathUtils.clamp(v.x, -hw, hw), THREE.MathUtils.clamp(v.y, -hh, hh), THREE.MathUtils.clamp(v.z, -hd, hd));
    const dlt = v.clone().sub(c);
    if (dlt.lengthSq() > 1e-9) dlt.setLength(r);
    p.setXYZ(i, c.x + dlt.x, c.y + dlt.y, c.z + dlt.z);
  }
  g.computeVertexNormals();
  return g;
}

// Displace a geometry's vertices with a deterministic noise function.
export function jitter(geometry, amount, seed = 1, freq = 2.0) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  // position-keyed displacement keeps shared corners together
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = Math.sin(v.x * 12.9898 * freq + v.y * 78.233 * freq + v.z * 37.719 * freq + seed) * 43758.5453;
    const n = (k - Math.floor(k)) - 0.5;
    const len = v.length() || 1;
    v.multiplyScalar(1 + (n * amount) / len);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export { _c };
