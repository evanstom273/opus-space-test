// Procedurally modelled, rigged and animated explorer in an EVA suit.
// Forward is -Z, right is +X, origin at the feet.
import * as THREE from 'three';
import { RigBuilder, G, mat } from '../render/geom.js';
import { createFlameMaterial } from '../render/materials.js';

const SUIT = 0xe9e6de, SUIT2 = 0xcfccc4, ORANGE = 0xe2742c, DARK = 0x3a3f48, DARKER = 0x23272e, VISOR = 0x1d3346;

export class Astronaut {
  constructor(material, visorMaterial, outlineMaterial) {
    const rig = new RigBuilder();
    const root = rig.bone('root', null, [0, 0, 0]);
    const hips = rig.bone('hips', root, [0, 0.96, 0]);
    const spine = rig.bone('spine', hips, [0, 0.1, 0]);
    const chest = rig.bone('chest', spine, [0, 0.24, 0]);
    const neck = rig.bone('neck', chest, [0, 0.26, 0]);
    const head = rig.bone('head', neck, [0, 0.06, 0]);
    const side = (s, n) => n + (s > 0 ? 'R' : 'L');
    for (const s of [-1, 1]) {
      const sh = rig.bone(side(s, 'shoulder'), chest, [0.215 * s, 0.17, 0.0]);
      const fa = rig.bone(side(s, 'forearm'), sh, [0, -0.29, 0]);
      rig.bone(side(s, 'hand'), fa, [0, -0.26, 0]);
      const th = rig.bone(side(s, 'thigh'), hips, [0.105 * s, -0.04, 0]);
      const sn = rig.bone(side(s, 'shin'), th, [0, -0.43, 0]);
      rig.bone(side(s, 'foot'), sn, [0, -0.43, 0]);
    }
    const B = Object.fromEntries(rig.bones.map((b) => [b.name, b]));

    // torso
    rig.add(hips, G.rbox(0.34, 0.2, 0.23, 0.07), SUIT2, { matrix: mat([0, 0.0, 0]) });
    rig.add(hips, G.rbox(0.36, 0.06, 0.25, 0.03), DARK, { matrix: mat([0, 0.09, 0]) });
    rig.add(spine, G.rbox(0.33, 0.24, 0.22, 0.08), SUIT, { matrix: mat([0, 0.1, 0]) });
    rig.add(chest, G.rbox(0.44, 0.34, 0.27, 0.1), SUIT, { matrix: mat([0, 0.1, 0]) });
    rig.add(chest, G.rbox(0.2, 0.12, 0.05, 0.02), DARK, { matrix: mat([0, 0.12, -0.13]) });
    rig.add(chest, G.box(0.05, 0.03, 0.02), 0x5fe0ff, { matrix: mat([0.05, 0.13, -0.16]), emissive: 1.2 });
    rig.add(chest, G.box(0.03, 0.03, 0.02), ORANGE, { matrix: mat([-0.05, 0.13, -0.16]), emissive: 0.8 });
    rig.add(chest, G.box(0.46, 0.05, 0.28), ORANGE, { matrix: mat([0, 0.2, 0]) });
    // backpack life-support unit with thruster nozzles
    rig.add(chest, G.rbox(0.38, 0.46, 0.18, 0.05), SUIT2, { matrix: mat([0, 0.08, 0.21]) });
    rig.add(chest, G.rbox(0.3, 0.12, 0.06, 0.02), ORANGE, { matrix: mat([0, 0.2, 0.31]) });
    rig.add(chest, G.cyl(0.035, 0.05, 0.08, 10), DARKER, { matrix: mat([0.1, -0.17, 0.22]) });
    rig.add(chest, G.cyl(0.035, 0.05, 0.08, 10), DARKER, { matrix: mat([-0.1, -0.17, 0.22]) });
    rig.add(chest, G.cyl(0.015, 0.015, 0.3, 6), DARK, { matrix: mat([0.17, 0.2, 0.22], [0.3, 0, 0]) });
    // collar + helmet
    rig.add(neck, G.torus(0.12, 0.035, 8, 20), DARK, { matrix: mat([0, 0.0, 0], [Math.PI / 2, 0, 0]) });
    rig.add(head, G.sphere(0.165, 20, 16), SUIT, { matrix: mat([0, 0.13, 0.01]) });
    rig.add(head, G.box(0.04, 0.05, 0.08), DARK, { matrix: mat([0.16, 0.13, 0.02]) });
    rig.add(head, G.box(0.04, 0.05, 0.08), DARK, { matrix: mat([-0.16, 0.13, 0.02]) });
    rig.add(head, G.cyl(0.006, 0.006, 0.14, 5), DARK, { matrix: mat([0.16, 0.26, 0.05]) });
    rig.add(head, G.sphere(0.012, 6, 4), 0xff5a3a, { matrix: mat([0.16, 0.33, 0.05]), emissive: 2 });
    // limbs
    for (const s of [-1, 1]) {
      const n = s > 0 ? 'R' : 'L';
      rig.add(B['shoulder' + n], G.sphere(0.085, 12, 10), SUIT2, { matrix: mat([0, -0.01, 0]) });
      rig.add(B['shoulder' + n], G.cap(0.063, 0.2, 4, 10), SUIT, { matrix: mat([0, -0.15, 0]) });
      rig.add(B['shoulder' + n], G.cyl(0.07, 0.07, 0.04, 10), ORANGE, { matrix: mat([0, -0.08, 0]) });
      rig.add(B['forearm' + n], G.cap(0.058, 0.18, 4, 10), SUIT, { matrix: mat([0, -0.12, 0]) });
      rig.add(B['forearm' + n], G.sphere(0.06, 10, 8), SUIT2, { matrix: mat([0, 0.0, 0]) });
      rig.add(B['forearm' + n], G.cyl(0.066, 0.066, 0.06, 10), DARK, { matrix: mat([0, -0.23, 0]) });
      rig.add(B['hand' + n], G.rbox(0.08, 0.1, 0.09, 0.03), DARK, { matrix: mat([0, -0.05, -0.005]) });
      rig.add(B['hand' + n], G.cap(0.02, 0.04, 3, 6), DARK, { matrix: mat([-0.045 * s, -0.04, -0.03], [0.3, 0, 0.5 * s]) });
      rig.add(B['thigh' + n], G.cap(0.085, 0.3, 4, 10), SUIT, { matrix: mat([0, -0.2, 0]) });
      rig.add(B['thigh' + n], G.cyl(0.094, 0.094, 0.05, 10), ORANGE, { matrix: mat([0, -0.06, 0]) });
      rig.add(B['shin' + n], G.cap(0.074, 0.28, 4, 10), SUIT, { matrix: mat([0, -0.2, 0]) });
      rig.add(B['shin' + n], G.sphere(0.08, 10, 8), SUIT2, { matrix: mat([0, 0, -0.02]) });
      rig.add(B['shin' + n], G.rbox(0.1, 0.07, 0.04, 0.015), DARK, { matrix: mat([0, -0.02, -0.08]) });
      rig.add(B['foot' + n], G.rbox(0.13, 0.11, 0.27, 0.04), DARK, { matrix: mat([0, 0.04, -0.045]) });
      rig.add(B['foot' + n], G.rbox(0.14, 0.035, 0.29, 0.015), DARKER, { matrix: mat([0, -0.0, -0.045]) });
      rig.add(B['shin' + n], G.cyl(0.082, 0.082, 0.06, 10), DARK, { matrix: mat([0, -0.36, 0]) });
    }
    const built = rig.build(material, outlineMaterial);
    this.mesh = built.mesh;
    this.bones = built.bones;

    // glossy visor is a separate small mesh on the head bone
    const visorGeo = new THREE.SphereGeometry(0.15, 20, 14, Math.PI * 0.18, Math.PI * 0.64, Math.PI * 0.26, Math.PI * 0.42);
    const vg = visorGeo.toNonIndexed();
    const n = vg.attributes.position.count;
    const col = new Float32Array(n * 4);
    const vc = new THREE.Color(VISOR);
    for (let i = 0; i < n; i++) { col[i * 4] = vc.r; col[i * 4 + 1] = vc.g; col[i * 4 + 2] = vc.b; col[i * 4 + 3] = 0.05; }
    vg.setAttribute('aColor', new THREE.BufferAttribute(col, 4));
    vg.rotateY(Math.PI);
    const visor = new THREE.Mesh(vg, visorMaterial);
    visor.position.set(0, 0.13, -0.035);
    visor.scale.set(1.02, 1.0, 1.06);
    this.bones.head.add(visor);

    // jetpack flames
    this.flameMat = createFlameMaterial(0x7fd8ff);
    const flameGeo = new THREE.ConeGeometry(0.05, 1, 10, 1, true);
    flameGeo.rotateX(Math.PI);
    flameGeo.translate(0, -0.5, 0);
    this.flames = [];
    for (const s of [-1, 1]) {
      const f = new THREE.Mesh(flameGeo, this.flameMat);
      f.position.set(0.1 * s, -0.22, 0.22);
      f.scale.set(1, 0.001, 1);
      f.visible = false;
      f.frustumCulled = false;
      this.bones.chest.add(f);
      this.flames.push(f);
    }

    this.group = new THREE.Group();
    this.group.add(this.mesh);
    this.phase = 0;
    this.idleT = Math.random() * 10;
    this.lean = 0;
    this.landT = 0;
  }

