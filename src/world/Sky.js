// Background starfield, nebula band and the sun (a real sphere plus a glow shell).
import * as THREE from 'three';
import { mulberry32 } from '../core/noise.js';
import { ATMO_PARS, NOISE_GLSL } from '../render/shaders.js';

const STAR_R = 900000;

export class Sky {
  constructor(scene, camEnv, sunDef) {
    this.group = new THREE.Group();
    this.group.name = 'sky';
    scene.add(this.group);
    this._buildNebula();
    this._buildStars();
    this._buildSun(scene, camEnv, sunDef);
  }

  _buildStars() {
    const rand = mulberry32(777);
    const count = 9000;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const tmp = new THREE.Color();
    for (let i = 0; i < count; i++) {
      // concentrate some stars along a galactic band
      let x, y, z;
      const u = rand() * 2 - 1, t = rand() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      x = s * Math.cos(t); y = u; z = s * Math.sin(t);
      if (rand() < 0.45) { y *= 0.18; const l = Math.hypot(x, y, z); x /= l; y /= l; z /= l; }
      // tilt band
      const yy = y * 0.88 - z * 0.47, zz = y * 0.47 + z * 0.88;
      pos[i * 3] = x * STAR_R; pos[i * 3 + 1] = yy * STAR_R; pos[i * 3 + 2] = zz * STAR_R;
      const temp = rand();
      if (temp < 0.15) tmp.setRGB(1.0, 0.75, 0.55);
      else if (temp < 0.35) tmp.setRGB(0.7, 0.8, 1.0);
      else tmp.setRGB(1, 0.97, 0.92);
      const b = Math.pow(rand(), 3.5);
      const intensity = 0.2 + b * 2.2;
      col[i * 3] = tmp.r * intensity; col[i * 3 + 1] = tmp.g * intensity; col[i * 3 + 2] = tmp.b * intensity;
      size[i] = 1.0 + b * 2.6;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    this.starMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 } },
      vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        attribute vec3 aCol;
        attribute float aSize;
        uniform float uTime;
        uniform float uPixelRatio;
        varying vec3 vCol;
        void main() {
          float tw = 0.8 + 0.2 * sin(uTime * 2.0 + position.x * 0.001 + position.z * 0.0013);
          vCol = aCol * tw;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uPixelRatio;
          #include <logdepthbuf_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        #include <logdepthbuf_pars_fragment>
        varying vec3 vCol;
        void main() {
          #include <logdepthbuf_fragment>
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          float a = smoothstep(0.5, 0.1, d);
          gl_FragColor = vec4(vCol * a, 1.0);
        }
      `,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      transparent: false,
    });
    this.stars = new THREE.Points(geo, this.starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -9;
    this.group.add(this.stars);
  }

  _buildNebula() {
    const geo = new THREE.SphereGeometry(STAR_R * 1.05, 48, 32);
    this.nebulaMat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          #include <logdepthbuf_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        #include <logdepthbuf_pars_fragment>
        ${NOISE_GLSL}
        varying vec3 vDir;
        void main() {
          #include <logdepthbuf_fragment>
          vec3 d = normalize(vDir);
          // tilted galactic band
          float band = d.y * 0.88 - d.z * 0.47;
          float bandMask = exp(-band * band * 18.0);
          float n = snoise(d * 2.2) * 0.5 + snoise(d * 5.1) * 0.3 + snoise(d * 11.0) * 0.2;
          float n2 = snoise(d * 3.3 + 7.0);
          vec3 c1 = vec3(0.10, 0.05, 0.20);
          vec3 c2 = vec3(0.02, 0.09, 0.16);
          vec3 c3 = vec3(0.20, 0.07, 0.10);
          vec3 col = mix(c1, c2, smoothstep(-0.4, 0.4, n2));
          col = mix(col, c3, smoothstep(0.3, 0.8, n) * 0.6);
          float neb = smoothstep(-0.2, 0.7, n) * (0.25 + bandMask * 0.9);
          vec3 outc = col * neb * 0.55 + vec3(0.006, 0.007, 0.012);
          float dust = smoothstep(0.1, 0.6, snoise(d * 7.0 + 3.0)) * bandMask;
          outc *= 1.0 - dust * 0.6;
          gl_FragColor = vec4(outc, 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.nebula = new THREE.Mesh(geo, this.nebulaMat);
    this.nebula.frustumCulled = false;
    this.nebula.renderOrder = -10;
    this.group.add(this.nebula);
  }

  _buildSun(scene, camEnv, sunDef) {
    const geo = new THREE.SphereGeometry(sunDef.radius, 48, 32);
    this.sunMat = new THREE.ShaderMaterial({
      uniforms: Object.assign({}, camEnv, { uCore: { value: new THREE.Vector3(...sunDef.color).multiplyScalar(60) } }),
      vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        varying vec3 vN;
        varying vec3 vWorldPos;
        void main() {
          vN = normalize(mat3(modelMatrix) * normal);
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
          #include <logdepthbuf_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        ${ATMO_PARS}
        uniform vec3 uCore;
        varying vec3 vN;
        varying vec3 vWorldPos;
        void main() {
          #include <logdepthbuf_fragment>
          vec3 V = normalize(cameraPosition - vWorldPos);
          float limb = pow(max(dot(normalize(vN), V), 0.0), 0.4);
          vec3 c = uCore * (0.55 + 0.45 * limb);
          // colour the disc by the atmosphere we look through (redder near the horizon)
          vec3 rd = -V;
          vec3 ins, tr;
          atmoScatter(cameraPosition, rd, 1e7, 8, ins, tr);
          float avg = max(dot(tr, vec3(0.3333)), 1e-3);
          c *= tr / avg;
          gl_FragColor = vec4(c, 1.0);
        }
      `,
    });
    this.sun = new THREE.Mesh(geo, this.sunMat);
    this.sun.frustumCulled = false;
    scene.add(this.sun);

    const glowGeo = new THREE.SphereGeometry(sunDef.radius * 9, 32, 24);
    this.glowMat = new THREE.ShaderMaterial({
      uniforms: { uSunCenter: { value: new THREE.Vector3() }, uColor: { value: new THREE.Vector3(...sunDef.color) }, uRadius: { value: sunDef.radius } },
      vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        varying vec3 vWorldPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
          #include <logdepthbuf_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        #include <logdepthbuf_pars_fragment>
        uniform vec3 uSunCenter;
        uniform vec3 uColor;
        uniform float uRadius;
        varying vec3 vWorldPos;
        void main() {
          #include <logdepthbuf_fragment>
          vec3 rd = normalize(vWorldPos - cameraPosition);
          vec3 sd = normalize(uSunCenter - cameraPosition);
          float ang = acos(clamp(dot(rd, sd), -1.0, 1.0));
          float sunAng = uRadius / length(uSunCenter - cameraPosition);
          float x = ang / sunAng;
          float g = exp(-max(x - 1.0, 0.0) * 0.9) * 1.2 + 0.25 / (1.0 + x * x * 0.08);
          gl_FragColor = vec4(uColor * g * 1.6, 1.0);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
    });
    this.glow = new THREE.Mesh(glowGeo, this.glowMat);
    this.glow.frustumCulled = false;
    scene.add(this.glow);
  }

  update(sunRenderPos, time, pixelRatio) {
    this.sun.position.copy(sunRenderPos);
    this.glow.position.copy(sunRenderPos);
    this.glowMat.uniforms.uSunCenter.value.copy(sunRenderPos);
    this.starMat.uniforms.uTime.value = time;
    this.starMat.uniforms.uPixelRatio.value = pixelRatio;
  }
}
