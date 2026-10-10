// src/game/drift.js — drift scoring + častice (dym z driftu, iskry).
// Port z monolitu (js cca 9921–10000 + 10604–10669), adaptovaný na náš car-objekt.
// Monolit čítal player.{speed,steer,latV,yawRate,x,z} a input.hand;
// nové signatúry: updateDrift(dt, car, inputLike) kde car={x,z,speed,steer}
// a inputLike={handbrake()} — vnútri mapuj (pozri updateDrift).
// Stav driftu/misií držia moduly (neťahá sa do core/state).
// THREE body cez S.scene; PS pool ako modul-lokál.
// Žiadne volania pri importe; žiadne game/player/input/bgm/showToast globály.
import * as THREE from 'three';
import { S } from '../world/shared.js';

// ---------- 6) DRIFT SCORING ----------
// Slip angle = uhol medzi smerom rýchlostného vektora a headingom auta.
// updatePlayer posúva auto o (forward*speed + right*latV)*dt, takže zložky sú
// presne tie isté a beta = atan2(|latV|, |speed|) [rad].
// Rýchlosť sa meria PO ZEMI (sqrt(speed^2 + latV^2)), nie len pozdĺžne:
// pri driftu je auto šikmo a pozdĺžna zložka padá k nule, kým auto stále letí
// 60+ km/h bokom. Meriť len `speed` by drift nikdy nespustil.
export const DRIFT_MIN_KMH = 30; // pod touto pozemnou rýchlosťou sa nedriftscoreuje
export const DRIFT_MIN_SLIP = 15 * Math.PI / 180; // 15°
export const DRIFT_COMBO_STEP = 1.1; // s medzi +1 ku combo
export const DRIFT_COMBO_MAX = 12;
export const DRIFT_BANK_GAP = 1.0; // s pod hranicou, kým sa reťaz odloží
// rýchlosť[km/h] × uhol[°] × násobič, presne podľa zadania. DRIFT_RATE je
// jediný gombík na kalibráciu: 1.0 by dalo 2500 bodov za ~0.6 s šialeného
// driftu, 0.02 dá hrávateľných ~15-25 s poriadneho klopaného serpentínu.
export const DRIFT_RATE = 0.02;
export const DRIFT_LS = 'kruhac-drift-best';
export const DR = {
  score: 0,
  total: 0,
  best: 0,
  combo: 1,
  comboT: 0,
  gap: 0,
  slip: 0,
  rate: 0,
  on: false,
  live: false,
  hudScore: -1,
  hudCombo: -1,
  hudBest: -1,
  hudOn: false,
};

export function loadDriftBest() {
  try {
    const v = parseFloat(localStorage.getItem(DRIFT_LS));
    if (isFinite(v) && v > 0) DR.best = v;
  } catch { /* storage nedostupné — best zostáva 0 */ }
}

export function saveDriftBest() {
  try {
    localStorage.setItem(DRIFT_LS, String(Math.round(DR.best)));
  } catch { /* storage nedostupné — best sa neuloží */ }
}

export function resetDrift() {
  DR.score = 0;
  DR.total = 0;
  DR.combo = 1;
  DR.comboT = 0;
  DR.gap = 0;
  DR.slip = 0;
  DR.rate = 0;
  DR.on = false;
  DR.live = false;
  DR.hudScore = -1;
  DR.hudCombo = -1;
  DR.hudBest = -1;
  DR.hudOn = false;
}

// ťažký náraz / zlom trasy: neodložený reťaz sa zbankuje a combo ide na nulu
export function driftBreak() {
  if (DR.live && DR.score > DR.best) {
    DR.best = DR.score;
    saveDriftBest();
  }
  DR.score = 0;
  DR.combo = 1;
  DR.comboT = 0;
  DR.gap = 0;
  DR.live = false;
  DR.rate = 0;
  DR.on = false;
}

