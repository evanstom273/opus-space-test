// Main game orchestration: modes (on foot / piloting), boarding, camera rigs,
// floating origin, streaming systems, HUD and audio.
import * as THREE from 'three';
import { Pipeline } from '../render/Pipeline.js';
import { Universe } from '../world/Universe.js';
import { Input } from './Input.js';
import { createEnv, copyEnv, createCelMaterial, createOutlineMaterial } from '../render/materials.js';
import { Astronaut } from '../entities/Astronaut.js';
import { Player } from '../entities/Player.js';
import { Ship } from '../entities/Ship.js';
import { sampleSurface } from '../world/terrainGen.js';
import { Flora } from '../world/Flora.js';
import { Fauna } from '../world/Fauna.js';
import { Clouds } from '../world/Clouds.js';
import { Weather } from '../world/Weather.js';
import { Hud } from '../ui/Hud.js';
import { AudioEngine } from '../audio/AudioEngine.js';
import { Discoveries } from './Discoveries.js';
import { TouchControls, isTouchDevice } from '../ui/TouchControls.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = { h: 0, nx: 0, ny: 0, nz: 0, slope: 0 };

function smooth01(t) { return t * t * (3 - 2 * t); }

export class Game {
  constructor(container, hudEl) {
    this.params = new URLSearchParams(location.search);
    this.pipeline = new Pipeline(container);
    this.input = new Input(this.pipeline.renderer.domElement);
    this.universe = new Universe(this.pipeline.scene);
    this.scene = this.pipeline.scene;

    // dynamic environment for objects that move between planets
    this.dynEnv = createEnv();
    this.celMat = createCelMaterial(this.dynEnv, { rim: 0.45 });
    this.glassMat = createCelMaterial(this.dynEnv, { rim: 0.8, gloss: 1.4 });
    this.outlineMat = createOutlineMaterial(this.dynEnv, { width: 0.022, far: 600 });
    this.shipOutlineMat = createOutlineMaterial(this.dynEnv, { width: 0.05, far: 3000 });

    this.astronaut = new Astronaut(this.celMat, this.glassMat, this.outlineMat);
    this.player = new Player(this.astronaut);
    this.ship = new Ship(this.universe, this.celMat, this.glassMat, this.shipOutlineMat);

    this.flora = new Flora(this.universe);
    this.fauna = new Fauna(this.universe, this.flora);
    this.clouds = new Clouds(this.universe);
    this.weather = new Weather(this.scene, this.dynEnv);
    this.discoveries = new Discoveries();
    this.hud = new Hud(hudEl, this);
    this.audio = new AudioEngine();

    this.mode = 'foot';
    this.camWorld = new THREE.Vector3();
    this.camQuat = new THREE.Quaternion();
    this.origin = new THREE.Vector3();
    this.blend = 1; // camera transition progress
    this.blendFrom = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
    this.shipCam = { lag: new THREE.Quaternion(), init: false, look: new THREE.Vector2(), orbit: false };
    this.fov = 62;
    this.started = false;
    this.paused = false;
    this.timeScale = 1;
    this.last = performance.now();
    this.fps = 60;
    this.noRender = this.params.has('norender');
    this.prof = { terrain: 0, flora: 0, fauna: 0, misc: 0, hud: 0, render: 0, frames: 0, pre: 0 };
    this.fixedDt = this.params.has('fixeddt') ? parseFloat(this.params.get('fixeddt')) || 0.033 : 0;

    this._spawn();

    this.pipeline.renderer.domElement.addEventListener('click', () => {
      this.input.requestLock();
      this.audio.resume();
    });
    this.input.onLockChange = (locked) => this.hud.setLocked(locked);
    if (isTouchDevice()) {
      this.touch = new TouchControls(hudEl, this.input, this);
      this.hud.setTouch(true);
    }
  }

  // Find a pleasant daytime landing spot and set the ship + player there.
  _spawn() {
    this._spawnOn(this.universe.planets[0]);
  }

