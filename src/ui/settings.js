// src/ui/settings.js — NASTAVENIA grafiky (port z monolitu, bez ray-tracingu).
//
// ZDROJ: monolit index.monolith.legacy.html, relatívne od `<script type="module">`
//   applyPR @9367 · applyViewDist @9375 · vramEstimate @9389 · vramGuard @9410
//   saveSettings @9419 · loadSettings @9425 · toggleSettings @9445 · syncSettingsUI @9453
//   SHADOW_TIERS + shadowTier/SHADOW_RES/SHADOW_TEXEL/SHADOW_DEPTH @3790–3799
// Overené v src/world/shared.js: shadowTier/SHADOW_RES tam NIE SÚ → deklarované
// tu ako LOKÁLNE. S.* sa používa len pre mená zo shared.js (S.IS_MOBILE).
//
// ADAPTÁCIA (povinná, nie verbatim): monolit čítal globály game/renderer/scene/
// camera/player. Modul drží vlastný `settings` store a berie `ctx`:
//   ctx = { renderer, scene, camera, sun, engine, bloom, water }
// bloom/water sú voliteľné API { setMode(n) } / { setQuality(n) } — volajú sa
// cez ctx.bloom?.setMode(...) / ctx.water?.setQuality(...), žiadne priame
// importy (žiadne cykly: settings nesmie importovať main/engine-loop).
// RT engine sa NEPORTUJE (stage-3): RT podúrovne sa len uložia + toast.
// Žiadne volania pri importe; žiadne game/player/input/bgm.
import { S } from '../world/shared.js';
import { setShadowRangeScale } from '../fx/sunshadow.js';

// Vlastný store (predvolené hodnoty podľa zadania).
export const settings = {
  res: 1, fps: 60, dist: 220, bloom: 1, water: 2, bal: 0,
  rt: true, rtQ: 1, rtSh: 1, rtLi: 1, rtQl: 1, shq: 2,
  music: 1, // hudba (rádio) ZAP = 1 / VYP = 0; motor a zvuky idú vždy
  engine: 'tdi', // motor: 'tdi' (1.9 TDI) | 'wankel' (4-rotor)
};
// Mená motorov pre label (bez importu fyziky — settings nesmie ťahať vehicle).
const ENGINE_NAME = { tdi: '1.9 TDI', wankel: '4-ROTOR' };

// ---------- KVALITA TIENÍ (LOKÁLNE, verbatim monolit @3790–3799) ----------
// [mapSize, strop pre orto polomer v m]. Polomer rastie s mapSize tak, aby hrana
// tieňa nekončila v dohľade hry a zároveň sa stále kryje celá oblasť hráča.
// Texel = 2r/mapSize: 2K@140 = 13.7 cm (povodne 2048@±150 = 14.6 cm),
// 4K@220 = 10.7 cm, 8K@320 = 7.8 cm. Mimo frustumu je hĺbka zbytočná.
const SHADOW_TIERS = [
  { res: 1024, r: 90 },
  { res: 2048, r: 140 },
  { res: 4096, r: 220 },
  { res: 8192, r: 320 },
];
// Monolit: `let shadowTier = IS_MOBILE ? 1 : 2` — tu zrkadlí settings.shq
// (store je zdroj pravdy; držané v synchronizácii v load/apply).
let shadowTier = settings.shq;
let SHADOW_RES = 2048; // efektívne; overí sa cez maxTextureSize
export let SHADOW_TEXEL = 0.1; // m na texel tieňovej mapy (diagnostika)
export let SHADOW_DEPTH = 500; // hĺbkový rozsah tieňového frustumu (diagnostika)

