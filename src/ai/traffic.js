// src/ai/traffic.js — VERNÝ port legacy dopravného systému (kolóna + protismer + ambient).
// ZDROJ: index.monolith.legacy.html, riadky RELATÍVNE od `<script type="module">`.
// Verbatim (telá bezo zmien, len S.* sed + mená zo shared.js):
//   updateSuspension, snapSuspension (js 3547–3581; updateBodySpring NEPORTOVANÁ — je hráčova),
//   makeCar, buildCarMeshes, drawCars (js 6686–6791),
//   buildTraffic — len pool-inicializácia (js 6872–6896; buildPlayer NEPORTOVANÝ),
//   ambientPlace PLNÁ signatúra (c, ri, t, dt, snap, nosus) (js 6981–7008),
//   safePlace + AI_* consty (js 10669–10695),
//   updateTraffic CELÁ (js 10696–10916) vrátane wave/stop-go, horn, blockT, LOD, recyklácie,
//   aiHonk (js 4071–4095) — TELO NAHRADENÉ delegáciou na injektovaný `hornFn` (signatúra zachovaná).
// ADAPTÁCIE: `player` globál → parameter P/player; `playerS` globál → parameter playerS;
//   `game.aiTick` → modulový `aiTick`; `game.muted` → modulový `aiMuted` (setMuted) + 5-presná
//   signatúra updateTraffic zostáva; `game.aiActive` → modulový `aiActive`;
//   `game.fpsFrames` (resetuje sa) → monotónny `aiTick` (štatisticky rovnocenné);
//   legacy čas `t` (s) → modulový `aiTime` (akumulátor dt), lebo 1. parameter je stav.
// S.* sed: OSM_DATA→S.osm, scene→S.scene, _v1→S._v1, _hWrap→S._hWrap, GEO→S.GEO, MAT→S.MAT,
//   DYN_GEO→S.DYN_GEO, DYN_IM→S.DYN_IM, routeLen/roundS/bridgeS0/bridgeS1/townRoads→S.*.
//   (tools/need.txt v repe NEEXISTUJE — overené; sednuté sú všetky mená, ktoré má shared.js.)
import * as THREE from 'three';
import { S } from '../world/shared.js';
import { routePose } from '../world/roads.js';
// wheelGroundY: updateSuspension ho volá priamo (legacy globál; dnes žije v height.js).
import { driveY, LANE_OFF, getTerrainHeight, wheelGroundY } from '../world/height.js';

// ---------- POČTY ÁUT (lokálne consty; legacy js 3775–3777: IS_MOBILE→S.IS_MOBILE) ----------
export const TRAFFIC_N = S.IS_MOBILE ? 18 : 30;
export const INCOMING_N = S.IS_MOBILE ? 6 : 8;
export const AMBIENT_N = S.IS_MOBILE ? 8 : 12;
export const PARKED_N = 10; // zaparkované z townRoads blízko štartu (modulárna extenzia; legacy ich nemal)
// Legacy MAXC = 51 (30+8+12+1); rozšírené o PARKED_N, aby sa ALL_CARS vrátane
// zaparkovaných vošlo do InstancedMesh (inak OOB zápis matíc = neviditeľné autá).
export const MAXC = TRAFFIC_N + INCOMING_N + AMBIENT_N + PARKED_N;

// ---------- AI DOPRAVA: Distance LOD pásma (legacy js 10695) ----------
export const AI_NEAR2 = 22500, AI_MID2 = 122500, AI_POOL2 = 160000, AI_MAX_FULL = 32;

// ---------- INSTANCOVANIE ÁUT (lokálne consty; legacy js 6691–6699) ----------
// IM ako lokál `let IM = null` (plní ho buildCarMeshes); DYN_IM je S.DYN_IM.
export let IM = null;
export const dummy = new THREE.Object3D();
export const BRAKE_ON = new THREE.Color(0xff1a1a);
export const BRAKE_OFF = new THREE.Color(0x550a0a);
// CAR_COLORS lokálne (plní buildCarMeshes z legacy palety js 4837;
// S.CAR_COLORS existuje tiež, ale plní ho buildShared pre iné vrstvy).
export const CAR_COLORS = [];
export const ALL_CARS = [];
export const WPOS = [[-0.85, 1.35], [0.85, 1.35], [-0.85, -1.35], [0.85, -1.35]];

// ---------- POOLY (naplnené raz v create/build, v slučke len recyklácia; legacy js 3848–3851) ----------
export const trafficPool = [];  // AI kolóna na 513-ke
export const incomingPool = []; // protismer na 513-ke
export const ambientPool = [];  // voľná doprava v celom meste
export const parkedPool = [];   // zaparkované (stoja, len sa kreslia)
export let ambientRR = 0;
export let aiTick = 0;    // monotónny čítač snímok pre staggered AI update (legacy game.aiTick)
export let aiTime = 0;    // legacy čas `t` pre wave (akumulátor dt — signatúra updateTraffic ho nemá)
export let aiActive = 0;  // koľko áut je vo full-rate pásme (legacy game.aiActive)
let aiMuted = false;      // legacy game.muted (signatúra updateTraffic nemá muted → setMuted)
let hornFn = null;        // injektovaný klaksón (setHorn)

// ---------- nearestRoute: NECHÁVA SA AKO JE (kompatibilný export, používa missions/cheats) ----------
const _nrp = { x: 0, z: 0, h: 0, d: 0 };

