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

class Batch {
  constructor(planet, id, proto, mats) {
    this.planet = planet;
    this.id = id;
    this.proto = proto;
    this.mats = mats;
    this.cells = new Set();
    this.dirty = false;
    this.mesh = null;
    this.outline = null;
    this.shadow = null;
    this.material = proto.gloss ? mats.gloss : proto.wind ? mats.windFor(proto.wind) : mats.solid;
    this.outlineMaterial = proto.noOutline ? null : proto.wind ? mats.outlineWindFor(proto.wind) : mats.outline;
    this._alloc('mesh', 256);
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
    m.frustumCulled = false;
    m.castShadow = kind === 'shadow';
    m.receiveShadow = kind === 'mesh';
    if (kind === 'mesh') m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    if (kind === 'shadow') m.renderOrder = -1;
    root.add(m);
    this[kind] = m;
    return m;
  }

  rebuild() {
    let total = 0;
    for (const c of this.cells) total += c.count;
    if (total > this.mesh.userData.capacity) this._alloc('mesh', Math.ceil(total * 1.5));
    const mArr = this.mesh.instanceMatrix.array;
    const cArr = this.mesh.instanceColor.array;
    let o = 0;
    for (const c of this.cells) {
      mArr.set(c.matrices.subarray(0, c.count * 16), o * 16);
      cArr.set(c.colors.subarray(0, c.count * 3), o * 3);
      o += c.count;
    }
    this.mesh.count = o;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
    this.dirty = false;
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
        solid: createCelMaterial(env, { rim: 0.3, emitScale: 2.5 }),
        gloss: createCelMaterial(env, { rim: 0.5, gloss: 1.2, emitScale: 2.5 }),
        outline: createOutlineMaterial(env, { width: 0.03, far: 700 }),
        windFor: (w) => {
          if (!windMats.has(w)) windMats.set(w, createCelMaterial(env, { rim: 0.3, wind: w, emitScale: 2.5, side: THREE.DoubleSide }));
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
      const matrices = new Float32Array(n * 16);
      const colors = new Float32Array(n * 3);
      const col = [];
      const info = batch.proto.collider;
      const rand = mulberry32(Math.floor(data[0] * 13 + data[2] * 7) | 0);
      for (let i = 0; i < n; i++) {
        const k = i * 9;
        _p.set(data[k], data[k + 1], data[k + 2]);
        _up.set(data[k + 3], data[k + 4], data[k + 5]);
        const sc = data[k + 6], yaw = data[k + 7];
        _q.setFromUnitVectors(Y, _up);
        const qy = new THREE.Quaternion().setFromAxisAngle(Y, yaw);
        _q.multiply(qy);
        _s.set(sc, sc * (0.9 + data[k + 8] * 0.25), sc);
        _m.compose(_p, _q, _s);
        _m.toArray(matrices, i * 16);
        const v = 0.86 + rand() * 0.28;
        const hue = (rand() - 0.5) * 0.08;
        _c.setRGB(v * (1 + hue), v, v * (1 - hue));
        colors[i * 3] = _c.r; colors[i * 3 + 1] = _c.g; colors[i * 3 + 2] = _c.b;
        if (info) col.push({ x: _p.x, y: _p.y, z: _p.z, r: info.r * sc, h: info.h * sc, top: info.top });
      }
      const cell = { count: n, matrices, colors, colliders: col, id, positions: data, center: node.center.clone(), radius: node.radius };
      batch.cells.add(cell);
      batch.dirty = true;
      cellRecords.push([batch, cell]);
    }
    state.cells.set(node, { records: cellRecords, center: node.center.clone(), radius: node.radius });
    if (res.spawns && res.spawns.length && this.onSpawns) this.onSpawns(state.planet, node, res.spawns);
  }

  _removeCell(state, node) {
    const c = state.cells.get(node);
    if (!c) return;
    for (const [batch, cell] of c.records) {
      batch.cells.delete(cell);
      batch.dirty = true;
    }
    state.cells.delete(node);
    if (this.onSpawnsRemove) this.onSpawnsRemove(state.planet, node);
  }

  update(dt, camWorld, focusPlanet) {
    this.nearTimer = (this.nearTimer || 0) - dt;
    for (const state of this.planets.values()) {
      let changed = false;
      for (const b of state.batches.values()) if (b.dirty) { b.rebuild(); changed = true; }
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
