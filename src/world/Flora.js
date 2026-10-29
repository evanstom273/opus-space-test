// Streams procedurally placed flora/rocks per terrain cell. Also provides
// collision and discovery queries.
import * as THREE from 'three';
import { buildProp, FLORA_INFO } from './props.js';
import { createCelMaterial, createOutlineMaterial } from '../render/materials.js';
import { mulberry32 } from '../core/noise.js';
import { Q } from '../core/quality.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3();
const _t = new THREE.Vector3();
const _b = new THREE.Vector3();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const Y = new THREE.Vector3(0, 1, 0);

const OUTLINE_R = Q.outlineRadius;
const SHADOW_R = 95;
const _hidden = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });

// First-fit slot allocator so cells can be added/removed in place and only
// their own instance ranges are re-uploaded to the GPU.
class Slots {
  constructor() { this.free = []; this.top = 0; this.live = 0; }
  alloc(n) {
    this.live += n;
    for (let i = 0; i < this.free.length; i++) {
      const f = this.free[i];
      if (f[1] >= n) {
        const s = f[0];
        f[0] += n; f[1] -= n;
        if (f[1] === 0) this.free.splice(i, 1);
        return s;
      }
    }
    const s = this.top;
    this.top += n;
    return s;
  }
  release(s, n) {
    this.live -= n;
    this.free.push([s, n]);
    this.free.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const f of this.free) {
      const last = merged[merged.length - 1];
      if (last && last[0] + last[1] === f[0]) last[1] += f[1];
      else merged.push([f[0], f[1]]);
    }
    // trailing free space lowers the high-water mark
    const tail = merged[merged.length - 1];
    if (tail && tail[0] + tail[1] === this.top) { this.top = tail[0]; merged.pop(); }
    this.free = merged;
  }
  reset() { this.free = []; this.top = 0; this.live = 0; }
}

class Batch {
  constructor(planet, id, proto, mats) {
    this.planet = planet;
    this.id = id;
    this.proto = proto;
    this.mats = mats;
    this.cells = new Set();
    this.slots = new Slots();
    this.nearDirty = false;
    this.mesh = null;
    this.outline = null;
    this.shadow = null;
    this.material = proto.gloss ? mats.gloss : proto.wind ? mats.windFor(proto.wind) : mats.solid;
    this.outlineMaterial = proto.noOutline ? null : proto.wind ? mats.outlineWindFor(proto.wind) : mats.outline;
    this._alloc('mesh', 1024);
    if (this.outlineMaterial) this._alloc('outline', 256);
    if (!proto.noShadow) this._alloc('shadow', 128);
  }

  _alloc(kind, cap) {
    const root = this.planet.root;
    const old = this[kind];
    if (old) { root.remove(old); old.dispose(); }
    const mat = kind === 'mesh' ? this.material : kind === 'outline' ? this.outlineMaterial : _hidden;
    const m = new THREE.InstancedMesh(this.proto.geo, mat, cap);
    m.userData.capacity = cap;
    m.count = 0;
    m.visible = false;
    m.frustumCulled = false;
    m.castShadow = kind === 'shadow';
    m.receiveShadow = kind === 'mesh';
    if (kind === 'mesh') m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    if (kind === 'shadow') m.renderOrder = -1;
    root.add(m);
    this[kind] = m;
    return m;
  }

  // Empty batches are hidden so they cost no draw calls (main or shadow pass).
  _syncVis() {
    this.mesh.visible = this.mesh.count > 0;
    if (this.outline) this.outline.visible = this.outline.count > 0;
    if (this.shadow) this.shadow.visible = this.shadow.count > 0;
  }

  _ensureCapacity(top) {
    const cap = this.mesh.userData.capacity;
    if (top <= cap) return;
    const oldM = this.mesh.instanceMatrix.array, oldC = this.mesh.instanceColor.array;
    const m = this._alloc('mesh', Math.ceil(Math.max(top, cap * 2)));
    m.instanceMatrix.array.set(oldM.subarray(0, Math.min(oldM.length, m.instanceMatrix.array.length)));
    m.instanceColor.array.set(oldC.subarray(0, Math.min(oldC.length, m.instanceColor.array.length)));
    m.instanceMatrix.needsUpdate = true;
    m.instanceColor.needsUpdate = true;
  }

