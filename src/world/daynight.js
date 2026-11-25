// src/world/daynight.js — cyklus dňa a noci (celý deň = 10 min reálneho času).
// JEDINÝ VLASTNÍK OKOLITÉHO SVETLA: slnko/mesiac, fill, hemisféra, ambient,
// pozadie scény, hmla aj tón oblohy (sky.js setSkyDayness). Búrka (storm.js)
// už nepíše do svetiel sama — len volá setSkyGloom(gloom, flash), a tento modul
// v jednom mieste skombinuje prítmie búrky so stadiom dňa. Tým sa rieši konflikt,
// keď storm zachytil sunBase/hemiBase pri boote a po prepnutí na noc by ich
// vrátil na denné hodnoty.
//
// dayT: 0 = poludnie, 0.25 = západ, 0.5 = polnoc, 0.75 = východ slnka.
// Prechody (svitanie/súmrok) sú plynulé cez smoothstep okolo nuly elevácie —
// slnko "zapadá" tým, že sa znižuje intenzita a mení farba (oranžová), nie
// pozícia: pozícia slnka je invariant tieňového systému (sunshadow.js texel
// snap), takže sa NEHÝBE.
import * as THREE from 'three';
import { S } from './shared.js';
import { setSkyDayness } from './sky.js';
import { NIGHT } from '../fx/night.js';

// ---------- KONFIG ----------
const DAY_LEN = 600;            // s na celý deň (10 min) — používateľ si vybral 10
const SUNSET_LEN = 90;          // s trvania súmraku/svítania (šírka prechodu)
const NIGHT_SUN = 0.30;         // mesiac: slabý a studený
const NIGHT_AMB = 0.34;
const NIGHT_FILL = 0.06;

// Paleta: denné hodnoty teplé (GTA V: teplé slnko, studené tiene), nočné tmavomodré.
const C = {
  dayBg:   new THREE.Color(S.SKY_HORIZON),
  dayFog:  new THREE.Color(S.SKY_FOG),
  daySun:  new THREE.Color(0xfff5e8),  // slop-newyork midday lightColor
  golden:  new THREE.Color(0xffab5e),  // západ/východ slnka
  nightBg: new THREE.Color(0x0a1226),
  nightFog: new THREE.Color(0x0a1020),
  nightSun: new THREE.Color(0x9db6e0),  // mesiac
  nightAmb: new THREE.Color(0x1a2540),
};
const _bg = new THREE.Color(), _fogC = new THREE.Color(), _sunC = new THREE.Color();

// ---------- STAV ----------
let scene = null, sun = null, fill = null, hemi = null, amb = null;
let dayT = 0.06;          // štart: neskoré dopoledne (hra sa začne za dňa)
let frozen = false;       // cheat STOPCAS
let gloom = 0, flash = 0; // živia ich storm.js cez setSkyGloom
let inited = false;

function smooth01(v) { return v <= 0 ? 0 : v >= 1 ? 1 : v * v * (3 - 2 * v); }
function lerp(a, b, t) { return a + (b - a) * t; }

// 0 = hlboká noc, 1 = plný deň. Elevácia cos(2π·dayT): 1 poludnie, −1 polnoc.
export function dayness() {
  const elev = Math.cos(dayT * Math.PI * 2);
  // Šírka prechodu: ±SUNSET_LEN/2 s okolo východu/západu.
  const w = SUNSET_LEN / DAY_LEN;
  return smooth01((elev + w) / (2 * w));
}

// ---------- APLIKÁCIA SVETIEL ----------
function apply() {
  const d = dayness();
  const n = 1 - d; // nočný podiel
  // Zlatá hodina: teplý odlesk okolo horizontu (sunrise/sunset), bez zmytia poludnia.
  const elev = Math.cos(dayT * Math.PI * 2);
  const golden = Math.exp(-Math.abs(elev) * 4.5); // bump pri horizonte (východ/západ)
  // Slnko → mesiac: intenzita aj farba sa menia, pozícia ostáva (invariant tieňov).
  if (sun) {
    const dayInt = lerp(2.5, 4.5, Math.min(1, d * 1.15));  // slop-newyork: silnejsie slnko
    sun.intensity = lerp(NIGHT_SUN, dayInt, d) * (1 - 0.45 * gloom);
    _sunC.copy(C.nightSun).lerp(C.daySun, d);
    if (golden > 0.05) _sunC.lerp(C.golden, Math.min(0.85, golden));
    sun.color.copy(_sunC);
  }
  if (fill) fill.intensity = lerp(NIGHT_FILL, 0.6, d);
  if (hemi) hemi.intensity = lerp(0.3, 1.3, d) * (1 - 0.35 * gloom) + flash * 3;
  if (amb) {
    amb.color.copy(C.nightAmb);
    amb.intensity = (NIGHT_AMB + 0.12) * n + flash * 2.5;
  }
  if (scene) {
    if (scene.background && scene.background.isColor) {
      _bg.copy(C.nightBg).lerp(C.dayBg, d);
      scene.background.copy(_bg).multiplyScalar(1 - 0.55 * gloom);
    }
    if (scene.fog && scene.fog.isFogExp2) {
      _fogC.copy(C.nightFog).lerp(C.dayFog, d);
      scene.fog.color.copy(_fogC).multiplyScalar(1 - 0.35 * gloom);
      // Noc = hustejšia hmla (svetlá lamp majú čo žiariť cez), búrka pridáva svoje.
      scene.fog.density = 0.00022 * (1 + 0.75 * n) * (1 + 0.6 * gloom);  // slop-newyork: redsia hmla
    }
  }
  NIGHT.value = n;
  setSkyDayness(d);
}

// ---------- VEREJNÉ API ----------
export function initDayNight(opts) {
  scene = opts?.scene || scene;
  sun = opts?.sun || sun;
  fill = opts?.fill || fill;
  if (scene && !hemi) {
    scene.traverse((o) => { if (!hemi && o && o.isHemisphereLight) hemi = o; });
  }
  // Ambient: denné svetlo ho nepotrebuje (hemi ho kryje), v noci dvihne tmavé
  // tváre nad stmavnutou hemisférou. castShadow netreba — je to plná omáčka.
  if (scene && !amb) {
    amb = new THREE.AmbientLight(0x2a3a5a, 0);
    scene.add(amb);
  }
  inited = !!scene;
  apply();
  console.info('[den] cyklus dňa/noci: ' + DAY_LEN + ' s / deň · štart dayT=' + dayT.toFixed(2));
}

export function updateDayNight(dt) {
  if (!inited) return;
  if (!frozen) {
    dayT = (dayT + dt / DAY_LEN) % 1;
  }
  apply();
}

// Cheat DENNY / NOCNY: nastav fázu hneď (neprebieha cez svitany — skok je
// zámerný, je to cheat).
export function setDayPhase(p) {
  dayT = ((p % 1) + 1) % 1;
  apply();
}
export function isDay() { return dayness() > 0.5; }

// Cheat STOPCAS: zamrzne beh času (svetlá/obloha stáčajú, ale záujem o pozíciu
// slnka ostáva — tieňový systém sa nedotkne).
export function toggleTimeFreeze() {
  frozen = !frozen;
  return frozen;
}
export function isFrozen() { return frozen; }

// storm.js: prítmie búrky (0 jasno … 1 tma) + obálka záblesku blesku (0..1).
export function setSkyGloom(g, f) {
  gloom = Math.max(0, Math.min(1, g || 0));
  flash = Math.max(0, Math.min(1, f || 0));
}
