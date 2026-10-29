// DOM heads-up display: status, flight gauges, planet markers, prompts,
// discovery toasts, help and journal panels, and the start screen.
import * as THREE from 'three';
import { settings, setSetting } from '../game/Settings.js';
import { Q } from '../core/quality.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

function el(tag, cls, parent, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}

function fmtDist(m) {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
}

const CONTROLS = [
  ['On foot', [['W A S D', 'Move'], ['Mouse', 'Look'], ['Shift', 'Sprint'], ['Space', 'Jump · hold for jetpack'], ['F', 'Board ship (when close)'], ['Wheel', 'Camera distance']]],
  ['Piloting', [['Mouse', 'Pitch & yaw (virtual stick)'], ['W / S', 'Thrust / brake'], ['A / D', 'Roll'], ['Space / C', 'Ascend / descend'], ['Shift', 'Boost · cruise drive in space'], ['Right mouse', 'Look around'], ['V', 'Camera distance'], ['F', 'Exit ship (when landed)']]],
  ['General', [['Tab', 'Discovery journal'], ['L', 'Lamp: auto / on / off'], ['T', 'Fast-forward time of day'], ['O', 'Settings'], ['H', 'Toggle this help'], ['M', 'Mute audio'], ['Esc', 'Pause / release mouse']]],
  ['Gamepad', [['Left stick', 'Move / steer'], ['Right stick', 'Look'], ['A', 'Jump · ascend'], ['B', 'Sprint · descend'], ['X', 'Board / exit'], ['RT / LT', 'Thrust / brake'], ['LB / RB', 'Roll'], ['Y', 'Boost'], ['Start', 'Journal']]],
];

export class Hud {
  constructor(root, game) {
    this.root = root;
    this.game = game;
    this.locked = false;
    root.innerHTML = '';

    this.status = el('div', 'hud-status', root);
    this.statusName = el('div', 'hud-planet', this.status);
    this.statusSub = el('div', 'hud-sub', this.status);
    this.statusSub2 = el('div', 'hud-sub dim', this.status);

    this.clock = el('div', 'hud-clock', root);

    this.markers = el('div', 'hud-markers', root);
    this.markerEls = new Map();

    this.reticle = el('div', 'hud-reticle', root, '<div class="ret-center"></div><div class="ret-stick"></div><div class="ret-pro"></div>');
    this.retStick = this.reticle.querySelector('.ret-stick');
    this.retPro = this.reticle.querySelector('.ret-pro');

    this.gauges = el('div', 'hud-gauges', root);
    this.gSpeed = el('div', 'g-speed', this.gauges);
    this.gBar = el('div', 'g-bar', this.gauges, '<div class="g-fill"></div>');
    this.gFill = this.gBar.querySelector('.g-fill');
    this.gFlags = el('div', 'g-flags', this.gauges);

    this.fuel = el('div', 'hud-fuel', root, '<div class="fuel-fill"></div><span>JET</span>');
    this.fuelFill = this.fuel.querySelector('.fuel-fill');

    this.promptEl = el('div', 'hud-prompt', root);
    this.toasts = el('div', 'hud-toasts', root);

    this.help = el('div', 'hud-panel hud-help hidden', root);
    this._buildHelp(this.help);
    this.journal = el('div', 'hud-panel hud-journal hidden', root);

    this.start = el('div', 'hud-start', root);
    this.start.innerHTML = `
      <div class="start-inner">
        <div class="start-title">WAYFARER</div>
        <div class="start-tag">A sandbox of five worlds · fly, land, wander</div>
        <div class="start-load"><div class="start-load-fill"></div></div>
        <div class="start-click">Click to begin</div>
        <div class="start-buttons"><button class="start-btn" data-act="settings">Settings</button></div>
        <div class="start-controls"></div>
        <div class="start-foot">No story. No loading screens. Every planet you see is a place you can walk on.</div>
      </div>`;
    this.startLoad = this.start.querySelector('.start-load-fill');
    this.startClick = this.start.querySelector('.start-click');
    this._buildHelp(this.start.querySelector('.start-controls'), true);
    this.errorEl = el('div', 'hud-error hidden', root);
    this.start.querySelector('[data-act="settings"]').addEventListener('click', (e) => { e.stopPropagation(); this.openSettings(); });
    // performance overlay: frame-time graph + summary
    this.perf = el('div', 'hud-perf hidden', root, '<canvas width="240" height="64"></canvas><div class="perf-text"></div>');
    this.perfCanvas = this.perf.querySelector('canvas');
    this.perfCtx = this.perfCanvas.getContext('2d');
    this.perfText = this.perf.querySelector('.perf-text');
    this.frameMs = new Float32Array(240);
    this.workMs = new Float32Array(240);
    this.frameIdx = 0;
    this.hitchTimes = [];
    this._perfT = 0;
    this.startLoaded = false;
    this.start.classList.add('loading');
    this._buildSettings();
    if (game.params.has('autopilot')) this.start.classList.add('hidden');
    this.promptText = '';
    this.toastTimer = 0;
    this.journalOpen = false;
  }

