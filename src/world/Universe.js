// The star system: sun + five planets, time, and helpers for reference frames.
import * as THREE from 'three';
import { PLANETS, SUN } from './planetDefs.js';
import { Planet } from './Planet.js';
import { Sky } from './Sky.js';
import { TerrainService } from './TerrainService.js';
import { createEnv, copyEnv } from '../render/materials.js';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class Universe {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;
    this.sunWorld = new THREE.Vector3(...SUN.position);
    this.service = new TerrainService();
    this.planets = PLANETS.map((def, i) => new Planet(def, i, scene, this.service));
    // env used by the sun disc + objects not owned by a planet (follows the camera's nearest planet)
    this.camEnv = createEnv();
    this.sky = new Sky(scene, this.camEnv, SUN);
    for (const p of this.planets) p.updateRotation(0);
  }

  get ready() {
    return this.planets.every((p) => p.terrain.rootsReady);
  }

  nearest(world) {
    let best = null, bestD = Infinity;
    for (const p of this.planets) {
      const d = world.distanceTo(p.position) - p.R;
      if (d < bestD) { bestD = d; best = p; }
    }
    return { planet: best, altitude: bestD };
  }

  // Planet whose sphere of influence contains a world position, if any.
  soiAt(world) {
    for (const p of this.planets) {
      if (world.distanceTo(p.position) < p.soi) return p;
    }
    return null;
  }

  // --- frame conversion for {frame, pos, vel, quat} bodies -------------------
  toWorld(body, outPos, outQuat) {
    if (body.frame) {
      body.frame.localToWorld(body.pos, outPos);
      if (outQuat) outQuat.copy(body.frame.quat).multiply(body.quat);
    } else {
      outPos.copy(body.pos);
      if (outQuat) outQuat.copy(body.quat);
    }
    return outPos;
  }

  // Move a body into a new frame (planet or null = inertial), preserving its
  // world-space position, velocity and orientation.
  changeFrame(body, frame) {
    if (body.frame === frame) return;
    const wPos = new THREE.Vector3(), wVel = new THREE.Vector3(), wQuat = new THREE.Quaternion();
    // to world
    if (body.frame) {
      const f = body.frame;
      f.localToWorld(body.pos, wPos);
      wVel.copy(body.vel).applyQuaternion(f.quat).add(f.frameVelocityAt(wPos, _v));
      wQuat.copy(f.quat).multiply(body.quat);
    } else {
      wPos.copy(body.pos); wVel.copy(body.vel); wQuat.copy(body.quat);
    }
    // to new frame
    if (frame) {
      frame.worldToLocal(wPos, body.pos);
      _q.copy(frame.quat).invert();
      body.vel.copy(wVel).sub(frame.frameVelocityAt(wPos, _v)).applyQuaternion(_q);
      body.quat.copy(_q).multiply(wQuat);
    } else {
      body.pos.copy(wPos); body.vel.copy(wVel); body.quat.copy(wQuat);
    }
    body.frame = frame;
  }

  update(dt, origin, camWorld, pixelRatio) {
    for (const p of this.planets) {
      p.updateRender(origin, this.sunWorld, this.time, camWorld);
    }
    // camera env follows the nearest planet (for the sun disc colouring)
    const { planet } = this.nearest(camWorld);
    copyEnv(this.camEnv, planet.env);
    this.sky.update(_v.copy(this.sunWorld).sub(origin), this.time, pixelRatio);
  }

  updateTerrain(camWorld) {
    for (const p of this.planets) {
      const local = p.worldToLocal(camWorld, _v);
      p.terrain.update(local);
    }
    this.service.update();
  }
}