export function updateDrift(dt, car = {}, inputLike = null) {
  // ADAPTÁCIA mapovania (monolit → nový car-objekt):
  // player.speed → car.speed, player.latV → car.latV (alebo fallback z car.steer),
  // player.steer → car.steer, player.yawRate → car.yawRate, player.x/z → car.x/z,
  // input.hand (bool) → inputLike.handbrake() (fn). game.noclip → car.noclip.
  // Scoring je verbatim: pozemná rýchlosť + slip angle, na ručnú sa neviaže
  // (param inputLike je pre API kompatibilitu a heat-systém — scoring ho nepotrebuje).
  const noclip = !!(car && car.noclip);
  if (noclip) {
    DR.on = false;
    DR.rate = 0;
    return;
  }
  const speed = typeof car?.speed === 'number' ? car.speed : 0;
  const steer = typeof car?.steer === 'number' ? car.steer : 0;
  const yawRate = typeof car?.yawRate === 'number' ? car.yawRate : 0;
  // poloha car.x/z sa pre scoring nepoužíva (bezpolohový), patrí k car-objektu
  // pre heat-systém; načítame ju, aby mapovanie bolo úplné.
  const px = car?.x ?? 0;
  const pz = car?.z ?? 0;
  // input.hand → inputLike.handbrake(): verbatim scoring ho nepotrebuje,
  // voláme ho len kvôli mapovaniu (budúci heat-systém / HUD).
  let hand = false;
  try {
    if (inputLike && typeof inputLike.handbrake === 'function') hand = !!inputLike.handbrake();
    else if (inputLike && typeof inputLike.hand === 'boolean') hand = !!inputLike.hand;
  } catch { hand = false; }
  // bočný sklzn: prednosť má car.latV (legacy vehicle), inak aproximácia zo
  // steru pre nový car-objekt bez latV (|steer| 0..1 → bočná zložka).
  // vehicle.js: drifting = hand && |speed|>8 && |steer|>0.4, takže 0.4 ≈ hranica.
  let latV = 0;
  if (typeof car?.latV === 'number') {
    latV = car.latV;
  } else if (typeof car?.steer === 'number') {
    // yawRate (ak existuje) jemne pripočíta — inak čistý steer fallback.
    const yawPart = yawRate !== 0 ? yawRate * 0.5 : 0;
    latV = (steer * 0.45 + yawPart) * speed;
  }
  const lon = speed < 0 ? -speed : speed;
  const lat = latV < 0 ? -latV : latV;
  // pozemná rýchlosť (auto letí aj bokom) a slip angle voči headingu
  const ground = Math.sqrt(speed * speed + latV * latV);
  const kmh = ground * 3.6;
  const beta = ground > 0.6 ? Math.atan2(lat, lon) : 0;
  DR.slip = beta;
  // px/pz/hand sú súčasťou mapovania car/inputLike (heat-systém), scoring je
  // bez nich verbatim — explicitné dotknutie, aby mapovanie bolo viditeľné.
  if (px !== null && pz !== null && !hand) {
    // zámerne prázdne: scoring sa na polohe/ručke neviaže
  }
  const on = kmh > DRIFT_MIN_KMH && beta > DRIFT_MIN_SLIP;
  DR.on = on;
  if (on) {
    DR.live = true;
    DR.gap = 0;
    DR.comboT += dt;
    if (DR.comboT >= DRIFT_COMBO_STEP) {
      DR.comboT -= DRIFT_COMBO_STEP;
      if (DR.combo < DRIFT_COMBO_MAX) DR.combo += 1;
    }
    DR.rate = kmh * (beta * 180 / Math.PI) * DR.combo * DRIFT_RATE;
    DR.score += DR.rate * dt;
    DR.total += DR.rate * dt;
  } else {
    DR.rate = 0;
    DR.comboT = 0;
    if (DR.live) {
      DR.gap += dt;
      if (DR.gap > DRIFT_BANK_GAP) {
        if (DR.score > DR.best) {
          DR.best = DR.score;
          saveDriftBest();
        }
        DR.score = 0;
        DR.combo = 1;
        DR.live = false;
      }
    }
  }
}

let _elDScore = null;
let _elDCombo = null;
let _elDBest = null;
let _elDrift = null;

