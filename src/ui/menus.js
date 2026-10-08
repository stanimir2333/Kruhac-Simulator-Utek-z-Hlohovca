// src/ui/menus.js — overlay obrazovky (štart / koniec / nastavenia / bigmap pauza).
import { cheatLocked } from '../game/cheats.js';
// `engine` už sa nepoužíva (FPS limit má vlastného posluchateľa v settings.js)
// — parameter ponechaný kvôli kompatibilite call-site v main.js.
export function wireMenus(state, engine, hud) {   // eslint-disable-line no-unused-vars
  const $ = (id) => document.getElementById(id);
  $('btn-start')?.addEventListener('click', () => {
    $('ov-start')?.classList.add('hidden');
    state.started = true;
    hud.show();
  });
  $('btn-retry')?.addEventListener('click', () => location.reload());

  // Veľká mapa je PAUZA. state.js to dokumentoval (`paused: bigmap / settings`),
  // ale nikto ju nenastavoval — mapa sa otvárala a hra bežila ďalej za ňou
  // (auto jazdilo do kolízie, misie tikali, čas bežal). Now toggling .hidden
  // prepíše aj state.paused.
  const toggleBigMap = () => {
    const el = $('bigmap');
    if (!el) return;
    const open = el.classList.contains('hidden');
    el.classList.toggle('hidden', !open);
    if (state.started) state.paused = open;
  };
  // Nastavenia: ESC má vlastný toggle v settings.js (wireSettingsUI) — tu
  // NESMIEME prepisovať, inak sa dva listenery navzájom rušia.
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyM' && !cheatLocked()) toggleBigMap();
  });
  // ESC zavrie aj veľkú mapu (legend v bigmap-legend to sľubuje). Beží v capture
  // fáze a volá stopImmediatePropagation, aby sa na ten istý ESC nezobudil aj
  // settings.js a neotvoril panel nastavení naraz s mapou.
  addEventListener('keydown', (e) => {
    if (e.code !== 'Escape') return;
    const el = $('bigmap');
    if (!el || el.classList.contains('hidden')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    toggleBigMap();
  }, { capture: true });
  $('set-btn')?.addEventListener('click', () => $('settings')?.classList.toggle('hidden'));
  $('btn-set-close')?.addEventListener('click', () => $('settings')?.classList.add('hidden'));
  $('minimap-wrap')?.addEventListener('click', toggleBigMap);
  // Klik do mapy ju zavrie (bez toho by ostala navždy otvorená — ESC zavrie
  // len nastavenia).
  $('bigmap')?.addEventListener('click', (e) => {
    if (e.target === $('bigmap')) toggleBigMap();
  });
}