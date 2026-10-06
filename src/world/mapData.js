// src/world/mapData.js — async načítanie OSM mapy s fallbackom.
//  vite dev/build: GET /data/mapData.json alebo ./data/mapData.json (public/ → koreň)
//  python -m http.server (bez Vite): GET ./public/data/mapData.json (repo koreň)
//  file:// bez servera: fetch zlyhá na CORS → použije sa TINY fallback,
//  aby hra vždy nabehla; plná mapa dobehne hneď, ako sa otvorí cez http(s).
import { WORLD } from '../core/config.js';
import { fetchJsonAsync, fetchFirst, nextFrame } from '../core/loader.js';

const CANDIDATES = [
  '/data/mapData.json', './data/mapData.json', 'data/mapData.json',
  '/public/data/mapData.json', './public/data/mapData.json', 'public/data/mapData.json',
];

/** Minimálna hrateľná mapa, keď fetch zlyhá (file:// bez servera). */
export const TINY_FALLBACK = {
  elev: [], route: [0, 0, 0, -100, 0, -200], streets: [], roundabouts: [],
  bridge: [0, 0, 0], pois: [[0, -50, 'Námestie sv. Michala']],
  length: 200, roads: [[3.5, 0, 0, 0, -200]], dirt: [], rounds: [],
  blds: [], water: [], tlabels: [], links: [], rails: [], rbridges: [],
  greens: [], bbox: [-300, -300, 300, 300],
};

export function pruneOSM(d, decimals = 1) {
  // Redundantné OSM tagy sa už pri extrakcii vyhodili (zostali len kompaktné
  // [šírka,x,z,…] vektory + POI). Tu len kvantizácia na ~10 cm.
  const q = (n) => Math.round(Number(n) * 10 ** decimals) / 10 ** decimals;
  const walk = (v) => Array.isArray(v) ? v.map((x) => (typeof x === 'number' ? q(x) : (Array.isArray(x) ? walk(x) : x))) : v;
  const out = {};
  for (const [k, v] of Object.entries(d)) out[k] = Array.isArray(v) ? walk(v) : v;
  return out;
}

export async function loadMapData(onProgress) {
  for (const url of CANDIDATES) {
    try {
      const data = await fetchJsonAsync(url, (p) => onProgress?.(p, `mapa: ${url} ${(p * 100) | 0} %`));
      await nextFrame();
      console.info(`[map] ${url} OK (${(JSON.stringify(data).length / 1024).toFixed(0)} kB)`);
      return { data, url, fallback: false };
    } catch (e) { /* skús ďalšie */ }
  }
  // fetchFirst ako posledná šanca s detailnou chybou — inak fallback
  console.warn('[map] fetch zlyhal (asi file:// bez servera) → TINY_FALLBACK. Spusti `npm run dev`.');
  return { data: TINY_FALLBACK, url: null, fallback: true };
}

// Validácia tvaru (fail-fast s zrozumiteľnou hláškou, nie NaN v teréne)
export function assertMapShape(d) {
  for (const k of ['roads', 'blds', 'bbox', 'route']) {
    if (!Array.isArray(d[k])) throw new Error(`mapData.json: chýba pole "${k}"`);
  }
  return true;
}
