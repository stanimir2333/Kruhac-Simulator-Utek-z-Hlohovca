// src/ui/hud.js — throttled HUD (5 Hz, žiadny layout thrash; budíky majú vlastný canvas).
// Názov ulice z OSM streets rozsahov (civilná verzia legacy streetAt).
function streetName(osm, s) {
  for (const [a, b, name] of osm.streets || []) if (s >= a && s < b) return name;
  return 'CESTA 513';
}

export function createHUD(state) {
  const el = (id) => document.getElementById(id);
  const ui = {
    hud: el('hud'), speed: el('hud-speed'), dist: el('hud-dist'), time: el('hud-time'),
    street: el('hud-street'), toast: el('toast'), fps: el('fps'),
    barTemp: el('bar-temp'), barStress: el('bar-stress'),
    valTemp: el('val-temp'), valStress: el('val-stress'), route: document.querySelector('#bar-route>i'),
  };
  let toastT = 0;
  return {
    show() { ui.hud?.classList.add('on'); },
    toast(msg, ms = 2200) {
      if (!ui.toast) return;
      ui.toast.textContent = msg; ui.toast.classList.add('show');
      clearTimeout(toastT); toastT = setTimeout(() => ui.toast.classList.remove('show'), ms);
    },
    /** Volaj max 5×/s z main loopu. */
    update(dt, t, playerS, routeLen, osm) {   // eslint-disable-line no-unused-vars
      if (!ui.hud?.classList.contains('on')) return;
      const p = state.player;
      const kmh = Math.abs(p.speed) * 3.6;
      if (ui.speed) ui.speed.textContent = kmh | 0;
      if (ui.dist) ui.dist.textContent = Math.max(0, routeLen - playerS) | 0;
      if (ui.time) { const s = t | 0; ui.time.textContent = `${(s / 60) | 0}:${String(s % 60).padStart(2, '0')}`; }
      if (ui.street && osm) ui.street.textContent = streetName(osm, playerS) + ' → VON Z MESTA';
      if (ui.route) ui.route.style.width = `${(100 * playerS / routeLen).toFixed(1)}%`;
      const tmp = Math.round(p.temp * 100), str = Math.round(p.stress * 100);
      if (ui.valTemp) ui.valTemp.textContent = tmp + '%';
      if (ui.valStress) ui.valStress.textContent = str + '%';
      ui.barTemp?.firstElementChild && (ui.barTemp.firstElementChild.style.width = tmp + '%');
      ui.barStress?.firstElementChild && (ui.barStress.firstElementChild.style.width = str + '%');
      ui.barTemp?.classList.toggle('hot', p.temp > 0.85);
      ui.barStress?.classList.toggle('hot', p.stress > 0.85);
    },
  };
}
