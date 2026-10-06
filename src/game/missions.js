// src/game/missions.js — misie + turbo + warp (port z monolitu, adaptovaný na car-objekt).
// Zdroje (relatívne od <script type="module">):
// - js cca 9674–9688: TURBO_T/VMAX_TURBO/TURBO_TQ, turboActive, toggleTurbo
// - js cca 9696–9703 + 9736–9793: WARP, clearOfBuildings, warpCar, faceTowards, warpLandmark
// - js cca 10001–10215: ZPN, buildCheckpoints, startMission, missionDone,
//   missionWarpReset, missionReset, updateMissions, updateMissionHUD, updateBoostHUD.
// ADAPTÁCIA: žiadne game/player/input/bgm/showToast globály (všetko cez params/api);
// S.* len mená existujúce v src/world/shared.js; stav misií/turba držia moduly.
// nearestRoute importuj z '../ai/traffic.js' (src/game/ → src/ai/traffic.js);
// BGRID cez S.*. Žiadne volania pri importe. Komentáre zachované. Export na všetko.
// VYNECHANÉ: cheat-kódy (CHEAT_DEFS a ďalej) a fixCar.
import * as THREE from 'three';
import { S } from '../world/shared.js';
import { routePose } from '../world/roads.js';
import { driveY, getTerrainHeight, LANE_OFF } from '../world/height.js';
import { gridQuery } from '../world/ground.js';
import { nearestRoute } from '../ai/traffic.js';
import { DR } from './drift.js';

// ---------- 1) PAMÄTNÉ MIESTA (warp ciele) ----------
// Súradnice sú svetové (R1 = 0,0) a odvodené z OSM dát uložených v tomto súbore:
//   zámok   -> CASTLE_X/Z (výškový model, konštanta vyššie) + najbližšia vozovka
//              pod zámkom, 44 m od jeho osi (terén zámku nie je vozovka)
//   Urbánek -> zóna URBAN_X/Z (OSM uzol "Hlohovec, Urbánek" 242 m n.m.). Bod je
//              na vrchole z serpentínových uličiek (109 m, 1.3 m od vozovky) a
//              MISIA 1 sa ide DOWNHILL - preto sa auto otáča k najbližšiemu
//              bodu trasy (t.j. do údolia k Hlohovcu), NIE na kopec do URBAN_X/Z.
//   stanica -> železničné rozvetie: spoločný koniec OSM vetiev "rails" 1 a 8
//              (odtiaľ trasa Hlohovec–Bratislava / Hlohovec–Trnava)
// Mostová brána sa dopočíta z bridgeS0 (prepočítané v buildRoute), nie je
// natvrdo - inak by teleport ostal na starom mieste pri úprave trasy.
export const LM_CASTLE = { x: -1775.5, z: -167.9, r: 26 };
export const LM_URBAN = { x: -1820.0, z: 490.0, r: 34 };
export const LM_STATION = { x: 2.0, z: -826.5, r: 24 };

// ---------- 2) TURBO ----------
export const TURBO_T = 12.0; // dĺžka boostu (s)
export const VMAX_TURBO = 83.333; // 300 km/h v m/s
export const TURBO_TQ = 1.65; // násobok krútiaceho momentu počas boostu
// Stav na našom car/state — turboT drží modul (neťahá sa do core/state).
export let turboT = 0;

export function turboActive() {
  return turboT > 0;
}

export function toggleTurbo(toast) {
  turboT = TURBO_T;
  // pôvodne aj beep(520, 0.1, 0) — audio rieši sfx v main, tu vynechané.
  if (typeof toast === 'function') toast('TURBO: 300 km/h, ' + TURBO_T.toFixed(0) + ' s', 2.4);
}

// Odpočet boostu (pôvodne updateCheatState z monolitu).
// notify(msg) volá pri expirácii — main posiela hud.toast.
export function updateTurbo(dt, notify) {
  if (turboT > 0) {
    turboT -= dt;
    if (turboT <= 0) {
      turboT = 0;
      if (typeof notify === 'function') notify('TURBO došiel. Späť na 250 km/h.', 2.0);
    }
  }
  return turboT;
}

