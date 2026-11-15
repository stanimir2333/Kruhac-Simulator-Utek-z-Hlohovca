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

// ---------- KONFIG ----------
const DAY_LEN = 600;            // s na celý deň (10 min) — používateľ si vybral 10
const SUNSET_LEN = 90;          // s trvania súmraku/svítania (šírka prechodu)
const NIGHT_SUN = 0.22;         // mesiac: síce smer "slnka", ale studený a slabý
const NIGHT_AMB = 0.38;
const NIGHT_FILL = 0.08;

// Paleta: denné hodnoty z legacy (S.SKY_*, engine.js svetlá), nočné tmavomodré.
const C = {
  dayBg:   new THREE.Color(S.SKY_HORIZON),
  dayFog:  new THREE.Color(S.SKY_FOG),
  daySun:  new THREE.Color(0xfff1d8),
  nightBg: new THREE.Color(0x0a1226),
  nightFog: new THREE.Color(0x0c1428),
  nightSun: new THREE.Color(0x8fa8d8),  // mesiac
  nightAmb: new THREE.Color(0x2a3a5a),
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
  // Slnko → mesiac: intenzita aj farba sa menia, pozícia ostáva (invariant tieňov).
  if (sun) {
    sun.intensity = lerp(NIGHT_SUN, 2.4, d) * (1 - 0.45 * gloom);
    _sunC.copy(C.nightSun).lerp(C.daySun, d);
    sun.color.copy(_sunC);
  }
  if (fill) fill.intensity = lerp(NIGHT_FILL, 0.35, d);
  if (hemi) hemi.intensity = lerp(0.18, 0.85, d) * (1 - 0.35 * gloom) + flash * 3;
  if (amb) {
    amb.color.copy(C.nightAmb);
    amb.intensity = NIGHT_AMB * n + flash * 2.5;
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
      scene.fog.density = 0.0008 * (1 + 0.35 * n) * (1 + 0.6 * gloom);
    }
  }
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
