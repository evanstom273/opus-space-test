// Schedules terrain/scatter generation jobs on a pool of workers, with a
// time-sliced main-thread fallback if module workers are unavailable.
import { PLANETS } from './planetDefs.js';
import { createGen, buildPatch, buildScatter } from './terrainGen.js';

export class TerrainService {
  constructor() {
    this.gens = PLANETS.map((def) => createGen(def));
    this.queue = [];
    this.inflight = new Map();
    this.nextId = 1;
    this.workers = [];
    this.fallback = false;
    const count = Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
    try {
      for (let i = 0; i < count; i++) {
        const w = new Worker(new URL('./terrainWorker.js', import.meta.url), { type: 'module' });
        w.jobs = 0;
        w.onmessage = (e) => this._onResult(w, e.data);
        w.onerror = (err) => this._onWorkerError(w, err);
        this.workers.push(w);
      }
    } catch (err) {
      console.warn('Terrain workers unavailable, generating on main thread', err);
      this.fallback = true;
    }
  }

  // job: {kind, planet, ...params}; priority: lower = sooner
  request(job, priority, callback) {
    job.id = this.nextId++;
    const entry = { job, priority, callback, cancelled: false, worker: null };
    this.queue.push(entry);
    return entry;
  }

  cancel(entry) {
    if (!entry) return;
    entry.cancelled = true;
  }

  get pending() {
    return this.queue.length + this.inflight.size;
  }

  update() {
    if (this.queue.length === 0) return;
    // drop cancelled, sort by priority
    this.queue = this.queue.filter((e) => !e.cancelled);
    this.queue.sort((a, b) => a.priority - b.priority);
    if (this.fallback) {
      const t0 = performance.now();
      while (this.queue.length && performance.now() - t0 < 6) {
        const e = this.queue.shift();
        if (e.cancelled) continue;
        e.callback(this._runLocal(e.job));
      }
      return;
    }
    for (const w of this.workers) this._pump(w);
  }

  // Keep a worker busy: called each frame and whenever it returns a result.
  _pump(w) {
    while (w.jobs < 3 && this.queue.length) {
      const e = this.queue.shift();
      if (e.cancelled) continue;
      e.worker = w;
      w.jobs++;
      this.inflight.set(e.job.id, e);
      w.postMessage(e.job);
    }
  }

  _runLocal(job) {
    const gen = this.gens[job.planet];
    if (job.kind === 'patch') return buildPatch(gen, job.face, job.x0, job.y0, job.size, job.skirt);
    return buildScatter(gen, job.tier, job.face, job.level, job.x0, job.y0, job.size, job.spawns, job.density);
  }

  _onResult(worker, msg) {
    worker.jobs--;
    const e = this.inflight.get(msg.id);
    this.inflight.delete(msg.id);
    if (e && !e.cancelled) e.callback(msg.result);
    this._pump(worker);
  }

  _onWorkerError(worker, err) {
    console.warn('Terrain worker failed; switching to main-thread generation', err);
    err.preventDefault?.();
    this.fallback = true;
    for (const w of this.workers) w.terminate();
    this.workers = [];
    // requeue everything that was in flight
    for (const e of this.inflight.values()) this.queue.push(e);
    this.inflight.clear();
  }
}
