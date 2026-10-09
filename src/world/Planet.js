// A planet: rotating local frame, quadtree terrain, liquid surface, atmosphere
// shell, clouds, scatter (flora/rocks) and fauna. Everything visible from space
// is the same object you land on.
import * as THREE from 'three';
import { Terrain } from './Terrain.js';
import { createEnv, createCelMaterial, createWaterMaterial, createAtmosphereMaterial } from '../render/materials.js';

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _m4 = new THREE.Matrix4();

export class Planet {
  constructor(def, index, scene, service) {
    this.def = def;
    this.index = index;
    this.name = def.name;
    this.gen = service.gens[index];
    this.R = def.radius;
    this.seaLevel = def.hasSea ? def.seaLevel : -Infinity;
    this.position = new THREE.Vector3(...def.position);
    this.axis = new THREE.Vector3(...def.axis).normalize();
    this.omega = (Math.PI * 2) / def.dayLength;
    this.quat = new THREE.Quaternion();
    this.gravity = def.gravity;
    this.atmoHeight = this.R * def.atmo.height;
    this.atmoTop = this.R + this.atmoHeight;
    this.soi = this.R * 4.5;
    this.isNear = true;

    this.root = new THREE.Group();
    this.root.name = `planet-${def.id}`;
    scene.add(this.root);

    this.env = createEnv();
    this._initEnv();

    this.terrainMat = createCelMaterial(this.env, { emitUniform: true, emitScale: 1, rim: 0.12 });
    this.waterMat = def.hasSea ? createWaterMaterial(this.env, def) : null;
    this.terrain = new Terrain(this, service, this.terrainMat, this.waterMat);

    const atmoGeo = new THREE.SphereGeometry(this.atmoTop, 96, 64);
    this.atmoMat = createAtmosphereMaterial(this.env, this.R - 25);
    this.atmosphere = new THREE.Mesh(atmoGeo, this.atmoMat);
    this.atmosphere.renderOrder = 5;
    this.atmosphere.frustumCulled = false;
    this.root.add(this.atmosphere);
  }

  _initEnv() {
    const e = this.env, a = this.def.atmo;
    const H = this.atmoHeight * a.scale;
    e.uPlanetRadius.value = this.R * 0.995;
    e.uAtmoRadius.value = this.atmoTop;
    e.uAtmoBase.value = this.R;
    e.uScaleH.value = H;
    e.uBetaR.value.set(a.od[0] / H, a.od[1] / H, a.od[2] / H);
    e.uBetaM.value = a.mie / H;
    e.uMieG.value = a.mieG;
    e.uAtmoSun.value = a.sun;
    e.uAtmoOn.value = 1;
    e.uAtmoTint.value.set(...a.tint);
    e.uSkyAmbient.value.set(...this.def.sky.ambient);
    e.uGroundAmbient.value.set(...this.def.sky.ground);
    e.uNightAmbient.value.set(...this.def.sky.night);
    e.uSunColor.value.set(2.25, 2.15, 2.0);
    e.uEmissive.value.set(...this.def.emissive);
  }

  updateRotation(time) {
    this.quat.setFromAxisAngle(this.axis, this.omega * time + this.def.phase);
  }

  // Convert between planet-local and world coordinates.
  localToWorld(local, out) {
    return out.copy(local).applyQuaternion(this.quat).add(this.position);
  }
  worldToLocal(world, out) {
    _q.copy(this.quat).invert();
    return out.copy(world).sub(this.position).applyQuaternion(_q);
  }
  // Velocity of the rotating frame at a world position (omega x r).
  frameVelocityAt(world, out) {
    _v.copy(world).sub(this.position);
    return out.copy(this.axis).multiplyScalar(this.omega).cross(_v);
  }

  height(dir) {
    return this.gen.height(dir.x, dir.y, dir.z);
  }
  // Ground radius including the liquid surface (for vehicles / walking on ice).
  surfaceRadius(dir, includeSea = true) {
    const h = this.gen.height(dir.x, dir.y, dir.z);
    return this.R + (includeSea ? Math.max(h, this.seaLevel) : h);
  }

  updateRender(origin, sunWorld, time, camWorld) {
    this.root.position.copy(this.position).sub(origin);
    this.root.quaternion.copy(this.quat);
    const e = this.env;
    e.uPlanetCenter.value.copy(this.root.position);
    e.uSunPos.value.copy(sunWorld).sub(origin);
    _m4.makeRotationFromQuaternion(_q.copy(this.quat).invert());
    e.uPlanetRotInv.value.setFromMatrix4(_m4);
    e.uTime.value = time;
    this.camDist = camWorld.distanceTo(this.position);
  }
}
