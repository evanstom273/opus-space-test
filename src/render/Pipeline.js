// Renderer, HDR composer with bloom + ACES tonemapping, and the sun shadow light.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Q } from '../core/quality.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.32 },
    uHeat: { value: 0 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    uniform float uHeat;
    uniform float uTime;
    varying vec2 vUv;
    void main() {
      vec2 uv = vUv;
      if (uHeat > 0.0) {
        uv.x += sin(uv.y * 60.0 + uTime * 30.0) * 0.0015 * uHeat;
      }
      vec4 c = texture2D(tDiffuse, uv);
      vec2 d = vUv - 0.5;
      float v = 1.0 - dot(d, d) * uVignette * 2.0;
      c.rgb *= v;
      c.rgb += vec3(1.0, 0.35, 0.1) * uHeat * 0.08 * smoothstep(0.2, 0.7, length(d));
      gl_FragColor = c;
    }
  `,
};

export class Pipeline {
  constructor(container) {
    this.container = container;
    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      logarithmicDepthBuffer: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    const params = new URLSearchParams(location.search);
    this.lowres = params.has('lowres');
    this.maxPixelRatio = this.lowres ? 0.5 : Math.min(window.devicePixelRatio || 1, Q.pixelRatioMax);
    this.pixelRatio = this.maxPixelRatio;
    this.adapt = { t: 0, frames: 0, time: 0, cooldown: 4, enabled: !params.has('fixeddt') };
    renderer.setPixelRatio(this.pixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = Q.shadows;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.08, 3e6);
    this.scene.add(this.camera);

    // Sun shadow light; direction is updated each frame from the sun to the focus.
    const light = new THREE.DirectionalLight(0xffffff, 0.0);
    light.castShadow = Q.shadows;
    light.shadow.mapSize.set(Q.shadowSize, Q.shadowSize);
    light.shadow.bias = -0.0004;
    light.shadow.normalBias = 0.04;
    light.shadow.radius = 1.5;
    const sc = light.shadow.camera;
    sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 900;
    this.scene.add(light);
    this.scene.add(light.target);
    this.sunLight = light;
    this.shadowExtent = 45;

    const size = new THREE.Vector2(window.innerWidth, window.innerHeight);
    const rt = new THREE.WebGLRenderTarget(size.x * this.pixelRatio, size.y * this.pixelRatio, {
      type: THREE.HalfFloatType,
      samples: this.lowres ? 0 : Q.msaa,
    });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.grade = new ShaderPass(GradeShader);
    if (Q.bloom) {
      this.bloom = new UnrealBloomPass(size, 0.42, 0.55, 2.6);
      this.composer.addPass(this.bloom);
      this.composer.addPass(this.grade);
    }
    this.composer.addPass(new OutputPass());

    window.addEventListener('resize', () => this.resize());
  }

  // Adaptive resolution: drop the render scale when the frame rate sags,
  // raise it again when there is headroom.
  adaptResolution(rawDt) {
    const a = this.adapt;
    if (!a.enabled) return;
    a.frames++;
    a.time += rawDt;
    a.cooldown -= rawDt;
    if (a.time < 2) return;
    const fps = a.frames / a.time;
    a.frames = 0;
    a.time = 0;
    if (a.cooldown > 0) return;
    let pr = this.pixelRatio;
    if (fps < 42) pr = Math.max(Q.pixelRatioMin, pr * (fps < 28 ? 0.75 : 0.87));
    else if (fps > 57) pr = Math.min(this.maxPixelRatio, pr * 1.1);
    if (Math.abs(pr - this.pixelRatio) > 0.01) {
      this.pixelRatio = pr;
      this.renderer.setPixelRatio(pr);
      this.composer.setPixelRatio(pr);
      this.resize();
      a.cooldown = 3;
    }
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  // Place the shadow camera around a focus point (render space), snapped to
  // texels to avoid shimmering.
  updateShadow(focus, sunDir, extent) {
    const light = this.sunLight;
    if (extent !== this.shadowExtent) {
      const sc = light.shadow.camera;
      sc.left = -extent; sc.right = extent; sc.top = extent; sc.bottom = -extent;
      sc.updateProjectionMatrix();
      this.shadowExtent = extent;
    }
    const texel = (extent * 2) / light.shadow.mapSize.x;
    // build a light-space basis to snap the focus
    const fwd = sunDir.clone().negate();
    const up = Math.abs(fwd.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, fwd).normalize();
    const up2 = new THREE.Vector3().crossVectors(fwd, right);
    const x = Math.round(focus.dot(right) / texel) * texel;
    const y = Math.round(focus.dot(up2) / texel) * texel;
    const z = focus.dot(fwd);
    const snapped = right.multiplyScalar(x).add(up2.multiplyScalar(y)).add(fwd.multiplyScalar(z));
    light.target.position.copy(snapped);
    light.position.copy(snapped).addScaledVector(sunDir, 450);
    light.target.updateMatrixWorld();
  }

  render(dt) {
    this.grade.uniforms.uTime.value += dt;
    this.composer.render(dt);
  }
}
