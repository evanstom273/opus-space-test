// Spacecraft flight model. Assisted, inertial handling: velocity is steered
// toward the nose with axis-specific grip (strong in air, loose in vacuum),
// hover assist cancels gravity, and a proximity-limited cruise drive makes
// interplanetary flight quick while still being continuous physical travel.
import * as THREE from 'three';
import { buildShip } from './ShipModel.js';
import { sampleSurface } from '../world/terrainGen.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _up = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = { h: 0, nx: 0, ny: 0, nz: 0, slope: 0 };

export class Ship {
  constructor(universe, material, glassMaterial, outlineMaterial) {
    this.universe = universe;
    const m = buildShip(material, glassMaterial, outlineMaterial);
    Object.assign(this, m);
    this.body = { frame: null, pos: new THREE.Vector3(), vel: new THREE.Vector3(), quat: new THREE.Quaternion() };
    this.angVel = new THREE.Vector3();
    this.stick = new THREE.Vector2();
    this.throttle = 0;
    this.thrustVis = 0;
    this.boost = 0;
    this.landed = true;
    this.gear = 1;
    this.heat = 0;
    this.piloted = false;
    this.altitude = 0;
    this.speed = 0;
    this.cruise = false;
    this.shake = 0;
    this.impact = 0;
    this.planet = null;
    this.inAtmo = false;
    this.events = [];
    this.time = 0;
  }

  placeLanded(planet, local, heading) {
    const b = this.body;
    b.frame = planet;
    _up.copy(local).normalize();
    const r = planet.surfaceRadius(_up);
    b.pos.copy(_up).multiplyScalar(r + this.gearHeight);
    b.vel.set(0, 0, 0);
    const fwd = heading.clone().addScaledVector(_up, -heading.dot(_up)).normalize();
    const right = new THREE.Vector3().crossVectors(fwd, _up).normalize();
    const m = new THREE.Matrix4().makeBasis(right, _up, fwd.clone().negate());
    b.quat.setFromRotationMatrix(m);
    this.landed = true;
    this.gear = 1;
    this._settle(1, true);
  }

  // Local up for the current frame (radial) or null in deep space.
  _localUp(out) {
    if (!this.body.frame) return null;
    return out.copy(this.body.pos).normalize();
  }

