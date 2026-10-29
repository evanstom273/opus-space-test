// Keyboard + mouse (pointer lock) input with per-frame edge detection.
export class Input {
  constructor(element) {
    this.el = element;
    this.keys = new Set();
    this.pressed = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.buttons = 0;
    this.locked = false;
    this.onLockChange = null;
    this.touchMode = false;
    this.touchStarted = false;
    this.stickActive = false;
    this.stickX = 0;
    this.stickY = 0;
    this.touchLooking = false;
    // gamepad state (standard mapping)
    this.padKeys = new Set();
    this.padActive = false;
    this.padJustActivated = false;
    this.padLooking = false;
    this._padStick = false;
    this.padName = '';

    window.addEventListener('keydown', (e) => {
      if (e.repeat) { if (this._block(e)) e.preventDefault(); return; }
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (this._block(e)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    });
    element.addEventListener('mousedown', (e) => {
      this.buttons |= 1 << e.button;
    });
    window.addEventListener('mouseup', (e) => {
      this.buttons &= ~(1 << e.button);
    });
    element.addEventListener('wheel', (e) => {
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
    element.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
      if (!this.locked) this.keys.clear();
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }

  _block(e) {
    return ['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ControlLeft'].includes(e.code);
  }

  requestLock() {
    if (!this.locked) this.el.requestPointerLock?.();
  }

  down(...codes) {
    for (const c of codes) if (this.keys.has(c) || this.padKeys.has(c)) return true;
    return false;
  }

  // Poll the first connected gamepad and map it onto the same virtual keys,
  // joystick and look deltas the keyboard/mouse/touch paths use.
  pollGamepad(dt, mode) {
    this.padJustActivated = false;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (const p of pads) if (p && p.connected) { gp = p; break; }
    if (!gp) {
      if (this._padStick) { this.stickActive = false; this.stickX = 0; this.stickY = 0; this._padStick = false; }
      this.padKeys.clear();
      this.padLooking = false;
      return;
    }
    const dz = (v) => (Math.abs(v) < 0.16 ? 0 : (v - Math.sign(v) * 0.16) / 0.84);
    const btn = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
    const val = (i) => (gp.buttons[i] ? gp.buttons[i].value : 0);
    const lx = dz(gp.axes[0] || 0), ly = dz(gp.axes[1] || 0);
    const rx = dz(gp.axes[2] || 0), ry = dz(gp.axes[3] || 0);
    const keys = new Set();
    if (mode === 'ship') {
      if (val(7) > 0.15) keys.add('KeyW');        // RT thrust
      if (val(6) > 0.15) keys.add('KeyS');        // LT brake
      if (btn(0)) keys.add('Space');              // A up
      if (btn(1)) keys.add('KeyC');               // B down
      if (btn(3) || btn(10)) keys.add('ShiftLeft'); // Y / L3 boost
      if (btn(4)) keys.add('KeyA');               // LB roll left
      if (btn(5)) keys.add('KeyD');               // RB roll right
      if (btn(2)) keys.add('KeyF');               // X exit
    } else {
      if (btn(0)) keys.add('Space');              // A jump / jetpack
      if (btn(1) || btn(10)) keys.add('ShiftLeft'); // B / L3 sprint
      if (btn(2)) keys.add('KeyF');               // X board
    }
    if (btn(9)) keys.add('Tab');                  // Start journal
    if (btn(8)) keys.add('KeyV');                 // Back camera
    if (btn(12)) keys.add('KeyL');                // D-pad up lamp
    if (btn(13)) keys.add('KeyT');                // D-pad down time
    const any = keys.size > 0 || lx || ly || rx || ry;
    if (any && !this.padActive) { this.padActive = true; this.padJustActivated = true; this.padName = gp.id; }
    for (const k of keys) if (!this.padKeys.has(k)) this.pressed.add(k);
    this.padKeys = keys;
    // left stick: move / steer (unless a touch joystick is in use)
    if (lx || ly) {
      this.stickActive = true; this.stickX = lx; this.stickY = ly; this._padStick = true;
    } else if (this._padStick) {
      this.stickActive = false; this.stickX = 0; this.stickY = 0; this._padStick = false;
    }
    // right stick: look (on foot) / free-look orbit (in ship)
    this.padLooking = mode === 'ship' && (Math.abs(rx) > 0 || Math.abs(ry) > 0);
    this.mouseDX += rx * 650 * dt;
    this.mouseDY += ry * 650 * dt;
  }

  hit(...codes) {
    for (const c of codes) if (this.pressed.has(c)) return true;
    return false;
  }

  axis(neg, pos) {
    return (this.down(...pos) ? 1 : 0) - (this.down(...neg) ? 1 : 0);
  }

  endFrame() {
    this.pressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }
}
