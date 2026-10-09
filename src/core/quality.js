// Graphics quality tiers. Touch devices default to "low"; override with
// ?quality=low|high in the URL.
const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const touch = typeof window !== 'undefined' && (('ontouchstart' in window) || navigator.maxTouchPoints > 0);
const tier = params.get('quality') || (touch ? 'low' : 'high');

const TIERS = {
  high: {
    name: 'high', pixelRatioMax: 1.5, pixelRatioMin: 0.6, msaa: 4, shadows: true, shadowSize: 2048, bloom: true,
    vertexAtmoSteps: 6, outlineAtmoSteps: 4, skyAtmoSteps: 12, splitK: 1.9, levelOffset: 0, waterStride: 1, outlineRadius: 260, grass: true, floraDensity: 1,
    fauna: 38, cloudDetail: 2, outlines: true,
  },
  low: {
    name: 'low', pixelRatioMax: 1.0, pixelRatioMin: 0.5, msaa: 0, shadows: false, shadowSize: 1024, bloom: false,
    vertexAtmoSteps: 3, outlineAtmoSteps: 2, skyAtmoSteps: 6, splitK: 1.2, levelOffset: -1, waterStride: 2, outlineRadius: 110, grass: false, floraDensity: 0.45,
    fauna: 16, cloudDetail: 1, outlines: true,
  },
};

export const Q = TIERS[tier] || TIERS.high;
export const IS_TOUCH = touch;