// Mená segmentov (verbatim monolit).
const BLOOM_NAME = ['VYP.', 'SLABÝ', 'JASNÝ'];
const WAT_NAME = ['VYP.', 'NÍZKE', 'VYSOKÉ'];
// Vyváženie: L30 … STRED … R20 (hodnota -1..+1).
function balLabel(v) {
  const p = Math.round(v * 50);
  if (p === 0) return 'STRED';
  return (p < 0 ? 'Ľ' : 'R') + Math.abs(p);
}
// Náhrada labelu za RT_LEVELS[RT.level].name.
const RT_LEVEL_NAMES = ['LITE', 'STANDARD', 'ULTRA'];
// Opačná mapa: RT úroveň → tieňový tier (LITE=2K, STD=4K, ULTRA=8K).
// shadowTier je jediný zdroj pravdy; tieto dva smery ho nemôžu rozejdeť.
const SHADOW_FROM_RT = [1, 2, 3];
// Opačná mapa: tieňový tier → RT úroveň. 1K nemá vlastný preset (najnižšie
// LITE), takže 1K aj 2K zobrazujú LITE; 4K = STANDARD, 8K = ULTRA.
// (index musí zostať v RT_LEVEL_NAMES — dlhé 3 spôsobilo undefined.)
const RT_TIER_FROM_SHADOW = [0, 1, 2, 2];

// Rozpočet VRAM: pri prekročení ustúpi o JEDEN schod
// (max 1× za 3 s, drag slideru nekaskáduje): najprv tiene.
// Monolit potom ustupoval aj RT škálou a bloom lowRes — VYNECHANÉ
// (RT/bloom engine sa neportuje). Vždy s toastom, nikdy potichu.
const VRAM_BUDGET = (S.IS_MOBILE ? 350 : 900) * 1048576;
let vramT = 0;
let setOpen = false;
let _ctx = null;
let _say = null;

// Dočasný terč pre getDrawingBufferSize (bez alokácie, bez importu three:
// three implementácia volá len .set().floor()).
const _vb = {
  x: 0,
  y: 0,
  set(x, y) { this.x = x; this.y = y; return this; },
  floor() { this.x = Math.floor(this.x); this.y = Math.floor(this.y); return this; },
};

const $ = (id) => document.getElementById(id);

// ---------- NASTAVENIA (rozlíšenie / FPS limit / dohľadnosť, perzistencia) ----------
// <- legacy @9367
export function applyPR(ctx) {
  const c = ctx || _ctx;
  const dpr = typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1;
  let v = settings.res * dpr * settings.rtQl; // KVALITA RT škáluje render
  if (v < 0.1) v = 0.1;
  else if (v > 2) v = 2; // strop 2x: 3x + RT ULTRA + 8K tieň = GB VRAM navyše na iGPU so zdieľanou RAM
  if (c?.renderer?.setPixelRatio) c.renderer.setPixelRatio(v);
  // VYNECHANÉ: rtResize()/bloomResize() (stage-3 / bloom engine),
  // prCur/resManual auto-rozlíšenie (engine-loop sa neportuje).
  vramGuard(c, _say); // rozpočet VRAM: prípadný ústup o schod skôr než pád kontextu
}

// <- legacy @9375
export function applyViewDist(ctx) {
  const c = ctx || _ctx;
  if (c?.camera) {
    c.camera.far = settings.dist;
    if (c.camera.updateProjectionMatrix) c.camera.updateProjectionMatrix();
  }
  // hmla drží konštantnú relatívnu dohľadnosť: pri 2 km je mesto vidieť, pri 220 m rovnako ako doteraz
  const fog = c?.scene?.fog;
  if (fog && typeof fog.density === 'number') fog.density = 0.0008 * 220 / settings.dist;
  // VYNECHANÉ: waterResize() (odrazová kamera Váhu — vodný modul).
}

// <- legacy @9389 (bez RT/bloom/vodných bufferov — tie vlastnia neportované moduly)
export function vramEstimate(ctx) {
  const c = ctx || _ctx;
  let b = 0;
  b += SHADOW_RES * SHADOW_RES * 4; // hĺbková mapa tieňov
  const renderer = c?.renderer;
  if (renderer && renderer.getDrawingBufferSize) {
    renderer.getDrawingBufferSize(_vb);
    const W = Math.max(2, _vb.x | 0), H = Math.max(2, _vb.y | 0);
    b += W * H * 4 * 2; // canvas (s MSAA rezervou)
  }
  // VYNECHANÉ: RT buffery (stage-3), composer/srcRT/bloom mipy (bloom engine),
  // odraz hladiny (Váh modul).
  return b;
}