// Pôvodný názov z monolitu — alias na updateTurbo (zachovaná kompatibilita).
export function updateCheatState(dt, notify) {
  return updateTurbo(dt, notify);
}

// ---------- 3) BEZPREČNÝ WARP ----------
export const WARP = { x: 0, z: 0 };
// VYNECHANÉ z monolitu: PLAYER_OK + sanitizePlayerTransform() (PositionalAudio
// poistka proti NaN v matrixWorld). Nový car-objekt NaN stráži v warpCar
// (isFinite fallback na car.x/car.z/car.h) a audio nemá PositionalAudio dietu.

// teleport nesmie skončiť vnútri múru: vytlačí bod z OBB budov (BGRID)
// rovnakou konvenciou uhlov ako overlapBox (forward = (sin,cos))
export function clearOfBuildings(x, z) {
  let px = x;
  let pz = z;
  for (let pass = 0; pass < 3; pass++) {
    const n = gridQuery(S.BGRID, px, pz, 1);
    let moved = false;
    for (let i = 0; i < n; i++) {
      const b = S.GQ[i];
      const dx = px - S.BX.x[b];
      const dz = pz - S.BX.z[b];
      const c = Math.cos(S.BX.rot[b]);
      const s = Math.sin(S.BX.rot[b]);
      const lf = dx * s + dz * c; // pozdĺžne
      const lr = -(dx * c) + dz * s; // priečne
      const af = lf < 0 ? -lf : lf;
      const ar = lr < 0 ? -lr : lr;
      const hf = S.BX.hl[b] + 1.6;
      const hr = S.BX.hw[b] + 1.6;
      if (af > hf || ar > hr) continue;
      let of = 0;
      let or = 0;
      if (hf - af < hr - ar) {
        of = (lf < 0 ? -hf : hf) - lf;
      } else {
        or = (lr < 0 ? -hr : hr) - lr;
      }
      px += s * of - c * or;
      pz += c * of + s * or;
      moved = true;
    }
    if (!moved) break;
  }
  WARP.x = px;
  WARP.z = pz;
  return WARP;
}

// teleport na podvozku (adaptovaný): nastaví y z fyzikálneho collidera.
// Monolit navyše volal snapSuspension, sanitizePlayerTransform, game.immune/
// crashCooldown/stuckT/shake a camera.position — to je VYNECHANÉ (fyziku/kameru
// rieši main + src/physics/vehicle.js). missionWarpReset volá warpCar.
export function warpCar(car, x, z, heading) {
  if (!car) return car;
  let nx = x;
  let nz = z;
  let nh = heading;
  if (!isFinite(nx)) nx = car.x; // teleport nesmie zaviesť NaN do transformu
  if (!isFinite(nz)) nz = car.z;
  const fallbackH = typeof car.h === 'number'
    ? car.h
    : (typeof car.heading === 'number' ? car.heading : 0);
  if (!isFinite(nh)) nh = fallbackH;
  if (nx < S.GB.x0) nx = S.GB.x0;
  else if (nx > S.GB.x1) nx = S.GB.x1;
  if (nz < S.GB.z0) nz = S.GB.z0;
  else if (nz > S.GB.z1) nz = S.GB.z1;
  clearOfBuildings(nx, nz);
  car.x = WARP.x;
  car.z = WARP.z;
  // s pre driveY: najbližší bod trasy (namiesto routeFrameOf/RF.s/RF.lat).
  let s = 0;
  try {
    const nr = nearestRoute(car.x, car.z);
    if (nr && typeof nr.s === 'number') s = nr.s;
  } catch { s = 0; }
  try {
    car.y = driveY(car.x, car.z, s, 0);
  } catch { /* výška ostáva na volajúcom */ }
  if (typeof car.h === 'number') car.h = nh;
  else car.heading = nh;
  car.speed = 0;
  if (typeof car.latV === 'number') car.latV = 0;
  if (typeof car.yawRate === 'number') car.yawRate = 0;
  if (typeof car.steer === 'number') car.steer = 0;
  missionWarpReset();
  return car;
}

