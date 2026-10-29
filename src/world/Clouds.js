// Puffy 3D cel-shaded clouds orbiting each planet at altitude. Visible from
// space and flyable through, they slowly drift around the planet's axis.
// Clouds are merged into six regional meshes per planet so the ones behind the
// camera are frustum-culled; they don't cast sun shadows (too costly for the
// little they add), and a distant planet's clouds hide until you approach it.
import * as THREE from 'three';
import { part, mergeParts, mat, jitter, G } from '../render/geom.js';
import { createCloudMaterial } from '../render/materials.js';
import { mulberry32 } from '../core/noise.js';
import { Q } from '../core/quality.js';

function cloudGeo(seed) {
  const rand = mulberry32(seed);
  const parts = [];
  const n = 6 + Math.floor(rand() * 5);
  for (let i = 0; i < n; i++) {
    const r = 0.35 + rand() * 0.45;
    const x = (rand() - 0.5) * 2.4, z = (rand() - 0.5) * 1.3;
    const y = r * 0.35 + rand() * 0.15;
    const g = jitter(G.ico(r, Q.cloudDetail), 0.06, seed + i, 3);
    parts.push(part(g, 0xffffff, { matrix: mat([x, y, z], [0, 0, 0], [1, 0.72, 1]) }));
  }
  // flat base
  parts.push(part(G.ico(1, 1), 0xffffff, { matrix: mat([0, 0.05, 0], [0, 0, 0], [1.6, 0.18, 0.85]) }));
  return mergeParts(parts);
}

const SECTORS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map((d) => new THREE.Vector3(...d));

export class Clouds {
  constructor(universe) {
    this.groups = [];
    for (const planet of universe.planets) {
      const def = planet.def.clouds;
      if (!def) continue;
      const group = new THREE.Group();
      planet.root.add(group);
      const material = createCloudMaterial(planet.env, def.color, def.shade);
      const rand = mulberry32(planet.def.seed * 101);
      const variants = [cloudGeo(planet.def.seed + 1), cloudGeo(planet.def.seed + 2), cloudGeo(planet.def.seed + 3)];
      const bySector = SECTORS.map(() => []);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
      const Y = new THREE.Vector3(0, 1, 0);
      for (let k = 0; k < def.count; k++) {
        // fibonacci-ish distribution with jitter
        const y = 1 - (2 * (k + 0.5)) / def.count;
        const rr = Math.sqrt(1 - y * y);
        const th = k * 2.39996 + rand() * 0.6;
        p.set(Math.cos(th) * rr, y + (rand() - 0.5) * 0.15, Math.sin(th) * rr).normalize();
        const up = p.clone();
        q.setFromUnitVectors(Y, up).multiply(new THREE.Quaternion().setFromAxisAngle(Y, rand() * 6.28));
        const size = (32 + rand() * 46) * def.size;
        s.set(size, size * (0.8 + rand() * 0.5), size * (0.8 + rand() * 0.3));
        p.multiplyScalar(planet.R + def.alt + (rand() - 0.5) * 60);
        m.compose(p, q, s);
        let best = 0, bestDot = -2;
        SECTORS.forEach((d, i) => { const dd = d.dot(up); if (dd > bestDot) { bestDot = dd; best = i; } });
        bySector[best].push(variants[k % variants.length].clone().applyMatrix4(m));
      }
      for (const list of bySector) {
        if (!list.length) continue;
        const mesh = new THREE.Mesh(mergeParts(list), material);
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        group.add(mesh);
      }
      this.groups.push({ group, planet, axis: planet.axis.clone(), speed: 0.0025 + rand() * 0.002 });
    }
  }

  update(dt, time, camWorld) {
    for (const g of this.groups) {
      g.group.quaternion.setFromAxisAngle(g.axis, time * g.speed);
      // distant planets' clouds are sub-pixel specks: skip them entirely
      g.group.visible = !camWorld || camWorld.distanceTo(g.planet.position) < g.planet.R * 7;
    }
  }
}