  // state: { speed, grounded, jet, vUp, swim, turn }
  animate(dt, s) {
    const B = this.bones;
    this.idleT += dt;
    const speed = s.speed;
    const walk = THREE.MathUtils.clamp(speed / 4.5, 0, 1);
    const run = THREE.MathUtils.clamp((speed - 4.5) / 4.5, 0, 1);
    const stride = THREE.MathUtils.lerp(1.5, 2.6, run);
    if (s.grounded) this.phase += (speed / stride) * Math.PI * dt;
    const p = this.phase;
    const k = Math.min(1, dt * 12);
    const set = (bone, x, y = 0, z = 0) => {
      bone.rotation.x += (x - bone.rotation.x) * k;
      bone.rotation.y += (y - bone.rotation.y) * k;
      bone.rotation.z += (z - bone.rotation.z) * k;
    };
    const breathe = Math.sin(this.idleT * 1.7) * 0.02;
    if (s.grounded && !s.swim) {
      const amp = 0.55 * walk + 0.35 * run;
      const sw = Math.sin(p);
      set(B.thighL, sw * amp - 0.05 * run, 0, -0.03);
      set(B.thighR, -sw * amp - 0.05 * run, 0, 0.03);
      set(B.shinL, -Math.max(0, Math.sin(p + 1.3)) * (0.9 * walk + 0.6 * run) - 0.05, 0, 0);
      set(B.shinR, -Math.max(0, Math.sin(p + Math.PI + 1.3)) * (0.9 * walk + 0.6 * run) - 0.05, 0, 0);
      set(B.footL, Math.max(0, -Math.sin(p + 0.4)) * 0.3 * walk, 0, 0);
      set(B.footR, Math.max(0, -Math.sin(p + Math.PI + 0.4)) * 0.3 * walk, 0, 0);
      const armAmp = 0.45 * walk + 0.4 * run;
      set(B.shoulderL, -sw * armAmp + breathe, 0, -0.12 - walk * 0.04);
      set(B.shoulderR, sw * armAmp + breathe, 0, 0.12 + walk * 0.04);
      set(B.forearmL, 0.25 + 0.55 * run + Math.max(0, -sw) * 0.3 * walk, 0, 0);
      set(B.forearmR, 0.25 + 0.55 * run + Math.max(0, sw) * 0.3 * walk, 0, 0);
      set(B.spine, -0.06 * walk - 0.14 * run + breathe * 0.5, Math.sin(p) * 0.08 * walk, 0);
      set(B.chest, breathe, -Math.sin(p) * 0.12 * walk, 0);
      const bob = Math.abs(Math.cos(p)) * (0.035 * walk + 0.05 * run);
      B.hips.position.y = 0.96 - 0.03 * run + bob - this.landT * 0.12;
      B.hips.rotation.z = Math.sin(p) * 0.04 * walk;
      // idle look-around
      const look = (1 - walk) * Math.sin(this.idleT * 0.37) * 0.5;
      set(B.head, (1 - walk) * Math.sin(this.idleT * 0.23) * 0.1, look, 0);
    } else if (s.swim) {
      const sp = this.idleT * 3;
      set(B.thighL, Math.sin(sp) * 0.4 + 0.2, 0, -0.1);
      set(B.thighR, -Math.sin(sp) * 0.4 + 0.2, 0, 0.1);
      set(B.shinL, -0.5, 0, 0);
      set(B.shinR, -0.5, 0, 0);
      set(B.shoulderL, 1.2 + Math.sin(sp) * 0.6, 0, -0.4);
      set(B.shoulderR, 1.2 - Math.sin(sp) * 0.6, 0, 0.4);
      set(B.forearmL, 0.4, 0, 0);
      set(B.forearmR, 0.4, 0, 0);
      set(B.spine, -0.3, 0, 0);
      set(B.head, 0.3, 0, 0);
      B.hips.position.y = 0.96;
    } else {
      // airborne / jetpack
      const up = THREE.MathUtils.clamp(s.vUp / 6, -1, 1);
      const dang = s.jet ? 0.3 : 0;
      set(B.thighL, 0.45 - up * 0.2 - dang, 0, -0.08);
      set(B.thighR, 0.1 + up * 0.2 - dang * 0.5, 0, 0.08);
      set(B.shinL, -0.9 + dang, 0, 0);
      set(B.shinR, -0.4 + dang * 0.5, 0, 0);
      set(B.footL, 0.2, 0, 0);
      set(B.footR, 0.2, 0, 0);
      set(B.shoulderL, 0.2 + up * 0.3, 0, -0.5 - dang);
      set(B.shoulderR, 0.2 + up * 0.3, 0, 0.5 + dang);
      set(B.forearmL, 0.6, 0, 0);
      set(B.forearmR, 0.6, 0, 0);
      set(B.spine, -0.08, 0, 0);
      set(B.chest, 0, 0, 0);
      set(B.head, 0.1, 0, 0);
      B.hips.position.y = 0.96;
    }
    if (s.justLanded) this.landT = 1;
    this.landT = Math.max(0, this.landT - dt * 4);
    // lean into turns
    this.lean += ((s.turn || 0) * 0.15 * walk - this.lean) * Math.min(1, dt * 6);
    B.root.rotation.z = THREE.MathUtils.clamp(this.lean, -0.25, 0.25);

    const jet = s.jet ? 1 : 0;
    for (const f of this.flames) {
      f.visible = jet > 0;
      const len = 0.35 + Math.random() * 0.15;
      f.scale.set(1, len * jet + 0.001, 1);
    }
    this.flameMat.uniforms.uTime.value = this.idleT;
  }
}