function _driftEls() {
  if (_elDScore) return true;
  _elDScore = document.getElementById('d-score');
  _elDCombo = document.getElementById('d-combo');
  _elDBest = document.getElementById('d-best');
  _elDrift = document.getElementById('drift');
  return !!(_elDScore && _elDCombo && _elDBest && _elDrift);
}

export function updateDriftHUD() {
  if (!_driftEls()) return;
  const sc = DR.score < 1 ? 0 : Math.round(DR.score);
  if (sc !== DR.hudScore) {
    DR.hudScore = sc;
    _elDScore.textContent = sc;
  }
  if (DR.combo !== DR.hudCombo) {
    DR.hudCombo = DR.combo;
    _elDCombo.textContent = 'x' + DR.combo;
    _elDCombo.classList.toggle('hot', DR.combo >= 5);
  }
  const bs = Math.round(DR.best);
  if (bs !== DR.hudBest) {
    DR.hudBest = bs;
    _elDBest.textContent = 'REKORD ' + bs;
  }
  const on = DR.score > 0 || DR.best > 0;
  if (on !== DR.hudOn) {
    DR.hudOn = on;
    _elDrift.classList.toggle('on', on);
  }
}

// ---------- ČASTICE: dym z driftu + iskry z nárazov (1 pool, bez alokácií) ----------
export const PSMOKE_N = 240;
export const PS = {
  pts: null,
  pos: null,
  col: null,
  vel: null,
  life: null,
  max: null,
  grav: null,
  cur: 0,
  n: 0,
};