  _buildHelp(container, compact) {
    let html = compact ? '' : '<div class="panel-title">Controls</div>';
    html += '<div class="help-cols">';
    for (const [title, rows] of CONTROLS) {
      if (compact && title === 'Gamepad') continue;
      html += `<div class="help-col"><div class="help-h">${title}</div>`;
      for (const [k, d] of rows) html += `<div class="help-row"><span class="key">${k}</span><span>${d}</span></div>`;
      html += '</div>';
    }
    html += '</div>';
    container.innerHTML = html;
  }

  setTouch(on) {
    this.touch = on;
    this.root.classList.add('is-touch');
    if (this.startLoaded) this.startClick.textContent = 'Tap to begin · landscape recommended';
  }

  // Loading screen progress (0..1) with the current step.
  setLoading(frac, label) {
    this.startLoad.style.width = `${Math.round(Math.min(1, Math.max(0.03, frac)) * 100)}%`;
    this._txt(this.startClick, `${label}…`);
  }

  setReady() {
    this.startLoaded = true;
    this.start.classList.remove('loading');
    this.startLoad.style.width = '100%';
    this.startClick._v = undefined;
    this.startClick.textContent = this.touch ? 'Tap to begin · landscape recommended' : 'Click to begin';
  }

  // Called once per frame with the real frame interval and the JS work time.
  recordFrame(intervalMs, workMs) {
    const i = this.frameIdx = (this.frameIdx + 1) % this.frameMs.length;
    this.frameMs[i] = intervalMs;
    this.workMs[i] = workMs;
    const now = performance.now();
    if (intervalMs > 34 && this.game.ready) this.hitchTimes.push(now);
    while (this.hitchTimes.length && now - this.hitchTimes[0] > 10000) this.hitchTimes.shift();
    if (!settings.showFps) return;
    this._drawPerf();
  }

  _drawPerf() {
    const ctx = this.perfCtx, W = this.perfCanvas.width, H = this.perfCanvas.height;
    const n = this.frameMs.length, maxMs = 66.7;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, W, H);
    const y = (ms) => H - Math.min(ms, maxMs) / maxMs * H;
    for (let k = 0; k < n; k++) {
      const idx = (this.frameIdx + 1 + k) % n;
      const ms = this.frameMs[idx];
      if (!ms) continue;
      ctx.fillStyle = ms <= 18 ? '#6fe08a' : ms <= 34 ? '#ffd25a' : '#ff6a5a';
      ctx.fillRect(k, y(ms), 1, H - y(ms));
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillRect(k, y(this.workMs[idx]), 1, H - y(this.workMs[idx]));
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.setLineDash([3, 3]);
    for (const ms of [16.7, 33.3]) { ctx.beginPath(); ctx.moveTo(0, y(ms) + 0.5); ctx.lineTo(W, y(ms) + 0.5); ctx.stroke(); }
    ctx.setLineDash([]);
  }

  _updatePerfText() {
    const n = this.frameMs.length;
    let sum = 0, work = 0, worst = 0, c = 0;
    // last ~2 s of frames
    for (let k = 0; k < Math.min(n, 120); k++) {
      const idx = (this.frameIdx - k + n) % n;
      const ms = this.frameMs[idx];
      if (!ms) continue;
      sum += ms; work += this.workMs[idx]; c++;
      if (ms > worst) worst = ms;
    }
    if (!c) return;
    const avg = sum / c;
    const st = this.game.pipeline.stats || { calls: 0, tris: 0 };
    const cpu = work / c;
    const bound = avg > cpu + 6 ? 'GPU-bound' : 'CPU-bound';
    this._txt(this.perfText, `${Math.round(1000 / avg)} fps · ${avg.toFixed(1)} ms avg · worst ${worst.toFixed(0)} ms · ${this.hitchTimes.length} hitches/10 s\nCPU ${cpu.toFixed(1)} ms (${bound}) · ${st.calls} draws · ${(st.tris / 1e6).toFixed(2)}M tris · ${Q.name} · ${Math.round(this.game.pipeline.pixelRatio / (window.devicePixelRatio || 1) * 100)}% res`);
  }

