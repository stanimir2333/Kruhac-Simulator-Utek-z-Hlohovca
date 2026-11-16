// src/game/labyrinth.js — dvere do labirintu pred kostolom sv. Michala.
// Pred južnou fasádou kostola stoja voľne magické dvere (kamený portál s cyan
// žiarou, estetika tatra-labyrinth). Keď sa k nim hráč priblíži — pešo aj autom —
// hra sa pauzne a fullscreen iframe načíta tatra-labyrinth.html. Výhra aj
// tlačidlo "SPÄŤ DO HLOHOVCA" prídu z iframe ako postMessage → overlay sa
// zavrie a svet beží ďalej presne odtiaľ, kde zamrzol (auto aj peší ostávajú
// na svojom mieste — svet sa počas labirintu netočí).
import * as THREE from 'three';
import { getTerrainHeight } from '../world/height.js';

// Poloha dverí: námestie južne od kostola sv. Michala, priamo od trasy 513.
// Kolízny OBB kostola je z nepravidelného pôdorysu veľký a vyčnieva ~15 m
// pred viditeľnú fasádu — dvere stoja ~3 m pred OBB, aby boli dosiahnuteľné
// (push-out ich inak nedovolí osloviť). Trasa prechádza 38 m južne, takže
// jazda okolo náhodne neotvorí portál — treba k nim zámerne prísť.
const DOOR = { x: -1228.0, z: -650.0, rot: Math.PI };
const R_FOOT = 5.0;   // spúšť na pešo (m)
const R_CAR = 7.0;    // spúšť za volantom (m — auto ide rýchlejšie)
const REARM = 16.0;   // po návrate sa dvere znovu otvoria až po oddialení (m)
const COOLDOWN = 3.0; // tvrdý cooldown po návrate (s), re-arm + cooldown naraz

// Rovnaká kandidátna schéma ako mapData/radio (6 ciest): Vite dev, dist/,
// http.server v koreni, Pages root (public/…), file://. Prvé úspešné fetch
// rozhodne; file:// fetch blokuje, takže padá na relatívny guess nižšie.
const URL_CANDIDATES = [
  '/tatra-labyrinth.html', './tatra-labyrinth.html', 'tatra-labyrinth.html',
  '/public/tatra-labyrinth.html', './public/tatra-labyrinth.html', 'public/tatra-labyrinth.html',
];

// Je overlay labirintu otvorený? Používa sa ako brána pre klávesové skratky
// (M/bigmap by inak odomkol pauzu pod overlayom — pozri menus.js, settings.js).
export function labOpen() {
  const el = document.getElementById('lab');
  return !!el && !el.classList.contains('hidden');
}

export function createLabyrinth(opts = {}) {
  const el = document.getElementById('lab');
  const frame = document.getElementById('lab-frame');
  if (!el || !frame) return { update() {}, isOpen: () => false };

  let url = null;
  let open = false;
  let armed = true; // po návrate false, kým sa hráč neoddiali ≥ REARM
  let cool = 0;     // tvrdý cooldown po návrate (s)

  // Rozlíšenie URL — raz pri boote, idempotentne, ticho pri zlyhaní.
  (async () => {
    for (const c of URL_CANDIDATES) {
      try {
        const r = await fetch(c, { method: 'GET' });
        if (r && r.ok) { url = c; return; }
      } catch (_e) { /* ďalší kandidát */ }
    }
    // file:// — fetch neprejde, ale relatívny src v iframe môže načítať.
    url = location.protocol === 'file:' ? 'public/tatra-labyrinth.html' : URL_CANDIDATES[0];
  })();

  // ---------- MESH: voľne stojaci portál ----------
  // Kamený rám (2 stĺpy + nadstavec), dvojkrídlové tmavé dvere, cyan žiara
  // po stranách — cítiť "iný svet", ladí s neonmi tatra-labyrinthu.
  const scene = opts.scene;
  if (scene) {
    const y0 = getTerrainHeight(DOOR.x, DOOR.z);
    const grp = new THREE.Group();
    grp.position.set(DOOR.x, y0, DOOR.z);
    grp.rotation.y = DOOR.rot;
    const stone = new THREE.MeshStandardMaterial({ color: 0x9b8f80, roughness: 0.9, metalness: 0.02 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x241812, roughness: 0.82, metalness: 0.05 });
    // Kov bez envMapu je čierny → žiara má nízku metalness a živú emissive.
    const glow = new THREE.MeshStandardMaterial({ color: 0x0a2a33, emissive: 0x39d8ff, emissiveIntensity: 1.8, roughness: 0.4, metalness: 0.0 });
    const add = (geo, mat, x, y, z) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      grp.add(m);
      return m;
    };
    add(new THREE.BoxGeometry(0.9, 5.2, 0.9), stone, -2.35, 2.6, 0);   // ľavý stĺp
    add(new THREE.BoxGeometry(0.9, 5.2, 0.9), stone, 2.35, 2.6, 0);    // pravý stĺp
    add(new THREE.BoxGeometry(5.9, 0.9, 1.0), stone, 0, 5.55, 0);      // nadstavec
    add(new THREE.BoxGeometry(1.9, 4.7, 0.14), wood, -0.98, 2.35, 0);  // ľavé krídlo
    add(new THREE.BoxGeometry(1.9, 4.7, 0.14), wood, 0.98, 2.35, 0);   // pravé krídlo
    add(new THREE.BoxGeometry(0.1, 5.0, 0.12), glow, -1.85, 2.5, 0.45); // žiara vľavo
    add(new THREE.BoxGeometry(0.1, 5.0, 0.12), glow, 1.85, 2.5, 0.45);  // žiara vpravo
    add(new THREE.BoxGeometry(3.8, 0.1, 0.12), glow, 0, 4.95, 0.45);    // žiara hore
    scene.add(grp);
  }

  function enter() {
    if (open) return;
    open = true;
    armed = false;
    cool = COOLDOWN;
    frame.src = url || URL_CANDIDATES[0]; // nový beh labirintu pri každom vstupe
    el.classList.remove('hidden');
    if (opts.onEnter) opts.onEnter();
  }

  function leave(won) {
    if (!open) return;
    open = false;
    el.classList.add('hidden');
    frame.src = 'about:blank'; // labirint zastaví (renderer + audio v iframe)
    if (opts.onLeave) opts.onLeave(won);
    try { globalThis.focus(); } catch (_e) { /* noop */ }
  }

  // Správy z tatra-labyrinth (postEmbed): win = vyhraný labirint, return = zobrať
  // späť bez výhry. Tvar správy sa kontroluje — cudzie postMessage ignorujeme.
  addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.type !== 'tatra-labyrinth') return;
    if (d.cmd === 'win') leave(true);
    else if (d.cmd === 'return') leave(false);
  });

  return {
    isOpen: () => open,
    // Per-frame z main.js onTick — beží IBA keď hra nie je pauznutá (po gate),
    // takže počas otvoreného overlayu sa trigger prirodzene nevyhodnocuje.
    update(dt, px, pz) {
      if (open) return;
      if (cool > 0) cool -= dt;
      const dx = px - DOOR.x, dz = pz - DOOR.z;
      const d2 = dx * dx + dz * dz;
      if (!armed) {
        if (d2 >= REARM * REARM) armed = true;
        return;
      }
      if (cool > 0) return;
      const r = opts.onFoot && opts.onFoot() ? R_FOOT : R_CAR;
      if (d2 < r * r) enter();
    },
  };
}
