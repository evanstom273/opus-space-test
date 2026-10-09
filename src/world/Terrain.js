// Chunked cube-sphere quadtree terrain with skirts, per-patch water surfaces
// and hooks for scatter cells. Lives in planet-local coordinates.
import * as THREE from 'three';
import { PATCH_N, faceToDir } from './terrainGen.js';
import { nodeEdge, lodLevels } from './planetDefs.js';

const SPLIT_K = 1.9;
const MERGE_K = 2.4;

let sharedIndex = null;
let sharedWaterIndex = null;

function getIndices() {
  if (sharedIndex) return [sharedIndex, sharedWaterIndex];
  const N = PATCH_N;
  const idx = [];
  for (let j = 0; j < N - 1; j++) {
    for (let i = 0; i < N - 1; i++) {
      const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
      // alternate diagonals for a more even look
      if ((i + j) & 1) { idx.push(a, b, d, a, d, c); }
      else { idx.push(a, b, c, b, d, c); }
    }
  }
  const water = idx.slice();
  // skirts: edges are stored after the grid as [bottom, top, left, right]
  const base = N * N;
  const edgeLists = [];
  for (let e = 0; e < 4; e++) {
    const grid = [], skirt = [];
    for (let k = 0; k < N; k++) {
      let g;
      if (e === 0) g = k;
      else if (e === 1) g = (N - 1) * N + k;
      else if (e === 2) g = k * N;
      else g = k * N + N - 1;
      grid.push(g);
      skirt.push(base + e * N + k);
    }
    edgeLists.push([grid, skirt]);
  }
  for (const [grid, skirt] of edgeLists) {
    for (let k = 0; k < N - 1; k++) {
      const a = grid[k], b = grid[k + 1], c = skirt[k], d = skirt[k + 1];
      // both windings so skirts are visible from either side
      idx.push(a, c, b, b, c, d);
      idx.push(a, b, c, b, d, c);
    }
  }
  sharedIndex = new THREE.BufferAttribute(new Uint16Array(idx), 1);
  sharedWaterIndex = new THREE.BufferAttribute(new Uint16Array(water), 1);
  return [sharedIndex, sharedWaterIndex];
}

class Node {
  constructor(terrain, face, level, x0, y0, size, parent) {
    this.terrain = terrain;
    this.face = face; this.level = level;
    this.x0 = x0; this.y0 = y0; this.size = size;
    this.parent = parent;
    this.children = null;
    this.mesh = null;
    this.water = null;
    this.ready = false;
    this.job = null;
    this.scatterJob = null;
    this.scatterCell = null;
    const R = terrain.R;
    this.edge = nodeEdge(R, size);
    const d = faceToDir(face, x0 + size / 2, y0 + size / 2, [0, 0, 0]);
    this.dir = new THREE.Vector3(d[0], d[1], d[2]);
    this.center = this.dir.clone().multiplyScalar(R);
    this.radius = this.edge * 0.75 + terrain.relief;
    this.visible = false;
    this.dist = 0;
  }
}

export class Terrain {
  constructor(planet, service, material, waterMaterial) {
    this.planet = planet;
    this.def = planet.def;
    this.index = planet.index;
    this.R = planet.def.radius;
    this.service = service;
    this.material = material;
    this.waterMaterial = waterMaterial;
    this.relief = 320;
    const minH = planet.def.hasSea ? Math.max(planet.def.minHeight ?? -60, planet.def.seaLevel - 2) : (planet.def.minHeight ?? -60);
    this.occluderR = this.R + minH - 5;
    const lv = lodLevels(this.R);
    this.maxLevel = lv.maxLevel;
    this.scatterLevel = lv.scatterLevel;
    this.grassLevel = lv.grassLevel;
    this.group = new THREE.Group();
    this.group.name = `terrain-${this.def.id}`;
    planet.root.add(this.group);
    this.camLocal = new THREE.Vector3(1e9, 0, 0);
    this.nodeCount = 0;
    this.roots = [];
    for (let f = 0; f < 6; f++) {
      const n = new Node(this, f, 0, -1, -1, 2, null);
      this.roots.push(n);
      this._request(n);
    }
    this.onScatter = null;     // (node, tier, result) => void
    this.onScatterRemove = null; // (node) => void
    this.scatterEnabled = true;
  }

  get rootsReady() {
    return this.roots.every((n) => n.ready);
  }

  _priority(node) {
    const d = Math.max(0, this.camLocal.distanceTo(node.center) - node.radius);
    return d / node.edge - node.level * 0.05 + (this.planet.isNear ? 0 : 1000);
  }

  _request(node) {
    const skirt = Math.max(1.5, node.edge / 32 * 1.5);
    node.job = this.service.request(
      { kind: 'patch', planet: this.index, face: node.face, x0: node.x0, y0: node.y0, size: node.size, skirt },
      this._priority(node),
      (res) => this._onPatch(node, res),
    );
    this.nodeCount++;
  }

