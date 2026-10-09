// Third-person explorer controller on a spherical planet, in the planet's
// rotating local frame. Handles walking, sprinting, jumping, jetpack, swimming,
// slope sliding and simple cylinder collisions with props, creatures and the ship.
import * as THREE from 'three';
import { sampleSurface } from '../world/terrainGen.js';

const _up = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _s = { h: 0, nx: 0, ny: 0, nz: 0, slope: 0 };

function projectTangent(v, up) {
  v.addScaledVector(up, -v.dot(up));
  if (v.lengthSq() < 1e-8) {
    v.set(1, 0, 0).addScaledVector(up, -up.x);
    if (v.lengthSq() < 1e-6) v.set(0, 0, 1).addScaledVector(up, -up.z);
  }
  return v.normalize();
}

export class Player {
  constructor(model) {
    this.model = model;
    this.body = { frame: null, pos: new THREE.Vector3(), vel: new THREE.Vector3(), quat: new THREE.Quaternion() };
    this.heading = new THREE.Vector3(0, 0, -1);
    this.camFwd = new THREE.Vector3(0, 0, -1);
    this.camPitch = -0.18;
    this.camDist = 5.2;
    this.camDistTarget = 5.2;
    this.grounded = false;
    this.airTime = 0;
    this.jetFuel = 1;
    this.jetting = false;
    this.swimming = false;
    this.onLava = false;
    this.speed = 0;
    this.turn = 0;
    this.active = true;
    this.stepPhase = 0;
    this.events = [];
    this.colliders = [];
    this._move = new THREE.Vector3();
    this._target = new THREE.Vector3();
  }

  placeAt(planet, local, facing) {
    this.body.frame = planet;
    this.body.pos.copy(local);
    this.body.vel.set(0, 0, 0);
    _up.copy(local).normalize();
    this.heading.copy(facing);
    projectTangent(this.heading, _up);
    this.camFwd.copy(this.heading);
    this.grounded = true;
    this._updateQuat(_up);
  }

  _updateQuat(up) {
    const fwd = this.heading;
    _a.crossVectors(fwd, up).normalize();
    _b.copy(fwd).negate();
    _m.makeBasis(_a, up, _b);
    this.body.quat.setFromRotationMatrix(_m);
  }