/** Najbližší bod trasy k pozícii (hrubé + jemné hľadanie, bez alokácií). */
export function nearestRoute(x, z) {
  let best = 0, bd = 1e18;
  const N = S.ROUTE_N;
  for (let i = 0; i <= N; i += 4) {
    const dx = S.routeX[i] - x, dz = S.routeZ[i] - z, d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  for (let i = Math.max(0, best - 4); i <= Math.min(N, best + 4); i++) {
    const dx = S.routeX[i] - x, dz = S.routeZ[i] - z, d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  _nrp.x = S.routeX[best]; _nrp.z = S.routeZ[best]; _nrp.h = S.routeH[best];
  _nrp.d = Math.sqrt(bd);
  _nrp.s = (best / N) * S.routeLen;
  return _nrp;
}

// ---------- FYZIKA: 4-kolesové odpruženie (verbatim legacy js 3547–3571) ----------
// 4-kolesové odpruženie: karoséria = priemer, klopenie/klonenie zo sklonu, kolesá jednotlivo.
// Polomer kolesa 0.33 (S.GEO.wheel) = stred kolesa vždy ground+0.33, bez prepadávania a skákania.
export function updateSuspension(o, dt, s, lat) {
  if (!(dt > 0)) dt = 0.016;
  const hd = (o.h !== undefined) ? o.h : o.heading;
  const fx = Math.sin(hd), fz = Math.cos(hd);
  const g0 = wheelGroundY(o.x + (-0.85) * fz + 1.35 * fx, o.z + 0.85 * fx + 1.35 * fz, s, lat);
  const g1 = wheelGroundY(o.x + 0.85 * fz + 1.35 * fx, o.z - 0.85 * fx + 1.35 * fz, s, lat);
  const g2 = wheelGroundY(o.x + (-0.85) * fz - 1.35 * fx, o.z + 0.85 * fx - 1.35 * fz, s, lat);
  const g3 = wheelGroundY(o.x + 0.85 * fz - 1.35 * fx, o.z - 0.85 * fx - 1.35 * fz, s, lat);
  const kY = Math.min(1, dt * 10), kW = Math.min(1, dt * 14);
  let dy = ((g0 + g1 + g2 + g3) * 0.25 - o.y) * kY;
  const maxRise = 12 * dt, maxFall = 6 * dt; // rezerva na 250 km/h: 1.1 m terénu/snímok pri 60 FPS
  if (dy > maxRise) dy = maxRise; else if (dy < -maxFall) dy = -maxFall;
  o.y += dy;
  let pitch = Math.atan2((g2 + g3) * 0.5 - (g0 + g1) * 0.5, 2.7);
  let roll = Math.atan2((g1 + g3) * 0.5 - (g0 + g2) * 0.5, 1.7);
  if (pitch > 0.35) pitch = 0.35; else if (pitch < -0.35) pitch = -0.35;
  if (roll > 0.35) roll = 0.35; else if (roll < -0.35) roll = -0.35;
  o.pitch += (pitch - o.pitch) * kY;
  o.roll += (roll - o.roll) * kY;
  const wR = 12 * dt, wF = 6 * dt;
  let d0 = (g0 - o.w0) * kW; if (d0 > wR) d0 = wR; else if (d0 < -wF) d0 = -wF; o.w0 += d0;
  let d1 = (g1 - o.w1) * kW; if (d1 > wR) d1 = wR; else if (d1 < -wF) d1 = -wF; o.w1 += d1;
  let d2 = (g2 - o.w2) * kW; if (d2 > wR) d2 = wR; else if (d2 < -wF) d2 = -wF; o.w2 += d2;
  let d3 = (g3 - o.w3) * kW; if (d3 > wR) d3 = wR; else if (d3 < -wF) d3 = -wF; o.w3 += d3;
}

// okamžité usadenie po spavne/teleporte (žiadne dosadanie z výšky) (verbatim js 3573–3581,
// BEZ hráčovej vetvy `if(o === player)` — tá patrí updateBodySpring (hráč, neportuje sa);
// AI autá ňou nikdy neprechádzajú).
export function snapSuspension(o) {
  o.w0 = o.y; o.w1 = o.y; o.w2 = o.y; o.w3 = o.y;
  o.pitch = 0; o.roll = 0;
}

// ---------- AUTÁ: dáta (verbatim legacy js 6686–6690) ----------
export function makeCar(grp) {
  return {
    x: 0, z: 0, h: 0, y: 0, pitch: 0, roll: 0, w0: 0, w1: 0, w2: 0, w3: 0, speed: 0, spin: 0, braking: true, grp: grp,
    s: 0, dir: 1, seg: 0, vmax: 0, lane: 0, hOff: 0, t: 0,
    d2: 0, lod: 0, lodT: 0, blockT: 0, hidden: false, hornT: 0, hornCd: 0,
  }; // + horn triggery (kolóna>3s, náhodne blízko)
}

// ---------- AUTÁ: instancované meshe (verbatim legacy js 6700–6723, len S.* sed) ----------
export function buildCarMeshes() {
  if (IM) return; // idempotentný boot (main volá raz)
  if (!CAR_COLORS.length) { // legacy paleta z buildShared (js 4837)
    const palette = [0xb03030, 0x2b5aa0, 0xc7c7c7, 0x303035, 0xc07a20, 0x3f7a3f, 0x7a7a8a, 0xd42a1e];
    for (let i = 0; i < palette.length; i++) { CAR_COLORS.push(new THREE.Color(palette[i])); }
  }
  IM = {};
  dummy.rotation.order = 'YXZ';
  const wg = S.GEO.wheel.clone();
  wg.rotateZ(Math.PI / 2); // náprava pozdĺž X (rotácia kolies okolo nej)
  S.DYN_GEO.push(wg);
  IM.body = new THREE.InstancedMesh(S.GEO.body, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.4, envMapIntensity: 0.7 }), MAXC);
  IM.cabin = new THREE.InstancedMesh(S.GEO.cabin, S.MAT.glass, MAXC);
  IM.wheel = new THREE.InstancedMesh(wg, S.MAT.dark, MAXC * 4);
  IM.head = new THREE.InstancedMesh(S.GEO.light, S.MAT.head, MAXC * 2);
  IM.brake = new THREE.InstancedMesh(S.GEO.light, new THREE.MeshBasicMaterial({ color: 0xffffff }), MAXC * 2);
  IM.blob = new THREE.InstancedMesh(S.GEO.blob, S.MAT.blob, MAXC);
  for (const k in IM) {
    IM[k].frustumCulled = false; // instancie: jeden draw call cez celú mapu
    if (k === 'body' || k === 'cabin') { IM[k].castShadow = true; IM[k].receiveShadow = true; }
    IM[k].instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    S.scene.add(IM[k]);
    S.DYN_IM.push(IM[k]);
  }
  for (let i = 0; i < ALL_CARS.length; i++) { IM.body.setColorAt(i, CAR_COLORS[ALL_CARS[i].grp]); }
  IM.body.instanceColor.needsUpdate = true;
  for (let i = 0; i < MAXC * 2; i++) { IM.brake.setColorAt(i, BRAKE_OFF); }
  IM.brake.instanceColor.needsUpdate = true;
  drawCars();
}

