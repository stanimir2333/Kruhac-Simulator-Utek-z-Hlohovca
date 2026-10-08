// src/world/mapData.js — async načítanie OSM mapy s fallbackom.
//  vite dev/build: GET /data/mapData.json alebo ./data/mapData.json (public/ → koreň)
//  python -m http.server (bez Vite): GET ./public/data/mapData.json (repo koreň)
//  file:// bez servera: fetch zlyhá na CORS → použije sa TINY fallback,
//  aby hra vždy nabehla; plná mapa dobehne hneď, ako sa otvorí cez http(s).
//
// mapData.json sa pri `npm run build` PREPISUJE z monolit index.html (prebuild →
// extract-monolith.py), takže sa doň nesmie pridávať nič vlastné. Vrstvy, ktoré
// treba dorobiť z nového OSM exportu (budovy, stromy, body ele), žijú v
// `osmExtra.json` a tento modul ich načíta a zloží NAD mapData.
import { fetchJsonAsync, nextFrame } from '../core/loader.js';

const CANDIDATES = [
  '/data/mapData.json', './data/mapData.json', 'data/mapData.json',
  '/public/data/mapData.json', './public/data/mapData.json', 'public/data/mapData.json',
];

// Pre assets/ platí ten istý zoznam (repo koreň aj Pages servírujú /assets/…;
// len na *projektovej* stránke absolútne kandidáty spadnú, lebo chýba /<repo>/).
const ASSET_CANDIDATES = [
  'assets/', './assets/', '/assets/',
  'public/assets/', './public/assets/', 'public/assets/',
];

/** Minimálna hrateľná mapa, keď fetch zlyhá (file:// bez servera). */
export const TINY_FALLBACK = {
  elev: [], route: [0, 0, 0, -100, 0, -200], streets: [], roundabouts: [],
  bridge: [0, 0, 0], pois: [[0, -50, 'Námestie sv. Michala']],
  length: 200, roads: [[3.5, 0, 0, 0, -200]], dirt: [], rounds: [],
  blds: [], water: [], tlabels: [], links: [], rails: [], rbridges: [],
  greens: [], bbox: [-300, -300, 300, 300],
};

// (pruneOSM odstránená: nikdy sa nezavolala — extrakcia z monolitu už zháňa
//  zbytočné tagy a kvantizáciu robí priamo.)

export async function loadMapData(onProgress) {
  for (const url of CANDIDATES) {
    try {
      // fetchJsonAsync vracia aj `bytes` — veľkosť payloadu z reálneho fetchu,
      // nie z JSON.stringify(data), ktorý by znovu prešiel celú mapu.
      const { data, bytes } = await fetchJsonAsync(url, (p) => onProgress?.(p, `mapa: ${url} ${(p * 100) | 0} %`));
      await nextFrame();
      console.info(`[map] ${url} OK (${(bytes / 1024).toFixed(0)} kB)`);
      return { data, url, fallback: false };
    } catch { /* skús ďalej */ }
  }
  console.warn('[map] fetch zlyhal (asi file:// bez servera) → TINY_FALLBACK. Spusti `npm run dev`.');
  return { data: TINY_FALLBACK, url: null, fallback: true };
}

// ---------- NADSTAVY Z NOVÉHO OSM EXPORTU (osmExtra.json) ----------
// Budovy (5 681 z exportu + 500 zo základu mimo jeho bounding boxu), body
// `ele=` a body stromov. Generuje ich `python3 tools/gen_osm_extra.py`.
const EXTRA_CANDIDATES = [
  '/data/osmExtra.json', './data/osmExtra.json', 'data/osmExtra.json',
  '/public/data/osmExtra.json', './public/data/osmExtra.json', 'public/data/osmExtra.json',
];

async function loadExtra(onProgress) {
  for (const base of EXTRA_CANDIDATES) {
    try {
      const { data, bytes } = await fetchJsonAsync(base, (p) => onProgress?.(p, `vrstvy OSM: ${(p * 100) | 0} %`));
      console.info(`[map] ${base} OK (${(bytes / 1024).toFixed(0)} kB)`);
      return data;
    } catch { /* skús ďalej */ }
  }
  return null;
}

