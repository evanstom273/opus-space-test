// Shared GLSL: atmospheric scattering, planet shadowing, cel lighting and noise.

export const ATMO_PARS = /* glsl */ `
uniform vec3 uSunPos;
uniform vec3 uSunColor;
uniform vec3 uPlanetCenter;
uniform mat3 uPlanetRotInv;
uniform float uPlanetRadius;
uniform float uAtmoRadius;
uniform float uAtmoBase;
uniform float uScaleH;
uniform vec3 uBetaR;
uniform float uBetaM;
uniform float uMieG;
uniform float uAtmoSun;
uniform float uAtmoOn;
uniform vec3 uAtmoTint;
uniform vec3 uSkyAmbient;
uniform vec3 uGroundAmbient;
uniform vec3 uNightAmbient;
uniform float uTime;

vec2 raySphere(vec3 ro, vec3 rd, vec3 c, float r) {
  vec3 oc = ro - c;
  float b = dot(oc, rd);
  float cc = dot(oc, oc) - r * r;
  float h = b * b - cc;
  if (h < 0.0) return vec2(1e20, -1e20);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}

// Schuler's Chapman function approximation; X = R/H, h = altitude/H.
float chapman(float X, float h, float cosZ) {
  float c = sqrt(X + h);
  if (cosZ >= 0.0) {
    return c / (c * cosZ + 1.0) * exp(-h);
  }
  float x0 = sqrt(max(1.0 - cosZ * cosZ, 0.0)) * (X + h);
  float c0 = sqrt(x0);
  return 2.0 * c0 * exp(min(X - x0, 30.0)) - c / (1.0 - c * cosZ) * exp(-h);
}

// Soft occlusion of the sun by the planet body.
float planetShadow(vec3 p, vec3 L) {
  vec3 oc = uPlanetCenter - p;
  float b = dot(oc, L);
  if (b <= 0.0) return 1.0;
  float d = sqrt(max(dot(oc, oc) - b * b, 0.0));
  return smoothstep(uPlanetRadius * 0.975, uPlanetRadius * 1.01, d);
}

vec3 sunLightAt(vec3 p) {
  vec3 L = normalize(uSunPos - p);
  float vis = planetShadow(p, L);
  if (uAtmoOn < 0.5) return uSunColor * vis;
  vec3 pc = p - uPlanetCenter;
  float r = length(pc);
  float hh = max(r - uAtmoBase, 0.0) / uScaleH;
  float cosZ = dot(pc / r, L);
  float od = chapman(uAtmoBase / uScaleH, hh, cosZ) * uScaleH;
  return uSunColor * exp(-(uBetaR + vec3(uBetaM * 1.1)) * od) * vis;
}

void atmoScatter(vec3 ro, vec3 rd, float tMax, const int steps, out vec3 inscatter, out vec3 transmit) {
  inscatter = vec3(0.0);
  transmit = vec3(1.0);
  if (uAtmoOn < 0.5) return;
  vec2 ta = raySphere(ro, rd, uPlanetCenter, uAtmoRadius);
  float t0 = max(ta.x, 0.0);
  float t1 = min(ta.y, tMax);
  if (t1 <= t0) return;
  float ds = (t1 - t0) / float(steps);
  vec3 L = normalize(uSunPos - uPlanetCenter);
  float mu = dot(rd, L);
  float pR = 0.0596831 * (1.0 + mu * mu);
  float g = uMieG, g2 = g * g;
  float pM = 0.1193662 * (1.0 - g2) * (1.0 + mu * mu) / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5));
  vec3 betaE = uBetaR + vec3(uBetaM * 1.1);
  float X = uAtmoBase / uScaleH;
  float odV = 0.0;
  vec3 sum = vec3(0.0);
  for (int i = 0; i < 16; i++) {
    if (i >= steps) break;
    vec3 p = ro + rd * (t0 + ds * (float(i) + 0.5));
    vec3 pc = p - uPlanetCenter;
    float r = length(pc);
    float hh = max(r - uAtmoBase, 0.0) / uScaleH;
    float dens = exp(-hh) * ds;
    odV += dens * 0.5;
    float cosZ = dot(pc / r, L);
    float odS = chapman(X, hh, cosZ) * uScaleH;
    float sh = planetShadow(p, L);
    sum += dens * exp(-betaE * (odV + odS)) * sh;
    odV += dens * 0.5;
  }
  inscatter = uAtmoSun * uSunColor * uAtmoTint * sum * (uBetaR * pR + vec3(uBetaM * pM));
  transmit = exp(-betaE * odV);
}

// Hemispheric sky ambient that fades at night and with altitude.
vec3 ambientAt(vec3 p, vec3 n) {
  vec3 pc = p - uPlanetCenter;
  float r = length(pc);
  vec3 up = pc / r;
  vec3 L = normalize(uSunPos - p);
  float day = smoothstep(-0.28, 0.35, dot(up, L));
  float hemi = dot(n, up) * 0.5 + 0.5;
  vec3 amb = mix(uGroundAmbient, uSkyAmbient, hemi) * day;
  float alt = smoothstep(uAtmoRadius, uAtmoRadius * 1.8, r);
  return mix(amb, amb * 0.2, alt) + uNightAmbient;
}
`;

export const CEL_FUNCS = /* glsl */ `
float celRamp(float x) {
  return smoothstep(-0.01, 0.05, x) * 0.58 + smoothstep(0.34, 0.40, x) * 0.42;
}
`;

export const SHADOW_FRAG = /* glsl */ `
float sampleSunShadow() {
  float s = 1.0;
  #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
    DirectionalLightShadow dls = directionalLightShadows[ 0 ];
    vec4 sc = vDirectionalShadowCoord[ 0 ];
    if (receiveShadow) {
      s = getShadow( directionalShadowMap[ 0 ], dls.shadowMapSize, dls.shadowIntensity, dls.shadowBias, dls.shadowRadius, sc );
      vec3 c = sc.xyz / sc.w;
      float e = max(abs(c.x - 0.5), abs(c.y - 0.5));
      s = mix(s, 1.0, smoothstep(0.4, 0.5, e));
    }
  #endif
  return s;
}
`;

// Ashima/stegu 3D simplex noise
export const NOISE_GLSL = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`;
