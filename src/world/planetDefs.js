// Static description of the star system. Pure data so workers can import it.

export const SUN = {
  position: [310000, 95000, -520000],
  radius: 13000,
  color: [1.0, 0.94, 0.84],
};

export const PLANETS = [
  {
    id: 'elysia', minHeight: -125, name: 'Elysia', gen: 'elysia', seed: 11,
    blurb: 'Temperate world of teal meadows and amber forests',
    radius: 2000, seaLevel: 0, hasSea: true, sea: 'water',
    position: [0, 0, 0], axis: [0.12, 1, 0.08], dayLength: 1500, phase: 0.0,
    gravity: 9.0,
    atmo: { height: 0.34, scale: 0.24, od: [0.08, 0.19, 0.42], mie: 0.04, mieG: 0.78, sun: 4.5, tint: [1, 1, 1] },
    sky: { ambient: [0.36, 0.48, 0.62], ground: [0.22, 0.26, 0.18], night: [0.025, 0.035, 0.06] },
    water: { shallow: 0x4fc6c0, deep: 0x165a78, foam: 0xeaf6f2 },
    clouds: { count: 70, alt: 330, color: 0xffffff, shade: 0x8fa3be, size: 1.0 },
    weather: 'pollen',
    emissive: [0, 0, 0],
  },
  {
    id: 'kharif', minHeight: -85, name: 'Kharif', gen: 'kharif', seed: 23,
    blurb: 'Arid world of red mesas, canyons and endless dunes',
    radius: 1700, seaLevel: -9999, hasSea: false, sea: 'none',
    position: [24000, 2500, -16000], axis: [-0.2, 1, 0.1], dayLength: 1100, phase: 1.3,
    gravity: 8.0,
    atmo: { height: 0.3, scale: 0.26, od: [0.32, 0.22, 0.13], mie: 0.22, mieG: 0.72, sun: 4.5, tint: [1, 0.95, 0.85] },
    sky: { ambient: [0.62, 0.45, 0.32], ground: [0.38, 0.22, 0.12], night: [0.04, 0.03, 0.035] },
    water: null,
    clouds: null,
    weather: 'dust',
    emissive: [0, 0, 0],
  },
  {
    id: 'borea', minHeight: -75, name: 'Borea', gen: 'borea', seed: 37,
    blurb: 'Frozen world of glaciers, ice spires and a frozen sea',
    radius: 1500, seaLevel: 0, hasSea: true, sea: 'ice',
    position: [-21000, -3500, -19000], axis: [0.25, 1, -0.15], dayLength: 1700, phase: 2.1,
    gravity: 7.0,
    atmo: { height: 0.32, scale: 0.25, od: [0.12, 0.22, 0.38], mie: 0.1, mieG: 0.8, sun: 4.5, tint: [1, 1, 1] },
    sky: { ambient: [0.45, 0.56, 0.7], ground: [0.45, 0.5, 0.58], night: [0.03, 0.04, 0.07] },
    water: { shallow: 0xbfe6f5, deep: 0x6aa9d1, foam: 0xffffff },
    clouds: { count: 55, alt: 260, color: 0xf4f8ff, shade: 0x9fb2cc, size: 0.9 },
    weather: 'snow',
    emissive: [0, 0, 0],
  },
  {
    id: 'ignis', minHeight: -30, name: 'Ignis', gen: 'ignis', seed: 41,
    blurb: 'Volcanic world of basalt plains and seas of lava',
    radius: 1400, seaLevel: 0, hasSea: true, sea: 'lava',
    position: [14000, -5000, 27000], axis: [0.05, 1, 0.3], dayLength: 900, phase: 0.6,
    gravity: 10.0,
    atmo: { height: 0.3, scale: 0.25, od: [0.30, 0.13, 0.07], mie: 0.35, mieG: 0.65, sun: 4.2, tint: [1, 0.85, 0.75] },
    sky: { ambient: [0.42, 0.24, 0.18], ground: [0.35, 0.12, 0.05], night: [0.05, 0.02, 0.015] },
    water: { shallow: 0xffb040, deep: 0xff4a10, foam: 0xfff0a0 },
    clouds: { count: 40, alt: 280, color: 0x5a524e, shade: 0x2a2220, size: 1.1 },
    weather: 'embers',
    emissive: [4.5, 1.25, 0.25],
  },
  {
    id: 'umbra', minHeight: -95, name: 'Umbra', gen: 'umbra', seed: 53,
    blurb: 'Dusky fungal world lit by bioluminescent life',
    radius: 1800, seaLevel: 0, hasSea: true, sea: 'glow',
    position: [-27000, 4000, 14000], axis: [-0.1, 1, -0.2], dayLength: 1300, phase: 3.4,
    gravity: 6.5,
    atmo: { height: 0.36, scale: 0.26, od: [0.26, 0.10, 0.40], mie: 0.14, mieG: 0.75, sun: 4.2, tint: [1, 1, 1] },
    sky: { ambient: [0.42, 0.3, 0.58], ground: [0.2, 0.12, 0.28], night: [0.04, 0.03, 0.07] },
    water: { shallow: 0x3fd8c8, deep: 0x0f3550, foam: 0xbffff4 },
    clouds: { count: 50, alt: 300, color: 0xe6c8f0, shade: 0x6a4f8a, size: 1.0 },
    weather: 'spores',
    emissive: [0.4, 2.6, 2.2],
  },
];

// Approximate size of a quadtree node edge in metres.
export function nodeEdge(radius, size) {
  return radius * size * (Math.PI / 4);
}

// Level choices derived from planet size so cells have similar metric sizes.
export function lodLevels(radius) {
  const faceEdge = radius * Math.PI / 2;
  const maxLevel = Math.ceil(Math.log2(faceEdge / 32 / 0.9));
  const scatterLevel = Math.round(Math.log2(faceEdge / 150));
  return { maxLevel, scatterLevel, grassLevel: scatterLevel + 2 };
}
