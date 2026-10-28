// src/ui/garage.js — GARÁŽ: menu výberu auta hráča so štatistikami [G].
// Karty sa stavajú z katalógu CARS (src/core/config.js) — meshe vyberá
// world/cars.js podľa id, motor hľadá main v physics/vehicle.js ENGINE.
// Výber motora ZANIKOL: motor patrí typu auta (Octavia → 1.9 TDI,
// RX-7 → 4-ROTOR WANKEL), prepínač [G] teraz otvára túto garáž.
// Overlay = pauza v rovnakom duchu ako bigmap (ui/menus.js): otvorenie nastaví
// state.paused, zatvorenie ho vráti — ale NECHÁ pauzu, ak ju drží veľká mapa.
import { CARS } from '../core/config.js';

export function wireGarage(state, hud, api) {
  const $ = (id) => document.getElementById(id);
  const panel = $('garage');
  const list = $('garage-list');
  let pausedByGarage = false;

  // Katalóg → karty. applyCar(id) volá main (mesh swap + motor podľa auta).
  if (list) {
    list.innerHTML = '';
    for (const id in CARS) {
      const c = CARS[id];
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'gcar';
      card.dataset.car = id;
      const rows = c.stats.map(([k, v]) =>
        `<span class="gcr"><i>${k}</i><b>${v}</b></span>`).join('');
      card.innerHTML =
        `<span class="gchead">${c.name}<b class="gcbadge">AKTÍVNE</b></span>` +
        `<span class="gcsub">${c.sub}</span>` +
        rows +
        `<span class="gcdesc">${c.desc}</span>` +
        `<span class="gcengine">MOTOR: ${c.engine === 'wankel' ? '4-ROTOR WANKEL' : '1.9 TDI'}</span>`;
      card.addEventListener('click', () => {
        api.apply(id);
        refresh();
      });
      list.appendChild(card);
    }
  }

  function isOpen() {
    return !!panel && !panel.classList.contains('hidden');
  }

  /** Zelené rámčeky na aktívnom aute — volá sa pri otvorení aj po výbere. */
  function refresh() {
    if (!panel) return;
    const cur = api.carId();
    for (const el of panel.querySelectorAll('.gcar')) {
      el.classList.toggle('on', el.dataset.car === cur);
    }
  }

  function open() {
    if (!panel || isOpen()) return;
    refresh();
    // Veľká mapa leží NA garáži (z-index 70 > 60) — zatvor ju, inak by garáž
    // sedela pod mapou neviditeľná a hráč by vďaka pauze stál.
    const big = $('bigmap');
    if (big && !big.classList.contains('hidden')) big.classList.add('hidden');
    panel.classList.remove('hidden');
    hud.toast('GARÁŽ · vyber si auto (motor patrí typu auta)');
    if (state.started && !state.paused) {
      state.paused = true; // GARÁŽ = pauza (rovnako ako veľká mapa)
      pausedByGarage = true;
    }
  }

  function close() {
    if (!panel || !isOpen()) return;
    panel.classList.add('hidden');
    if (pausedByGarage) {
      pausedByGarage = false;
      // state.paused je zdieľaný s veľkou mapou: odomknem ho len vtedy, keď
      // mapa nie je otvorená (jej zavretie si pauzu spravuje samo).
      const big = $('bigmap');
      if (!big || big.classList.contains('hidden')) state.paused = false;
    }
  }

  function toggle() {
    if (isOpen()) close(); else open();
  }

  $('garage-btn')?.addEventListener('click', toggle);
  $('garage-close')?.addEventListener('click', close);
  // Klik mimo kariet zavrie (rovnaký vzor ako nastavenia).
  panel?.addEventListener('click', (e) => {
    if (e.target === panel) close();
  });
  // ESC: pri otvorenej garáži len zavrie — v capture fáze so stopImmediate
  // propagáciou, inak by sa na ten istý ESC po zatvorení garáže otvoril aj
  // panel nastavení (settings.js má vlastný ESC listener).
  addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' || !isOpen()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    close();
  }, { capture: true });

  return { open, close, toggle, isOpen };
}