// smer "k zámku" / "k ceste": forward = (sin h, cos h) => h = atan2(dx, dz)
export function faceTowards(car, tx, tz) {
  const cx = car?.x ?? 0;
  const cz = car?.z ?? 0;
  return Math.atan2(tx - cx, tz - cz);
}

export function warpLandmark(car, lx, lz, faceX, faceZ) {
  warpCar(car, lx, lz, faceTowards(car, faceX, faceZ));
  return car;
}

// VYNECHANÉ z monolitu: fixCar() (oprava + narovnanie po trase) a cheat-kódy
// (CHEAT_DEFS, cheatIndexOf, cheatPrefixMatch, cheatKey, cheatToast, runCheat,
// toggleNoclip). Dôvod: cheaty nepatria do misií; oprava je vec physics/main.

// ---------- 7) MISIE + 3D CHECKPOINT TRIGGER ZÓNY ----------
// ZPN.M sa naplní raz v buildCheckpoints (bridgeS0 je známy až po buildRoute).
export const ZPN = {
  grp: null,
  M: null,
  cx: [0, 0, 0],
  cz: [0, 0, 0],
  cy: [0, 0, 0],
  cr: [0, 0, 0],
  cyl: [null, null, null],
  disc: [null, null, null],
  mCyl: [null, null, null],
  mDisc: [null, null, null],
  vis: [false, false, false],
  pulse: [0, 0, 0],
  active: -1,
  res: 0,
  resT: 0,
  lastIdx: -1,
  why: '',
  cool: 0,
  prog: 0,
  t: 0,
  inZone: false,
  onBridge: false,
  bTime: 0,
  slowT: 0,
  hudName: '',
  hudStat: '',
  hudRes: '',
  hudOn: false,
  hudBar: -1,
  hudPct: -1,
  boostOn: false,
  boostTxt: '',
};

// Posledný car pre updateMissionHUD bez parametra (HUD číta rýchlosť auta).
let _lastCar = null;