  setLocked(locked) {
    this.locked = locked;
    this.start.classList.toggle('hidden', locked);
    if (locked) this.start.classList.add('played');
    if (this.touch || !this.startLoaded) return;
    this.startClick.textContent = this.start.classList.contains('played') ? 'Paused · click to resume' : 'Click to begin';
  }

  toggleHelp() { this.help.classList.toggle('hidden'); }

  _buildSettings() {
    const p = el('div', 'hud-panel hud-settings hidden', this.root);
    p.innerHTML = `
      <div class="panel-title">Settings</div>
      <div class="set-grid">
        <label for="set-sens">Look sensitivity <span class="set-val" data-val="sensitivity"></span></label>
        <input id="set-sens" type="range" min="0.3" max="3" step="0.05" data-key="sensitivity">
        <label for="set-invl">Invert look (on foot)</label><input id="set-invl" type="checkbox" data-key="invertLook">
        <label for="set-invf">Invert flight pitch</label><input id="set-invf" type="checkbox" data-key="invertFlight">
        <label for="set-q">Graphics quality</label>
        <select id="set-q" data-key="quality"><option value="auto">Auto</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
        <label for="set-fps">Show performance graph</label><input id="set-fps" type="checkbox" data-key="showFps">
        <label for="set-lamp">Lamp</label>
        <select id="set-lamp" data-key="lamp"><option value="auto">Auto (after dark)</option><option value="on">Always on</option><option value="off">Off</option></select>
        <label for="set-vol">Volume <span class="set-val" data-val="volume"></span></label>
        <input id="set-vol" type="range" min="0" max="1" step="0.05" data-key="volume">
      </div>
      <div class="set-note hidden">Quality changes apply after a reload. <button data-act="reload">Reload now</button></div>
      <div class="set-current"></div>
      <div class="set-actions"><button data-act="close" class="primary">Done</button><button data-act="newgame" class="danger">New game</button></div>`;
    this.settingsPanel = p;
    const refresh = () => {
      for (const inp of p.querySelectorAll('[data-key]')) {
        const v = settings[inp.dataset.key];
        if (inp.type === 'checkbox') inp.checked = !!v; else inp.value = String(v);
      }
      p.querySelector('[data-val="sensitivity"]').textContent = `${Number(settings.sensitivity).toFixed(2)}×`;
      p.querySelector('[data-val="volume"]').textContent = `${Math.round(settings.volume * 100)}%`;
      p.querySelector('.set-current').textContent = `Running: ${Q.name} quality`;
    };
    this._refreshSettings = refresh;
    for (const inp of p.querySelectorAll('[data-key]')) {
      inp.addEventListener(inp.type === 'range' ? 'input' : 'change', () => {
        const k = inp.dataset.key;
        const v = inp.type === 'checkbox' ? inp.checked : inp.type === 'range' ? parseFloat(inp.value) : inp.value;
        setSetting(k, v);
        if (k === 'quality') p.querySelector('.set-note').classList.toggle('hidden', (v === 'auto' ? (this.touch ? 'low' : 'high') : v) === Q.name);
        refresh();
      });
    }
    p.querySelector('[data-act="close"]').addEventListener('click', () => this.closeSettings());
    p.querySelector('[data-act="reload"]').addEventListener('click', () => location.reload());
    p.querySelector('[data-act="newgame"]').addEventListener('click', () => {
      if (window.confirm('Start a new game? Your saved position and discoveries will be reset.')) this.game.newGame();
    });
    // keep panel input away from the game's touch/mouse handlers
    for (const ev of ['touchstart', 'mousedown', 'wheel']) p.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
    refresh();
  }

  get settingsOpen() { return !this.settingsPanel.classList.contains('hidden'); }

  openSettings() {
    this._refreshSettings();
    this.settingsPanel.classList.remove('hidden');
    if (document.pointerLockElement) document.exitPointerLock?.();
  }

  closeSettings() { this.settingsPanel.classList.add('hidden'); }

  toggleSettings() { if (this.settingsOpen) this.closeSettings(); else this.openSettings(); }

  toggleJournal() {
    this.journalOpen = !this.journalOpen;
    this.journal.classList.toggle('hidden', !this.journalOpen);
    if (this.journalOpen) this._renderJournal();
  }