// <- legacy @9410 (RT škála + bloom lowRes vynechané — neportované enginy)
export function vramGuard(ctx, say) {
  const now = performance.now();
  if (now - vramT < 3000) return;
  if (vramEstimate(ctx) < VRAM_BUDGET) return;
  vramT = now;
  if (shadowTier > (S.IS_MOBILE ? 1 : 2)) {
    applyShadowTier(ctx, shadowTier - 1);
    saveSettings();
    if (say) say('VRAM strážca: tiene o stupeň nižšie.');
    return;
  }
  if (say) say('VRAM strážca: rozpočet prekročený.');
}

// Zmena rozlíšenia za behu: Three cacheuje alokáciu, treba mapu zahodiť.
// (verbatim monolit applyShadowTier; sunLight → ctx.sun)
export function applyShadowTier(ctx, t) {
  const c = ctx || _ctx;
  shadowTier = Math.max(0, Math.min(SHADOW_TIERS.length - 1, t));
  settings.shq = shadowTier; // store je zdroj pravdy (monolit: shadowTier)
  const res = SHADOW_TIERS[shadowTier].res;
  const maxTex = c?.renderer ? c.renderer.capabilities.maxTextureSize : 2048;
  const use = Math.min(res, maxTex);
  SHADOW_RES = use; // PRED shadowFrustum(): bias sa odvádza z texelu
  const sun = c?.sun;
  if (sun && sun.shadow && sun.shadow.mapSize) {
    if (sun.shadow.mapSize.width !== use) {
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      sun.shadow.mapSize.width = use;
      sun.shadow.mapSize.height = use;
    }
    sun.shadow.needsUpdate = true;
    // VYNECHANÉ: shadowFrustum()/applyShadowBias()/shForce
    // (tieňový frustum cestuje s hráčom — engine-loop/main.js).
  }
  // Diagnostika bez frustumu: texel z min(dohľad, strop tieru), hĺbka len orientačná.
  // Presné čísla po prvom prepočte prepíše main loop (setShadowDiag).
  const r = Math.max(60, Math.min(settings.dist, SHADOW_TIERS[shadowTier].r));
  SHADOW_TEXEL = (2 * r) / Math.max(1, use);
  SHADOW_DEPTH = 500;
  syncSettingsUI(c);
}

// Diagnostiku frustumu zapisuje main loop (src/fx/sunshadow.js) — priame
// priradenie sem nesmie (importy by spravili cyklus), preto setter.
export function setShadowDiag(texel, depth) {
  SHADOW_TEXEL = texel;
  SHADOW_DEPTH = depth;
}
// Strop orto-polomeru pre aktuálny tier (pre dynamický frustum v main loopu).
export function shadowTierR() {
  return SHADOW_TIERS[Math.max(0, Math.min(SHADOW_TIERS.length - 1, shadowTier))].r;
}

// <- legacy @9419 (rovnaký kľúč aj polia ako monolit)
export function saveSettings() {
  try {
    localStorage.setItem('kruhac-set', JSON.stringify({
      res: settings.res,
      fps: settings.fps,
      dist: settings.dist,
      sh: shadowTier,        // jediný zdroj pravdy pre tieňovú mapu
      bl: settings.bloom,
      wq: settings.water,
      bal: settings.bal,
      rt: settings.rt ? 1 : 0,
      // `rtq` sa už neukladá — odvádza sa zo `sh` (pozri RT_TIER_FROM_SHADOW).
      // Staré zápisy v localStorage sa ignorujú, nič sa nestane.
      rtsh: settings.rtSh,
      rtli: settings.rtLi,
      rtql: settings.rtQl,
      mus: settings.music, // hudba (rádio) 1/0; zvuky motora sa neukladajú
      eng: settings.engine, // motor 'tdi' | 'wankel'
    }));
  } catch (_e) { /* noop: súkromný režim bez localStorage */ }
}