export function buildCheckpoints() {
  // 1) misie (jednorazovo, žiadna alokácia v slučke)
  ZPN.M = [
    {
      name: 'MISIA 1 · URBÁNEK DOWNHILL DRIFT',
      kind: 0,
      x: S.URBAN_X,
      z: S.URBAN_Z,
      r: 430,
      target: 2500,
      limit: 240,
      hint: '2 500 drift bodov · ručná brzda = SPACE',
    },
    {
      name: 'MISIA 2 · VÁH BRIDGE DASH',
      kind: 1,
      r: 180,
      target: 0,
      limit: 45,
      hint: 'prejdi most > 180 km/h · zábradlie sa nedotýkať',
    },
  ];
  // 2) tri trigger zóny: Zámok (landmark), Urbánek (M1), nájazd na most (M2)
  ZPN.cx[0] = LM_CASTLE.x;
  ZPN.cz[0] = LM_CASTLE.z;
  ZPN.cr[0] = LM_CASTLE.r;
  ZPN.cx[1] = LM_URBAN.x;
  ZPN.cz[1] = LM_URBAN.z;
  ZPN.cr[1] = LM_URBAN.r;
  const bs = Math.max(4, S.bridgeS0 - 22);
  routePose(bs, S._v1, S._hWrap, LANE_OFF);
  ZPN.cx[2] = S._v1.x;
  ZPN.cz[2] = S._v1.z;
  ZPN.cr[2] = 22;
  // 3) geometria: jedna jednotková valcová plášť + jeden prstenec, zdieľané
  //    cez scale (rôzne polomery zón = 0 extra geometrie). Obidva idú do GEO,
  //    ktorý cleanup() disposuje (netreba DYN_GEO - inak dvojitý dispose).
  const seg = S.IS_MOBILE ? 18 : 30;
  S.GEO.zoneCyl = new THREE.CylinderGeometry(1, 1, 1, seg, 1, true);
  S.GEO.zoneDisc = new THREE.RingGeometry(0.78, 1, seg);
  S.GEO.zoneDisc.rotateX(-Math.PI / 2);
  const grp = new THREE.Group();
  ZPN.grp = grp;
  S.scene.add(grp);
  const cols = [0xffb000, 0x39ff6a, 0x35c8ff];
  for (let i = 0; i < 3; i++) {
    const matC = new THREE.MeshBasicMaterial({
      color: cols[i],
      transparent: true,
      opacity: 0.20,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const matD = new THREE.MeshBasicMaterial({
      color: cols[i],
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    S.MAT['zoneCyl' + i] = matC;
    S.MAT['zoneDisc' + i] = matD;
    ZPN.mCyl[i] = matC;
    ZPN.mDisc[i] = matD;
    const cy = getTerrainHeight(ZPN.cx[i], ZPN.cz[i]);
    ZPN.cy[i] = cy;
    const H = 30;
    const cyl = new THREE.Mesh(S.GEO.zoneCyl, matC);
    cyl.scale.set(ZPN.cr[i], H, ZPN.cr[i]);
    cyl.position.set(ZPN.cx[i], cy + H * 0.5, ZPN.cz[i]);
    cyl.renderOrder = 2;
    const disc = new THREE.Mesh(S.GEO.zoneDisc, matD);
    disc.scale.set(ZPN.cr[i], 1, ZPN.cr[i]);
    disc.position.set(ZPN.cx[i], cy + 0.12, ZPN.cz[i]);
    disc.renderOrder = 2;
    grp.add(cyl);
    grp.add(disc);
    ZPN.cyl[i] = cyl;
    ZPN.disc[i] = disc;
    ZPN.pulse[i] = i * 2.1;
    cyl.visible = false;
    disc.visible = false;
  }
}

export function startMission(i, toast) {
  ZPN.active = i;
  ZPN.lastIdx = i;
  ZPN.res = 0;
  ZPN.why = '';
  ZPN.prog = 0;
  ZPN.t = 0;
  ZPN.inZone = false;
  ZPN.onBridge = false;
  ZPN.bTime = 0;
  ZPN.slowT = 0;
  // pôvodne aj beep(660, 0.12, 0) — audio rieši sfx v main, tu vynechané.
  if (ZPN.M && ZPN.M[i] && typeof toast === 'function') toast(ZPN.M[i].name + '\n' + ZPN.M[i].hint, 3.4);
}

export function missionDone(ok, why, toast) {
  if (ZPN.res !== 0) return;
  ZPN.res = ok ? 1 : 2;
  ZPN.resT = 4.5;
  ZPN.cool = 6.0; // stojíš stále v zóne -> ďalšia misia sa nesmie spustiť hneď
  ZPN.why = why || '';
  const m = ZPN.M ? ZPN.M[ZPN.active < 0 ? ZPN.lastIdx : ZPN.active] : null;
  const nm = m ? m.name : '';
  // pôvodne aj beep(990/200, ...) — audio rieši sfx v main, tu vynechané.
  if (typeof toast === 'function') {
    if (ok) toast('PASSED · ' + nm, 3.4);
    else toast('FAILED · ' + nm + (why ? '\n' + why : ''), 3.4);
  }
}

export function missionWarpReset() { // teleport = misia sa preruší, banner zmizne
  ZPN.active = -1;
  ZPN.res = 0;
  ZPN.resT = 0;
  ZPN.why = '';
  // cool sa NEDÁVA: teleport do zóny je zámer - WARPURBANEK/WARPBRIDGE majú
  // misiu spustiť hneď (odstávka patrí až po vyhodnotení misie, pozri missionDone).
  ZPN.cool = 0;
  ZPN.prog = 0;
  ZPN.t = 0;
  ZPN.onBridge = false;
  ZPN.inZone = false;
}

let _elMission = null;
let _elMName = null;
let _elMStat = null;
let _elMRes = null;
let _elBarMission = null;
let _elBoost = null;

function _missionEls() {
  if (_elMName) return true;
  _elMission = document.getElementById('mission');
  _elMName = document.getElementById('m-name');
  _elMStat = document.getElementById('m-stat');
  _elMRes = document.getElementById('m-res');
  _elBarMission = document.getElementById('bar-mission');
  _elBoost = document.getElementById('boost-badge');
  return !!(_elMission && _elMName && _elMStat && _elMRes && _elBarMission);
}

export function missionReset() {
  missionWarpReset();
  ZPN.lastIdx = -1;
  ZPN.hudName = '';
  ZPN.hudStat = '';
  ZPN.hudRes = '';
  ZPN.hudOn = false;
  ZPN.hudBar = -1;
  ZPN.hudPct = -1;
  if (!_missionEls()) return;
  _elMission.classList.remove('on');
  _elMRes.className = 'mres';
}

export function updateMissions(dt, api = {}) {
  // ADAPTÁCIA: monolit čítal player.{x,z,speed}, playerS, bridgeS0/S1/bridgeLen,
  // RF.lat, DR.{on,rate}, game.noclip, showToast/beep.
  // Nové: api={car, playerS, routeLen, toast(msg), onWin(), onFail(msg)}
  // + voliteľné api.lat / api.noclip (fallbacky nižšie).
  if (!ZPN.grp) return;
  const car = api?.car ?? {};
  _lastCar = car;
  const cx = car?.x ?? 0;
  const cz = car?.z ?? 0;
  const spd = car?.speed ?? 0;
  const playerS = typeof api?.playerS === 'number' ? api.playerS : 0;
  const routeLen = typeof api?.routeLen === 'number' ? api.routeLen : S.routeLen;
  const toast = typeof api?.toast === 'function' ? api.toast : null;
  const noclip = !!(api?.noclip ?? car?.noclip ?? false);
  // routeLen je súčasťou api (main drží S.routeLen) — tu len na úplnosť mapovania.
  if (!(routeLen > 0)) {
    // zámerne prázdne: bridge logika stojí na S.bridgeS0/S1, nie na routeLen
  }
  // 1) 3D zóny: viditeľnosť + pulz (ľahké porovnanie vzdialenosti, 3 kusy)
  for (let i = 0; i < 3; i++) {
    const dx = cx - ZPN.cx[i];
    const dz = cz - ZPN.cz[i];
    const vis = dx * dx + dz * dz < 620 * 620;
    if (vis !== ZPN.vis[i]) {
      ZPN.vis[i] = vis;
      ZPN.cyl[i].visible = vis;
      ZPN.disc[i].visible = vis;
    }
    if (vis) {
      ZPN.pulse[i] += dt;
      const s = 0.5 + 0.5 * Math.sin(ZPN.pulse[i] * 2.4);
      ZPN.mCyl[i].opacity = 0.14 + 0.11 * s;
      ZPN.mDisc[i].opacity = 0.38 + 0.26 * s;
      ZPN.disc[i].rotation.y += dt * 0.6;
    }
  }
  // 2) trigger: vstup do zóny rozbehne misiu (GTA štýl)
  //    cool: po vyhodnotení misie je hráč stále v jej zóne. Bez odstávky by si
  //    misiu znovu spustil v nasledujúcom snímku - banner by si ani nestihol prečítať.
  if (ZPN.cool > 0) ZPN.cool -= dt;
  if (ZPN.res === 0 && ZPN.active < 0 && ZPN.cool <= 0 && !noclip) {
    for (let i = 0; i < 3; i++) {
      const dx = cx - ZPN.cx[i];
      const dz = cz - ZPN.cz[i];
      if (dx * dx + dz * dz < ZPN.cr[i] * ZPN.cr[i]) {
        if (i === 2) startMission(1, toast);
        else if (i === 1) startMission(0, toast);
        // pôvodne aj beep(520, 0.08, 0) — audio rieši sfx v main, tu vynechané.
        else if (toast) toast('ZÁMOK HLOHOVEC · landmark', 2.2);
        break;
      }
    }
  }
  // 3) výsledok drží banner ešte resT sekúnd, potom sa panel schová
  if (ZPN.res !== 0) {
    ZPN.resT -= dt;
    if (ZPN.resT <= 0) missionWarpReset();
    return;
  }
  if (ZPN.active < 0) return;
  const m = ZPN.M[ZPN.active];
  ZPN.t += dt;
  if (m.kind === 0) {
    // MISION 1: drift body sa počítajú len v zóne Urbánka
    const dx = cx - m.x;
    const dz = cz - m.z;
    ZPN.inZone = (dx * dx + dz * dz) < m.r * m.r;
    if (DR.on && ZPN.inZone) ZPN.prog += DR.rate * dt;
    if (ZPN.prog >= m.target) {
      missionDone(true, '', toast);
      try {
        api?.onWin?.();
      } catch { /* callback nesmie zhodiť slučku */ }
    } else if (ZPN.t > m.limit) {
      const why = 'ČAS VYPRŠAL (' + Math.round(m.limit) + ' s)';
      missionDone(false, why, toast);
      try {
        api?.onFail?.(why);
      } catch { /* callback nesmie zhodiť slučku */ }
    }
  } else {
    // MISION 2: mostová brána - > 180 km/h po celý prechod, bez zábradlia
    ZPN.inZone = false;
    if (playerS > S.bridgeS0 && playerS < S.bridgeS1) {
      if (!ZPN.onBridge) {
        ZPN.onBridge = true;
        ZPN.bTime = 0;
        ZPN.slowT = 0;
      }
      ZPN.bTime += dt;
      const kmh = (spd < 0 ? -spd : spd) * 3.6;
      // RF.lat → api.lat, inak vzdialenosť od trasy cez nearestRoute (d ≈ |lat|).
      let alat = 0;
      if (typeof api?.lat === 'number') {
        alat = api.lat < 0 ? -api.lat : api.lat;
      } else if (typeof car?.lat === 'number') {
        alat = car.lat < 0 ? -car.lat : car.lat;
      } else {
        try {
          const nr = nearestRoute(cx, cz);
          alat = nr ? nr.d : 0;
        } catch { alat = 0; }
      }
      if (alat > 3.2) {
        missionDone(false, 'ZÁBRADLIE', toast);
        try {
          api?.onFail?.('ZÁBRADLIE');
        } catch { /* callback nesmie zhodiť slučku */ }
      } else if (kmh < 180) {
        ZPN.slowT += dt; // 0.35 s tolerancie pre výkyvy
        if (ZPN.slowT > 0.35) {
          missionDone(false, 'POD 180 KM/H', toast);
          try {
            api?.onFail?.('POD 180 KM/H');
          } catch { /* callback nesmie zhodiť slučku */ }
        }
      } else ZPN.slowT = 0;
      if (ZPN.res === 0 && ZPN.bTime > m.limit) {
        missionDone(false, 'ČAS VYPRŠAL', toast);
        try {
          api?.onFail?.('ČAS VYPRŠAL');
        } catch { /* callback nesmie zhodiť slučku */ }
      }
    } else if (ZPN.onBridge && playerS >= S.bridgeS1) {
      missionDone(true, '', toast); // playerS je schodík ~2.8 m
      try {
        api?.onWin?.();
      } catch { /* callback nesmie zhodiť slučku */ }
    }
    let pp = S.bridgeLen > 0 ? (playerS - S.bridgeS0) / S.bridgeLen : 0;
    if (pp < 0) pp = 0;
    else if (pp > 1) pp = 1;
    ZPN.prog = pp;
  }
}

export function updateMissionHUD(carParam) {
  if (!_missionEls()) return;
  // car pre rýchlosť v M2: param, inak posledný car z updateMissions (bez globál).
  const car = carParam ?? _lastCar ?? {};
  const spd = typeof car?.speed === 'number' ? car.speed : 0;
  let on = false;
  let name = '';
  let stat = '';
  let resTxt = '';
  let resCls = 'mres';
  let pct = 0;
  let barW = 0;
  let hot = false;
  if (ZPN.res !== 0) {
    const m = ZPN.M[ZPN.lastIdx < 0 ? 0 : ZPN.lastIdx];
    on = true;
    name = m.name;
    stat = ZPN.res === 1
      ? 'HOTOVO · ' + Math.round(ZPN.prog) + (m.target ? ' / ' + m.target : '')
      : 'PREPADSLO: ' + ZPN.why;
    resTxt = ZPN.res === 1 ? 'PASSED' : 'FAILED';
    resCls = 'mres ' + (ZPN.res === 1 ? 'pass' : 'fail');
    barW = 100;
  } else if (ZPN.active >= 0) {
    const m = ZPN.M[ZPN.active];
    on = true;
    name = m.name;
    if (m.kind === 0) {
      stat = Math.round(ZPN.prog) + ' / ' + m.target + ' · ' + Math.round(m.limit - ZPN.t) + ' s';
      if (DR.on && ZPN.inZone) stat = '+' + Math.round(DR.rate) + ' bodov/s · ' + stat;
      else if (!ZPN.inZone) stat = 'MIMO ZÓNY · ' + stat;
      pct = ZPN.prog / m.target;
      barW = pct > 1 ? 100 : pct * 100;
    } else {
      stat = Math.round(ZPN.prog * 100) + ' % mosta · ' + Math.round(m.limit - ZPN.t) + ' s';
      if (ZPN.onBridge) {
        const kmh = Math.round((spd < 0 ? -spd : spd) * 3.6);
        stat = kmh + ' km/h · ' + stat;
      }
      barW = ZPN.prog * 100;
    }
    if (barW > 100) barW = 100;
    hot = barW > 80;
  }
  if (on !== ZPN.hudOn) {
    ZPN.hudOn = on;
    _elMission.classList.toggle('on', on);
  }
  if (!on) return;
  if (name !== ZPN.hudName) {
    ZPN.hudName = name;
    _elMName.textContent = name;
  }
  if (stat !== ZPN.hudStat) {
    ZPN.hudStat = stat;
    _elMStat.textContent = stat;
  }
  if (resTxt !== ZPN.hudRes) {
    ZPN.hudRes = resTxt;
    _elMRes.textContent = resTxt;
    _elMRes.className = resCls;
  }
  const bw = barW.toFixed(1); // zhoda s #bar-route: pri cieli 2500 by celé číslo
  if (bw !== ZPN.hudBar) { // ukazovalo "0%" prvých ~12 bodov a vyzeralo zaseknuté
    ZPN.hudBar = bw;
    _elBarMission.firstElementChild.style.width = bw + '%';
    _elBarMission.classList.toggle('hot', hot);
  }
}

export function updateBoostHUD() {
  if (!_missionEls() && !document.getElementById('boost-badge')) return;
  const badge = _elBoost ?? document.getElementById('boost-badge');
  if (!badge) return;
  if (!_elBoost) _elBoost = badge;
  const on = turboT > 0;
  if (on !== ZPN.boostOn) {
    ZPN.boostOn = on;
    badge.classList.toggle('on', on);
  }
  const t = on ? turboT.toFixed(1) : '';
  if (t !== ZPN.boostTxt) {
    ZPN.boostTxt = t;
    badge.textContent = t ? 'TURBO ' + t + 's' : 'TURBO';
  }
}
