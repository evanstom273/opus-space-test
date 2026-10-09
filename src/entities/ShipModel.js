// Procedural hard-surface explorer ship (~12 m). Forward -Z, up +Y, right +X.
import * as THREE from 'three';
import { part, mergeParts, mat, G, outlined } from '../render/geom.js';
import { createFlameMaterial } from '../render/materials.js';

const HULL = 0xd6d2c8, HULL2 = 0xa9a69e, ORANGE = 0xd9662a, DARK = 0x2f343c, DARKER = 0x1c1f24, GLASS = 0x14212e;

// Loft a hull through elliptical-octagon cross sections along Z.
function loft(sections, sides = 10, sharp = 2.6) {
  const pos = [];
  const rings = sections.map((s) => {
    const ring = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2 + Math.PI / sides;
      const c = Math.cos(a), sn = Math.sin(a);
      const x = Math.sign(c) * Math.pow(Math.abs(c), 2 / sharp) * s.w * 0.5;
      let y = Math.sign(sn) * Math.pow(Math.abs(sn), 2 / sharp) * s.h * 0.5;
      if (y < 0) y *= s.bottom ?? 1;
      ring.push([x, y + (s.y || 0), s.z]);
    }
    return ring;
  });
  const tri = (a, b, c) => pos.push(...a, ...b, ...c);
  for (let r = 0; r < rings.length - 1; r++) {
    const A = rings[r], B = rings[r + 1];
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      tri(A[i], A[j], B[j]);
      tri(A[i], B[j], B[i]);
    }
  }
  // caps
  const capFan = (ring, flip) => {
    const c = ring.reduce((acc, p) => [acc[0] + p[0] / sides, acc[1] + p[1] / sides, acc[2] + p[2] / sides], [0, 0, 0]);
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      if (flip) tri(c, ring[j], ring[i]); else tri(c, ring[i], ring[j]);
    }
  };
  capFan(rings[0], true);
  capFan(rings[rings.length - 1], false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  // ensure outward winding (front faces visible): flip if the first normal points inward
  return g;
}

function wingGeo(span, rootChord, tipChord, sweep, thick) {
  const sh = new THREE.Shape();
  sh.moveTo(0, -rootChord * 0.5);
  sh.lineTo(span, -rootChord * 0.5 + sweep);
  sh.lineTo(span, -rootChord * 0.5 + sweep + tipChord);
  sh.lineTo(0, rootChord * 0.5);
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.05, bevelSegments: 1 });
  g.translate(0, 0, -thick / 2);
  g.rotateX(Math.PI / 2); // shape XY -> XZ plane
  return g;
}

