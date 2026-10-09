// Procedural WebAudio: wind, engines, jetpack, footsteps, creature calls,
// UI chimes and a slow ambient pad that shifts with each world.
const PAD_CHORDS = {
  elysia: [220.0, 277.18, 329.63, 415.3],
  kharif: [196.0, 233.08, 293.66, 349.23],
  borea: [246.94, 311.13, 369.99, 493.88],
  ignis: [146.83, 174.61, 220.0, 261.63],
  umbra: [174.61, 220.0, 261.63, 329.63],
  space: [110.0, 164.81, 220.0, 246.94],
};

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.ready = false;
    this.padKey = null;
  }

  resume() {
    if (!this.ctx) {
      try { this._init(); } catch (e) { console.warn('audio unavailable', e); return; }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  _init() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(comp).connect(ctx.destination);
    // noise buffer
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    const noise = () => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };

    // wind
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass'; this.windFilter.frequency.value = 500; this.windFilter.Q.value = 0.7;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    noise().connect(this.windFilter).connect(this.windGain).connect(this.master);

    // engine: detuned saws through a lowpass + hiss
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 300; this.engFilter.Q.value = 2;
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    this.engOsc = [55, 55.7, 110.4].map((f) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(this.engFilter); o.start(); return o;
    });
    this.engFilter.connect(this.engGain).connect(this.master);
    this.hissFilter = ctx.createBiquadFilter();
    this.hissFilter.type = 'bandpass'; this.hissFilter.frequency.value = 2400; this.hissFilter.Q.value = 0.6;
    this.hissGain = ctx.createGain(); this.hissGain.gain.value = 0;
    noise().connect(this.hissFilter).connect(this.hissGain).connect(this.master);

    // cruise shimmer
    this.cruiseGain = ctx.createGain(); this.cruiseGain.gain.value = 0;
    this.cruiseOsc = ctx.createOscillator(); this.cruiseOsc.type = 'triangle'; this.cruiseOsc.frequency.value = 220;
    const trem = ctx.createOscillator(); trem.frequency.value = 6; const tg = ctx.createGain(); tg.gain.value = 18;
    trem.connect(tg).connect(this.cruiseOsc.frequency); trem.start();
    this.cruiseOsc.connect(this.cruiseGain).connect(this.master); this.cruiseOsc.start();

    // jetpack
    this.jetFilter = ctx.createBiquadFilter(); this.jetFilter.type = 'highpass'; this.jetFilter.frequency.value = 900;
    this.jetGain = ctx.createGain(); this.jetGain.gain.value = 0;
    noise().connect(this.jetFilter).connect(this.jetGain).connect(this.master);

    // ambient pad
    this.padGain = ctx.createGain(); this.padGain.gain.value = 0.0;
    const padFilter = ctx.createBiquadFilter(); padFilter.type = 'lowpass'; padFilter.frequency.value = 900;
    this.padFilter = padFilter;
    const delay = ctx.createDelay(1.5); delay.delayTime.value = 0.6;
    const fb = ctx.createGain(); fb.gain.value = 0.45;
    delay.connect(fb).connect(delay);
    padFilter.connect(this.padGain);
    this.padGain.connect(this.master);
    this.padGain.connect(delay); delay.connect(this.master);
    this.padOsc = PAD_CHORDS.elysia.map((f, i) => {
      const o = ctx.createOscillator(); o.type = i % 2 ? 'sine' : 'triangle'; o.frequency.value = f / 2;
      const g = ctx.createGain(); g.gain.value = 0.0;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05 + i * 0.031;
      const lg = ctx.createGain(); lg.gain.value = 0.06;
      lfo.connect(lg).connect(g.gain); lfo.start();
      o.connect(g).connect(padFilter); o.start();
      g.gain.value = 0.07;
      return o;
    });
    this.ready = true;
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.7, this.ctx.currentTime, 0.1);
  }

  _env(node, peak, attack, decay) {
    const t = this.ctx.currentTime;
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(peak, t + attack);
    node.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  _tone(freq, type, peak, attack, decay, endFreq) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, ctx.currentTime + attack + decay);
    const g = ctx.createGain();
    o.connect(g).connect(this.master);
    this._env(g, peak, attack, decay);
    o.start(); o.stop(ctx.currentTime + attack + decay + 0.05);
  }

  _noiseBurst(freq, q, peak, attack, decay, type = 'bandpass') {
    const ctx = this.ctx;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    s.connect(f).connect(g).connect(this.master);
    this._env(g, peak, attack, decay);
    s.start(0, Math.random()); s.stop(ctx.currentTime + attack + decay + 0.05);
  }

  event(name) {
    if (!this.ready || this.muted) return;
    switch (name) {
      case 'discover':
        this._tone(660, 'sine', 0.12, 0.01, 0.6);
        setTimeout(() => this.ready && this._tone(990, 'sine', 0.1, 0.01, 0.9), 120);
        break;
      case 'board': this._noiseBurst(600, 1, 0.2, 0.02, 0.3); this._tone(180, 'triangle', 0.15, 0.01, 0.2); break;
      case 'exit': this._noiseBurst(900, 1, 0.18, 0.02, 0.35); break;
      case 'land': this._noiseBurst(140, 1, 0.5, 0.01, 0.5, 'lowpass'); break;
      case 'bump': this._noiseBurst(120, 1, 0.6, 0.005, 0.4, 'lowpass'); break;
      case 'takeoff': this._noiseBurst(300, 0.6, 0.25, 0.1, 0.8); break;
      case 'jump': this._noiseBurst(500, 1.5, 0.05, 0.01, 0.12); break;
      case 'lava': this._noiseBurst(3000, 0.5, 0.15, 0.01, 0.4); break;
    }
  }

  step(planet, run) {
    if (!this.ready || this.muted) return;
    const f = { elysia: 900, kharif: 2200, borea: 3200, ignis: 700, umbra: 600 }[planet.def.id] || 1000;
    this._noiseBurst(f * (0.85 + Math.random() * 0.3), 1.2, run ? 0.09 : 0.06, 0.005, 0.12);
  }

  call(c, dist) {
    if (!this.ready || this.muted) return;
    const vol = Math.max(0, 1 - dist / 90) * 0.18;
    if (vol < 0.005) return;
    const b = c.base * (0.9 + Math.random() * 0.2);
    switch (c.kind) {
      case 'low': this._tone(b, 'sine', vol, 0.3, 1.4, b * 0.7); this._tone(b * 1.5, 'triangle', vol * 0.3, 0.4, 1.2, b); break;
      case 'chirp': for (let i = 0; i < 3; i++) setTimeout(() => this.ready && this._tone(b, 'sine', vol * 0.6, 0.01, 0.08, b * 1.6), i * 110); break;
      case 'whistle': this._tone(b, 'sine', vol * 0.7, 0.1, 0.8, b * 1.4); break;
      case 'hiss': this._noiseBurst(2800, 0.8, vol, 0.2, 0.9); break;
      case 'click': for (let i = 0; i < 5; i++) setTimeout(() => this.ready && this._noiseBurst(b * 6, 6, vol, 0.002, 0.04), i * 70); break;
      case 'chime': this._tone(b, 'sine', vol * 0.5, 0.01, 2.0); this._tone(b * 2.76, 'sine', vol * 0.2, 0.01, 1.4); break;
      case 'flutter': this._noiseBurst(b, 3, vol * 0.5, 0.05, 0.3); break;
      case 'whale': this._tone(b, 'sine', vol, 0.6, 2.2, b * 1.6); break;
    }
  }

  update(dt, game) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const ship = game.ship;
    const shipMode = game.mode === 'ship';
    const planet = shipMode ? ship.body.frame : game.player.body.frame;
    // wind: on foot a planet-dependent breeze, in flight speed * air density
    let wind = 0;
    if (shipMode) wind = Math.min(1, ship.speed / 250) * (ship.density || 0) * 1.4 + ship.heat * 0.6;
    else wind = { elysia: 0.12, kharif: 0.3, borea: 0.28, ignis: 0.15, umbra: 0.08 }[planet?.def.id] || 0.1;
    this.windGain.gain.setTargetAtTime(wind * 0.35, t, 0.3);
    this.windFilter.frequency.setTargetAtTime(350 + wind * 900, t, 0.3);
    // engines
    const thrust = shipMode && !ship.landed ? ship.thrustVis : shipMode ? 0.05 : 0;
    const idle = shipMode && !ship.landed ? 0.25 : 0;
    this.engGain.gain.setTargetAtTime((idle + thrust) * 0.12, t, 0.15);
    this.engFilter.frequency.setTargetAtTime(220 + thrust * 900 + ship.boost * 600, t, 0.2);
    const pitch = 1 + thrust * 0.4 + ship.boost * 0.3;
    this.engOsc[0].frequency.setTargetAtTime(55 * pitch, t, 0.2);
    this.engOsc[1].frequency.setTargetAtTime(55.7 * pitch, t, 0.2);
    this.engOsc[2].frequency.setTargetAtTime(110.4 * pitch, t, 0.2);
    this.hissGain.gain.setTargetAtTime(shipMode ? (thrust * 0.05 + ship.boost * 0.05) : 0, t, 0.2);
    this.cruiseGain.gain.setTargetAtTime(shipMode && ship.cruise ? 0.04 : 0, t, 0.5);
    this.cruiseOsc.frequency.setTargetAtTime(180 + Math.min(1, ship.speed / 5000) * 260, t, 0.5);
    this.jetGain.gain.setTargetAtTime(!shipMode && game.player.jetting ? 0.1 : 0, t, 0.05);

    // ambient pad follows the world (or space)
    const inAtmo = planet && (shipMode ? ship.body.pos.length() < planet.atmoTop : true);
    const key = inAtmo ? planet.def.id : 'space';
    if (key !== this.padKey) {
      this.padKey = key;
      PAD_CHORDS[key].forEach((f, i) => this.padOsc[i].frequency.setTargetAtTime(f / 2, t, 2.5));
      this.padFilter.frequency.setTargetAtTime(key === 'space' ? 600 : 1100, t, 2);
    }
    this.padGain.gain.setTargetAtTime(0.32, t, 3);

    // gameplay events
    if (!shipMode) {
      for (const e of game.player.events) {
        if (e === 'step') this.step(planet, game.player.speed > 6);
        else if (e === 'land') this.event('land');
        else if (e === 'jump') this.event('jump');
        else if (e === 'lava') this.event('lava');
      }
    }
    for (const e of ship.events) this.event(e);
    for (const c of game.fauna.calls) this.call(c, c.dist);
  }
}