// <- legacy @9425 (rovnaké rozsahy ako monolit)
export function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('kruhac-set') || 'null');
    if (!s) return;
    if (s.res >= 0.5 && s.res <= 2) settings.res = s.res;
    if (s.fps >= 15 && s.fps <= 150) settings.fps = s.fps;
    if (s.dist >= 100 && s.dist <= 2000) settings.dist = s.dist;
    // `sh` (tieňový tier) je jediný uložený zdroj pravdy. `rtq` sa už nečíta
    // — bol to druhý zápis do tej istej premennej a spôsobil, že uložený stav
    // závisel od poradia kliknutí. syncSettingsUI ho odviedie z shadowTier.
    if (s.sh >= 0 && s.sh <= SHADOW_TIERS.length - 1) {
      shadowTier = s.sh;
      settings.shq = s.sh;
    }
    settings.rtQ = RT_TIER_FROM_SHADOW[Math.max(0, Math.min(SHADOW_TIERS.length - 1, shadowTier))];
    if (s.bl >= 0 && s.bl <= 2) settings.bloom = s.bl;
    if (s.wq >= 0 && s.wq <= 2) settings.water = s.wq;
    if (typeof s.bal === 'number' && s.bal >= -1 && s.bal <= 1) settings.bal = s.bal;
    // Monolit: URL prepínače (?rt=/?rtq=/?rts=) mali prednosť pred uloženým
    // nastavením — VYNECHANÉ (neportuje sa; uložené RT sa vždy prevezme).
if (s.rt === 1) settings.rt = true;
    // s.rtq sa už NEČÍTA — pozri komentár vyššie.
    if (s.rtsh >= 0 && s.rtsh <= 1.5) settings.rtSh = s.rtSh;
    if (s.rtli >= 0 && s.rtli <= 2) settings.rtLi = s.rtLi;
    if (s.rtql >= 0.3 && s.rtql <= 1) settings.rtQl = s.rtql;
    if (s.mus === 0 || s.mus === 1) settings.music = s.mus;
    if (s.eng === 'tdi' || s.eng === 'wankel') settings.engine = s.eng;
    settings.shq = shadowTier;
  } catch (_e) { /* noop: poškodený JSON ignoruj */ }
}

// <- legacy @9445 (bez clearInputs/lastT — input/engine-loop sa neportuje)
export function toggleSettings(force) {
  const open = force !== undefined ? force : !setOpen;
  if (open === setOpen) return;
  setOpen = open;
  syncSettingsUI(_ctx);
  if (open) {
    $('settings')?.classList.remove('hidden');
  } else {
    $('settings')?.classList.add('hidden');
    saveSettings();
  }
}