export function buildShip(material, glassMaterial, outlineMaterial) {
  const group = new THREE.Group();
  const parts = [];
  const P = (geo, color, m, opts = {}) => parts.push(part(geo, color, { matrix: m, flat: opts.flat ?? true, emissive: opts.emissive }));

  // fuselage
  const hull = loft([
    { z: -6.3, w: 0.18, h: 0.14, y: 0.0 },
    { z: -5.4, w: 0.85, h: 0.62, y: 0.02 },
    { z: -3.6, w: 1.55, h: 1.15, y: 0.08 },
    { z: -1.2, w: 2.0, h: 1.45, y: 0.12 },
    { z: 1.6, w: 2.1, h: 1.42, y: 0.12 },
    { z: 3.6, w: 1.75, h: 1.15, y: 0.16 },
    { z: 4.9, w: 1.25, h: 0.82, y: 0.2 },
  ], 10, 2.8);
  P(hull, HULL, mat());
  // dorsal spine + stripes
  P(G.box(0.5, 0.25, 6.2), HULL2, mat([0, 0.78, 1.0]));
  P(G.box(2.12, 0.08, 0.5), ORANGE, mat([0, 0.12, -1.6]));
  P(G.box(1.62, 0.08, 0.4), ORANGE, mat([0, 0.1, -3.8], [0, 0, 0], [1, 1, 1]));
  P(G.box(0.12, 0.27, 4.0), ORANGE, mat([0, 0.8, 1.3]));
  // underside keel + intakes
  P(G.box(1.2, 0.3, 6.5), DARK, mat([0, -0.62, 0.2]));
  for (const s of [-1, 1]) {
    P(G.box(0.25, 0.5, 1.6), DARKER, mat([1.0 * s, -0.1, -1.4], [0, 0.12 * s, 0]));
    // wings
    const w = wingGeo(3.9, 3.4, 1.2, 2.2, 0.16);
    const wm = mat([0.85 * s, -0.12, 0.9], [0, 0, (s > 0 ? -0.07 : 0.07)], [s, 1, 1]);
    P(w, HULL, wm);
    P(G.box(2.6, 0.06, 0.32), ORANGE, mat([2.5 * s, -0.02, 1.0], [0, -0.48 * s, 0]));
    // wingtip pods + nav lights
    P(G.cyl(0.14, 0.14, 1.6, 8), HULL2, mat([4.75 * s, -0.4, 2.3], [Math.PI / 2, 0, 0]));
    P(G.sphere(0.1, 8, 6), s > 0 ? 0x44ff77 : 0xff3a3a, mat([4.75 * s, -0.4, 1.45]), { emissive: 3, flat: false });
    // engine nacelles
    P(G.cyl(0.52, 0.46, 3.4, 12), HULL2, mat([1.3 * s, 0.1, 2.7], [Math.PI / 2, 0, 0]));
    P(G.cyl(0.55, 0.55, 0.35, 12), DARK, mat([1.3 * s, 0.1, 1.15], [Math.PI / 2, 0, 0]));
    P(G.cyl(0.5, 0.58, 0.5, 12), DARKER, mat([1.3 * s, 0.1, 4.55], [Math.PI / 2, 0, 0]));
    P(G.cyl(0.36, 0.36, 0.05, 12), 0x7fdcff, mat([1.3 * s, 0.1, 4.78], [Math.PI / 2, 0, 0]), { emissive: 2.2 });
    P(G.box(0.08, 0.06, 2.6), ORANGE, mat([1.3 * s + 0.5 * s, 0.1, 2.7]));
    // tail fins
    const fin = new THREE.Shape();
    fin.moveTo(0, 0); fin.lineTo(1.7, 0); fin.lineTo(2.2, 1.6); fin.lineTo(1.5, 1.7); fin.closePath();
    const fg = new THREE.ExtrudeGeometry(fin, { depth: 0.12, bevelEnabled: false });
    fg.translate(0, 0, -0.06);
    fg.rotateY(-Math.PI / 2);
    P(fg, HULL, mat([0.62 * s, 0.6, 2.8], [0, 0, -0.3 * s]));
    P(G.box(0.14, 0.18, 0.7), ORANGE, mat([0.62 * s + 0.42 * s, 1.95, 4.7], [0, 0, -0.3 * s]));
  }
  // cockpit frame + antenna
  P(G.box(1.25, 0.12, 0.2), DARK, mat([0, 0.83, -1.05]));
  P(G.cyl(0.02, 0.02, 0.9, 5), DARK, mat([0.3, 1.3, 2.4], [0.25, 0, 0]));
  P(G.sphere(0.05, 6, 4), 0xff5533, mat([0.3, 1.74, 2.52]), { emissive: 3, flat: false });
  // nose sensor
  P(G.cone(0.12, 0.6, 8), DARK, mat([0, 0.0, -6.55], [-Math.PI / 2, 0, 0]));
  // landing lights
  P(G.box(0.3, 0.06, 0.08), 0xfff4d0, mat([0, -0.45, -4.9]), { emissive: 2.0 });

  const geo = mergeParts(parts);
  const hullMesh = outlined(geo, material, outlineMaterial);
  group.add(hullMesh);

  // canopy glass
  const cg = new THREE.SphereGeometry(1, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  const canopyGeo = mergeParts([part(cg, GLASS, { matrix: mat([0, 0.62, -2.35], [0, 0, 0], [0.66, 0.62, 1.8]), emissive: 0.04 })]);
  const canopy = outlined(canopyGeo, glassMaterial, outlineMaterial);
  group.add(canopy);

  // landing gear: pivoting legs
  const legs = [];
  const legDefs = [
    { p: [0, -0.62, -3.6], len: 1.35 },
    { p: [-1.35, -0.4, 2.3], len: 1.55 },
    { p: [1.35, -0.4, 2.3], len: 1.55 },
  ];
  for (const d of legDefs) {
    const lp = [];
    lp.push(part(G.cyl(0.09, 0.07, d.len, 8), DARK, { matrix: mat([0, -d.len / 2, 0]) }));
    lp.push(part(G.cyl(0.13, 0.13, d.len * 0.45, 8), HULL2, { matrix: mat([0, -d.len * 0.25, 0]) }));
    lp.push(part(G.cyl(0.32, 0.38, 0.12, 12), DARKER, { matrix: mat([0, -d.len, 0]) }));
    lp.push(part(G.box(0.08, 0.3, 0.08), ORANGE, { matrix: mat([0, -d.len * 0.6, -0.1]) }));
    const lgeo = mergeParts(lp);
    const pivot = new THREE.Group();
    pivot.position.set(...d.p);
    const leg = outlined(lgeo, material, outlineMaterial);
    pivot.add(leg);
    group.add(pivot);
    legs.push({ pivot, len: d.len, base: d.p });
  }
  const gearHeight = 0.62 + 1.35 + 0.06; // origin height above ground when landed

  // engine exhaust flames (additive)
  const flameMat = createFlameMaterial(0x6fd0ff);
  const fgeo = new THREE.ConeGeometry(0.42, 1, 14, 1, true);
  fgeo.rotateX(Math.PI);
  fgeo.translate(0, -0.5, 0);
  const flames = [];
  for (const s of [-1, 1]) {
    const f = new THREE.Mesh(fgeo, flameMat);
    f.position.set(1.3 * s, 0.1, 4.8);
    f.rotation.x = -Math.PI / 2; // flame points along +Z
    f.frustumCulled = false;
    group.add(f);
    flames.push(f);
  }
  // atmospheric entry plasma shell
  const heatMat = new THREE.ShaderMaterial({
    uniforms: { uHeat: { value: 0 }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main() {
        vP = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <logdepthbuf_pars_fragment>
      uniform float uHeat; uniform float uTime;
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main() {
        #include <logdepthbuf_fragment>
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
        float front = smoothstep(4.0, -7.0, vP.z);
        float flick = 0.7 + 0.3 * sin(uTime * 37.0 + vP.z * 3.0 + vP.x * 5.0);
        float a = uHeat * (f * 0.8 + front * 0.6) * flick;
        vec3 c = mix(vec3(1.0, 0.35, 0.08), vec3(1.0, 0.85, 0.5), front) * a * 2.5;
        gl_FragColor = vec4(c, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const heatGeo = new THREE.SphereGeometry(1, 24, 16);
  heatGeo.scale(5.4, 2.2, 8.0);
  heatGeo.translate(0, 0, -0.6);
  const heat = new THREE.Mesh(heatGeo, heatMat);
  heat.visible = false;
  heat.frustumCulled = false;
  group.add(heat);

  return { group, legs, flames, flameMat, heatShell: heat, heatMat, gearHeight, hullMesh };
}
