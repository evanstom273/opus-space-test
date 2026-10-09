// Ambient weather particles (snow, dust, embers, spores, pollen) as tiny 3D
// instanced shapes, animated on the GPU and wrapped in a box around the camera.
import * as THREE from 'three';
import { ATMO_PARS } from '../render/shaders.js';

const PRESETS = {
  pollen: { count: 500, color: [1.0, 0.85, 0.45], emit: 0.6, size: 0.05, wind: [0.6, 0.15, 0.3], fall: -0.05, swirl: 0.6, box: 50 },
  dust: { count: 1600, color: [0.85, 0.6, 0.38], emit: 0.0, size: 0.05, wind: [7.0, 0.4, 2.5], fall: 0.1, swirl: 1.2, box: 60, stretch: 4 },
  snow: { count: 1800, color: [0.95, 0.97, 1.0], emit: 0.15, size: 0.06, wind: [1.2, 0, 0.6], fall: 1.4, swirl: 0.8, box: 55 },
  embers: { count: 900, color: [1.0, 0.45, 0.12], emit: 3.5, size: 0.05, wind: [0.8, 0, 0.4], fall: -1.2, swirl: 1.0, box: 55, ash: true },
  spores: { count: 700, color: [0.45, 1.0, 0.9], emit: 2.2, size: 0.05, wind: [0.3, 0, 0.2], fall: -0.15, swirl: 0.7, box: 50, alt: [1.0, 0.5, 0.95] },
};

export class Weather {
  constructor(scene, env) {
    this.scene = scene;
    this.env = env;
    this.systems = {};
    this.current = null;
    this.time = 0;
    const geo = new THREE.OctahedronGeometry(1, 0);
    for (const [name, p] of Object.entries(PRESETS)) {
      const seeds = new Float32Array(p.count * 4);
      for (let i = 0; i < p.count * 4; i++) seeds[i] = Math.random();
      const g = new THREE.InstancedBufferGeometry();
      g.index = geo.index;
      g.attributes.position = geo.attributes.position;
      g.attributes.normal = geo.attributes.normal;
      g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
      g.instanceCount = p.count;
      const mat = new THREE.ShaderMaterial({
        uniforms: Object.assign({}, env, {
          uCamLocal: { value: new THREE.Vector3() },
          uRot: { value: new THREE.Matrix3() },
          uDown: { value: new THREE.Vector3(0, -1, 0) },
          uT: { value: 0 },
          uBox: { value: p.box },
          uWind: { value: new THREE.Vector3(...p.wind) },
          uFall: { value: p.fall },
          uSwirl: { value: p.swirl },
          uSize: { value: p.size },
          uStretch: { value: p.stretch || 1 },
          uCol: { value: new THREE.Vector3(...p.color) },
          uCol2: { value: new THREE.Vector3(...(p.alt || p.color)) },
          uEmit: { value: p.emit },
          uAsh: { value: p.ash ? 1 : 0 },
          uFade: { value: 1 },
        }),
        vertexShader: /* glsl */ `
          #include <common>
          #include <logdepthbuf_pars_vertex>
          ${ATMO_PARS}
          attribute vec4 aSeed;
          uniform vec3 uCamLocal; uniform mat3 uRot; uniform vec3 uDown;
          uniform float uT; uniform float uBox; uniform vec3 uWind; uniform float uFall; uniform float uSwirl;
          uniform float uSize; uniform float uStretch; uniform vec3 uCol; uniform vec3 uCol2; uniform float uEmit; uniform float uAsh; uniform float uFade;
          varying vec3 vCol; varying float vA;
          void main() {
            bool ash = uAsh > 0.5 && aSeed.w > 0.55;
            float fall = ash ? 0.9 : uFall;
            vec3 vel = uWind * (0.6 + aSeed.w * 0.8) + uDown * fall;
            vec3 p = aSeed.xyz * uBox + vel * uT;
            p += vec3(sin(uT * 0.7 + aSeed.w * 30.0), cos(uT * 0.5 + aSeed.x * 20.0), sin(uT * 0.6 + aSeed.y * 25.0)) * uSwirl;
            // wrap into a box centred on the camera (planet-local frame)
            p = mod(p - uCamLocal + uBox * 0.5, uBox) - uBox * 0.5;
            float edge = 1.0 - smoothstep(uBox * 0.35, uBox * 0.5, length(p));
            float s = uSize * (0.6 + aSeed.w * 0.8) * edge * uFade;
            vec3 local = position * s;
            // stretch along wind direction for streaky dust
            vec3 wd = normalize(vel + 1e-4);
            local += wd * dot(position, vec3(0.0, 1.0, 0.0)) * s * (uStretch - 1.0);
            vec3 wp = uRot * (p + local);
            vec4 mv = viewMatrix * vec4(wp, 1.0);
            gl_Position = projectionMatrix * mv;
            #include <logdepthbuf_vertex>
            vec3 sun = sunLightAt(wp);
            vec3 base = mix(uCol, uCol2, step(0.5, aSeed.x));
            if (ash) base = vec3(0.25, 0.23, 0.22);
            float em = ash ? 0.0 : uEmit;
            vCol = base * (ambientAt(wp, vec3(0.0, 1.0, 0.0)) + sun * 0.8) + base * em;
            vA = edge;
          }
        `,
        fragmentShader: /* glsl */ `
          #include <logdepthbuf_pars_fragment>
          varying vec3 vCol; varying float vA;
          void main() {
            #include <logdepthbuf_fragment>
            if (vA < 0.01) discard;
            gl_FragColor = vec4(vCol, 1.0);
          }
        `,
      });
      const mesh = new THREE.Mesh(g, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      scene.add(mesh);
      this.systems[name] = { mesh, mat };
    }
  }

  update(dt, game, planet) {
    this.time += dt;
    for (const s of Object.values(this.systems)) s.mesh.visible = false;
    if (!planet) return;
    const camLocal = planet.worldToLocal(game.camWorld, new THREE.Vector3());
    const alt = camLocal.length() - planet.R;
    const fade = 1 - THREE.MathUtils.smoothstep(alt, 150, 400);
    if (fade <= 0) return;
    const sys = this.systems[planet.def.weather];
    if (!sys) return;
    sys.mesh.visible = true;
    const u = sys.mat.uniforms;
    u.uCamLocal.value.copy(camLocal);
    u.uT.value = this.time;
    u.uFade.value = fade;
    u.uDown.value.copy(camLocal).normalize().negate();
    const m4 = new THREE.Matrix4().makeRotationFromQuaternion(planet.quat);
    u.uRot.value.setFromMatrix4(m4);
    // particles are rendered relative to the camera (floating origin), so the
    // box centre must map to render-space origin: offset handled in shader
  }
}