// ---------- VÝŠKOVÁ MAPA (SRTM DEM, assets/terrain/hlohovec_dem.*) ----------
// Vracia Float32Array v hracích Y (m nad S.ELE_DATUM) na mriežke TER_SEG+1,
// alebo null. Spodny zdroj terenu — bez neho height.js použije starý
// analytický model z OSM bodov (fallback, viditeľný v konzole).
//
// DEM je uložený ako R=high byte, G=low byte jednej 16-bitovej hodnoty, pretože
// canvas getImageData vracia len 8 bitov — 16-bitová PNG by sa v hre stratila na
// 0,7 m/krok a auto by posakovalo na rovine.
async function fetchAsset(name) {
  let last = null;
  for (const base of ASSET_CANDIDATES) {
    try {
      const r = await fetch(base + name);
      if (!r.ok) { last = `HTTP ${r.status}`; continue; }
      return await r.blob();
    } catch (e) { last = e?.message || String(e); }
  }
  console.warn(`[DEM] ${name} sa nepodarilo stiahnuť (${last})`);
  return null;
}

async function loadHeightmap() {
  const metaBlob = await fetchAsset('terrain/hlohovec_dem.json');
  if (!metaBlob) return null;
  let meta;
  try { meta = JSON.parse(await metaBlob.text()); } catch (e) { return null; }
  const pngBlob = await fetchAsset('terrain/' + (meta.file || 'hlohovec_dem.png'));
  if (!pngBlob) return null;
  let bmp;
  try {
    bmp = await createImageBitmap(pngBlob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  } catch (e) {
    console.warn('[DEM] createImageBitmap zlyhal, idem cez <img>:', e);
    bmp = await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = URL.createObjectURL(pngBlob);
    });
  }
  const w = meta.w, h = meta.h;
  if (!w || !h || bmp.width !== w || bmp.height !== h) {
    console.warn(`[DEM] rozmer nesúhlasí s meta (${bmp.width}x${bmp.height} vs ${w}x${h}) → fallback`);
    return null;
  }
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
  ctx.drawImage(bmp, 0, 0);
  bmp.close?.();
  let px;
  try { px = ctx.getImageData(0, 0, w, h, { colorSpace: 'srgb' }).data; }
  catch (e) { console.warn('[DEM] getImageData zlyhal (tainted canvas?) → fallback', e); return null; }
  // base je v nadmorských metroch; hra = m nad S.ELE_DATUM
  const base = meta.base - (meta.datum ?? 130.2);
  const scale = meta.scale ?? 0.1;
  const out = new Float32Array(w * h);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0, n = w * h; i < n; i++) {
    const q = px[i * 4] * 256 + px[i * 4 + 1];
    const v = base + q * scale;
    out[i] = v;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  console.info(`[DEM] SRTM ${w}x${h} bodov, herna Y ${lo.toFixed(1)}..${hi.toFixed(1)} m`);
  return { grid: out, w, h, bbox: meta.bbox, src: meta.src };
}

/**
 * Načíta všetko, čo potrebuje world: mapData + vrstvy z nového exportu + DEM.
 * Vracia `osm` objekt pripravený na S.osm.
 */
export async function loadWorld(onProgress) {
  const res = await loadMapData(onProgress);
  const osm = res.data, url = res.url, fallback = res.fallback;
  const extra = await loadExtra(onProgress);
  if (extra) {
    // zámena, nie doplnenie: export je novší zdroj pravdy pre tieto vrstvy
    if (Array.isArray(extra.blds) && extra.blds.length) osm.blds = extra.blds;
    if (Array.isArray(extra.elev) && extra.elev.length) osm.elev = extra.elev;
    if (extra.trees) osm.trees = extra.trees;
  } else {
    console.warn('[map] osmExtra.json chýba → staré vrstvy (python3 tools/gen_osm_extra.py)');
  }
  const dem = await loadHeightmap();
  if (!dem && !fallback) console.warn('[DEM] výšková mapa chýba → terén bez podkladu (len body ele + zvlnenie). Spusti python3 tools/build_dem.py');
  return { osm, url, fallback, dem };
}

// Validácia tvaru (fail-fast s zrozumiteľnou hláškou, nie NaN v teréne)
export function assertMapShape(d) {
  for (const k of ['roads', 'blds', 'bbox', 'route']) {
    if (!Array.isArray(d[k])) throw new Error(`mapData.json: chýba pole "${k}"`);
  }
  return true;
}