// vykresli všetky autá do instancií (bez alokácií, volá sa každý snímok) (verbatim js 6725–6791)
export function drawCars() {
  if (!IM) return; // pred buildCarMeshes nie je čo kresliť
  let bi = 0, wi = 0, hi = 0;
  for (let k = 0; k < ALL_CARS.length; k++) {
    const c = ALL_CARS[k];
    if (c.hidden) { // LOD freeze >350 m: nulová matica (indexy inštancií ostávajú stabilné)
      dummy.scale.set(0, 0, 0);
      dummy.position.set(c.x, c.y, c.z);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      IM.body.setMatrixAt(bi, dummy.matrix);
      IM.cabin.setMatrixAt(bi, dummy.matrix);
      for (let w = 0; w < 4; w++) { IM.wheel.setMatrixAt(wi++, dummy.matrix); }
      IM.head.setMatrixAt(hi, dummy.matrix);
      IM.brake.setMatrixAt(hi, dummy.matrix); hi++;
      IM.head.setMatrixAt(hi, dummy.matrix);
      IM.brake.setMatrixAt(hi, dummy.matrix); hi++;
      IM.blob.setMatrixAt(bi, dummy.matrix);
      bi++;
      continue;
    }
    const fx = Math.sin(c.h), fz = Math.cos(c.h);
    dummy.scale.set(1, 1, 1);
    dummy.position.set(c.x, 0.62 + c.y, c.z);
    dummy.rotation.set(c.pitch, c.h, c.roll);
    dummy.updateMatrix();
    IM.body.setMatrixAt(bi, dummy.matrix);
    dummy.position.set(c.x + (-0.3) * fx, 1.15 + c.y, c.z + (-0.3) * fz);
    dummy.rotation.set(c.pitch, c.h, c.roll);
    dummy.updateMatrix();
    IM.cabin.setMatrixAt(bi, dummy.matrix);
    for (let w = 0; w < 4; w++) {
      const ox = WPOS[w][0], oz = WPOS[w][1];
      const wy = w === 0 ? c.w0 : (w === 1 ? c.w1 : (w === 2 ? c.w2 : c.w3));
      dummy.position.set(c.x + ox * fz + oz * fx, wy + 0.33, c.z + (-ox * fx + oz * fz));
      dummy.rotation.set(c.spin, c.h, 0);
      dummy.updateMatrix();
      IM.wheel.setMatrixAt(wi++, dummy.matrix);
    }
    for (let s2 = -1; s2 <= 1; s2 += 2) {
      dummy.position.set(c.x + (s2 * 0.55) * fz + 2.12 * fx, 0.66 + c.y, c.z + (-(s2 * 0.55) * fx + 2.12 * fz));
      dummy.rotation.set(c.pitch, c.h, c.roll);
      dummy.updateMatrix();
      IM.head.setMatrixAt(hi, dummy.matrix);
      dummy.position.set(c.x + (s2 * 0.55) * fz + (-2.12) * fx, 0.72 + c.y, c.z + (-(s2 * 0.55) * fx + (-2.12) * fz));
      dummy.rotation.set(c.pitch, c.h, c.roll);
      dummy.updateMatrix();
      IM.brake.setMatrixAt(hi, dummy.matrix);
      IM.brake.setColorAt(hi, c.braking ? BRAKE_ON : BRAKE_OFF);
      hi++;
    }
    dummy.position.set(c.x, 0.16 + c.y, c.z);
    dummy.rotation.set(0, c.h, 0);
    dummy.scale.set(1.05, 1, 2.25);
    dummy.updateMatrix();
    IM.blob.setMatrixAt(bi, dummy.matrix);
    bi++;
  }
  IM.body.count = bi; IM.cabin.count = bi; IM.blob.count = bi;
  IM.wheel.count = wi; IM.head.count = hi; IM.brake.count = hi;
  IM.body.instanceMatrix.needsUpdate = true;
  IM.cabin.instanceMatrix.needsUpdate = true;
  IM.wheel.instanceMatrix.needsUpdate = true;
  IM.head.instanceMatrix.needsUpdate = true;
  IM.brake.instanceMatrix.needsUpdate = true;
  IM.blob.instanceMatrix.needsUpdate = true;
  IM.brake.instanceColor.needsUpdate = true;
}

