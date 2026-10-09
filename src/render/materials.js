// Material factories. Every lit surface uses one cel-shading model with
// per-fragment sun direction (so distant planets light correctly), sun shadows,
// sky ambient and per-vertex atmospheric scattering for aerial perspective.
import * as THREE from 'three';
import { ATMO_PARS, CEL_FUNCS, SHADOW_FRAG, NOISE_GLSL } from './shaders.js';

export function createEnv() {
  return {
    uSunPos: { value: new THREE.Vector3() },
    uSunColor: { value: new THREE.Vector3(1, 1, 1) },
    uPlanetCenter: { value: new THREE.Vector3(1e9, 0, 0) },
    uPlanetRotInv: { value: new THREE.Matrix3() },
    uPlanetRadius: { value: 1 },
    uAtmoRadius: { value: 1 },
    uAtmoBase: { value: 1 },
    uScaleH: { value: 1 },
    uBetaR: { value: new THREE.Vector3() },
    uBetaM: { value: 0 },
    uMieG: { value: 0.76 },
    uAtmoSun: { value: 10 },
    uAtmoOn: { value: 0 },
    uAtmoTint: { value: new THREE.Vector3(1, 1, 1) },
    uSkyAmbient: { value: new THREE.Vector3() },
    uGroundAmbient: { value: new THREE.Vector3() },
    uNightAmbient: { value: new THREE.Vector3(0.02, 0.025, 0.04) },
    uTime: { value: 0 },
    uEmissive: { value: new THREE.Vector3() },
  };
}

export function copyEnv(dst, src) {
  for (const k in src) {
    const v = src[k].value;
    if (v && v.copy) dst[k].value.copy(v);
    else dst[k].value = v;
  }
}

function lightsUniforms() {
  return THREE.UniformsUtils.clone(THREE.UniformsLib.lights);
}

const CEL_VERT = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
${ATMO_PARS}
attribute vec4 aColor;
uniform float uWind;
varying vec3 vNormalW;
varying vec3 vWorldPos;
varying vec4 vColor;
varying vec3 vSunCol;
varying vec3 vAmb;
varying vec3 vInscatter;
varying vec3 vTransmit;
varying vec3 vLocalPos;

void main() {
  vColor = aColor;
  #ifdef USE_INSTANCING_COLOR
    vColor.rgb *= instanceColor;
  #endif
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  #ifdef USE_WIND
    vec3 ip = vec3(0.0);
    #ifdef USE_INSTANCING
      ip = instanceMatrix[3].xyz;
    #endif
    float ph = dot(ip, vec3(0.13, 0.17, 0.11));
    float bend = max(transformed.y, 0.0);
    bend *= bend;
    transformed.x += sin(uTime * 1.6 + ph) * uWind * bend;
    transformed.z += cos(uTime * 1.3 + ph * 1.3) * uWind * bend * 0.7;
  #endif
  #include <project_vertex>
  #include <logdepthbuf_vertex>
  vec4 worldPosition = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    worldPosition = instanceMatrix * worldPosition;
  #endif
  worldPosition = modelMatrix * worldPosition;
  #include <shadowmap_vertex>
  vWorldPos = worldPosition.xyz;
  vNormalW = normalize(inverseTransformDirection(transformedNormal, viewMatrix));
  vLocalPos = uPlanetRotInv * (worldPosition.xyz - uPlanetCenter);
  vSunCol = sunLightAt(worldPosition.xyz);
  vAmb = ambientAt(worldPosition.xyz, vNormalW);
  vec3 toV = worldPosition.xyz - cameraPosition;
  float dist = length(toV);
  atmoScatter(cameraPosition, toV / max(dist, 1e-4), dist, 6, vInscatter, vTransmit);
}
`;

const CEL_FRAG = /* glsl */ `
#include <common>
#include <packing>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
${ATMO_PARS}
${CEL_FUNCS}
${SHADOW_FRAG}
uniform vec3 uColor;
uniform vec3 uEmissive;
uniform float uEmitScale;
uniform float uEmitUniform;
uniform float uRim;
uniform float uGloss;
uniform float uDetail;
varying vec3 vNormalW;
varying vec3 vWorldPos;
varying vec4 vColor;
varying vec3 vSunCol;
varying vec3 vAmb;
varying vec3 vInscatter;
varying vec3 vTransmit;
varying vec3 vLocalPos;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

