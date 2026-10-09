// Web Worker: builds terrain patches and scatter placements off the main thread.
import { PLANETS } from './planetDefs.js';
import { createGen, buildPatch, buildScatter } from './terrainGen.js';

const gens = PLANETS.map((def) => createGen(def));

self.onmessage = (e) => {
  const job = e.data;
  const gen = gens[job.planet];
  if (job.kind === 'patch') {
    const r = buildPatch(gen, job.face, job.x0, job.y0, job.size, job.skirt);
    const transfer = [r.positions.buffer, r.normals.buffer, r.colors.buffer];
    if (r.water) transfer.push(r.water.positions.buffer, r.water.depth.buffer);
    self.postMessage({ id: job.id, result: r }, transfer);
  } else if (job.kind === 'scatter') {
    const r = buildScatter(gen, job.tier, job.face, job.level, job.x0, job.y0, job.size, job.spawns);
    const transfer = Object.values(r.types).map((a) => a.buffer);
    self.postMessage({ id: job.id, result: r }, transfer);
  }
};