// <- legacy @9453
export function syncSettingsUI(ctx) {
  if (ctx) _ctx = ctx;
  if (typeof document === 'undefined') return;
  const c = _ctx;
  $('set-res') && ($('set-res').value = settings.res);
  const resV = $('set-res-v');
  if (resV) resV.textContent = settings.res.toFixed(1) + 'x';
  $('set-fps') && ($('set-fps').value = settings.fps);
  const fpsV = $('set-fps-v');
  if (fpsV) fpsV.textContent = String(settings.fps);
  $('set-dist') && ($('set-dist').value = settings.dist);
  const distV = $('set-dist-v');
  if (distV) distV.textContent = settings.dist + ' m';
  // --- tieňová mapa ---
  const shqV = $('set-shq-v');
  if (shqV) shqV.textContent = SHADOW_RES + ' px';
  const maxTex = c?.renderer ? c.renderer.capabilities.maxTextureSize : 2048;
  const shs = $('set-shq')?.children;
  if (shs) {
    for (let i = 0; i < shs.length; i++) {
      shs[i].classList.toggle('on', i === shadowTier);
      shs[i].disabled = SHADOW_TIERS[i].res > maxTex; // 8K vypnuté, ak ho GPU nezvládne
    }
  }
  // --- bloom (žiarenie) ---
  const bloomV = $('set-bloom-v');
  if (bloomV) bloomV.textContent = BLOOM_NAME[settings.bloom];
  const bsegs = $('set-bloom')?.children;
  if (bsegs) {
    for (let i = 0; i < bsegs.length; i++) bsegs[i].classList.toggle('on', i === settings.bloom);
  }
  // --- voda ---
  const wqV = $('set-wq-v');
  if (wqV) wqV.textContent = WAT_NAME[settings.water];
  const wsegs = $('set-wq')?.children;
  if (wsegs) {
    for (let i = 0; i < wsegs.length; i++) wsegs[i].classList.toggle('on', i === settings.water);
  }
  // --- zvuk: vyváženie L/R (-1..+1, krok 0.02) ---
  $('set-bal') && ($('set-bal').value = Math.round(settings.bal * 50));
  const balV = $('set-bal-v');
  if (balV) balV.textContent = balLabel(settings.bal);
  // --- hudba (rádio) ZAP/VYP — motor a zvuky idú vždy ---
  const musT = $('set-music-toggle');
  if (musT) {
    musT.classList.toggle('on', settings.music === 1);
    musT.textContent = settings.music === 1 ? 'HUDBA ZAPNUTÁ' : 'ZAPNÚŤ HUDBU';
  }
  const musV = $('set-music-v');
  if (musV) musV.textContent = settings.music === 1 ? 'ZAP.' : 'VYP.';
  // --- motor (prepínač vlastní main.js: fyzika + zvuk + vizualizácia + budíky) ---
  const engV = $('set-engine-v');
  if (engV) engV.textContent = ENGINE_NAME[settings.engine] || ENGINE_NAME.tdi;
  const esegs = $('set-engine')?.children;
  if (esegs) {
    for (let i = 0; i < esegs.length; i++) {
      const b = esegs[i];
      b.classList.toggle('on', b.getAttribute('data-e') === settings.engine);
    }
  }
  // --- ray tracing (engine v stage-3: len stav + labely, bez RT_SPLITPOROV.) ---
  const tg = $('set-rt-toggle');
  if (tg) {
    tg.classList.toggle('on', settings.rt);
    tg.textContent = settings.rt ? 'TIENE ZAPNUTÉ' : 'ZAPNÚŤ TIENE';
  }
  const rtV = $('set-rt-v');
  if (rtV) rtV.textContent = settings.rt ? 'ZAP.' : 'VYP.';
// TIENE·MAPA (LITE/STD/ULTRA) ZOBRAZUJE shadowTier, nie vlastný settings.rtQ.
      // Oba ovládače zapisovali do jednej premennej `shadowTier`, takže uložený
      // stav závisel od toho, ktorý bol kliknutý naposledy (po starte sa navyše
      // načítal `rtq` a prepísal `shq`). Teraz je zdroj pravdy jeden: shadowTier
      // (zapisuje ho set-shq aj set-rtq), a `rtq` sa z neho iba odvádza.
      const qTier = RT_TIER_FROM_SHADOW[shadowTier];
      settings.rtQ = qTier;
      const rtqV = $('set-rtq-v');
      if (rtqV) rtqV.textContent = RT_LEVEL_NAMES[qTier];
      $('settings')?.classList.toggle('rt-off', !settings.rt);
      const segs = $('set-rtq')?.children;
      if (segs) {
        // všetky úrovne dostupné aj na mobile (vrátane 8K tieňovej mapy)
        for (let i = 0; i < segs.length; i++) segs[i].classList.toggle('on', i === qTier);
      }
  $('set-rtsh') && ($('set-rtsh').value = settings.rtSh);
  const rtshV = $('set-rtsh-v');
  if (rtshV) rtshV.textContent = Math.round(settings.rtSh * 100) + '%';
  $('set-rtli') && ($('set-rtli').value = settings.rtLi);
  const rtliV = $('set-rtli-v');
  if (rtliV) rtliV.textContent = Math.round(settings.rtLi * 100) + '%';
  $('set-rtql') && ($('set-rtql').value = settings.rtQl);
  const rtqlV = $('set-rtql-v');
  if (rtqlV) rtqlV.textContent = Math.round(settings.rtQl * 100) + '%';
}