  _renderJournal() {
    const d = this.game.discoveries;
    let html = '<div class="panel-title">Discovery Journal</div><div class="journal-grid">';
    let total = 0, found = 0;
    for (const p of this.game.universe.planets) {
      const t = d.totals(p);
      total += t.fauna.total + t.flora.total;
      found += t.fauna.found.length + t.flora.found.length;
      html += `<div class="j-planet ${t.visited ? '' : 'unvisited'}"><div class="j-name">${p.name}</div><div class="j-blurb">${t.visited ? p.def.blurb : 'Not yet visited'}</div>`;
      html += `<div class="j-sec">Fauna ${t.fauna.found.length}/${t.fauna.total}</div><div class="j-items">${t.fauna.found.map((n) => `<span>${n}</span>`).join('') || '<em>—</em>'}</div>`;
      html += `<div class="j-sec">Flora &amp; formations ${t.flora.found.length}/${t.flora.total}</div><div class="j-items">${t.flora.found.map((n) => `<span>${n}</span>`).join('') || '<em>—</em>'}</div></div>`;
    }
    html += `</div><div class="j-total">${found} of ${total} discoveries catalogued</div>`;
    this.journal.innerHTML = html;
  }

  toast(text, sub = '', kind = '') {
    const t = el('div', `toast ${kind}`, this.toasts, `<div class="toast-t">${text}</div>${sub ? `<div class="toast-s">${sub}</div>` : ''}`);
    setTimeout(() => t.classList.add('out'), 4200);
    setTimeout(() => t.remove(), 5000);
    while (this.toasts.children.length > 4) this.toasts.firstChild.remove();
  }

  discover(text, sub, kind) {
    this.toast(text, sub, 'disc ' + kind);
    this.game.audio?.event('discover');
    if (this.journalOpen) this._renderJournal();
  }

  prompt(text) {
    if (text === this.promptText) return;
    this.promptText = text;
    this.promptEl.textContent = text;
    this.promptEl.classList.toggle('show', !!text);
  }

  error(err) {
    this.errorEl.classList.remove('hidden');
    this.errorEl.textContent = 'Error: ' + (err && err.message ? err.message : err);
  }

  // Only touch the DOM when a value actually changes.
  _txt(el, v) { if (el._v !== v) { el._v = v; el.textContent = v; } }
  _html(el, v) { if (el._h !== v) { el._h = v; el.innerHTML = v; } }

  update(dt) {
    const g = this.game;
    const u = g.universe;
    this._textT = (this._textT || 0) - dt;
    const doText = this._textT <= 0;
    if (doText) this._textT = 0.12;
    // performance overlay summary
    this._perfT -= dt;
    if (this._perfT <= 0) {
      this._perfT = 0.25;
      this.perf.classList.toggle('hidden', !settings.showFps);
      if (settings.showFps) this._updatePerfText();
    }

    const shipMode = g.mode === 'ship';
    const body = shipMode ? g.ship.body : g.player.body;
    const world = u.toWorld(body, _v);
    const near = u.nearest(world);
    const planet = body.frame;
    const inAtmo = planet && body.pos.length() < planet.atmoTop;

    // status
    if (!doText) { /* text refreshed at ~8 Hz */ } else if (planet && (inAtmo || !shipMode)) {
      this._txt(this.statusName, planet.name);
      const alt = shipMode ? g.ship.altitude : 0;
      this._txt(this.statusSub, shipMode ? `Altitude ${fmtDist(Math.max(0, alt))} · ${Math.round(g.ship.speed)} m/s` : `${planet.def.blurb}`);
    } else if (planet) {
      this._txt(this.statusName, `${planet.name} orbit`);
      this._txt(this.statusSub, `Altitude ${fmtDist(near.altitude)} · ${Math.round(g.ship.speed)} m/s`);
    } else {
      this._txt(this.statusName, 'Interplanetary space');
      this._txt(this.statusSub, `Nearest: ${near.planet.name} · ${fmtDist(near.altitude)}`);
    }
    if (doText) this._txt(this.statusSub2, shipMode ? (g.ship.landed ? 'Landed' : g.ship.cruise ? 'Cruise drive engaged' : inAtmo ? 'Atmospheric flight' : 'Vacuum flight') : g.player.swimming ? 'Swimming' : g.player.jetting ? 'Jetpack' : 'On foot');

    // clock: sun elevation at the player's position
    if (!doText) { /* throttled */ } else if (planet) {
      const up = _w.copy(body.pos).normalize().applyQuaternion(planet.quat);
      const sunDir = u.sunWorld.clone().sub(world).normalize();
      const e = up.dot(sunDir);
      const ax = planet.axis;
      const rising = new THREE.Vector3().crossVectors(ax, up).dot(sunDir) < 0;
      let label = e > 0.55 ? 'Midday' : e > 0.15 ? (rising ? 'Morning' : 'Afternoon') : e > -0.08 ? (rising ? 'Dawn' : 'Dusk') : 'Night';
      const disc = [...g.discoveries.planets.values()].reduce((a, d) => a + d.items.size, 0);
      this._html(this.clock, `<span class="sun ${label.toLowerCase()}"></span>${label}${g.timeScale > 1 ? ' ⏩' : ''}<span class="sep">·</span>${disc} discoveries`);
    } else {
      const disc = [...g.discoveries.planets.values()].reduce((a, d) => a + d.items.size, 0);
      this._html(this.clock, `${disc} discoveries`);
    }

    // ship gauges + reticle
    this.gauges.classList.toggle('show', shipMode);
    this.reticle.classList.toggle('show', shipMode && !g.ship.landed);
    this.fuel.classList.toggle('show', !shipMode && g.player.jetFuel < 0.999);
    if (!shipMode && doText) this.fuelFill.style.height = `${Math.round(g.player.jetFuel * 100)}%`;
    if (shipMode) {
      const s = g.ship;
      if (doText) this._html(this.gSpeed, `${Math.round(s.speed)}<span>m/s</span>`);
      const maxv = s.cruise ? 5200 : s.inAtmo ? 340 : 420;
      this.gFill.style.width = `${Math.min(100, (s.speed / maxv) * 100)}%`;
      this.gFill.classList.toggle('cruise', s.cruise);
      const flags = [];
      if (s.cruise) flags.push('<b class="f-cruise">CRUISE</b>');
      if (s.boost > 0.3 && !s.cruise) flags.push('<b>BOOST</b>');
      flags.push(s.gear > 0.5 ? '<b class="f-gear">GEAR ▼</b>' : '<span>GEAR ▲</span>');
      if (s.heat > 0.1) flags.push('<b class="f-heat">ENTRY HEAT</b>');
      this._html(this.gFlags, flags.join(''));
      const w = window.innerWidth, h = window.innerHeight;
      this.retStick.style.transform = `translate(${s.stick.x * 90}px, ${s.stick.y * 90}px)`;
      // prograde marker
      const vel = s.body.vel.clone();
      if (s.body.frame) vel.applyQuaternion(s.body.frame.quat);
      if (vel.length() > 3) {
        const p = vel.normalize().multiplyScalar(1000).project(g.pipeline.camera);
        const vis = p.z < 1 && Math.abs(p.x) < 1 && Math.abs(p.y) < 1;
        this.retPro.style.display = vis ? 'block' : 'none';
        this.retPro.style.transform = `translate(${p.x * w / 2}px, ${-p.y * h / 2}px)`;
      } else this.retPro.style.display = 'none';
    }

    this._updateMarkers(shipMode, planet, inAtmo);
  }

