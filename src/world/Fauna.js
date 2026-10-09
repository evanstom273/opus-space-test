// Streams herds of procedural creatures around the player and runs their
// behaviour: wandering, grazing, fleeing, curiosity, flight and drifting.
import * as THREE from 'three';
import { SPECIES, buildSpeciesProto, instantiate, animateCreature } from './creatures.js';
import { createCelMaterial, createOutlineMaterial } from '../render/materials.js';
import { mulberry32 } from '../core/noise.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _cam = new THREE.Vector3();
const GROUND = new Set(['quadruped', 'hexapod', 'strider', 'hopper', 'serpent']);
const COLLIDE_R = { quadruped: 1.1, hexapod: 1.0, strider: 0.6, hopper: 0.3, serpent: 0.55 };

function tangent(v, up) {
  v.addScaledVector(up, -v.dot(up));
  if (v.lengthSq() < 1e-8) v.set(up.y, -up.x, 0).addScaledVector(up, 0);
  return v.normalize();
}

export class Fauna {
  constructor(universe, flora) {
    this.universe = universe;
    this.mats = new Map();
    this.protos = new Map();
    this.herds = new Map();
    this.creatures = [];
    this.max = 38;
    this.calls = [];
    this.playerLocal = new THREE.Vector3();
    for (const p of universe.planets) {
      this.mats.set(p, {
        cel: createCelMaterial(p.env, { rim: 0.45, emitScale: 2.5 }),
        celDouble: createCelMaterial(p.env, { rim: 0.45, emitScale: 2.5, side: THREE.DoubleSide }),
        outline: createOutlineMaterial(p.env, { width: 0.025, far: 500 }),
      });
      this.herds.set(p, new Map());
    }
    if (flora) {
      flora.onSpawns = (planet, node, spawns) => this._addHerds(planet, node, spawns);
      flora.onSpawnsRemove = (planet, node) => this._removeHerds(planet, node);
    }
  }

  _proto(planet, id) {
    const key = planet.def.id + ':' + id;
    if (!this.protos.has(key)) {
      const m = this.mats.get(planet);
      this.protos.set(key, buildSpeciesProto(id, m.cel, null, m.celDouble));
    }
    return this.protos.get(key);
  }

  _addHerds(planet, node, spawns) {
    const list = spawns.map((s) => {
      const dir = new THREE.Vector3(...s.dir);
      const h = planet.height(dir);
      return { planet, id: s.id, dir, center: dir.clone().multiplyScalar(planet.R + h), count: s.count, seed: s.seed, creatures: [], spawned: false };
    });
    this.herds.get(planet).set(node, list);
  }

  _removeHerds(planet, node) {
    const list = this.herds.get(planet).get(node);
    if (!list) return;
    for (const h of list) this._despawn(h);
    this.herds.get(planet).delete(node);
  }