// ---------- POOL-INICIALIZÁCIA (verbatim legacy buildTraffic js 6872–6896, len S.* sed) ----------
// Vyžaduje postavenú trasu (S.routeLen z buildRoute). Volá sa raz (stráž v createTraffic).
export function buildTraffic() {
  if (trafficPool.length || incomingPool.length) return;
  let seed = 1234567;
  function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  for (let i = 0; i < TRAFFIC_N; i++) {
    const car = makeCar(i % 7);
    car.s = 42 + i * 13.5 + rnd() * 4;
    car.speed = 0; car.lane = LANE_OFF; car.hOff = 0; car.braking = true;
    routePose(car.s, S._v1, S._hWrap, LANE_OFF);
    car.x = S._v1.x; car.z = S._v1.z; car.h = S._hWrap.v;
    car.y = driveY(car.x, car.z, car.s, LANE_OFF);
    snapSuspension(car);
    trafficPool.push(car);
  }
  for (let i = 0; i < INCOMING_N; i++) {
    const car = makeCar((i + 3) % 7);
    car.s = S.routeLen * (0.08 + 0.84 * i / Math.max(1, INCOMING_N - 1));
    car.vmax = 9 + (i % 3);
    car.lane = -LANE_OFF; car.hOff = Math.PI;
    routePose(car.s, S._v1, S._hWrap, -LANE_OFF);
    car.x = S._v1.x; car.z = S._v1.z; car.h = S._hWrap.v + Math.PI; // opačný smer
    car.y = driveY(car.x, car.z, car.s, -LANE_OFF);
    snapSuspension(car);
    incomingPool.push(car);
  }
}

// ---------- KOMPATIBILNÉ API (na ňom stojí main.js) ----------
// JEDNO pole postavené RAZ pri create (concat referencií poolov — žiadne alokácie v update).
// `n` sa preberá pre kompatibilitu, veľkosti poolov riadia legacy consty TRAFFIC_N/INCOMING_N/AMBIENT_N.
export function createTraffic(n) {
  buildTraffic();
  let seed = 777; // deterministický ambient-scatter (legacy buildPlayer js 6967–6968)
  function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  if (!ambientPool.length) { // ambient-init z legacy buildPlayer (js 6969–6977), bez hráčovho meshu
    for (let i = 0; i < AMBIENT_N; i++) {
      const car = makeCar((i * 2 + 1) % 7);
      car.road = -1; car.t = 0; car.seg = 0; car.dir = 1;
      car.speed = 0; car.vmax = 7 + rnd() * 4;
      car.h = 0;
      car.lane = 0;
      car.x = 0; car.z = 0; car.y = 0; snapSuspension(car); // rozptýli ich placeTraffic
      ambientPool.push(car);
    }
  }
  if (!parkedPool.length) { // zaparkované sloty (logika z predchádzajúceho traffic.js, bez push v place)
    for (let i = 0; i < PARKED_N; i++) {
      const car = makeCar((i * 3 + 2) % 7);
      car.parked = true; car.road = -1; car.t = 0; car.seg = 0; car.dir = 1;
      car.speed = 0; car.vmax = 0; car.hidden = true;
      car.x = 0; car.y = -50; car.z = 0; car.h = 0;
      snapSuspension(car);
      parkedPool.push(car);
    }
  }
  if (!ALL_CARS.length) { // hráč NIE je v ALL_CARS (vlastný mesh mimo InstancedMesh)
    for (let i = 0; i < trafficPool.length; i++) { ALL_CARS.push(trafficPool[i]); }
    for (let i = 0; i < incomingPool.length; i++) { ALL_CARS.push(incomingPool[i]); }
    for (let i = 0; i < ambientPool.length; i++) { ALL_CARS.push(ambientPool[i]); }
    for (let i = 0; i < parkedPool.length; i++) { ALL_CARS.push(parkedPool[i]); }
  }
  return { cars: ALL_CARS, placed: false };
}