  update(dt, input, controls = true) {
    const planet = this.body.frame;
    const pos = this.body.pos, vel = this.body.vel;
    const up = _up.copy(pos).normalize();
    projectTangent(this.heading, up);
    projectTangent(this.camFwd, up);
    this.events.length = 0;

    // camera look
    if (controls) {
      const sens = 0.0024;
      this.camFwd.applyAxisAngle(up, -input.mouseDX * sens);
      projectTangent(this.camFwd, up);
      this.camPitch = THREE.MathUtils.clamp(this.camPitch - input.mouseDY * sens, -1.25, 1.0);
      if (input.wheel) this.camDistTarget = THREE.MathUtils.clamp(this.camDistTarget + input.wheel * 0.8, 2.2, 14);
    }
    this.camDist += (this.camDistTarget - this.camDist) * Math.min(1, dt * 8);

    const camRight = _a.crossVectors(this.camFwd, up).normalize();
    let fIn = 0, rIn = 0, sprint = false, jumpHit = false, jumpHeld = false;
    if (controls) {
      fIn = input.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']);
      rIn = input.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']);
      sprint = input.down('ShiftLeft', 'ShiftRight');
      jumpHit = input.hit('Space');
      jumpHeld = input.down('Space');
    }
    const move = this._move.copy(this.camFwd).multiplyScalar(fIn).addScaledVector(camRight, rIn);
    const moving = move.lengthSq() > 0.01;
    if (moving) move.normalize();

    const g = planet.gravity;
    let vN = vel.dot(up);
    const vT = _c.copy(vel).addScaledVector(up, -vN);
    const maxSpeed = this.swimming ? 2.6 : sprint ? 9.5 : 4.6;
    const target = this._target.copy(move).multiplyScalar(moving ? maxSpeed : 0);
    const accel = this.grounded ? 12 : this.swimming ? 4 : 2.2;
    vT.lerp(target, 1 - Math.exp(-accel * dt));

    // jump / jetpack
    let wasGrounded = this.grounded;
    if (jumpHit && (this.grounded || this.swimming)) {
      vN = this.swimming ? 4.5 : 6.2;
      this.grounded = false;
      this.airTime = 0;
      this.events.push('jump');
    }
    this.jetting = false;
    if (!this.grounded && !this.swimming && jumpHeld && this.airTime > 0.28 && this.jetFuel > 0) {
      vN += (g + 8.5) * dt;
      vN = Math.min(vN, 9);
      this.jetFuel = Math.max(0, this.jetFuel - dt / 3.2);
      this.jetting = true;
    }
    if (this.grounded) this.jetFuel = Math.min(1, this.jetFuel + dt / 2.5);

    vN -= g * dt;
    vel.copy(vT).addScaledVector(up, vN);
    pos.addScaledVector(vel, dt);

    // collisions with props/creatures/ship (cylinders in planet-local space)
    this._collide();

    // ground / liquids
    const dir = _a.copy(pos).normalize();
    const hTerrain = planet.height(dir);
    let floor = planet.R + hTerrain;
    this.swimming = false;
    this.onLava = false;
    const sea = planet.def.hasSea ? planet.R + planet.seaLevel : -Infinity;
    const kind = planet.def.sea;
    if (floor < sea) {
      if (kind === 'ice') floor = sea;
      else if (kind === 'lava') { floor = sea; this.onLava = true; }
      else if (floor < sea - 1.3) {
        // deep water: float with head above the surface
        const swimFloor = sea - 1.3;
        if (pos.length() < swimFloor + 0.05) {
          this.swimming = true;
          floor = swimFloor;
        }
      }
    }
    const r = pos.length();
    vN = vel.dot(dir);
    if (r <= floor) {
      pos.setLength(floor);
      if (vN < 0) {
        if (!wasGrounded && vN < -4) this.events.push('land');
        vel.addScaledVector(dir, -vN);
      }
      this.grounded = !this.swimming;
      if (this.swimming) this.grounded = false;
    } else if (this.grounded && r - floor < 0.4 && vN < 1.0) {
      // stick to the ground when walking downhill
      pos.setLength(floor);
      vel.addScaledVector(dir, -Math.min(0, vN));
    } else if (this.swimming) {
      // already handled
    } else {
      this.grounded = false;
    }
    if (this.onLava && r <= floor + 0.05) {
      vel.addScaledVector(dir, 7.5);
      this.grounded = false;
      this.events.push('lava');
    }

    // slide down steep slopes
    if (this.grounded) {
      sampleSurface(planet.gen, dir.x, dir.y, dir.z, _s);
      const ndot = _s.nx * dir.x + _s.ny * dir.y + _s.nz * dir.z;
      if (ndot < 0.62) {
        const n = _b.set(_s.nx, _s.ny, _s.nz);
        const downhill = n.addScaledVector(dir, -ndot);
        vel.addScaledVector(downhill.normalize(), g * (0.62 - ndot) * 3 * dt);
      }
    }
    this.airTime = this.grounded ? 0 : this.airTime + dt;
    if (this.grounded && !wasGrounded) this.events.push('touch');

    // facing
    const up2 = _up.copy(pos).normalize();
    const vT2 = _c.copy(vel).addScaledVector(up2, -vel.dot(up2));
    this.speed = vT2.length();
    const prevHeading = _b.copy(this.heading);
    if (moving || this.speed > 0.5) {
      const want = moving ? target.clone().normalize() : vT2.clone().normalize();
      if (want.lengthSq() > 0.5) {
        this.heading.lerp(want, 1 - Math.exp(-10 * dt));
        projectTangent(this.heading, up2);
      }
    }
    const cross = prevHeading.cross(this.heading).dot(up2);
    this.turn = THREE.MathUtils.clamp(cross / Math.max(dt, 1e-3), -3, 3);
    this._updateQuat(up2);

    // footstep events
    if (this.grounded && this.speed > 0.5) {
      const before = Math.floor(this.model.phase / Math.PI);
      this.model.animate(dt, { speed: this.speed, grounded: true, jet: false, vUp: 0, swim: false, turn: this.turn, justLanded: this.events.includes('land') });
      const after = Math.floor(this.model.phase / Math.PI);
      if (after !== before) this.events.push('step');
    } else {
      this.model.animate(dt, { speed: this.speed, grounded: this.grounded, jet: this.jetting, vUp: vel.dot(up2), swim: this.swimming, turn: this.turn, justLanded: this.events.includes('land') });
    }
  }

  _collide() {
    const pos = this.body.pos, vel = this.body.vel;
    const pr = 0.35;
    for (const c of this.colliders) {
      // c: {x,y,z,r,h} base point in planet-local space; axis = radial
      _a.set(c.x, c.y, c.z);
      const axis = _b.copy(_a).normalize();
      const d = _c.copy(pos).sub(_a);
      const along = d.dot(axis);
      if (along < -1.0 || along > c.h) continue;
      d.addScaledVector(axis, -along);
      const dist = d.length();
      const minD = c.r + pr;
      if (dist < minD && dist > 1e-5) {
        if (c.top && along > c.h - 0.6 && this.body.vel.dot(axis) <= 0) {
          // stand on top of low flat obstacles
          pos.addScaledVector(axis, c.h - along);
          this.grounded = true;
          vel.addScaledVector(axis, -Math.min(0, vel.dot(axis)));
          continue;
        }
        d.multiplyScalar(1 / dist);
        pos.addScaledVector(d, minD - dist);
        const vn = vel.dot(d);
        if (vn < 0) vel.addScaledVector(d, -vn);
      }
    }
  }

  // Camera in planet-local space.
  computeCamera(outPos, outQuat) {
    const planet = this.body.frame;
    const pos = this.body.pos;
    const up = _up.copy(pos).normalize();
    const right = _a.crossVectors(this.camFwd, up).normalize();
    const f = _b.copy(this.camFwd).applyAxisAngle(right, this.camPitch);
    const pivot = _c.copy(pos).addScaledVector(up, 1.55).addScaledVector(right, 0.32);
    outPos.copy(pivot).addScaledVector(f, -this.camDist);
    this.camPivot = (this.camPivot || new THREE.Vector3()).copy(pivot);
    // keep the camera above ground / water
    const cd = outPos.clone().normalize();
    let ground = planet.surfaceRadius(cd) + 0.45;
    const r = outPos.length();
    if (r < ground) outPos.setLength(ground);
    const look = pivot.clone().addScaledVector(f, 2.0);
    _m.lookAt(outPos, look, up);
    outQuat.setFromRotationMatrix(_m);
  }
}