  update(dt, input) {
    this.time += dt;
    this.events.length = 0;
    const b = this.body;
    const universe = this.universe;

    // reference planet + frame management (sphere of influence)
    const world = universe.toWorld(b, _w);
    const near = universe.nearest(world);
    this.planet = near.planet;
    if (!b.frame) {
      const soi = universe.soiAt(world);
      if (soi) universe.changeFrame(b, soi);
    } else if (b.pos.length() > b.frame.soi * 1.08) {
      universe.changeFrame(b, null);
    }
    const planet = b.frame || this.planet;
    let altitude, ground = 0, density = 0, up = null;
    if (b.frame) {
      up = _up.copy(b.pos).normalize();
      ground = planet.surfaceRadius(up);
      altitude = b.pos.length() - ground;
      const H = planet.atmoHeight * planet.def.atmo.scale;
      density = b.pos.length() < planet.atmoTop ? Math.exp(-Math.max(0, b.pos.length() - planet.R) / H) : 0;
    } else {
      altitude = near.altitude;
    }
    this.altitude = altitude;
    this.inAtmo = density > 0.004;
    this.density = density;

    const ctl = this.piloted && input;
    // --- inputs -------------------------------------------------------------
    let fwdIn = 0, vertIn = 0, rollIn = 0, boostIn = false, yawKey = 0, pitchKey = 0;
    if (ctl) {
      fwdIn = input.axis(['KeyS'], ['KeyW']);
      vertIn = input.axis(['ControlLeft', 'KeyC'], ['Space']);
      rollIn = input.axis(['KeyA'], ['KeyD']) + input.axis(['KeyQ'], ['KeyE']) * 0.0;
      yawKey = input.axis(['ArrowRight', 'KeyE'], ['ArrowLeft', 'KeyQ']);
      pitchKey = input.axis(['ArrowUp'], ['ArrowDown']);
      boostIn = input.down('ShiftLeft', 'ShiftRight');
      // virtual stick from mouse with auto-centering
      this.stick.x += input.mouseDX * 0.0042;
      this.stick.y += input.mouseDY * 0.0042;
    }
    const center = Math.exp(-dt * 3.2);
    this.stick.multiplyScalar(center);
    if (this.stick.length() > 1) this.stick.normalize();

    // --- landed state ----------------------------------------------------------
    if (this.landed) {
      this.throttle = 0;
      this.angVel.set(0, 0, 0);
      this.stick.set(0, 0);
      b.vel.set(0, 0, 0);
      this._settle(dt, false);
      this.gear = Math.min(1, this.gear + dt * 1.5);
      if (ctl && (vertIn > 0 || fwdIn > 0)) {
        this.landed = false;
        b.vel.copy(_up.copy(b.pos).normalize()).multiplyScalar(7);
        this.events.push('takeoff');
      }
      this._animate(dt, 0, 0);
      return;
    }

    // --- rotation ------------------------------------------------------------
    const maxPitch = 1.7, maxYaw = 1.15, maxRoll = 2.6;
    const tPitch = THREE.MathUtils.clamp(-this.stick.y + pitchKey * 0.8, -1, 1) * maxPitch;
    const tYaw = THREE.MathUtils.clamp(-this.stick.x * 0.85 + yawKey * 0.8, -1, 1) * maxYaw;
    let tRoll = -rollIn * maxRoll;
    // in atmosphere: bank into yaw turns and auto-level when not rolling
    if (b.frame && this.inAtmo) {
      const right = _v.set(1, 0, 0).applyQuaternion(b.quat);
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(b.quat);
      const upS = new THREE.Vector3(0, 1, 0).applyQuaternion(b.quat);
      const rollErr = right.dot(up); // + means right wing up
      const steepness = Math.abs(fwd.dot(up));
      const bankWant = -tYaw * 0.45;
      if (Math.abs(rollIn) < 0.1 && steepness < 0.92) {
        const upright = upS.dot(up) > -0.2 ? 1 : 0.4;
        tRoll += (-rollErr - bankWant) * 2.2 * upright * Math.min(1, this.density * 4 + 0.3);
      }
    }
    _v.set(tPitch, tYaw, tRoll);
    this.angVel.lerp(_v, 1 - Math.exp(-dt * 7));
    _e.set(this.angVel.x * dt, this.angVel.y * dt, this.angVel.z * dt, 'YXZ');
    _q.setFromEuler(_e);
    b.quat.multiply(_q).normalize();

    // --- translation -----------------------------------------------------------
    const surfaceDist = Math.max(0, altitude);
    const atmoSpeed = 150, atmoBoost = 340;
    let maxFwd, accel;
    if (this.inAtmo) {
      const t = THREE.MathUtils.clamp(this.density * 1.4, 0, 1);
      const spaceSpeed = boostIn ? 900 : 380;
      maxFwd = THREE.MathUtils.lerp(spaceSpeed, boostIn ? atmoBoost : atmoSpeed, t);
      accel = boostIn ? 1.2 : 0.9;
      this.cruise = false;
    } else {
      // proximity-limited cruise drive: fast in open space, slows near bodies
      const cruiseCap = THREE.MathUtils.clamp((surfaceDist - 250) * 0.75, 400, 5200);
      maxFwd = boostIn ? cruiseCap : 420;
      accel = boostIn ? 0.45 : 0.9;
      this.cruise = boostIn && cruiseCap > 800;
    }
    let targetThrottle = fwdIn > 0 ? 1 : fwdIn < 0 ? -0.25 : 0;
    this.throttle += (targetThrottle - this.throttle) * (1 - Math.exp(-dt * 3));
    this.boost += ((boostIn && fwdIn > 0 ? 1 : 0) - this.boost) * (1 - Math.exp(-dt * 3));

    _qi.copy(b.quat).invert();
    const vLocal = _v.copy(b.vel).applyQuaternion(_qi);
    const targetFwd = -this.throttle * maxFwd; // forward is -Z
    if (fwdIn !== 0) {
      vLocal.z += (targetFwd - vLocal.z) * (1 - Math.exp(-dt * accel * 1.8));
    } else if (this.inAtmo) {
      // air drag brings the ship to a hover
      vLocal.z *= Math.exp(-dt * (0.45 + this.density * 0.6));
    } else {
      // vacuum: keep momentum, very light assist damping
      vLocal.z *= Math.exp(-dt * 0.02);
    }
    // lateral + vertical grip
    const grip = this.inAtmo ? 2.4 + this.density * 2 : 0.9;
    vLocal.x *= Math.exp(-dt * grip);
    const vertTarget = vertIn * (this.inAtmo ? 28 : 60);
    vLocal.y += (vertTarget - vLocal.y) * (1 - Math.exp(-dt * (vertIn ? 2.2 : grip)));
    b.vel.copy(vLocal).applyQuaternion(b.quat);

    // global speed cap from proximity (prevents slamming into planets at cruise speed)
    const sp = b.vel.length();
    const hardCap = this.inAtmo ? (boostIn ? atmoBoost : atmoSpeed) * 1.15 : THREE.MathUtils.clamp((surfaceDist - 150) * 0.85, 300, 5600);
    if (sp > hardCap) b.vel.multiplyScalar(Math.max(hardCap / sp, Math.exp(-dt * 1.4)));

    b.pos.addScaledVector(b.vel, dt);
    this.speed = b.vel.length();

    // atmospheric entry heating
    const heatTarget = this.inAtmo ? THREE.MathUtils.clamp((this.speed - 160) / 260, 0, 1) * Math.min(1, this.density * 3) : 0;
    this.heat += (heatTarget - this.heat) * (1 - Math.exp(-dt * 2.5));

    // --- ground interaction ------------------------------------------------------
    if (b.frame) {
      up = _up.copy(b.pos).normalize();
      ground = planet.surfaceRadius(up);
      const r = b.pos.length();
      altitude = r - ground;
      this.altitude = altitude;
      // landing gear deploys low and slow
      const wantGear = altitude < 45 && this.speed < 60;
      this.gear += ((wantGear ? 1 : 0) - this.gear) * (1 - Math.exp(-dt * 3));
      const clearance = this.gear > 0.5 ? this.gearHeight : 1.2;
      if (altitude < clearance) {
        const vUp = b.vel.dot(up);
        const shipUp = _w.set(0, 1, 0).applyQuaternion(b.quat);
        const upright = shipUp.dot(up);
        const horiz = Math.sqrt(Math.max(0, this.speed * this.speed - vUp * vUp));
        if (this.gear > 0.8 && upright > 0.8 && horiz < 14 && vUp > -12) {
          this.landed = true;
          b.vel.set(0, 0, 0);
          this.angVel.set(0, 0, 0);
          this.events.push('land');
          this._settle(dt, false);
        } else {
          b.pos.setLength(ground + clearance);
          if (vUp < 0) {
            this.impact = Math.min(1, -vUp / 40 + horiz / 300);
            b.vel.addScaledVector(up, -vUp * 1.4);
            b.vel.multiplyScalar(0.8);
            this.shake = Math.max(this.shake, this.impact);
            this.events.push('bump');
          }
        }
      }
    }
    this.shake = Math.max(this.shake * Math.exp(-dt * 3), this.heat * 0.35);
    this._animate(dt, Math.max(0, this.throttle) * (0.6 + this.boost * 0.6) + Math.abs(vertIn) * 0.25, this.heat);
  }

