// src/ui/menus.js — overlay obrazovky (štart / koniec / nastavenia / bigmap pauza).
export function wireMenus(state, engine, hud) {
  const $ = (id) => document.getElementById(id);
  $('btn-start')?.addEventListener('click', () => {
    $('ov-start')?.classList.add('hidden');
    state.started = true;
    hud.show();
  });
  $('btn-retry')?.addEventListener('click', () => location.reload());
  $('set-btn')?.addEventListener('click', () => $('settings')?.classList.toggle('hidden'));
  $('btn-set-close')?.addEventListener('click', () => $('settings')?.classList.add('hidden'));
  addEventListener('keydown', (e) => {
    if (e.code === 'Escape') $('settings')?.classList.toggle('hidden');
    if (e.code === 'KeyM') $('bigmap')?.classList.toggle('hidden');
  });
  $('minimap-wrap')?.addEventListener('click', () => $('bigmap')?.classList.toggle('hidden'));
}