// Nové: aplikuj celý store na ctx (FPS limit, pixelRatio, dohľad, tiene,
// voliteľné bloom/water API). Volá len sync, nič nevracia.
export function applyAll(ctx) {
  if (ctx) _ctx = ctx;
  const c = _ctx;
  if (c?.engine?.setFpsCap) c.engine.setFpsCap(settings.fps);
  applyPR(c);
  applyViewDist(c);
  applyShadowTier(c, settings.shq);
  try { c?.bloom?.setMode?.(settings.bloom); } catch (_e) { /* noop */ }
  try { c?.water?.setQuality?.(settings.water); } catch (_e) { /* noop */ }
  try { c?.audio?.setBalance?.(settings.bal); } catch (_e) { /* noop */ }
  try {
    if (c?.renderer) c.renderer.shadowMap.enabled = settings.rt;
    if (c?.sun) c.sun.intensity = 2.4 * settings.rtLi;
    setShadowRangeScale(settings.rtSh);
  } catch (_e) { /* noop */ }
  syncSettingsUI(c);
}

// Nové: napoj VŠETKY DOM id z index.html. toast(msg) je voliteľný.
// RT podúrovne sa len uložia + toast o stage-3 (RT engine sa neportuje).
export function wireSettingsUI(ctx, toast) {
  if (ctx) _ctx = ctx;
  if (toast) _say = toast;
  const c = _ctx;
  const say = (m) => { if (_say) _say(m); };
  loadSettings();
  applyAll(c);
  syncSettingsUI(c);

  $('set-btn')?.addEventListener('click', () => toggleSettings());
  $('btn-set-close')?.addEventListener('click', () => toggleSettings(false));
  $('settings')?.addEventListener('click', (e) => {
    if (e.target === $('settings')) toggleSettings(false);
  });
  addEventListener('keydown', (e) => {
    if (e.code === 'Escape') toggleSettings();
  });

  $('set-res')?.addEventListener('input', (e) => {
    settings.res = parseFloat(e.target.value);
    const v = $('set-res-v');
    if (v) v.textContent = settings.res.toFixed(1) + 'x';
    // Ručná voľba je posvätná (verbatim komentár): automatika by ju inak
    // prepisovala — auto-rozlíšenie sa však neportuje (engine-loop), takže
    // slider preberá kontrolu priamo.
    applyPR(c);
  });
  $('set-res')?.addEventListener('change', () => saveSettings());

  $('set-fps')?.addEventListener('input', (e) => {
    settings.fps = parseInt(e.target.value, 10);
    const v = $('set-fps-v');
    if (v) v.textContent = String(settings.fps);
    if (c?.engine?.setFpsCap) c.engine.setFpsCap(settings.fps);
  });
  $('set-fps')?.addEventListener('change', () => saveSettings());

  $('set-shq')?.addEventListener('click', (e) => {
    const b = e.target.closest ? e.target.closest('button') : null;
    if (!b || b.disabled) return;
    applyShadowTier(c, parseInt(b.getAttribute('data-s'), 10));
    saveSettings();
  });

  $('set-dist')?.addEventListener('input', (e) => {
    settings.dist = parseInt(e.target.value, 10);
    const v = $('set-dist-v');
    if (v) v.textContent = settings.dist + ' m';
    applyViewDist(c);
  });
  $('set-dist')?.addEventListener('change', () => saveSettings());

  $('set-bal')?.addEventListener('input', (e) => {
    settings.bal = Math.max(-1, Math.min(1, parseInt(e.target.value, 10) / 50));
    const v = $('set-bal-v');
    if (v) v.textContent = balLabel(settings.bal);
  try { c?.audio?.setBalance?.(settings.bal); } catch (_e) { /* noop */ }
  try { c?.audio?.setMusicMuted?.(settings.music !== 1); } catch (_e) { /* noop */ }
  });
  $('set-bal')?.addEventListener('change', () => saveSettings());

  // Hudba (rádio) ZAP/VYP — prepínač vlastní main.js (sfx + rádio + HUD),
  // nastavenia len volajú voliteľné API a prekreslia label.
  $('set-music-toggle')?.addEventListener('click', () => {
    try { c?.audio?.toggleMusic?.(); } catch (_e) { /* noop */ }
    syncSettingsUI(c);
    saveSettings();
  });

  // Motor: segmenty 1.9 TDI / 4-ROTOR — main prepne fyziku, zvuk, vizualizáciu aj budíky.
  $('set-engine')?.addEventListener('click', (e) => {
    const b = e.target.closest ? e.target.closest('button') : null;
    if (!b) return;
    const id = b.getAttribute('data-e');
    if (id !== 'tdi' && id !== 'wankel') return;
    try { c?.motor?.setEngine?.(id); } catch (_e) { /* noop */ }
    syncSettingsUI(c);
    saveSettings();
  });

  $('set-bloom')?.addEventListener('click', (e) => {
    const b = e.target.closest ? e.target.closest('button') : null;
    if (!b) return;
    settings.bloom = parseInt(b.getAttribute('data-b'), 10);
    // Monolit resetoval BLOOM.badT/lowRes + applyBloomMode() — VYNECHANÉ
    // (bloom engine sa neportuje), volá sa len voliteľné API.
    try { c?.bloom?.setMode?.(settings.bloom); } catch (_e) { /* noop */ }
    syncSettingsUI(c);
    saveSettings();
  });

  $('set-wq')?.addEventListener('click', (e) => {
    const b = e.target.closest ? e.target.closest('button') : null;
    if (!b) return;
    settings.water = parseInt(b.getAttribute('data-q'), 10);
    // Monolit: WAT.every/uReflMix — VYNECHANÉ (Váh modul), len voliteľné API.
    try { c?.water?.setQuality?.(settings.water); } catch (_e) { /* noop */ }
    syncSettingsUI(c);
    saveSettings();
  });

  // RT = dynamické tiene + sunlight (neportovaný ray-tracer; panel riadi realtime svetlá).
  // Master toggle: tiene ZAP (frustum cestuje s hráčom) / VYP (tieňová mapa off).
  $('set-rt-toggle')?.addEventListener('click', () => {
    settings.rt = !settings.rt;
    try {
      if (c?.renderer) {
        c.renderer.shadowMap.enabled = settings.rt;
        c.scene?.traverse?.((o) => { if (o.material) o.material.needsUpdate = true; });
      }
    } catch (_e) { /* noop */ }
    syncSettingsUI(c);
    saveSettings();
    say(settings.rt ? 'Dynamické tiene ZAP.' : 'Tiene VYP.');
  });
  $('set-rtq')?.addEventListener('click', (e) => {
    const b = e.target.closest ? e.target.closest('button') : null;
    if (!b || b.disabled) return;
    const q = Math.max(0, Math.min(2, parseInt(b.getAttribute('data-q'), 10)));
    // ÚROVEŇ = preset tieňovej mapy: LITE 2K / STD 4K / ULTRA 8K.
    // applyShadowTier nastaví settings.rtQ z nového shadowTieru (pozri syncSettingsUI).
    applyShadowTier(c, SHADOW_FROM_RT[q]);
    saveSettings();
  });
  const rtRange = (id, labelId, key) => {
    $(id)?.addEventListener('input', (e) => {
      settings[key] = parseFloat(e.target.value);
      const v = $(labelId);
      if (v) v.textContent = Math.round(settings[key] * 100) + '%';
      applyRTLive(c);
    });
    $(id)?.addEventListener('change', () => {
      syncSettingsUI(c);
      saveSettings();
      applyRTLive(c);
    });
  };
  rtRange('set-rtsh', 'set-rtsh-v', 'rtSh');
  rtRange('set-rtli', 'set-rtli-v', 'rtLi');
  rtRange('set-rtql', 'set-rtql-v', 'rtQl');
}

// Živé RT hodnoty: TIENE = zoom frustumu, SVETLO = intenzita slnka,
// KVALITA = škálovanie renderu (cez applyPR).
export function applyRTLive(ctx) {
  const c = ctx || _ctx;
  try { setShadowRangeScale(settings.rtSh); } catch (_e) { /* noop */ }
  try { if (c?.sun) c.sun.intensity = 2.4 * settings.rtLi; } catch (_e) { /* noop */ }
  applyPR(c);
}
