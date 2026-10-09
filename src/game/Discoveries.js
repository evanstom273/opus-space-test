// Tracks what the explorer has found: planets visited, fauna, flora, minerals.
import { FLORA_INFO } from '../world/props.js';
import { SPECIES } from '../world/creatures.js';

export class Discoveries {
  constructor() {
    this.flags = {};
    this.planets = new Map(); // planet id -> { visited, items: Map(id -> {name, kind}) }
    this.log = [];
    try {
      const saved = JSON.parse(localStorage.getItem('wayfarer-discoveries') || 'null');
      if (saved) {
        for (const [pid, data] of Object.entries(saved)) {
          this.planets.set(pid, { visited: data.visited, items: new Map(Object.entries(data.items)) });
        }
      }
    } catch (e) { /* storage unavailable */ }
  }

  _p(planet) {
    const id = planet.def.id;
    if (!this.planets.has(id)) this.planets.set(id, { visited: false, items: new Map() });
    return this.planets.get(id);
  }

  _save() {
    try {
      const out = {};
      for (const [pid, d] of this.planets) out[pid] = { visited: d.visited, items: Object.fromEntries(d.items) };
      localStorage.setItem('wayfarer-discoveries', JSON.stringify(out));
    } catch (e) { /* ignore */ }
  }

  visitPlanet(planet, hud) {
    const d = this._p(planet);
    if (d.visited) return;
    d.visited = true;
    hud?.discover(`Entered the atmosphere of ${planet.name}`, planet.def.blurb, 'planet');
    this._save();
  }

  has(planet, id) {
    return this._p(planet).items.has(id);
  }

  add(planet, id, name, kind, hud) {
    const d = this._p(planet);
    if (d.items.has(id)) return;
    d.items.set(id, { name, kind });
    const label = kind === 'fauna' ? 'New fauna' : kind === 'mineral' ? 'New formation' : 'New flora';
    hud?.discover(`${label}: ${name}`, planet.name, kind);
    this._save();
  }

  // Totals per planet derived from generator rules.
  totals(planet) {
    const flora = planet.gen.scatter.filter((r) => FLORA_INFO[r.id]?.name).map((r) => r.id);
    const fauna = planet.gen.spawns.map((s) => s.id);
    const d = this._p(planet);
    const found = (ids) => ids.filter((id) => d.items.has(id));
    return {
      visited: d.visited,
      fauna: { found: found(fauna).map((id) => SPECIES[id].name), total: fauna.length, all: fauna },
      flora: { found: found(flora).map((id) => FLORA_INFO[id].name), total: flora.length, all: flora },
    };
  }
}