/** Hustá kolóna okolo hráča + ambient scatter + parked; legacy mechanika (routePose+driveY+snap). */
export function placeTraffic(t, playerS, routeLen) {
  // — kolóna ± okolo hráča (rozloženie ako doteraz: 2 vpredu / 1 vzadu, protismer dopredu) —
  let fwd = 0, back = 0;
  for (let i = 0; i < trafficPool.length; i++) {
    const c = trafficPool[i];
    if (fwd % 3 !== 2) { c.s = playerS + 25 + fwd * 22 + Math.random() * 8; fwd++; }
    else { c.s = playerS - 30 - back * 26 - Math.random() * 8; back++; fwd++; }
    c.s = ((c.s % (routeLen - 20)) + routeLen - 20) % (routeLen - 20);
    c.lane = LANE_OFF; c.hOff = 0;
    c.speed = 2 + Math.random() * 3; c.braking = true; // kolóna sa plíži, nie stojí
    routePose(c.s, S._v1, S._hWrap, LANE_OFF);
    c.x = S._v1.x; c.z = S._v1.z; c.h = S._hWrap.v;
    c.y = driveY(c.x, c.z, c.s, LANE_OFF);
    snapSuspension(c);
  }
  for (let i = 0; i < incomingPool.length; i++) {
    const c = incomingPool[i];
    c.s = (((playerS + 60 + i * 45 + Math.random() * 20) % routeLen) + routeLen) % routeLen;
    c.lane = -LANE_OFF; c.hOff = Math.PI;
    c.speed = 0;
    routePose(c.s, S._v1, S._hWrap, -LANE_OFF);
    c.x = S._v1.x; c.z = S._v1.z; c.h = S._hWrap.v + Math.PI;
    c.y = driveY(c.x, c.z, c.s, -LANE_OFF);
    snapSuspension(c);
  }
  // opora pre d2/scatter: póza hráča na trase
  routePose(playerS, S._v1, S._hWrap, 0);
  const px = S._v1.x, pz = S._v1.z;
  for (let i = 0; i < trafficPool.length; i++) {
    const c = trafficPool[i];
    const dx = c.x - px, dz = c.z - pz; c.d2 = dx * dx + dz * dz;
  }
  for (let i = 0; i < incomingPool.length; i++) {
    const c = incomingPool[i];
    const dx = c.x - px, dz = c.z - pz; c.d2 = dx * dx + dz * dz;
  }
  // — ambient scatter okolo hráča (road=-1; round-robin v updateTraffic ich usadí na cesty) —
  for (let i = 0; i < ambientPool.length; i++) {
    const c = ambientPool[i];
    c.road = -1; c.speed = 0; c.seg = 0;
    c.x = px + 40 + i * 10; c.z = pz + 60; c.h = 0;
    c.y = getTerrainHeight(c.x, c.z);
    snapSuspension(c);
    const dx = c.x - px, dz = c.z - pz; c.d2 = dx * dx + dz * dz;
  }
  // — zaparkované na vedľajších cestách do 500 m od pózy hráča (logika z predchádzajúceho súboru) —
  let parked = 0;
  for (let ri = 0; ri < S.townRoads.length && parked < parkedPool.length; ri++) {
    const R = S.townRoads[ri];
    if (!R || !R.pts || !R.n) continue;
    const mx = (R.pts[0] + R.pts[R.n * 2 - 2]) / 2, mz = (R.pts[1] + R.pts[R.n * 2 - 1]) / 2;
    const dx = mx - px, dz = mz - pz;
    if (dx * dx + dz * dz > 250000) continue; // len do 500 m
    const c = parkedPool[parked++];
    c.parked = true; c.road = ri; c.t = R.len * (0.25 + 0.5 * Math.random()); c.seg = 0;
    c.dir = Math.random() < 0.5 ? 1 : -1; c.speed = 0; c.vmax = 0; c.hidden = false;
    ambientPlace(c, ri, c.t, 0.016, true, true); // snap = hneď správny kurz, nosus = stoja
    const ddx = c.x - px, ddz = c.z - pz; c.d2 = ddx * ddx + ddz * ddz;
  }
  for (let i = parked; i < parkedPool.length; i++) { parkedPool[i].hidden = true; parkedPool[i].d2 = 1e9; }
  t.placed = true;
}

// miesto auta na vedľajšej ceste + plynulé natáčanie (bez alokácií) (verbatim js 6981–7008)
// nosus = stredné LOD pásmo: čisto kinematický waypoint lerp, Y priamo z heightmapy
export function ambientPlace(c, ri, t, dt, snap, nosus) {
  const R = S.townRoads[ri];
  if (t < 0) t = 0; else if (t > R.len) t = R.len;
  let s = c.seg;
  if (s < 0) s = 0; else if (s > R.n - 2) s = R.n - 2;
  while (s < R.n - 2 && t > R.cum[s + 1]) s++;
  while (s > 0 && t < R.cum[s]) s--;
  c.seg = s;
  const x0 = R.pts[s * 2], z0 = R.pts[s * 2 + 1];
  const x1 = R.pts[s * 2 + 2], z1 = R.pts[s * 2 + 3];
  let dx = x1 - x0, dz = z1 - z0;
  const L = Math.sqrt(dx * dx + dz * dz) || 1; dx /= L; dz /= L;
  const f = (t - R.cum[s]) / L;
  const h = Math.atan2(dx * c.dir, dz * c.dir);
  c.x = x0 + dx * f + (-Math.cos(h)) * LANE_OFF;
  c.z = z0 + dz * f + (Math.sin(h)) * LANE_OFF;
  if (snap) { c.h = h; } else {
    let d = h - c.h;
    if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;
    const mx = 2.5 * dt;
    if (d > mx) d = mx; else if (d < -mx) d = -mx;
    c.h += d;
  }
  c.t = t;
  c.y = getTerrainHeight(c.x, c.z); // ambient kopíruje terén vedľajších ciest
  if (!nosus) updateSuspension(c, dt, -1, 0); // vedľajšie cesty mimo mostovky
}

