// Autosave / resume of the explorer's position, ship state and time of day.
const KEY = 'wayfarer-save-v1';

const v3 = (v) => [v.x, v.y, v.z];
const q4 = (q) => [q.x, q.y, q.z, q.w];

export function writeSave(game) {
  const u = game.universe;
  const p = game.player, s = game.ship;
  const data = {
    v: 1,
    savedAt: Date.now(),
    time: u.time,
    mode: game.mode,
    player: {
      planet: p.body.frame.index,
      pos: v3(p.body.pos), heading: v3(p.heading), camFwd: v3(p.camFwd), camPitch: p.camPitch,
    },
    ship: {
      planet: s.body.frame ? s.body.frame.index : -1,
      pos: v3(s.body.pos), vel: v3(s.body.vel), quat: q4(s.body.quat),
      landed: s.landed, gear: s.gear,
    },
  };
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* storage unavailable */ }
}

export function readSave() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!d || d.v !== 1 || !d.player || !d.ship) return null;
    const finite = (a) => Array.isArray(a) && a.every((x) => Number.isFinite(x));
    if (!finite(d.player.pos) || !finite(d.ship.pos) || !finite(d.ship.quat)) return null;
    return d;
  } catch (e) {
    return null;
  }
}

export function clearSave() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
}