void main() {
  #include <logdepthbuf_fragment>
  vec3 albedo = vColor.rgb * uColor;
  #ifdef USE_DETAIL
    // subtle fine-grain variation on terrain, fades with distance
    float dd = length(cameraPosition - vWorldPos);
    vec3 lp = floor(vLocalPos * 1.3);
    float n = hash13(lp) - 0.5;
    albedo *= 1.0 + n * uDetail * (1.0 - smoothstep(20.0, 80.0, dd));
  #endif
  vec3 N = normalize(vNormalW);
  if (!gl_FrontFacing) N = -N;
  vec3 L = normalize(uSunPos - vWorldPos);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float ndl = dot(N, L);
  float sh = sampleSunShadow();
  float lit = celRamp(ndl) * sh;
  vec3 col = albedo * (vAmb + vSunCol * lit);
  float fres = 1.0 - max(dot(N, V), 0.0);
  float rim = smoothstep(0.6, 0.8, fres) * uRim;
  col += albedo * rim * (vSunCol * smoothstep(-0.3, 0.4, ndl) * (0.4 + 0.6 * sh) + vAmb * 0.6);
  if (uGloss > 0.0) {
    vec3 H = normalize(L + V);
    float sp = pow(max(dot(N, H), 0.0), 80.0);
    col += vSunCol * smoothstep(0.45, 0.55, sp) * uGloss * sh;
  }
  col += mix(vColor.rgb, uEmissive, uEmitUniform) * vColor.a * uEmitScale;
  col = col * vTransmit + vInscatter;
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createCelMaterial(env, opts = {}) {
  const uniforms = Object.assign(lightsUniforms(), env, {
    uColor: { value: new THREE.Color(opts.color ?? 0xffffff) },
    uEmitScale: { value: opts.emitScale ?? 3.0 },
    uEmitUniform: { value: opts.emitUniform ? 1 : 0 },
    uRim: { value: opts.rim ?? 0.4 },
    uGloss: { value: opts.gloss ?? 0 },
    uWind: { value: opts.wind ?? 0 },
    uDetail: { value: opts.detail ?? 0 },
  });
  const defines = {};
  if (opts.wind) defines.USE_WIND = '';
  if (opts.detail) defines.USE_DETAIL = '';
  const mat = new THREE.ShaderMaterial({
    uniforms, defines,
    vertexShader: CEL_VERT,
    fragmentShader: CEL_FRAG,
    lights: true,
    side: opts.side ?? THREE.FrontSide,
  });
  mat.isCel = true;
  return mat;
}

// Inverted-hull outline for strong silhouettes.
const OUTLINE_VERT = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
${ATMO_PARS}
attribute vec3 aONormal;
uniform float uWidth;
uniform float uWind;
uniform float uFar;
varying vec3 vInscatter;
varying vec3 vTransmit;
varying float vFade;
void main() {
  #include <beginnormal_vertex>
  objectNormal = aONormal;
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  vec4 wp0 = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    wp0 = instanceMatrix * wp0;
  #endif
  wp0 = modelMatrix * wp0;
  float dist = length(wp0.xyz - cameraPosition);
  float w = uWidth * clamp(dist / 12.0, 1.0, 5.0) * (1.0 - smoothstep(uFar * 0.6, uFar, dist));
  vFade = 1.0 - smoothstep(uFar * 0.6, uFar, dist);
  transformed += normalize(objectNormal) * w;
  #ifdef USE_WIND
    vec3 ip = vec3(0.0);
    #ifdef USE_INSTANCING
      ip = instanceMatrix[3].xyz;
    #endif
    float ph = dot(ip, vec3(0.13, 0.17, 0.11));
    float bend = max(transformed.y, 0.0);
    bend *= bend;
    transformed.x += sin(uTime * 1.6 + ph) * uWind * bend;
    transformed.z += cos(uTime * 1.3 + ph * 1.3) * uWind * bend * 0.7;
  #endif
  #include <project_vertex>
  #include <logdepthbuf_vertex>
  vec4 wp = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    wp = instanceMatrix * wp;
  #endif
  wp = modelMatrix * wp;
  vec3 toV = wp.xyz - cameraPosition;
  float d = length(toV);
  atmoScatter(cameraPosition, toV / max(d, 1e-4), d, 4, vInscatter, vTransmit);
}
`;

const OUTLINE_FRAG = /* glsl */ `
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
varying vec3 vInscatter;
varying vec3 vTransmit;
varying float vFade;
void main() {
  #include <logdepthbuf_fragment>
  if (vFade <= 0.001) discard;
  gl_FragColor = vec4(uColor * vTransmit + vInscatter, 1.0);
}
`;

export function createOutlineMaterial(env, opts = {}) {
  const uniforms = Object.assign({}, env, {
    uColor: { value: new THREE.Color(opts.color ?? 0x0b0a10) },
    uWidth: { value: opts.width ?? 0.03 },
    uWind: { value: opts.wind ?? 0 },
    uFar: { value: opts.far ?? 400 },
  });
  const defines = {};
  if (opts.wind) defines.USE_WIND = '';
  return new THREE.ShaderMaterial({
    uniforms, defines,
    vertexShader: OUTLINE_VERT,
    fragmentShader: OUTLINE_FRAG,
    side: THREE.BackSide,
  });
}

// Liquid / frozen surfaces: water, ice, lava and glowing water.
const WATER_VERT = /* glsl */ `
#include <common>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
${ATMO_PARS}
attribute float aDepth;
varying float vDepth;
varying vec3 vWorldPos;
varying vec3 vLocalPos;
varying vec3 vInscatter;
varying vec3 vTransmit;
varying vec3 vSunCol;
varying vec3 vAmb;
varying vec3 vUp;
uniform float uWaveAmp;
void main() {
  vDepth = aDepth;
  vec3 transformed = position;
  vec4 wp0 = modelMatrix * vec4(transformed, 1.0);
  vec3 lp = uPlanetRotInv * (wp0.xyz - uPlanetCenter);
  vec3 upL = normalize(lp);
  float w = sin(dot(lp, vec3(0.21, 0.13, 0.17)) + uTime * 1.1) * 0.5 + sin(dot(lp, vec3(-0.09, 0.23, 0.11)) + uTime * 1.7) * 0.35;
  float amp = uWaveAmp * smoothstep(0.0, 3.0, aDepth);
  vec3 objUp = normalize((inverse(modelMatrix) * vec4(normalize(wp0.xyz - uPlanetCenter), 0.0)).xyz);
  transformed += objUp * w * amp;
  vec3 objectNormal = objUp;
  vec3 transformedNormal = normalMatrix * objectNormal;
  #include <project_vertex>
  #include <logdepthbuf_vertex>
  vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);
  #include <shadowmap_vertex>
  vWorldPos = worldPosition.xyz;
  vLocalPos = lp;
  vUp = normalize(worldPosition.xyz - uPlanetCenter);
  vSunCol = sunLightAt(worldPosition.xyz);
  vAmb = ambientAt(worldPosition.xyz, vUp);
  vec3 toV = worldPosition.xyz - cameraPosition;
  float dist = length(toV);
  atmoScatter(cameraPosition, toV / max(dist, 1e-4), dist, 6, vInscatter, vTransmit);
}
`;

const WATER_FRAG = /* glsl */ `
#include <common>
#include <packing>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
${ATMO_PARS}
${CEL_FUNCS}
${SHADOW_FRAG}
${NOISE_GLSL}
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uFoam;
uniform float uKind; // 0 water, 1 ice, 2 lava, 3 glow water
varying float vDepth;
varying vec3 vWorldPos;
varying vec3 vLocalPos;
varying vec3 vInscatter;
varying vec3 vTransmit;
varying vec3 vSunCol;
varying vec3 vAmb;
varying vec3 vUp;