export function buildParticles(sceneParam) {
  const scene = sceneParam ?? S.scene;
  if (!scene) return;
  const n = S.IS_MOBILE ? 120 : PSMOKE_N;
  PS.n = n;
  PS.pos = new Float32Array(n * 3);
  PS.col = new Float32Array(n * 3);
  PS.vel = new Float32Array(n * 3);
  PS.life = new Float32Array(n);
  PS.max = new Float32Array(n);
  PS.grav = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    PS.pos[i * 3 + 1] = -999;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(PS.pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('color', new THREE.BufferAttribute(PS.col, 3).setUsage(THREE.DynamicDrawUsage));
  S.DYN_GEO.push(g);
  S.MAT.smoke = new THREE.PointsMaterial({
    size: 1.1,
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    sizeAttenuation: true,
  });
  PS.pts = new THREE.Points(g, S.MAT.smoke);
  // farby zapíše psEmit, animujú sa pozície — color atribút netreba dorátať
  // v updateParticles (pozri koniec funkcie).
  PS.pts.geometry.attributes.color.needsUpdate = true;
  PS.pts.frustumCulled = false;
  PS.pts.updateMatrix();
  PS.pts.matrixAutoUpdate = false;
  scene.add(PS.pts);
}

export let psSeed = 918273;

export function psRnd() {
  psSeed = (psSeed * 1103515245 + 12345) & 0x7fffffff;
  return psSeed / 0x7fffffff;
}

export function psEmit(x, y, z, vx, vy, vz, life, r, g2, b, grav) {
  if (!PS.n) return;
  const i = PS.cur;
  PS.cur = (PS.cur + 1) % PS.n;
  PS.pos[i * 3] = x;
  PS.pos[i * 3 + 1] = y;
  PS.pos[i * 3 + 2] = z;
  PS.vel[i * 3] = vx;
  PS.vel[i * 3 + 1] = vy;
  PS.vel[i * 3 + 2] = vz;
  PS.life[i] = life;
  PS.max[i] = life;
  PS.grav[i] = grav;
  PS.col[i * 3] = r;
  PS.col[i * 3 + 1] = g2;
  PS.col[i * 3 + 2] = b;
  // farba je definitívna (nemá žiadnu animáciu) → upload hneď pri emitu,
  // nie na každý snímok v updateParticles
  if (PS.pts) PS.pts.geometry.attributes.color.needsUpdate = true;
}

export function emitDriftSmoke(car = {}) {
  // ADAPTÁCIA: monolit čítal player.{heading,x,y,z,speed};
  // nové: car.{h|heading,x,y,z,speed} — vnútri mapuj.
  // zadné kolesá vo svetových súradniciach (bez alokácií)
  if (!PS.n) return;
  const h = typeof car?.h === 'number' ? car.h : (typeof car?.heading === 'number' ? car.heading : 0);
  const cx = car?.x ?? 0;
  const cz = car?.z ?? 0;
  const cy = car?.y ?? 0;
  const spd = car?.speed ?? 0;
  const fx = Math.sin(h);
  const fz = Math.cos(h);
  const rx = -fz;
  const rz = fx;
  for (let k = 0; k < 2; k++) {
    const s = k === 0 ? -0.85 : 0.85;
    const x = cx - fx * 1.35 + rx * s;
    const z = cz - fz * 1.35 + rz * s;
    const sh = 0.55 + psRnd() * 0.2; // sivý dym
    psEmit(
      x + (psRnd() - 0.5) * 0.6,
      cy + 0.25,
      z + (psRnd() - 0.5) * 0.6,
      (psRnd() - 0.5) * 1.5 - fx * spd * 0.08,
      1.2 + psRnd() * 1.2,
      (psRnd() - 0.5) * 1.5 - fz * spd * 0.08,
      0.9 + psRnd() * 0.5,
      sh,
      sh,
      sh,
      0,
    );
  }
}

// ---------- PLAMENE Z VÝFUKU: straight pipe strieľa pri pustení plynu ----------
// Špička výfuku v lokále auta (0.55, 0.32, −2.1) → svet cez rotáciu Y:
//   wx = x·cos h + z·sin h, wz = −x·sin h + z·cos h (three.js rotation.y).
// Pozor: (rx, rz) z vehicle.js je prevrátený trojčlen (−cos, +sin), sedí len pre
// symetrické emity (dym ±0.85) — výfuk je jednostranný, takže tu priamo cos/sin.
const EXH_X = 0.55, EXH_Y = 0.32, EXH_Z = -2.1;
// Dávka po ubratí: plný plyn → pustený vo vysokých otáčkach = zášľah 0.3–0.65 s.
// Modulový stav (hráč je jeden, žiadna alokácia).
let FLAME_T = 0;
let FLAME_PREV_TH = 0;

// Jeden jazyk plameňa: rýchly šľah dozadu (+ unášanie rýchlosťou auta, inak by
// pri 200 km/h oheň opticky teleportoval 4 m za auto), krátky život, grav=1
// (padá ako iskra, nestúpa ako dym). Farba: žltobiele jadro / oranž / modrý lem.
function emitFlame(x, y, z, vx, vy, vz) {
  const pick = psRnd();
  if (pick < 0.45) {
    psEmit(x, y, z, vx, vy, vz, 0.1 + psRnd() * 0.1, 1.0, 0.85, 0.35, 1);
  } else if (pick < 0.85) {
    psEmit(x, y, z, vx, vy, vz, 0.12 + psRnd() * 0.13, 1.0, 0.42 + psRnd() * 0.2, 0.08, 1);
  } else {
    psEmit(x, y, z, vx, vy, vz, 0.08 + psRnd() * 0.08, 0.35, 0.55, 1.0, 1);
  }
}

// Volá main loop každý snímok (len hráč, nie noclip): throttle 0/1 z inputu,
// rpm01 = (rpm − idle) / range ako pre sfx.engine. boost > 1 = výraznejšie
// šľahy (wankel strieľa väčšie ohne).
export function updateExhaustFlames(dt, car = {}, throttle = 0, rpm01 = 0, boost = 1) {
  if (!PS.n) return;
  const th = throttle > 1 ? 1 : (throttle < 0 ? 0 : throttle);
  const r = rpm01 > 1 ? 1 : (rpm01 < 0 ? 0 : rpm01);
  // Nástupná hrana plného plynu → pustený vo vysokých otáčkach: spusti dávku.
  if (FLAME_PREV_TH > 0.5 && th < 0.15 && r > 0.25) FLAME_T = 0.3 + r * 0.35;
  FLAME_PREV_TH = th;
  const bursting = FLAME_T > 0;
  // Mimo dávky len občasný praskot pri plachtení vo vysokých otáčkach
  // (vizuálny partner k audio-popom v sfx.js).
  if (!bursting && !(th < 0.08 && r > 0.4 && psRnd() < r * 0.25)) return;
  if (bursting) FLAME_T -= dt;
  const h = typeof car?.h === 'number' ? car.h : 0;
  const cx = car?.x ?? 0;
  const cy = car?.y ?? 0;
  const cz = car?.z ?? 0;
  const spd = typeof car?.speed === 'number' ? car.speed : 0;
  const fx = Math.sin(h), fz = Math.cos(h);
  const tx = cx + EXH_X * fz + EXH_Z * fx;
  const tz = cz - EXH_X * fx + EXH_Z * fz;
  const ty = cy + EXH_Y;
  const power = (0.7 + r * 0.6) * (boost > 0 ? boost : 1);
  const burstN = S.IS_MOBILE ? 2 : (bursting ? 3 + ((psRnd() * 2) | 0) : 2);
  const n = Math.max(1, Math.round(burstN * (boost > 0 ? boost : 1)));
  for (let k = 0; k < n; k++) {
    const sp = (5 + psRnd() * 6) * power;
    emitFlame(
      tx + (psRnd() - 0.5) * 0.15,
      ty + (psRnd() - 0.5) * 0.1,
      tz + (psRnd() - 0.5) * 0.15,
      // unášanie + šľah dozadu + rozptyl + mierne hore
      fx * spd - fx * sp + (psRnd() - 0.5) * 2.2,
      1.0 + psRnd() * 2.0,
      fz * spd - fz * sp + (psRnd() - 0.5) * 2.2,
    );
  }
}

export function emitSparks(x, y, z, n) {
  for (let k = 0; k < n; k++) {
    const a = psRnd() * 6.2832;
    const sp = 2 + psRnd() * 6;
    psEmit(
      x,
      y + (psRnd() - 0.5) * 0.5,
      z,
      Math.cos(a) * sp,
      1.5 + psRnd() * 4,
      Math.sin(a) * sp,
      0.3 + psRnd() * 0.35,
      1.0,
      0.45 + psRnd() * 0.3,
      0.1,
      1,
    );
  }
}

export function updateParticles(dt) {
  if (!PS.pts) return;
  const n = PS.n;
  const posAttr = PS.pts.geometry.attributes.position;
  for (let i = 0; i < n; i++) {
    if (PS.life[i] <= 0) continue;
    PS.life[i] -= dt;
    if (PS.life[i] <= 0) {
      PS.pos[i * 3 + 1] = -999;
      posAttr.needsUpdate = true;
      continue;
    }
    const dr = PS.grav[i] > 0.5 ? 0.4 : 1.6; // iskry: gravitácia, dym: odpor + stúpanie
    PS.vel[i * 3 + 1] += (PS.grav[i] > 0.5 ? -9 : 1.2) * dt;
    PS.vel[i * 3] -= PS.vel[i * 3] * dr * dt;
    PS.vel[i * 3 + 2] -= PS.vel[i * 3 + 2] * dr * dt;
    PS.pos[i * 3] += PS.vel[i * 3] * dt;
    PS.pos[i * 3 + 1] += PS.vel[i * 3 + 1] * dt;
    PS.pos[i * 3 + 2] += PS.vel[i * 3 + 2] * dt;
    posAttr.needsUpdate = true;
  }
  // `color` sa nikdy neanimuje (farba sa píše len pri psEmit) — jeho needsUpdate
  // patrí do emitovacej cesty, nie do update. Position sa uploaduje len keď
  // sa naozaj niečo pohybovalo alebo zhaslo; inak by sa ~6 kB posielalo
  // do GPU 60×/s aj pri úplne prázdnom bazéne častíc.
}

// (driftState odstránená: vracia DR, ale jediný potenciálny čitateľ bol
//  heat-systém, ktorý odišiel so src/ai/police.js. missions.js importuje DR
//  priamo.)
