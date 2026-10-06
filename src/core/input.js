// src/core/input.js — klávesnica + dotyk (bez alokácií v slučke).
export function createInput() {
  const keys = Object.create(null);
  const touch = { left: false, right: false, gas: false, brake: false, hand: false };
  const onKey = (down) => (e) => {
    if (e.repeat) return;
    keys[e.code] = down;
    if (down && ['ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault?.();
  };
  const kd = onKey(true), ku = onKey(false);
  window.addEventListener('keydown', kd);
  window.addEventListener('keyup', ku);

  // dotykové tlačidlá (id z index.html) — bindujeme len ak existujú
  const bindHold = (id, prop) => {
    const el = document.getElementById(id);
    if (!el) return;
    const on = (e) => { e.preventDefault(); touch[prop] = true; };
    const off = (e) => { e.preventDefault(); touch[prop] = false; };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('pointerleave', off);
  };
  bindHold('t-left', 'left'); bindHold('t-right', 'right');
  bindHold('t-gas', 'gas'); bindHold('t-brake', 'brake'); bindHold('t-hand', 'hand');

  return {
    keys, touch,
    // Konvencia z monolitu (steerInput = left − right): vľavo = +1, heading rastie doľava.
    axis() {
      const l = (keys.KeyA || keys.ArrowLeft || touch.left) ? 1 : 0;
      const r = (keys.KeyD || keys.ArrowRight || touch.right) ? 1 : 0;
      return l - r;
    },
    throttle() {
      if (keys.KeyW || keys.ArrowUp || touch.gas) return 1;
      return 0;
    },
    brake() {
      if (keys.KeyS || keys.ArrowDown || touch.brake) return 1;
      return 0;
    },
    handbrake() { return !!(keys.Space || touch.hand); },
    dispose() {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
    },
  };
}