  _spawn(herd) {
    const planet = herd.planet;
    const proto = this._proto(planet, herd.id);
    const m = this.mats.get(planet);
    const rand = mulberry32(herd.seed);
    const sp = proto.sp;
    for (let i = 0; i < herd.count; i++) {
      if (this.creatures.length >= this.max) break;
      const inst = instantiate(proto, proto.doubleSide ? m.celDouble : m.cel, proto.doubleSide ? null : m.outline);
      const up = herd.dir.clone();
      const t1 = tangent(new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5), up);
      const spread = 6 + herd.count * 2;
      const p = herd.center.clone().addScaledVector(t1, rand() * spread);
      const dir = p.clone().normalize();
      const cr = {
        sp, planet, herd, mesh: inst.mesh, bones: inst.bones, extra: inst.extra,
        pos: dir.multiplyScalar(planet.R + planet.height(dir)),
        heading: tangent(new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5), up),
        speed: 0, targetSpeed: 0, mode: 'idle', timer: rand() * 3, home: herd.center.clone(),
        t: rand() * 10, phase: rand() * 6, graze: 0, look: 0, hop: 0, yOffset: 0, glide: 0,
        alt: sp.alt ? sp.alt[0] + rand() * (sp.alt[1] - sp.alt[0]) : 0, altNow: 0,
        turn: (rand() - 0.5) * 0.3, seed: rand() * 100, rand, callT: 4 + rand() * 12, roll: 0,
      };
      cr.altNow = cr.alt;
      planet.root.add(cr.mesh);
      herd.creatures.push(cr);
      this.creatures.push(cr);
      this._place(cr, 0);
    }
    herd.spawned = true;
  }

  _despawn(herd) {
    for (const cr of herd.creatures) {
      cr.mesh.parent?.remove(cr.mesh);
      cr.mesh.skeleton.dispose();
      const i = this.creatures.indexOf(cr);
      if (i >= 0) this.creatures.splice(i, 1);
    }
    herd.creatures.length = 0;
    herd.spawned = false;
  }

  update(dt, game, focusPlanet) {
    this.calls.length = 0;
    const camWorld = game.camWorld;
    // player position in the focus planet frame (for flee/curiosity)
    const pb = game.mode === 'foot' ? game.player.body : game.ship.body;
    for (const [planet, nodes] of this.herds) {
      const near = planet === focusPlanet;
      const camLocal = planet.worldToLocal(camWorld, _cam);
      for (const list of nodes.values()) {
        for (const h of list) {
          const d = h.center.distanceTo(camLocal);
          if (near && !h.spawned && d < 430 && this.creatures.length < this.max) this._spawn(h);
          else if (h.spawned && (!near || d > 620)) this._despawn(h);
        }
      }
    }
    if (!focusPlanet) return;
    if (pb.frame === focusPlanet) this.playerLocal.copy(pb.pos);
    else this.playerLocal.set(1e9, 0, 0);
    const shipMode = game.mode === 'ship';
    for (const cr of this.creatures) {
      if (cr.planet !== focusPlanet) continue;
      this._behave(cr, dt, shipMode);
      this._place(cr, dt);
      animateCreature(cr, dt);
    }
  }

  _behave(cr, dt, shipMode) {
    const sp = cr.sp;
    const up = _v.copy(cr.pos).normalize();
    const toPlayer = _w.copy(this.playerLocal).sub(cr.pos);
    const dPlayer = toPlayer.length();
    cr.timer -= dt;
    const fleeDist = (sp.flee || 0) * (shipMode ? 2.2 : 1);
    if (GROUND.has(sp.plan)) {
      if (fleeDist && dPlayer < fleeDist && !(sp.curious && !shipMode && dPlayer > 3.5)) {
        if (cr.mode !== 'flee') cr.timer = 2.5 + cr.rand() * 2;
        cr.mode = 'flee';
        const away = toPlayer.clone().multiplyScalar(-1);
        tangent(away, up);
        cr.heading.lerp(away, 1 - Math.exp(-dt * 4));
      } else if (sp.curious && !shipMode && dPlayer < 16 && dPlayer > 3.5 && cr.mode !== 'flee') {
        cr.mode = 'approach';
        const to = tangent(toPlayer.clone(), up);
        cr.heading.lerp(to, 1 - Math.exp(-dt * 3));
        if (dPlayer < 5) cr.mode = 'idle';
      } else if (cr.timer <= 0) {
        const r = cr.rand();
        cr.mode = r < 0.35 ? 'idle' : r < 0.8 ? 'wander' : sp.plan === 'quadruped' ? 'graze' : 'wander';
        cr.timer = 3 + cr.rand() * 6;
        const turn = (cr.rand() - 0.5) * 2.4;
        cr.heading.applyAxisAngle(up, turn);
        // return toward home when wandering too far
        if (cr.pos.distanceTo(cr.home) > 70) {
          cr.heading.copy(cr.home).sub(cr.pos);
        }
        if (cr.mode !== 'flee' && cr.rand() < 0.3 && dPlayer < 60) cr.look = (cr.rand() - 0.5) * 1.2;
      }
      cr.targetSpeed = cr.mode === 'flee' ? sp.run : cr.mode === 'wander' ? sp.walk : cr.mode === 'approach' ? sp.walk * 0.8 : 0;
      if (cr.mode === 'flee' && cr.timer <= 0) cr.mode = 'wander';
    } else if (sp.plan === 'flyer') {
      if (cr.timer <= 0) {
        cr.timer = 2 + cr.rand() * 5;
        cr.turn = (cr.rand() - 0.5) * 0.6;
        cr.glide = cr.rand() < 0.4 ? 1 : 0;
        cr.alt = sp.alt[0] + cr.rand() * (sp.alt[1] - sp.alt[0]);
      }
      const homeDist = cr.pos.distanceTo(cr.home);
      if (homeDist > 140) {
        const to = tangent(cr.home.clone().sub(cr.pos), up);
        cr.heading.lerp(to, 1 - Math.exp(-dt * 0.8));
      }
      cr.heading.applyAxisAngle(up, cr.turn * dt);
      cr.targetSpeed = cr.glide ? sp.walk * 1.1 : sp.walk;
      if (fleeDist && dPlayer < 25) cr.targetSpeed = sp.run;
    } else {
      // floater: slow drift
      if (cr.timer <= 0) {
        cr.timer = 4 + cr.rand() * 6;
        cr.heading.applyAxisAngle(up, (cr.rand() - 0.5) * 2);
        if (cr.pos.distanceTo(cr.home) > 40) cr.heading.copy(cr.home).sub(cr.pos);
        cr.alt = sp.alt[0] + cr.rand() * (sp.alt[1] - sp.alt[0]);
      }
      cr.targetSpeed = sp.walk;
    }
    tangent(cr.heading, up);
    cr.speed += (cr.targetSpeed - cr.speed) * (1 - Math.exp(-dt * (cr.mode === 'flee' ? 3 : 1.5)));
    if (cr.look) cr.look *= Math.exp(-dt * 0.3);

    // move
    const planet = cr.planet;
    const old = _w.copy(cr.pos);
    cr.pos.addScaledVector(cr.heading, cr.speed * dt);
    const dir = _v.copy(cr.pos).normalize();
    const h = planet.height(dir);
    if (GROUND.has(sp.plan)) {
      const sea = planet.def.hasSea ? planet.seaLevel : -Infinity;
      if (h < sea + 0.3 && planet.def.sea !== 'ice') {
        // don't walk into liquids: turn around
        cr.pos.copy(old);
        cr.heading.negate();
        cr.timer = 1.5;
      } else {
        cr.pos.copy(dir).multiplyScalar(planet.R + Math.max(h, sea));
      }
    } else {
      const ground = planet.R + Math.max(h, planet.def.hasSea ? planet.seaLevel : -Infinity);
      cr.altNow += (cr.alt - cr.altNow) * (1 - Math.exp(-dt * 0.5));
      // keep above terrain smoothly
      const r = cr.pos.length();
      const target = ground + cr.altNow;
      cr.pos.setLength(r + (target - r) * (1 - Math.exp(-dt * 1.5)));
      if (cr.pos.length() < ground + 2) cr.pos.setLength(ground + 2);
    }
    // calls
    cr.callT -= dt;
    if (cr.callT <= 0) {
      cr.callT = 6 + cr.rand() * 14;
      const d = cr.pos.distanceTo(this.playerLocal);
      if (d < 90) this.calls.push({ ...sp.call, dist: d, size: sp.size });
    }
  }

  _place(cr, dt) {
    const up = _v.copy(cr.pos).normalize();
    const fwd = tangent(cr.heading.clone(), up);
    let pitch = 0;
    if (GROUND.has(cr.sp.plan) && cr.sp.plan !== 'serpent') {
      const planet = cr.planet;
      const a = cr.pos.clone().addScaledVector(fwd, 1.2).normalize();
      const b = cr.pos.clone().addScaledVector(fwd, -1.2).normalize();
      pitch = Math.atan2(planet.height(a) - planet.height(b), 2.4) * 0.7;
    }
    const right = _w.crossVectors(fwd, up).normalize();
    // banking for flyers
    if (cr.sp.plan === 'flyer') {
      cr.roll += (-cr.turn * 1.4 - cr.roll) * Math.min(1, dt * 2);
    }
    _m.makeBasis(right, up, fwd.clone().negate());
    cr.mesh.quaternion.setFromRotationMatrix(_m);
    if (pitch) cr.mesh.quaternion.multiply(_q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch));
    if (cr.roll) cr.mesh.quaternion.multiply(_q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), cr.roll));
    cr.mesh.position.copy(cr.pos).addScaledVector(up, cr.yOffset || 0);
  }

  collidersNear(planet, pos, radius, out) {
    for (const cr of this.creatures) {
      if (cr.planet !== planet) continue;
      const r = COLLIDE_R[cr.sp.plan];
      if (!r) continue;
      if (cr.pos.distanceTo(pos) > radius + 3) continue;
      const base = cr.pos.clone().addScaledVector(cr.pos.clone().normalize(), -0.3);
      out.push({ x: base.x, y: base.y, z: base.z, r: r * cr.sp.size, h: 2.5 * cr.sp.size });
    }
  }

  discoverNear(planet, pos, radius, discoveries, hud) {
    for (const cr of this.creatures) {
      if (cr.planet !== planet) continue;
      if (discoveries.has(planet, cr.sp.id)) continue;
      if (cr.pos.distanceTo(pos) < radius + cr.sp.size * 2) discoveries.add(planet, cr.sp.id, cr.sp.name, 'fauna', hud);
    }
  }
}
