// Streams procedurally placed flora/rocks per terrain cell into one instanced
// batch per prop type per planet. Also provides collision and discovery queries.
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

export class Flora {
  constructor(universe) {
    this.universe = universe;
    this.planets = new Map();
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
      const state = { planet, batches: new Map(), cells: new Map(), mats };
      for (const rule of planet.gen.scatter) {
        const proto = buildProp(rule.id);
        state.batches.set(rule.id, new Batch(planet, rule.id, proto, mats));
      }
      this.planets.set(planet, state);
      planet.terrain.onScatter = (node, tier, res) => this._addCell(state, node, res);
      planet.terrain.onScatterRemove = (node) => this._removeCell(state, node);
    }
    this.onSpawns = null; // (planet, node, spawns) => void
    this.onSpawnsRemove = null;
  }

  _addCell(state, node, res) {
    const cellRecords = [];
    for (const [id, data] of Object.entries(res.types)) {
      const batch = state.batches.get(id);
      if (!batch) continue;
      const n = data.length / 9;
      if (!n) continue;
      // matrices and tints were computed in the worker
      const matrices = res.mats[id];
      const colors = res.cols[id];
      const col = [];
      const info = batch.proto.collider;
      if (info) {
        for (let i = 0; i < n; i++) {
          const k = i * 9, sc = data[k + 6];
          col.push({ x: data[k], y: data[k + 1], z: data[k + 2], r: info.r * sc, h: info.h * sc, top: info.top });
        }
      }
      const cell = { count: n, matrices, colors, colliders: col, id, positions: data, center: node.center.clone(), radius: node.radius, slot: 0 };
      batch.addCell(cell);
      cellRecords.push([batch, cell]);
    }
    state.cells.set(node, { records: cellRecords, center: node.center.clone(), radius: node.radius });
    if (res.spawns && res.spawns.length && this.onSpawns) this.onSpawns(state.planet, node, res.spawns);
  }

  _removeCell(state, node) {
    const c = state.cells.get(node);
    if (!c) return;
    for (const [batch, cell] of c.records) batch.removeCell(cell);
    state.cells.delete(node);
    if (this.onSpawnsRemove) this.onSpawnsRemove(state.planet, node);
  }

  update(dt, camWorld, focusPlanet) {
    this.nearTimer = (this.nearTimer || 0) - dt;
    for (const state of this.planets.values()) {
      let changed = false;
      for (const b of state.batches.values()) if (b.nearDirty) { changed = true; b.nearDirty = false; }
      if (state.planet !== focusPlanet) continue;
      const focus = state.planet.worldToLocal(camWorld, _p);
      const moved = !state.lastFocus || state.lastFocus.distanceTo(focus) > 6;
      if (changed || moved || this.nearTimer <= 0) {
        for (const b of state.batches.values()) b.rebuildNear(focus);
        state.lastFocus = (state.lastFocus || new THREE.Vector3()).copy(focus);
      }
    }
    if (this.nearTimer <= 0) this.nearTimer = 1.0;
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
      for (const [, cell] of c.records) {
        for (const k of cell.colliders) {
          const dx = k.x - pos.x, dy = k.y - pos.y, dz = k.z - pos.z;
          const lim = radius + k.r;
          if (dx * dx + dy * dy + dz * dz < lim * lim + k.h * k.h) out.push(k);
        }
      }
    });
  }

  discoverNear(planet, pos, radius, discoveries, hud) {
    this._nearCells(planet, pos, radius + 10, (c) => {
      for (const [batch, cell] of c.records) {
        const info = FLORA_INFO[batch.id];
        if (!info || !info.name || discoveries.has(planet, batch.id)) continue;
        const d = cell.positions;
        const r2 = (radius + (batch.proto.collider ? batch.proto.collider.r * 2 : 0)) ** 2;
        for (let i = 0; i < d.length; i += 9) {
          const dx = d[i] - pos.x, dy = d[i + 1] - pos.y, dz = d[i + 2] - pos.z;
          if (dx * dx + dy * dy + dz * dz < r2) {
            discoveries.add(planet, batch.id, info.name, info.kind, hud);
            break;
          }
        }
      }
    });
  }
}
