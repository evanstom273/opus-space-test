// On-screen touch controls for phones/tablets: a floating joystick (move on
// foot, steer the ship), swipe-to-look on the right side, and context buttons
// that feed the same key codes the keyboard uses.
export function isTouchDevice() {
  return ('ontouchstart' in window) || navigator.maxTouchPoints > 0 || new URLSearchParams(location.search).has('touch');
}

const FOOT_BUTTONS = [
  { id: 'jump', label: 'JUMP', code: 'Space', hold: true, cls: 'big' },
  { id: 'run', label: 'RUN', code: 'ShiftLeft', toggle: true },
  { id: 'board', label: 'BOARD', code: 'KeyF', tap: true, ctx: 'board', cls: 'accent' },
];
const SHIP_BUTTONS = [
  { id: 'thrust', label: 'THRUST', code: 'KeyW', hold: true, cls: 'big' },
  { id: 'brake', label: 'BRAKE', code: 'KeyS', hold: true },
  { id: 'up', label: 'UP', code: 'Space', hold: true },
  { id: 'down', label: 'DOWN', code: 'KeyC', hold: true },
  { id: 'boost', label: 'BOOST', code: 'ShiftLeft', toggle: true },
  { id: 'rollL', label: '⟲', code: 'KeyA', hold: true, cls: 'small' },
  { id: 'rollR', label: '⟳', code: 'KeyD', hold: true, cls: 'small' },
  { id: 'exit', label: 'EXIT', code: 'KeyF', tap: true, ctx: 'exit', cls: 'accent' },
];

export class TouchControls {
  constructor(root, input, game) {
    this.input = input;
    this.game = game;
    input.touchMode = true;
    this.root = document.createElement('div');
    this.root.className = 'touch-ui';
    root.appendChild(this.root);

    this.joyBase = document.createElement('div');
    this.joyBase.className = 'joy-base';
    this.joyKnob = document.createElement('div');
    this.joyKnob.className = 'joy-knob';
    this.joyBase.appendChild(this.joyKnob);
    this.root.appendChild(this.joyBase);

    this.groups = {};
    this.buttons = {};
    for (const [name, defs] of [['foot', FOOT_BUTTONS], ['ship', SHIP_BUTTONS]]) {
      const g = document.createElement('div');
      g.className = `touch-buttons ${name}`;
      for (const d of defs) {
        const b = document.createElement('div');
        b.className = `tbtn ${d.cls || ''} b-${d.id}`;
        b.textContent = d.label;
        b.dataset.id = d.id;
        g.appendChild(b);
        this.buttons[name + ':' + d.id] = { el: b, def: d, on: false };
        this._bindButton(b, d, name);
      }
      this.root.appendChild(g);
      this.groups[name] = g;
    }
    // small utility buttons (journal, time of day, camera)
    const util = document.createElement('div');
    util.className = 'touch-util';
    for (const [label, code] of [['LOG', 'Tab'], ['TIME', 'KeyT'], ['CAM', 'KeyV']]) {
      const b = document.createElement('div');
      b.className = 'tbtn small';
      b.textContent = label;
      b.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); input.pressed.add(code); }, { passive: false });
      util.appendChild(b);
    }
    this.root.appendChild(util);

    this.joy = null;  // { id, x0, y0 }
    this.look = null; // { id, x, y }
    const canvas = game.pipeline.renderer.domElement;
    const opts = { passive: false };
    canvas.addEventListener('touchstart', (e) => this._start(e), opts);
    canvas.addEventListener('touchmove', (e) => this._move(e), opts);
    canvas.addEventListener('touchend', (e) => this._end(e), opts);
    canvas.addEventListener('touchcancel', (e) => this._end(e), opts);
  }

  _bindButton(el, d, group) {
    const input = this.input;
    const state = this.buttons[group + ':' + d.id];
    el.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (d.toggle) {
        state.on = !state.on;
        if (state.on) input.keys.add(d.code); else input.keys.delete(d.code);
        el.classList.toggle('on', state.on);
      } else {
        input.keys.add(d.code);
        input.pressed.add(d.code);
        el.classList.add('on');
      }
    }, { passive: false });
    const release = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (d.toggle) return;
      input.keys.delete(d.code);
      el.classList.remove('on');
    };
    el.addEventListener('touchend', release, { passive: false });
    el.addEventListener('touchcancel', release, { passive: false });
  }

  _start(e) {
    e.preventDefault();
    if (!this.input.touchStarted) {
      this.input.touchStarted = true;
      this.game.hud.setLocked(true);
      this.game.audio.resume();
      this.root.classList.add('active');
      return;
    }
    const w = window.innerWidth;
    for (const t of e.changedTouches) {
      if (t.clientX < w * 0.45 && !this.joy) {
        this.joy = { id: t.identifier, x0: t.clientX, y0: t.clientY };
        this.joyBase.style.left = `${t.clientX}px`;
        this.joyBase.style.top = `${t.clientY}px`;
        this.joyBase.classList.add('show');
        this._setStick(0, 0);
      } else if (!this.look) {
        this.look = { id: t.identifier, x: t.clientX, y: t.clientY };
        this.input.touchLooking = true;
      }
    }
  }

  _move(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (this.joy && t.identifier === this.joy.id) {
        const R = 60;
        let dx = (t.clientX - this.joy.x0) / R, dy = (t.clientY - this.joy.y0) / R;
        const m = Math.hypot(dx, dy);
        if (m > 1) { dx /= m; dy /= m; }
        this._setStick(dx, dy);
      } else if (this.look && t.identifier === this.look.id) {
        this.input.mouseDX += (t.clientX - this.look.x) * 1.6;
        this.input.mouseDY += (t.clientY - this.look.y) * 1.6;
        this.look.x = t.clientX;
        this.look.y = t.clientY;
      }
    }
  }

  _end(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (this.joy && t.identifier === this.joy.id) {
        this.joy = null;
        this.joyBase.classList.remove('show');
        this._setStick(0, 0);
        this.input.stickActive = false;
      } else if (this.look && t.identifier === this.look.id) {
        this.look = null;
        this.input.touchLooking = false;
      }
    }
  }

  _setStick(x, y) {
    this.input.stickActive = true;
    this.input.stickX = x;
    this.input.stickY = y;
    this.joyKnob.style.transform = `translate(${x * 60}px, ${y * 60}px)`;
  }

  update() {
    const g = this.game;
    const ship = g.mode === 'ship';
    this.groups.foot.classList.toggle('show', !ship);
    this.groups.ship.classList.toggle('show', ship);
    this.buttons['foot:board'].el.classList.toggle('hidden', !(g._nearShip && g._nearShip()));
    this.buttons['ship:exit'].el.classList.toggle('hidden', !(ship && g.ship.landed));
    // release toggles that belong to the other mode
    if (ship && this.buttons['foot:run'].on) { this.buttons['foot:run'].on = false; this.buttons['foot:run'].el.classList.remove('on'); }
    if (!ship && this.buttons['ship:boost'].on) { this.buttons['ship:boost'].on = false; this.buttons['ship:boost'].el.classList.remove('on'); this.input.keys.delete('ShiftLeft'); }
    if (ship && this.buttons['foot:run'].on === false && !this.buttons['ship:boost'].on) this.input.keys.delete('ShiftLeft');
  }
}