void main() {
  #include <logdepthbuf_fragment>
  if (vDepth < -0.5) discard;
  vec3 L = normalize(uSunPos - vWorldPos);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float dist = length(cameraPosition - vWorldPos);
  vec3 lp = vLocalPos;
  float sh = sampleSunShadow();
  vec3 col;
  float alpha = 1.0;
  if (uKind < 0.5 || uKind > 2.5) {
    // water: ripple normal from noise, fades with distance
    float fd = 1.0 - smoothstep(30.0, 400.0, dist);
    float t = uTime * 0.6;
    vec3 q = lp * 0.18;
    float n1 = snoise(q + vec3(t, 0.0, t * 0.7));
    float n2 = snoise(q * 2.3 - vec3(t * 0.8, t * 0.5, 0.0));
    vec3 tA = normalize(cross(vUp, vec3(0.0, 1.0, 0.0001)));
    vec3 tB = cross(vUp, tA);
    vec3 N = normalize(vUp + (tA * n1 + tB * n2) * 0.12 * fd);
    float depthT = smoothstep(0.0, 14.0, vDepth);
    vec3 base = mix(uShallow, uDeep, depthT);
    float ndl = dot(N, L);
    col = base * (vAmb * 0.8 + vSunCol * (0.35 + 0.65 * celRamp(ndl)) * sh);
    float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
    col = mix(col, vAmb * 1.6 + vSunCol * 0.12, fres * 0.6);
    vec3 H = normalize(L + V);
    float sp = pow(max(dot(N, H), 0.0), 220.0);
    col += vSunCol * smoothstep(0.3, 0.5, sp) * 2.0 * sh;
    float foamN = snoise(lp * 0.35 + vec3(0.0, uTime * 0.4, 0.0));
    float foam = smoothstep(1.4, 0.4, vDepth + foamN * 0.5) * (1.0 - smoothstep(0.0, 0.2, -vDepth));
    col = mix(col, uFoam * (vAmb + vSunCol * 0.9), foam * 0.85);
    alpha = mix(0.55, 0.95, depthT) + foam * 0.3 + fres * 0.2;
    if (uKind > 2.5) {
      // bioluminescent water glows in the shallows and with ripples
      float glow = (1.0 - depthT) * 0.6 + smoothstep(0.55, 0.9, n1 * 0.5 + 0.5) * 0.5;
      col += uShallow * glow * 1.4;
    }
  } else if (uKind < 1.5) {
    // ice sheet with crack lines
    float n = snoise(lp * 0.05);
    float c1 = abs(snoise(lp * 0.09 + 3.0));
    float crack = 1.0 - smoothstep(0.0, 0.035, c1);
    vec3 base = mix(uShallow, uDeep, smoothstep(-0.4, 0.8, n));
    base = mix(base, uDeep * 0.6, crack * (1.0 - smoothstep(60.0, 300.0, dist)));
    vec3 N = vUp;
    float ndl = dot(N, L);
    col = base * (vAmb + vSunCol * celRamp(ndl) * sh);
    vec3 H = normalize(L + V);
    float sp = pow(max(dot(N, H), 0.0), 120.0);
    col += vSunCol * smoothstep(0.4, 0.6, sp) * 0.8 * sh;
  } else {
    // lava: flowing, emissive, with a dark cooling crust
    float t = uTime * 0.05;
    float n = snoise(lp * 0.04 + vec3(t, -t, t * 0.5));
    float n2 = snoise(lp * 0.12 - vec3(t * 2.0, 0.0, t));
    float crust = smoothstep(0.1, 0.5, n + n2 * 0.4);
    vec3 hot = mix(uShallow, uDeep, smoothstep(-0.6, 0.6, n2));
    vec3 emiss = hot * (3.0 - crust * 2.6);
    vec3 crustCol = vec3(0.05, 0.035, 0.03) * (vAmb + vSunCol * celRamp(dot(vUp, L)) * sh);
    col = mix(emiss, crustCol + hot * 0.25, crust * 0.85);
    float edge = smoothstep(2.0, 0.0, vDepth);
    col += uFoam * edge * 2.0;
  }
  col = col * vTransmit + vInscatter;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}