  _write(cell) {
    const m = this.mesh;
    m.instanceMatrix.array.set(cell.matrices.subarray(0, cell.count * 16), cell.slot * 16);
    m.instanceColor.array.set(cell.colors.subarray(0, cell.count * 3), cell.slot * 3);
    m.instanceMatrix.addUpdateRange(cell.slot * 16, cell.count * 16);
    m.instanceColor.addUpdateRange(cell.slot * 3, cell.count * 3);
    m.instanceMatrix.needsUpdate = true;
    m.instanceColor.needsUpdate = true;
  }

  addCell(cell) {
    cell.slot = this.slots.alloc(cell.count);
    this._ensureCapacity(this.slots.top);
    this.cells.add(cell);
    this._write(cell);
    this.mesh.count = this.slots.top;
    this._syncVis();
    this.nearDirty = true;
  }

  removeCell(cell) {
    if (!this.cells.delete(cell)) return;
    const m = this.mesh;
    // zero matrices collapse the instances to nothing until the slots are reused
    m.instanceMatrix.array.fill(0, cell.slot * 16, (cell.slot + cell.count) * 16);
    m.instanceMatrix.addUpdateRange(cell.slot * 16, cell.count * 16);
    m.instanceMatrix.needsUpdate = true;
    this.slots.release(cell.slot, cell.count);
    m.count = this.slots.top;
    this._syncVis();
    this.nearDirty = true;
    // heavy fragmentation: compact everything once
    if (this.slots.top > 512 && this.slots.top > this.slots.live * 2) this._compact();
  }

  _compact() {
    this.slots.reset();
    const m = this.mesh;
    m.instanceMatrix.array.fill(0);
    m.instanceMatrix.clearUpdateRanges();
    m.instanceColor.clearUpdateRanges();
    for (const c of this.cells) {
      c.slot = this.slots.alloc(c.count);
      m.instanceMatrix.array.set(c.matrices.subarray(0, c.count * 16), c.slot * 16);
      m.instanceColor.array.set(c.colors.subarray(0, c.count * 3), c.slot * 3);
    }
    m.instanceMatrix.needsUpdate = true;
    m.instanceColor.needsUpdate = true;
    m.count = this.slots.top;
    this._syncVis();
  }