  _spawnOn(planet) {
    planet.updateRotation(this.universe.time);
    // sun direction in planet-local space, rotated back toward "morning"
    const sunLocal = planet.worldToLocal(this.universe.sunWorld, new THREE.Vector3()).normalize();
    const morning = sunLocal.clone().applyAxisAngle(planet.axis, -0.55).normalize();
    const minH = planet.def.hasSea ? planet.seaLevel + 6 : -35;
    let best = null, bestScore = -Infinity;
    const rng = (i) => Math.sin(i * 127.1 + planet.index * 17) * 0.5 + 0.5;
    for (let i = 0; i < 500; i++) {
      const d = morning.clone().add(new THREE.Vector3(rng(i) - 0.5, rng(i + 1000) - 0.5, rng(i + 2000) - 0.5).multiplyScalar(0.7)).normalize();
      sampleSurface(planet.gen, d.x, d.y, d.z, _s);
      if (_s.h < minH || _s.h > 70 || _s.slope > 0.06) continue;
      const m = planet.gen.moisture(d.x, d.y, d.z);
      const score = -Math.abs(m - 0.5) * 2 - _s.slope * 20 + d.dot(morning) * 2 - Math.abs(_s.h - minH - 12) * 0.02;
      if (score > bestScore) { bestScore = score; best = d; }
    }
    if (!best) best = morning;
    const heading = new THREE.Vector3(0, 1, 0).cross(best).normalize();
    this.ship.placeLanded(planet, best.clone().multiplyScalar(planet.R + 50), heading);
    // player stands beside the cockpit, facing the ship's nose direction
    const left = new THREE.Vector3(-1, 0, 0).applyQuaternion(this.ship.body.quat);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.ship.body.quat);
    const pLocal = this.ship.body.pos.clone().addScaledVector(left, 3.4).addScaledVector(fwd, 3.6);
    const dir = pLocal.clone().normalize();
    pLocal.copy(dir).multiplyScalar(planet.surfaceRadius(dir, false) + 0.05);
    const toward = this.ship.body.pos.clone().addScaledVector(fwd, 4).sub(pLocal);
    this.player.placeAt(planet, pLocal, toward);
    this.player.camFwd.copy(fwd).addScaledVector(dir, -fwd.dot(dir)).normalize().applyAxisAngle(dir, -0.6);
    if (this.mode === 'ship') { this.mode = 'foot'; this.ship.piloted = false; this.astronaut.group.visible = true; }
    this._attach();
  }

  _attach() {
    const pl = this.player.body.frame;
    if (this.astronaut.group.parent !== pl.root) pl.root.add(this.astronaut.group);
  }

  start() {
    const loop = () => {
      requestAnimationFrame(loop);
      const now = performance.now();
      const raw = (now - this.last) / 1000;
      this.last = now;
      this.fps += (1 / Math.max(raw, 1e-3) - this.fps) * 0.05;
      const dt = this.fixedDt || Math.min(0.05, raw);
      try {
        this.frame(dt);
      } catch (err) {
        console.error(err);
        this.hud.error(err);
        throw err;
      }
    };
    requestAnimationFrame(loop);
  }

  // --- per-frame -------------------------------------------------------------
  frame(dt) {
    const u = this.universe;
    const input = this.input;
    if (input.hit('KeyH')) this.hud.toggleHelp();
    if (input.hit('KeyM')) this.audio.toggleMute();
    if (input.hit('Tab')) this.hud.toggleJournal();
    if (input.hit('KeyT')) { this.timeScale = this.timeScale === 1 ? 20 : 1; this.hud.toast(this.timeScale > 1 ? 'Time of day: fast-forward' : 'Time of day: normal'); }
    if (input.hit('KeyV')) this.shipCam.far = !this.shipCam.far;

    // advance planet rotation
    u.time += dt * (this.timeScale > 1 ? 30 : 1);
    for (const p of u.planets) p.updateRotation(u.time);

    const tPre = performance.now();
    const controls = input.locked || this.params.has('autopilot') || (input.touchMode && input.touchStarted);
    if (this.touch) this.touch.update();
    const T = input.touchMode;
    if (this.mode === 'foot') {
      this._gatherColliders();
      this.player.update(dt, input, controls);
      this.ship.update(dt, null);
      const near = this._nearShip();
      if (near && controls && input.hit('KeyF')) this._board();
      this.hud.prompt(near ? (T ? 'Tap BOARD to enter your ship' : '[F] Board ship') : this.player.onLava ? 'Too hot! The crust burns' : '');
    } else {
      this.ship.update(dt, controls ? input : null);
      if (this.ship.landed) {
        this.hud.prompt(T ? 'EXIT to walk · UP or THRUST to take off' : '[F] Exit ship   ·   [Space] / [W] Take off');
        if (controls && input.hit('KeyF')) this._exitShip();
      } else {
        this.hud.prompt(this.ship.gear > 0.5 && this.ship.altitude < 40 ? (T ? 'Gear down · hold DOWN to land' : 'Landing gear down · hold [C] to settle and land') : '');
      }
    }
    this._placeEntities();
    this._updateCamera(dt);
    this.prof.pre += performance.now() - tPre;

    // floating origin: everything is rendered relative to the camera
    this.origin.copy(this.camWorld);
    u.update(dt, this.origin, this.camWorld, this.pipeline.pixelRatio);
    this._updateDynEnv();
    this._placeRender();

    const cam = this.pipeline.camera;
    cam.position.set(0, 0, 0);
    cam.quaternion.copy(this.camQuat);
    cam.fov = this.fov;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();

    // streaming systems
    const P = this.prof;
    let t0 = performance.now();
    u.updateTerrain(this.camWorld);
    P.terrain += performance.now() - t0; t0 = performance.now();
    const focusPlanet = this._focusPlanet();
    this.flora.update(dt, this.camWorld, focusPlanet);
    P.flora += performance.now() - t0; t0 = performance.now();
    this.fauna.update(dt, this, focusPlanet);
    P.fauna += performance.now() - t0; t0 = performance.now();
    this.clouds.update(dt, u.time);
    this.weather.update(dt, this, focusPlanet);
    this._discover(focusPlanet);
    P.misc += performance.now() - t0;

    // sun shadows around the focus
    const focus = this._focusRender(_w);
    const sunDir = _v.copy(u.sunWorld).sub(this.origin).sub(focus).normalize();
    let extent = 40;
    if (this.mode === 'ship') extent = this.ship.altitude < 150 ? 70 : 25;
    this.pipeline.updateShadow(focus, sunDir, extent);
    this.pipeline.grade.uniforms.uHeat.value = this.mode === 'ship' ? this.ship.heat : 0;

    this.audio.update(dt, this);
    t0 = performance.now();
    this.hud.update(dt);
    P.hud += performance.now() - t0; t0 = performance.now();
    if (!this.noRender || this.forceRender) {
      this.pipeline.render(dt);
      this.forceRender = false;
    }
    P.render += performance.now() - t0;
    P.frames++;
    input.endFrame();
  }

  _focusPlanet() {
    if (this.mode === 'foot') return this.player.body.frame;
    return this.ship.body.frame;
  }

  _gatherColliders() {
    const p = this.player;
    const planet = p.body.frame;
    const list = p.colliders;
    list.length = 0;
    this.flora.collidersNear(planet, p.body.pos, 8, list);
    this.fauna.collidersNear(planet, p.body.pos, 8, list);
    // ship hull as a few cylinders
    if (this.ship.body.frame === planet) {
      const sb = this.ship.body;
      const up = _v.copy(sb.pos).normalize();
      const fwd = _w.set(0, 0, -1).applyQuaternion(sb.quat);
      const ground = planet.surfaceRadius(up, false);
      for (const z of [-4.5, -2, 0.5, 3]) {
        const c = sb.pos.clone().addScaledVector(fwd, -z);
        const cd = c.clone().normalize();
        const base = cd.multiplyScalar(ground - 0.5);
        list.push({ x: base.x, y: base.y, z: base.z, r: z < -3 ? 0.8 : 1.25, h: 4 });
      }
      for (const s of [-1, 1]) {
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(sb.quat);
        for (const [lat, back, r] of [[2.6, -1.0, 1.3], [4.2, -2.0, 0.9]]) {
          const c = sb.pos.clone().addScaledVector(right, s * lat).addScaledVector(fwd, back);
          const base = c.normalize().multiplyScalar(ground - 0.3);
          list.push({ x: base.x, y: base.y, z: base.z, r, h: 2.6 });
        }
      }
    }
  }

  _nearShip() {
    if (!this.ship.landed || this.ship.body.frame !== this.player.body.frame) return false;
    return this.player.body.pos.distanceTo(this.ship.body.pos) < 7.5;
  }

  _beginBlend() {
    this.blend = 0;
    this.blendFrom.pos.copy(this.camWorld);
    this.blendFrom.quat.copy(this.camQuat);
  }

  _board() {
    this._beginBlend();
    this.mode = 'ship';
    this.ship.piloted = true;
    this.astronaut.group.visible = false;
    this.shipCam.init = false;
    this.audio.event('board');
    this.discoveries.flags.boarded = true;
  }

  _exitShip() {
    const sb = this.ship.body;
    const planet = sb.frame;
    if (!planet) return;
    this._beginBlend();
    this.mode = 'foot';
    this.ship.piloted = false;
    const left = new THREE.Vector3(-1, 0, 0).applyQuaternion(sb.quat);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(sb.quat);
    const pLocal = sb.pos.clone().addScaledVector(left, 3.4).addScaledVector(fwd, 3.6);
    const dir = pLocal.clone().normalize();
    pLocal.copy(dir).multiplyScalar(planet.surfaceRadius(dir) + 0.3);
    this.player.placeAt(planet, pLocal, fwd);
    this.player.camFwd.copy(fwd).addScaledVector(dir, -fwd.dot(dir)).normalize().applyAxisAngle(dir, -0.9);
    this.player.camPitch = -0.15;
    this._attach();
    this.astronaut.group.visible = true;
    this.audio.event('exit');
    this.discoveries.visitPlanet(planet, this.hud);
  }

  _placeEntities() {
    // ship scene-graph parent follows its frame
    const sb = this.ship.body;
    const parent = sb.frame ? sb.frame.root : this.scene;
    if (this.ship.group.parent !== parent) parent.add(this.ship.group);
    const pb = this.player.body;
    this.astronaut.group.position.copy(pb.pos);
    this.astronaut.group.quaternion.copy(pb.quat);
  }

  _placeRender() {
    const sb = this.ship.body;
    if (sb.frame) {
      this.ship.group.position.copy(sb.pos);
      this.ship.group.quaternion.copy(sb.quat);
    } else {
      this.ship.group.position.copy(sb.pos).sub(this.origin);
      this.ship.group.quaternion.copy(sb.quat);
    }
  }

  _focusRender(out) {
    const body = this.mode === 'foot' ? this.player.body : this.ship.body;
    this.universe.toWorld(body, out);
    return out.sub(this.origin);
  }

  _updateDynEnv() {
    const body = this.mode === 'foot' ? this.player.body : this.ship.body;
    const planet = body.frame || this.universe.nearest(this.universe.toWorld(body, _v)).planet;
    copyEnv(this.dynEnv, planet.env);
  }

  _updateCamera(dt) {
    const u = this.universe;
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion();
    let targetFov = 62;
    if (this.mode === 'foot') {
      const planet = this.player.body.frame;
      this.player.computeCamera(pos, quat);
      this._cameraShipOcclusion(planet, this.player.camPivot, pos);
      planet.localToWorld(pos, pos);
      quat.premultiply(planet.quat);
    } else {
      const sb = this.ship.body;
      const shipPos = u.toWorld(sb, new THREE.Vector3(), _q);
      const shipQuat = _q.clone();
      const sc = this.shipCam;
      if (!sc.init) { sc.lag.copy(shipQuat); sc.init = true; }
      sc.lag.slerp(shipQuat, 1 - Math.exp(-dt * (this.ship.landed ? 3 : 5.5)));
      // free-look orbit while holding the right mouse button
      const free = (this.input.buttons & 4) !== 0 || this.input.down('AltLeft') || this.input.touchLooking;
      if (free) {
        sc.look.x -= this.input.mouseDX * 0.004;
        sc.look.y = THREE.MathUtils.clamp(sc.look.y - this.input.mouseDY * 0.004, -1.2, 1.2);
        this.ship.stick.set(0, 0);
      } else {
        sc.look.multiplyScalar(Math.exp(-dt * 3));
      }
      const speed = this.ship.speed;
      const pull = THREE.MathUtils.clamp(speed / 300, 0, 1) * 3 + (this.ship.cruise ? 4 : 0);
      const dist = (sc.far ? 30 : 17) + pull;
      const lookQ = sc.lag.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(sc.look.y - 0.12, sc.look.x, 0, 'YXZ')));
      const off = new THREE.Vector3(0, 3.6 + (sc.far ? 3 : 0), dist).applyQuaternion(lookQ);
      pos.copy(shipPos).add(off);
      const target = new THREE.Vector3(0, 1.4, -10).applyQuaternion(lookQ).add(shipPos);
      const upv = new THREE.Vector3(0, 1, 0).applyQuaternion(lookQ);
      _m.lookAt(pos, target, upv);
      quat.setFromRotationMatrix(_m);
      // camera shake (turbulence, entry heat, impacts)
      const sh = this.ship.shake;
      if (sh > 0.01) {
        const t = performance.now() * 0.001;
        quat.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(t * 37) * sh * 0.01, Math.sin(t * 29 + 1) * sh * 0.01, Math.sin(t * 23) * sh * 0.006)));
      }
      // keep above ground
      if (sb.frame) {
        const local = sb.frame.worldToLocal(pos, new THREE.Vector3());
        const d = local.clone().normalize();
        const g = sb.frame.surfaceRadius(d) + 1.5;
        if (local.length() < g) { local.setLength(g); sb.frame.localToWorld(local, pos); }
      }
      targetFov = 62 + THREE.MathUtils.clamp(speed / 250, 0, 1) * 8 + (this.ship.cruise ? 10 : 0);
    }
    this.fov += (targetFov - this.fov) * (1 - Math.exp(-dt * 2));
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / 1.1);
      const k = smooth01(this.blend);
      pos.lerpVectors(this.blendFrom.pos, pos, k);
      quat.slerpQuaternions(this.blendFrom.quat, quat, k);
    }
    this.camWorld.copy(pos);
    this.camQuat.copy(quat);
  }

  // Pull the third-person camera in front of the ship hull if it would clip.
  _cameraShipOcclusion(planet, pivot, camPos) {
    const sb = this.ship.body;
    if (sb.frame !== planet) return;
    if (!this._hullProxy) {
      this._hullProxy = new THREE.Mesh(this.ship.hullMesh.geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
      this._hullProxy.updateMatrixWorld();
      this._ray = new THREE.Raycaster();
    }
    if (pivot.distanceTo(sb.pos) > 30) return;
    const inv = new THREE.Matrix4().compose(sb.pos, sb.quat, new THREE.Vector3(1, 1, 1)).invert();
    const a = pivot.clone().applyMatrix4(inv);
    const b = camPos.clone().applyMatrix4(inv);
    const dir = b.clone().sub(a);
    const len = dir.length();
    if (len < 1e-3) return;
    this._ray.set(a, dir.multiplyScalar(1 / len));
    this._ray.far = len + 0.3;
    const hit = this._ray.intersectObject(this._hullProxy, false)[0];
    if (hit) {
      const d = Math.max(0.6, hit.distance - 0.35);
      camPos.copy(pivot).addScaledVector(camPos.clone().sub(pivot).normalize(), d);
    }
  }

  _discover(planet) {
    if (!planet) return;
    const body = this.mode === 'foot' ? this.player.body : this.ship.body;
    if (body.pos.length() < planet.atmoTop) this.discoveries.visitPlanet(planet, this.hud);
    if (this.mode === 'foot' || this.ship.altitude < 30) {
      this.fauna.discoverNear(planet, body.pos, 26, this.discoveries, this.hud);
      this.flora.discoverNear(planet, body.pos, 9, this.discoveries, this.hud);
    }
  }
}