// ---------- UPDATE: DOPRAVA ----------
// bezpečné umiestnenie auta: nikdy nie na hráča (ohraničené, bez alokácií) (verbatim js 10669–10687)
// P = hráč {x, z} (legacy globál `player`).
export function safePlace(c, s, dir, P) {
  for (let k = 0; k < 8; k++) {
    const sk = s + dir * k * 15;
    routePose(sk, S._v1, S._hWrap, c.lane);
    const dx = S._v1.x - P.x, dz = S._v1.z - P.z;
    if (dx * dx + dz * dz > 324) { // viac než 18 m od hráča
      c.s = sk;
      c.x = S._v1.x; c.z = S._v1.z; c.h = S._hWrap.v + c.hOff;
      c.y = driveY(c.x, c.z, c.s, c.lane);
      snapSuspension(c);
      return;
    }
  }
  c.s = s + dir * 120; // núdzový odstup
  routePose(c.s, S._v1, S._hWrap, c.lane);
  c.x = S._v1.x; c.z = S._v1.z; c.h = S._hWrap.v + c.hOff;
  c.y = driveY(c.x, c.z, c.s, c.lane);
  snapSuspension(c);
}

// ---------- AI DOPRAVA: Distance LOD + staggered kolízie (proti sekanu) (verbatim js 10688–10916) ----------
// Pásma (d2, bez odmocnín): <150 m každý snímok · 150–350 m 5 Hz tick s akumulátorom stepu ·
// >350 m freeze (kolóna kreslí poslednú pózu, vedľajšie sa skryjú nulovou maticou).
// Kolízia s hráčom je lacný dot-product (žiadny THREE.Raycaster): prepočet len pre
// ~3 autá/snímok, výsledok držaný 0.3 s. Pohyb čisto kinematický (waypoint lerp +
// Y priamo z heightmapy), 4-kolesová suspenzia len do 150 m. Cap max 32 full-rate
// áut, kolóna má prioritu (gameplay stop-and-go ostáva plynulý).
// t = stav z createTraffic (pooly sú modulové; legacy `t` bol čas — ten drží aiTime).
export function updateTraffic(t, dt, player, playerS, routeLen) {
  aiTime += dt;
  const wave = 0.5 + 0.5 * Math.sin(aiTime * 0.35);
  aiTick++;
  const mut = aiMuted || (player && player.muted); // legacy game.muted
  let maxS = 0, i, c;
  for (i = 0; i < trafficPool.length; i++) { if (trafficPool[i].s > maxS) maxS = trafficPool[i].s; }
  // 1. pass: LOD pásma + active cap (kolóna prvá, vedľajšie len zo zvyšku budgetu)
  let budget = AI_MAX_FULL;
  for (i = 0; i < trafficPool.length; i++) {
    c = trafficPool[i];
    const dx = c.x - player.x, dz = c.z - player.z; c.d2 = dx * dx + dz * dz;
    if (c.d2 < AI_NEAR2 && budget > 0) { c.lod = 0; budget--; } else if (c.d2 < AI_MID2) { c.lod = 1; } else c.lod = 2;
  }
  for (i = 0; i < incomingPool.length; i++) {
    c = incomingPool[i];
    const dx = c.x - player.x, dz = c.z - player.z; c.d2 = dx * dx + dz * dz;
    if (c.d2 < AI_NEAR2 && budget > 0) { c.lod = 0; budget--; } else if (c.d2 < AI_MID2) { c.lod = 1; } else c.lod = 2;
  }
  for (i = 0; i < ambientPool.length; i++) {
    c = ambientPool[i];
    const dx = c.x - player.x, dz = c.z - player.z; c.d2 = dx * dx + dz * dz;
    if (c.d2 > AI_POOL2 && c.road >= 0) { c.road = -1; } // >400 m: späť do poolu, relocation ho dá pred hráča
    if (c.d2 < AI_NEAR2 && budget > 0) { c.lod = 0; budget--; } else if (c.d2 < AI_MID2) { c.lod = 1; } else c.lod = 2;
  }
  aiActive = AI_MAX_FULL - budget;
  for (i = 0; i < trafficPool.length; i++) {
    c = trafficPool[i];
    if (c.lod === 2) continue; // >350 m: zmrazené (póza ostáva, recyklácia kolóny nižšie beží)
    let step = dt;
    if (c.lod === 1) { // 150–350 m: 5 Hz tick, rýchlosť drží akumulátor
      c.lodT += dt;
      if (((aiTick + i) % 12) !== 0) continue;
      step = c.lodT; c.lodT = 0;
      if (!(step > 0)) step = dt; else if (step > 0.25) step = 0.25;
    }
    const next = trafficPool[(i + 1) % trafficPool.length];
    let gap = next.s - c.s;
    if (gap < 0) gap += routeLen;
    let cap = 11; // voľný úsek 513-ky
    for (let r = 0; r < S.roundS.length; r++) {
      if (c.s > S.roundS[r] - 50 && c.s < S.roundS[r] + 50) { cap = 2.5 + wave * 2.0; break; } // špunt kruháč
    }
    if (cap > 10 && c.s > S.bridgeS0 - 30 && c.s < S.bridgeS1 + 30) { cap = 5 + wave * 3.0; } // lievik most
    let target = cap;
    if (gap < 7) target = 0;
    else if (gap < 14) target = Math.min(target, 1.6);
    else if (gap < 24) target = Math.min(target, 4.0);
    // staggered prekážka: prepočet len pre ~3 autá/snímok, výsledok držaný 0.3 s
    if (((aiTick + i) % 10) === 0) {
      const pdx = player.x - c.x, pdz = player.z - c.z;
      const chx = Math.sin(c.h), chz = Math.cos(c.h);
      const lon = pdx * chx + pdz * chz;
      const latv = pdx * (-chz) + pdz * (chx);
      c.blockT = (lon > 0 && lon < 11 && latv > -2.6 && latv < 2.6) ? 0.3 : 0;
    } else c.blockT -= step;
    if (c.blockT > 0) { target = 0; }
    if (target > c.speed) { c.speed += 3.2 * step; if (c.speed > target) c.speed = target; } else { c.speed -= 9.0 * step; if (c.speed < target) c.speed = target; }
    if (c.speed < 0) c.speed = 0;
    c.s += c.speed * step;
    if (c.s > routeLen - 6) { safePlace(c, 8, 1, player); c.speed = 0; } // recyklácia na začiatok
    else {
      routePose(c.s, S._v1, S._hWrap, LANE_OFF);
      c.x = S._v1.x; c.z = S._v1.z; c.h = S._hWrap.v;
      c.y = driveY(c.x, c.z, c.s, LANE_OFF);
      if (c.lod === 0) updateSuspension(c, step, c.s, LANE_OFF); // suspenzia len blízko
    }
    c.spin += c.speed * step * 2.2;
    c.braking = (target < c.speed + 0.15) || (target < 0.3);
    // AI klaksón: náhodne blízko hráča (1 %/s) alebo kolóna pred mostom >3 s bez pohybu
    if (!mut) {
      c.hornCd -= step;
      if (c.d2 < 3600 && c.hornCd <= 0 && Math.random() < step * 0.01) {
        if (aiHonk(c)) c.hornCd = 8 + Math.random() * 12;
      } else if (c.s > S.bridgeS0 - 150 && c.s < S.bridgeS0 && Math.abs(c.speed) < 0.5) {
        c.hornT += step;
        if (c.hornT > 3) { c.hornT = 0; if (aiHonk(c)) c.hornCd = 5; }
      } else c.hornT = 0;
    }
  }
  // nekonečná kolóna: autá hlboko za hráčom sa presunú dopredu (bezpečne)
  if (maxS > 0) {
    for (i = 0; i < trafficPool.length; i++) {
      c = trafficPool[i];
      if (c.s < playerS - 80) {
        c.lane = LANE_OFF; c.hOff = 0;
        safePlace(c, maxS + 12 + (i % 5) * 2, 1, player);
        maxS = c.s;
      }
    }
  }
  // protismer: pokojná premávka opačným smerom (rovnaké LOD pásma)
  for (i = 0; i < incomingPool.length; i++) {
    c = incomingPool[i];
    if (c.lod === 2) { c.hidden = true; continue; } // >350 m: zmrazené + skryté
    c.hidden = false;
    let step = dt;
    if (c.lod === 1) {
      c.lodT += dt;
      if (((aiTick + i * 3) % 12) !== 0) continue;
      step = c.lodT; c.lodT = 0;
      if (!(step > 0)) step = dt; else if (step > 0.25) step = 0.25;
    }
    c.s -= c.vmax * step;
    if (c.s < 5) { c.lane = -LANE_OFF; c.hOff = Math.PI; safePlace(c, routeLen - 10, -1, player); } else {
      routePose(c.s, S._v1, S._hWrap, -LANE_OFF);
      c.x = S._v1.x; c.z = S._v1.z; c.h = S._hWrap.v + Math.PI;
      c.y = driveY(c.x, c.z, c.s, -LANE_OFF);
      if (c.lod === 0) updateSuspension(c, step, c.s, -LANE_OFF);
    }
    c.spin += c.speed * step * 2.2;
    c.braking = true;
    if (!mut && c.hornCd <= 0 && c.d2 < 3600 && Math.random() < step * 0.01) {
      if (aiHonk(c)) c.hornCd = 8 + Math.random() * 12;
    } else c.hornCd -= step;
  }
  // ambient: voľná doprava po celom meste (ping-pong po vedľajších cestách)
  ambientRR = (ambientRR + 1) % ambientPool.length;
  for (i = 0; i < ambientPool.length; i++) {
    c = ambientPool[i];
    if (c.lod === 2) { c.hidden = true; continue; } // >350 m: zmrazené + skryté (pool-recycle prebehol v 1. passe)
    c.hidden = false;
    if (i === ambientRR && (c.road < 0 || c.d2 > 160000)) {
      // presun blízko hráča (max 6 pokusov, bez alokácií)
      for (let k = 0; k < 6; k++) {
        const ri = Math.abs((i * 37 + aiTick * 13 + k * 101) % S.townRoads.length);
        const R = S.townRoads[ri];
        const mx = (R.pts[0] + R.pts[R.n * 2 - 2]) / 2, mz = (R.pts[1] + R.pts[R.n * 2 - 1]) / 2;
        const mdx = mx - player.x, mdz = mz - player.z;
        if (mdx * mdx + mdz * mdz < 122500) {
          c.road = ri; c.dir = (k % 2 === 0) ? 1 : -1;
          c.t = R.len * (0.2 + 0.6 * ((k * 29) % 10) / 10); c.seg = 0; c.speed = 0;
          ambientPlace(c, ri, c.t, dt, true, c.lod !== 0);
          break;
        }
      }
      continue;
    }
    if (c.road < 0) continue;
    let step = dt;
    if (c.lod === 1) { // 150–350 m: 5 Hz tick
      c.lodT += dt;
      if (((aiTick + i * 5) % 12) !== 0) continue;
      step = c.lodT; c.lodT = 0;
      if (!(step > 0)) step = dt; else if (step > 0.25) step = 0.25;
    }
    const R = S.townRoads[c.road];
    let target = c.vmax;
    if (((aiTick + i) % 6) === 0) { // staggered: ~2 autá/snímok
      const pdx = player.x - c.x, pdz = player.z - c.z;
      const chx = Math.sin(c.h), chz = Math.cos(c.h);
      const lon = pdx * chx + pdz * chz;
      const latv = pdx * (-chz) + pdz * (chx);
      c.blockT = (lon > 0 && lon < 11 && latv > -2.6 && latv < 2.6) ? 0.3 : 0;
    } else c.blockT -= step;
    if (c.blockT > 0) { target = 0; }
    if (target > c.speed) { c.speed += 3.0 * step; if (c.speed > target) c.speed = target; } else { c.speed -= 8.0 * step; if (c.speed < target) c.speed = target; }
    if (c.speed < 0) c.speed = 0;
    let nt = c.t + c.dir * c.speed * step;
    if (nt >= R.len || nt <= 0) {
      // koniec cesty: pokračuj napojením (plynulo v križovatke), nie otočkou
      const end = nt >= R.len ? 1 : 0;
      const links = end ? R.l1 : R.l0;
      if (links.length) {
        let ex, ez;
        if (end === 1) {
          ex = R.pts[R.n * 2 - 2] - R.pts[R.n * 2 - 4]; ez = R.pts[R.n * 2 - 1] - R.pts[R.n * 2 - 3];
        } else {
          ex = R.pts[0] - R.pts[2]; ez = R.pts[1] - R.pts[3];
        }
        const el = Math.sqrt(ex * ex + ez * ez) || 1; ex /= el; ez /= el;
        let bri = -1, bj = 0, bdir = 1, bcos = -2;
        for (let k = 0; k < links.length; k++) {
          const R2 = S.townRoads[links[k][0]];
          if (!R2) continue;
          const jj = links[k][1];
          for (let ds = -1; ds <= 1; ds += 2) {
            if (ds > 0 && jj >= R2.n - 1) continue;
            if (ds < 0 && jj <= 0) continue;
            const i2 = ds > 0 ? jj : jj - 1;
            let fx = R2.pts[i2 * 2 + 2] - R2.pts[i2 * 2], fz = R2.pts[i2 * 2 + 3] - R2.pts[i2 * 2 + 1];
            const fl = Math.sqrt(fx * fx + fz * fz) || 1;
            const dot = (ex * fx + ez * fz) / fl;
            if (dot > bcos) { bcos = dot; bri = links[k][0]; bj = jj; bdir = ds; }
          }
        }
        if (bri < 0) { c.road = -1; continue; } // slepá ulica: presuň sa
        if (((aiTick + i) & 3) === 0) {
          // občas odboč inam (nie vždy najrovnejšie)
          const alt = links[(bcos > -2 ? 1 : 0) % links.length];
          if (alt && alt[0] !== bri && S.townRoads[alt[0]]) {
            bri = alt[0]; bj = alt[1];
            const R2 = S.townRoads[bri];
            bdir = (bj >= R2.n - 1) ? -1 : 1;
          }
        }
        const R2 = S.townRoads[bri];
        c.road = bri;
        c.seg = bj;
        if (c.seg > R2.n - 2) c.seg = R2.n - 2;
        c.dir = bdir;
        c.t = R2.cum[bj];
        ambientPlace(c, c.road, c.t, step, false, c.lod !== 0);
      } else {
        c.road = -1; // slepá ulica: potichu sa presuň inde (round-robin prerozdelí)
      }
      c.braking = false;
      continue;
    }
    ambientPlace(c, c.road, nt, step, false, c.lod !== 0);
    c.spin += c.speed * step * 2.2;
    c.braking = (target < 0.5);
    if (!mut && c.hornCd <= 0 && c.d2 < 3600 && Math.random() < step * 0.01) {
      if (aiHonk(c)) c.hornCd = 8 + Math.random() * 12;
    } else c.hornCd -= step;
  }
}

// ---------- AI KLAKSÓN (signatúra legacy js 4071; telo = delegácia na hornFn, blízko = do 60 m) ----------
// Legacy hral pozičný hornPool sample; v modulárnej architektúre zvuk vlastní audio/sfx.js
// (ai/ nesmie siahať na audio/DOM). main.js injektuje `setHorn((x, y, z) => sfx.honkAt(...))`.
export function aiHonk(c) {
  if (!c || c.d2 > 3600) return false; // blízko = do 60 m (d2 < 3600, ako legacy triggery)
  // POISTKA z legacy: neposielať NaN do pannera (zabil by každý frame renderu).
  if (!isFinite(c.x) || !isFinite(c.y) || !isFinite(c.z)) return false;
  if (!hornFn) return false;
  try {
    hornFn(c.x, c.y + 1.2, c.z);
    return true;
  } catch { return false; }
}

/** Injektáž klaksónu z main.js. Vráti predchádzajúci handler. */
export function setHorn(fn) {
  const prev = hornFn;
  hornFn = fn;
  return prev;
}

/** Mute pre AI trúbenie (legacy game.muted; signatúra updateTraffic ho nemá). */
export function setMuted(m) {
  aiMuted = !!m;
}

export function isMuted() {
  return aiMuted;
}