  // Align a landed ship to the terrain beneath its gear.
  _settle(dt, instant) {
    const b = this.body;
    const planet = b.frame;
    if (!planet) return;
    const up = _up.copy(b.pos).normalize();
    sampleSurface(planet.gen, up.x, up.y, up.z, _s);
    const n = new THREE.Vector3(_s.nx, _s.ny, _s.nz);
    if (planet.def.hasSea && _s.h < planet.seaLevel) n.copy(up);
    n.lerp(up, 0.35).normalize();
    const ground = planet.surfaceRadius(up);
    const targetR = ground + this.gearHeight - 0.05;
    const r = b.pos.length();
    b.pos.setLength(instant ? targetR : r + (targetR - r) * Math.min(1, dt * 6));
    const shipUp = new THREE.Vector3(0, 1, 0).applyQuaternion(b.quat);
    const qAlign = new THREE.Quaternion().setFromUnitVectors(shipUp, n);
    if (instant) b.quat.premultiply(qAlign);
    else b.quat.premultiply(new THREE.Quaternion().slerp(qAlign, Math.min(1, dt * 4)));
    b.quat.normalize();
  }

  _animate(dt, thrust, heat) {
    this.thrustVis += (thrust - this.thrustVis) * (1 - Math.exp(-dt * 6));
    const t = this.thrustVis;
    const idle = this.landed ? 0 : 0.18;
    for (const f of this.flames) {
      const len = (idle + t * 2.6 + this.boost * 1.2) * (0.92 + Math.random() * 0.12);
      f.scale.set(0.8 + t * 0.3, Math.max(0.001, len * 2.4), 0.8 + t * 0.3);
      f.visible = len > 0.01;
    }
    this.flameMat.uniforms.uTime.value = this.time;
    this.flameMat.uniforms.uIntensity.value = 0.6 + t * 0.6;
    for (const leg of this.legs) {
      leg.pivot.rotation.x = (1 - this.gear) * -1.45;
      leg.pivot.visible = this.gear > 0.02;
    }
    this.heatMat.uniforms.uHeat.value = heat;
    this.heatMat.uniforms.uTime.value = this.time;
    this.heatShell.visible = heat > 0.02;
  }
}