  _updateMarkers(shipMode, planet, inAtmo) {
    const g = this.game;
    const cam = g.pipeline.camera;
    const w = window.innerWidth, h = window.innerHeight;
    const targets = [];
    for (const p of g.universe.planets) {
      if (p === planet && inAtmo) continue;
      const rel = p.position.clone().sub(g.origin);
      const dist = Math.max(0, rel.length() - p.R);
      targets.push({ key: p.def.id, name: p.name, rel, dist, cls: 'planet' });
    }
    if (!shipMode && g.ship.body.frame) {
      const sw = g.universe.toWorld(g.ship.body, new THREE.Vector3());
      const rel = sw.sub(g.origin);
      if (rel.length() > 30) targets.push({ key: '__ship', name: 'Your ship', rel, dist: rel.length(), cls: 'ship' });
    }
    const seen = new Set();
    for (const t of targets) {
      seen.add(t.key);
      let m = this.markerEls.get(t.key);
      if (!m) {
        m = el('div', `marker ${t.cls}`, this.markers, '<div class="m-dot"></div><div class="m-label"><b></b><span></span></div>');
        this.markerEls.set(t.key, m);
      }
      const p = t.rel.clone().project(cam);
      let x = p.x, y = p.y;
      const behind = p.z > 1;
      if (behind) { x = -x; y = -y; }
      const off = behind || Math.abs(x) > 0.92 || Math.abs(y) > 0.88;
      if (off) {
        const k = Math.max(Math.abs(x) / 0.92, Math.abs(y) / 0.88);
        x /= k; y /= k;
      }
      m.classList.toggle('off', off);
      m.style.transform = `translate(${(x * 0.5 + 0.5) * w}px, ${(-y * 0.5 + 0.5) * h}px)`;
      if (!m._b) { m._b = m.querySelector('b'); m._s = m.querySelector('span'); }
      this._txt(m._b, t.name);
      if (this._textT === 0.12) this._txt(m._s, fmtDist(t.dist));
    }
    for (const [k, m] of this.markerEls) {
      m.style.display = seen.has(k) ? '' : 'none';
    }
  }
}