  // Near subsets for outlines and shadow casting, refreshed as the focus moves.
  rebuildNear(focus) {
    for (const kind of ['outline', 'shadow']) {
      const m = this[kind];
      if (!m) continue;
      const R = kind === 'outline' ? OUTLINE_R : SHADOW_R;
      const r2 = R * R;
      let mesh = m, n = 0;
      for (const c of this.cells) {
        if (c.center && c.center.distanceTo(focus) > R + c.radius) continue;
        const d = c.positions;
        for (let i = 0; i < c.count; i++) {
          const dx = d[i * 9] - focus.x, dy = d[i * 9 + 1] - focus.y, dz = d[i * 9 + 2] - focus.z;
          if (dx * dx + dy * dy + dz * dz > r2) continue;
          if (n >= mesh.userData.capacity) {
            const prev = mesh.instanceMatrix.array.slice(0, n * 16);
            mesh = this._alloc(kind, Math.ceil(mesh.userData.capacity * 2));
            mesh.instanceMatrix.array.set(prev);
          }
          mesh.instanceMatrix.array.set(c.matrices.subarray(i * 16, i * 16 + 16), n * 16);
          n++;
        }
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    }
    this._syncVis();
  }
}

// Trees, rocks and other tier-0 props get one small instanced mesh per terrain
// cell, with real bounds, so cells behind the camera or out of range are
// culled. Small tier-1 props (grass, flowers) stay in shared batches.
const FAR_R = { high: 900, medium: 720, low: 520 }[Q.name] ?? 700;

// Only props within SHADOW_R of the player cast sun shadows: a per-type
// instanced subset (depth pass only) rebuilt as the player moves.
class NearCasters {
  constructor(planet, geo) {
    this.planet = planet;
    this.geo = geo;
    this.mesh = null;
    this._alloc(128);
  }
  _alloc(cap) {
    if (this.mesh) { this.planet.root.remove(this.mesh); this.mesh.dispose(); }
    const m = new THREE.InstancedMesh(this.geo, _hidden, cap);
    m.userData.capacity = cap;
    m.count = 0;
    m.visible = false;
    m.castShadow = true;
    m.frustumCulled = false;
    m.renderOrder = -1;
    this.planet.root.add(m);
    this.mesh = m;
  }
  clear() { this.mesh.count = 0; this.mesh.visible = false; }
  rebuild(state, id, focus) {
    const r2 = SHADOW_R * SHADOW_R;
    let n = 0;
    for (const c of state.cells.values()) {
      if (c.center.distanceTo(focus) > c.radius + SHADOW_R) continue;
      for (const rec of c.records) {
        if (rec.type.id !== id) continue;
        const d = rec.cell.positions, M = rec.cell.matrices;
        for (let i = 0; i < rec.cell.count; i++) {
          const dx = d[i * 9] - focus.x, dy = d[i * 9 + 1] - focus.y, dz = d[i * 9 + 2] - focus.z;
          if (dx * dx + dy * dy + dz * dz > r2) continue;
          if (n >= this.mesh.userData.capacity) {
            const prev = this.mesh.instanceMatrix.array.slice(0, n * 16);
            this._alloc(this.mesh.userData.capacity * 2);
            this.mesh.instanceMatrix.array.set(prev);
          }
          this.mesh.instanceMatrix.array.set(M.subarray(i * 16, i * 16 + 16), n * 16);
          n++;
        }
      }
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Flora {
  constructor(universe) {
    this.universe = universe;
    this.planets = new Map();
    this.timer = 0;
    this.warm = [];
    for (const planet of universe.planets) {
      const env = planet.env;
      const windMats = new Map(), outlineWind = new Map();
      const mats = {
        solid: createCelMaterial(env, { rim: 0.3, emitScale: 2.5, atmoSteps: 2 }),
        gloss: createCelMaterial(env, { rim: 0.5, gloss: 1.2, emitScale: 2.5, atmoSteps: 2 }),
        outline: createOutlineMaterial(env, { width: 0.03, far: 700 }),
        windFor: (w) => {
          if (!windMats.has(w)) windMats.set(w, createCelMaterial(env, { rim: 0.3, wind: w, emitScale: 2.5, side: THREE.DoubleSide, atmoSteps: 2 }));
          return windMats.get(w);
        },
        outlineWindFor: (w) => {
          if (!outlineWind.has(w)) outlineWind.set(w, createOutlineMaterial(env, { width: 0.03, far: 700, wind: w }));
          return outlineWind.get(w);
        },
      };
      const state = { planet, types: new Map(), cells: new Map(), mats, lastFocus: null, dirty: false, visOn: false };
      for (const rule of planet.gen.scatter) {
        const proto = buildProp(rule.id);
        state.types.set(rule.id, {
          id: rule.id,
          tier: rule.tier,
          proto,
          material: proto.gloss ? mats.gloss : proto.wind ? mats.windFor(proto.wind) : mats.solid,
          outlineMaterial: proto.noOutline ? null : proto.wind ? mats.outlineWindFor(proto.wind) : mats.outline,
          batch: rule.tier === 1 ? new Batch(planet, rule.id, proto, mats) : null,
          casters: rule.tier === 0 && !proto.noShadow && Q.shadows ? new NearCasters(planet, proto.geo) : null,
        });
      }
      this.planets.set(planet, state);
      planet.terrain.onScatter = (node, tier, res) => this._addCell(state, node, res);
      planet.terrain.onScatterRemove = (node) => this._removeCell(state, node);
    }
    this.onSpawns = null; // (planet, node, spawns) => void
    this.onSpawnsRemove = null;
  }

  _addCell(state, node, res) {
    const records = [];
    for (const [id, data] of Object.entries(res.types)) {
      const t = state.types.get(id);
      if (!t) continue;
      const n = data.length / 9;
      if (!n) continue;
      // matrices and tints were computed in the worker
      const col = [];
      const info = t.proto.collider;
      if (info) {
        for (let i = 0; i < n; i++) {
          const k = i * 9, sc = data[k + 6];
          col.push({ x: data[k], y: data[k + 1], z: data[k + 2], r: info.r * sc, h: info.h * sc, top: info.top });
        }
      }
      // tight bounds from the actual instance positions (the terrain node's
      // own bounds can still be a generous placeholder at this point)
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity, smax = 0;
      for (let i = 0; i < n; i++) {
        const k = i * 9;
        const x = data[k], y = data[k + 1], z = data[k + 2];
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (z < z0) z0 = z; if (z > z1) z1 = z;
        if (data[k + 6] > smax) smax = data[k + 6];
      }
      const center = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      const radius = Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 + t.proto.size * smax;
      const cell = { count: n, matrices: res.mats[id], colors: res.cols[id], colliders: col, id, positions: data, center, radius, slot: 0 };
      const rec = { type: t, cell, mesh: null, outline: null };
      if (t.batch) t.batch.addCell(cell);
      else this._makeCellMeshes(state, rec);
      records.push(rec);
    }
    // cell bounds = union of its records' bounds
    let cc = node.center.clone(), cr = 1;
    if (records.length) {
      cc = new THREE.Vector3();
      for (const r of records) cc.add(r.cell.center);
      cc.multiplyScalar(1 / records.length);
      for (const r of records) cr = Math.max(cr, cc.distanceTo(r.cell.center) + r.cell.radius);
    }
    state.cells.set(node, { records, center: cc, radius: cr });
    state.dirty = true;
    if (res.spawns && res.spawns.length && this.onSpawns) this.onSpawns(state.planet, node, res.spawns);
  }

  _makeCellMeshes(state, rec) {
    const { type: t, cell } = rec;
    const root = state.planet.root;
    const sphere = new THREE.Sphere(cell.center, cell.radius);
    const mesh = new THREE.InstancedMesh(t.proto.geo, t.material, cell.count);
    mesh.instanceMatrix = new THREE.InstancedBufferAttribute(cell.matrices, 16);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(cell.colors, 3);
    mesh.count = cell.count;
    mesh.boundingSphere = sphere;
    mesh.receiveShadow = true;
    mesh.visible = false;
    root.add(mesh);
    rec.mesh = mesh;
    if (t.outlineMaterial) {
      const o = new THREE.InstancedMesh(t.proto.geo, t.outlineMaterial, cell.count);
      o.instanceMatrix = mesh.instanceMatrix; // same GPU buffer as the mesh
      o.count = cell.count;
      o.boundingSphere = sphere;
      o.visible = false;
      root.add(o);
      rec.outline = o;
    }
    this._applyVis(rec, state.planet === this.focusPlanet ? state.lastFocus : null);
  }

  // Distance-based visibility, shadow casting and outlines for a cell's meshes.
  _applyVis(rec, focus) {
    if (!rec.mesh) return;
    let d = Infinity;
    if (focus) d = rec.cell.center.distanceTo(focus) - rec.cell.radius;
    const vis = d < FAR_R;
    rec.mesh.visible = vis;
    if (rec.outline) rec.outline.visible = vis && d < OUTLINE_R;
  }

  _removeCell(state, node) {
    const c = state.cells.get(node);
    if (!c) return;
    for (const rec of c.records) {
      if (rec.type.batch) { rec.type.batch.removeCell(rec.cell); continue; }
      const root = state.planet.root;
      if (rec.mesh) { root.remove(rec.mesh); rec.mesh.dispose(); }
      if (rec.outline) { root.remove(rec.outline); rec.outline.dispose(); }
    }
    state.cells.delete(node);
    if (this.onSpawnsRemove) this.onSpawnsRemove(state.planet, node);
  }

  update(dt, camWorld, focusPlanet) {
    this.focusPlanet = focusPlanet;
    this.timer -= dt;
    for (const state of this.planets.values()) {
      if (state.planet !== focusPlanet) {
        if (state.visOn) {
          for (const c of state.cells.values()) for (const rec of c.records) this._applyVis(rec, null);
          for (const t of state.types.values()) if (t.casters) t.casters.clear();
          state.visOn = false;
          state.lastFocus = null;
        }
        continue;
      }
      const focus = state.planet.worldToLocal(camWorld, _p);
      let changed = state.dirty || !state.visOn;
      for (const t of state.types.values()) if (t.batch && t.batch.nearDirty) { changed = true; t.batch.nearDirty = false; }
      const moved = !state.lastFocus || state.lastFocus.distanceTo(focus) > 8;
      if (changed || moved || this.timer <= 0) {
        state.lastFocus = (state.lastFocus || new THREE.Vector3()).copy(focus);
        for (const c of state.cells.values()) for (const rec of c.records) this._applyVis(rec, state.lastFocus);
        for (const t of state.types.values()) {
          if (t.batch) t.batch.rebuildNear(state.lastFocus);
          if (t.casters) t.casters.rebuild(state, t.id, state.lastFocus);
        }
        state.dirty = false;
        state.visOn = true;
      }
    }
    if (this.timer <= 0) this.timer = 0.5;
  }

  // One instanced shadow caster next to the player so the instanced
  // shadow-pass shader variant compiles behind the loading screen.
  addWarmupActors(planet, center) {
    const state = this.planets.get(planet);
    const t = [...state.types.values()].find((x) => !x.batch) || [...state.types.values()][0];
    const m = new THREE.InstancedMesh(t.proto.geo, t.material, 1);
    m.setMatrixAt(0, new THREE.Matrix4().makeTranslation(center.x, center.y, center.z));
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array([1, 1, 1]), 3);
    m.castShadow = true;
    m.frustumCulled = false;
    planet.root.add(m);
    this.warm.push(m);
  }

  removeWarmupActors() {
    for (const m of this.warm) { m.parent?.remove(m); m.dispose(); }
    this.warm.length = 0;
  }

  _nearCells(planet, pos, radius, fn) {
    const state = this.planets.get(planet);
    if (!state) return;
    for (const c of state.cells.values()) {
      if (c.center.distanceTo(pos) > c.radius + radius) continue;
      fn(c);
    }
  }

  collidersNear(planet, pos, radius, out) {
    this._nearCells(planet, pos, radius, (c) => {
      for (const rec of c.records) {
        for (const k of rec.cell.colliders) {
          const dx = k.x - pos.x, dy = k.y - pos.y, dz = k.z - pos.z;
          const lim = radius + k.r;
          if (dx * dx + dy * dy + dz * dz < lim * lim + k.h * k.h) out.push(k);
        }
      }
    });
  }

  discoverNear(planet, pos, radius, discoveries, hud) {
    this._nearCells(planet, pos, radius + 10, (c) => {
      for (const rec of c.records) {
        const id = rec.type.id;
        const info = FLORA_INFO[id];
        if (!info || !info.name || discoveries.has(planet, id)) continue;
        const d = rec.cell.positions;
        const r2 = (radius + (rec.type.proto.collider ? rec.type.proto.collider.r * 2 : 0)) ** 2;
        for (let i = 0; i < d.length; i += 9) {
          const dx = d[i] - pos.x, dy = d[i + 1] - pos.y, dz = d[i + 2] - pos.z;
          if (dx * dx + dy * dy + dz * dz < r2) {
            discoveries.add(planet, id, info.name, info.kind, hud);
            break;
          }
        }
      }
    });
  }
}