`;

export function createWaterMaterial(env, def) {
  const kinds = { water: 0, ice: 1, lava: 2, glow: 3 };
  const kind = kinds[def.sea] ?? 0;
  const transparent = kind === 0 || kind === 3;
  const uniforms = Object.assign(lightsUniforms(), env, {
    uShallow: { value: new THREE.Color(def.water.shallow) },
    uDeep: { value: new THREE.Color(def.water.deep) },
    uFoam: { value: new THREE.Color(def.water.foam) },
    uKind: { value: kind },
    uWaveAmp: { value: kind === 1 ? 0 : kind === 2 ? 0.4 : 0.35 },
  });
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    lights: true,
    transparent,
    depthWrite: true,
  });
}

// Atmosphere shell: rendered back-faces only, depth-tested so it fills the sky
// and planet limb; terrain carries its own per-vertex aerial perspective.
const ATMO_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
}
`;

const ATMO_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${ATMO_PARS}
uniform float uGroundRadius;
varying vec3 vWorldPos;
void main() {
  #include <logdepthbuf_fragment>
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWorldPos - ro);
  float tMax = length(vWorldPos - ro);
  vec2 tg = raySphere(ro, rd, uPlanetCenter, uGroundRadius);
  if (tg.x > 0.0) tMax = min(tMax, tg.x);
  vec3 ins, tr;
  atmoScatter(ro, rd, tMax, 12, ins, tr);
  // bright sky hides what lies behind it (stars, distant planets)
  float a = max(1.0 - dot(tr, vec3(0.3333)), smoothstep(0.0, 0.12, dot(ins, vec3(0.3, 0.5, 0.2))));
  // dithering to break up banding
  float dn = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  ins += dn * 0.004;
  gl_FragColor = vec4(max(ins, vec3(0.0)), clamp(a, 0.0, 1.0));
}
`;

export function createAtmosphereMaterial(env, groundRadius) {
  const uniforms = Object.assign({}, env, {
    uGroundRadius: { value: groundRadius },
  });
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: ATMO_VERT,
    fragmentShader: ATMO_FRAG,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  });
}

// Puffy cel clouds (opaque geometry with soft two-tone shading).
const CLOUD_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${ATMO_PARS}
uniform vec3 uColor;
uniform vec3 uShade;
varying vec3 vNormalW;
varying vec3 vWorldPos;
varying vec3 vSunCol;
varying vec3 vAmb;
varying vec3 vInscatter;
varying vec3 vTransmit;
varying vec4 vColor;
void main() {
  #include <logdepthbuf_fragment>
  vec3 N = normalize(vNormalW);
  vec3 L = normalize(uSunPos - vWorldPos);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float ndl = dot(N, L);
  float lit = smoothstep(-0.15, 0.05, ndl) * 0.6 + smoothstep(0.3, 0.45, ndl) * 0.4;
  vec3 base = mix(uShade * (vAmb * 1.4 + vSunCol * 0.25), uColor * (vAmb * 0.5 + vSunCol * 0.95), lit);
  float fres = 1.0 - max(dot(N, V), 0.0);
  base += uColor * vSunCol * smoothstep(0.55, 0.9, fres) * 0.35 * smoothstep(-0.4, 0.3, dot(V * -1.0, L));
  vec3 col = base * vTransmit + vInscatter;
  gl_FragColor = vec4(col, 1.0);
}
`;

export function createCloudMaterial(env, color, shade) {
  const uniforms = Object.assign(lightsUniforms(), env, {
    uColor: { value: new THREE.Color(color) },
    uShade: { value: new THREE.Color(shade) },
    uWind: { value: 0 },
  });
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: CEL_VERT,
    fragmentShader: CLOUD_FRAG,
    lights: true,
  });
}

// Additive engine/jetpack exhaust flames.
export function createFlameMaterial(color = 0x66ccff) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uIntensity: { value: 1 },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vPos;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vPos = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uColor;
      uniform float uIntensity;
      uniform float uTime;
      varying vec3 vPos;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        #include <logdepthbuf_fragment>
        float along = clamp(-vPos.y, 0.0, 1.0);
        float core = pow(abs(dot(normalize(vN), normalize(vV))), 1.5);
        float flick = 0.85 + 0.15 * sin(uTime * 40.0 + vPos.y * 20.0);
        float a = core * (1.0 - along) * uIntensity * flick;
        vec3 c = mix(uColor, vec3(1.0), core * (1.0 - along) * 0.6) * a * 3.0;
        gl_FragColor = vec4(c, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}