  _onPatch(node, res) {
    node.job = null;
    if (node.disposed) return;
    const [index, waterIndex] = getIndices();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(res.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(res.normals, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(res.colors, 4));
    geo.setIndex(index);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), res.radius);
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.position.set(res.center[0], res.center[1], res.center[2]);
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = node.level >= this.maxLevel - 3;
    mesh.receiveShadow = true;
    mesh.visible = false;
    this.group.add(mesh);
    node.mesh = mesh;
    node.center.set(res.center[0], res.center[1], res.center[2]);
    node.radius = res.radius;
    node.minH = res.minH; node.maxH = res.maxH;
    if (res.water && this.waterMaterial) {
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.BufferAttribute(res.water.positions, 3));
      wg.setAttribute('aDepth', new THREE.BufferAttribute(res.water.depth, 1));
      wg.setIndex(waterIndex);
      wg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), res.radius);
      const wm = new THREE.Mesh(wg, this.waterMaterial);
      wm.position.copy(mesh.position);
      wm.updateMatrix();
      wm.matrixAutoUpdate = false;
      wm.visible = false;
      wm.receiveShadow = true;
      wm.renderOrder = 2;
      this.group.add(wm);
      node.water = wm;
    }
    node.ready = true;
  }

  _requestScatter(node) {
    if (!this.onScatter) return;
    const tier = node.level === this.scatterLevel ? 0 : 1;
    node.scatterJob = this.service.request(
      { kind: 'scatter', planet: this.index, tier, face: node.face, level: node.level, x0: node.x0, y0: node.y0, size: node.size, spawns: tier === 0 },
      this._priority(node) - 0.3,
      (res) => {
        node.scatterJob = null;
        if (node.disposed) return;
        node.scatterCell = true;
        this.onScatter(node, tier, res);
      },
    );
  }

  _setVisible(node, v) {
    if (node.visible === v) return;
    node.visible = v;
    if (node.mesh) node.mesh.visible = v;
    if (node.water) node.water.visible = v;
  }

  _hideSubtree(node) {
    this._setVisible(node, false);
    if (node.children) for (const c of node.children) this._hideSubtree(c);
  }

  _split(node) {
    const h = node.size / 2;
    node.children = [
      new Node(this, node.face, node.level + 1, node.x0, node.y0, h, node),
      new Node(this, node.face, node.level + 1, node.x0 + h, node.y0, h, node),
      new Node(this, node.face, node.level + 1, node.x0, node.y0 + h, h, node),
      new Node(this, node.face, node.level + 1, node.x0 + h, node.y0 + h, h, node),
    ];
    for (const c of node.children) {
      this._request(c);
      if (this.scatterEnabled && (c.level === this.scatterLevel || c.level === this.grassLevel)) this._requestScatter(c);
    }
  }

  _dispose(node) {
    node.disposed = true;
    if (node.children) for (const c of node.children) this._dispose(c);
    node.children = null;
    if (node.job) this.service.cancel(node.job);
    if (node.scatterJob) this.service.cancel(node.scatterJob);
    if (node.scatterCell && this.onScatterRemove) this.onScatterRemove(node);
    node.scatterCell = null;
    if (node.mesh) {
      this.group.remove(node.mesh);
      node.mesh.geometry.dispose();
      node.mesh = null;
    }
    if (node.water) {
      this.group.remove(node.water);
      node.water.geometry.dispose();
      node.water = null;
    }
    this.nodeCount--;
  }

  // Conservative horizon test: is the node's bounding sphere entirely hidden
  // behind the planet's minimum-radius sphere as seen from the camera?
  _occluded(node) {
    const C = this.camLocal;
    const c = C.length();
    const r0 = this.occluderR;
    if (c <= r0 + 1) return false;
    const Q = node.center, rho = node.radius;
    // behind the horizon plane?
    if ((Q.x * C.x + Q.y * C.y + Q.z * C.z) / c + rho > (r0 * r0) / c) return false;
    // inside the occlusion cone?
    const vx = Q.x - C.x, vy = Q.y - C.y, vz = Q.z - C.z;
    const dq = Math.hypot(vx, vy, vz);
    if (dq <= rho) return false;
    const cosA = -(vx * C.x + vy * C.y + vz * C.z) / (dq * c);
    const ang = Math.acos(Math.min(1, Math.max(-1, cosA)));
    const alpha = Math.asin(r0 / c);
    return ang + Math.asin(Math.min(1, rho / dq)) < alpha;
  }

  _updateNode(node) {
    const d = Math.max(0, this.camLocal.distanceTo(node.center) - node.radius);
    node.dist = d;
    if (node.job) node.job.priority = this._priority(node);
    if (node.ready && node.level > 0 && this._occluded(node)) {
      this._setVisible(node, false);
      if (node.children) {
        if (d > MERGE_K * node.edge) {
          for (const c of node.children) this._dispose(c);
          node.children = null;
        } else for (const c of node.children) this._hideSubtree(c);
      }
      return;
    }
    const canSplit = node.level < this.maxLevel && this.planet.isNear;
    const want = canSplit && d < SPLIT_K * node.edge;
    if (want) {
      if (!node.children) this._split(node);
      const allReady = node.children.every((c) => c.ready);
      if (allReady) {
        this._setVisible(node, false);
        for (const c of node.children) this._updateNode(c);
        return;
      }
      this._setVisible(node, node.ready);
      for (const c of node.children) {
        this._hideSubtree(c);
        if (c.job) c.job.priority = this._priority(c);
      }
      return;
    }
    this._setVisible(node, node.ready);
    if (node.children) {
      if (!canSplit || d > MERGE_K * node.edge) {
        for (const c of node.children) this._dispose(c);
        node.children = null;
      } else {
        for (const c of node.children) this._hideSubtree(c);
      }
    }
  }

  update(camLocal) {
    this.camLocal.copy(camLocal);
    for (const r of this.roots) this._updateNode(r);
  }

  // Deepest ready node covering a direction (used for debugging/LOD queries).
  leafLevelAt(dir) {
    let best = 0;
    const visit = (n) => {
      if (!n.visible && !n.children) return;
      if (n.visible) best = Math.max(best, n.level);
      if (n.children) for (const c of n.children) visit(c);
    };
    for (const r of this.roots) visit(r);
    return best;
  }
}
