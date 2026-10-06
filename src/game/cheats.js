// src/game/cheats.js — cheat-kódy v GTA štýle (verbatim logika z monolitu).
// Písanie hocikde do klávesnice skladá buffer; zhoda spustí kód. WASD/šípky/
// medzerník jazdia vždy (buffer ich neruší), single-key skratky sa potláčajú
// len kým buffer reálne smeruje ku kódu (cheatLock okno 1.1 s).
import { S } from '../world/shared.js';
import { routePose } from '../world/roads.js';
import { nearestRoute } from '../ai/traffic.js';
import { warpLandmark, warpCar, clearOfBuildings, toggleTurbo, LM_CASTLE, LM_URBAN, LM_STATION, WARP } from './missions.js';
import { driveY } from '../world/height.js';

const CHEAT_DEFS = [
  { code: 'NOCLIP', name: 'GHOST CAM' },
  { code: 'WARPZAMOK', name: 'HLOHOVEC CASTLE' },
  { code: 'WARPURBANEK', name: 'URBÁNEK VIEWPOINT' },
  { code: 'WARPBRIDGE', name: 'VÁH BRIDGE' },
  { code: 'WARPSTATION', name: 'RAILWAY STATION' },
  { code: 'FIXCAR', name: 'REPAIR + RIGHT' },
  { code: 'HESOYAM', name: 'REPAIR + RIGHT' },
  { code: 'TURBO', name: 'TURBO BOOST' },
];
let CHEAT_MAX = 6;
for (const d of CHEAT_DEFS) {
  d.lc = d.code.toLowerCase();
  if (d.lc.length > CHEAT_MAX) CHEAT_MAX = d.lc.length;
}

let keyBuf = '';
let cheatLock = 0;
let noclip = false;

export function isNoclip() { return noclip; }
// Okno, počas ktorého sa potláčajú single-key skratky (H/M/X/Q/E/R/T).
export function cheatLocked() { return performance.now() < cheatLock; }

function cheatIndexOf(buf) {
  for (let i = 0; i < CHEAT_DEFS.length; i++) { if (CHEAT_DEFS[i].lc === buf) return i; }
  return -1;
}
function cheatPrefixMatch(buf) {
  for (const d of CHEAT_DEFS) {
    if (d.lc.length >= buf.length && d.lc.startsWith(buf)) return true;
  }
  return false;
}

// Jeden písmenový stisk (a–z). Vracia true, ak sa má stisk považovať za
// súčasť písania (volajúci vtedy preskočí single-key skratku).
export function cheatKey(k, api) {
  keyBuf = (keyBuf + k).slice(-CHEAT_MAX);
  const i = cheatIndexOf(keyBuf);
  if (i >= 0) { keyBuf = ''; cheatLock = 0; runCheat(i, api); return true; }
  if (!cheatPrefixMatch(keyBuf)) { keyBuf = ''; return false; }
  if (keyBuf.length >= 2) cheatLock = performance.now() + 1100;
  return true;
}
export function cheatCancel() { keyBuf = ''; cheatLock = 0; }
// Práve sa skladá kód (pre zrušenie inou klávesou).
export function cheatTyping() { return keyBuf.length > 0; }

export function cheatToast(name) {
  const elName = document.getElementById('cheat-name');
  const el = document.getElementById('cheat-toast');
  if (!elName || !el) return;
  elName.textContent = name;
  el.classList.remove('run');
  void el.offsetWidth; // reflow = CSS animácia od začiatku
  el.classList.add('run');
}

// Zjednodušený FIXCAR (monolit riešil aj náklon/denture — naša arkáda sa
// neprevracia): vytiahni z múru, otoč po trase, vychlaď motor, ukľudni vodiča.
export function fixCar(car, toast) {
  if (!car) return;
  clearOfBuildings(car.x, car.z);
  car.x = WARP.x;
  car.z = WARP.z;
  const nr = nearestRoute(car.x, car.z);
  car.h = nr.h;
  car.y = driveY(car.x, car.z, nr.s, 0);
  car.speed = 0;
  car.temp = 0.2;
  car.stress = 0;
  toast?.('OPRAVENÉ · motor beží · kolesá na teréne');
}
export function toggleNoclip(force, api) {
  noclip = force !== undefined ? !!force : !noclip;
  if (noclip && api?.car) api.car.speed = 0;
  api?.toast?.(noclip ? 'GHOST CAM: W/S + A/D, SPACE hore, SHIFT dole, E sprint' : 'GHOST CAM: VYPNUTÝ');
  document.getElementById('noclip')?.classList.toggle('on', noclip);
}

// Lietanie bez kolízií (verbatim pohyb z monolitu; E = sprint ×3).
export function updateNoclip(dt, car, input) {
  const k = input.keys || {};
  const fast = k.KeyE ? 3 : 1;
  const spd = 14 * fast * dt, vsp = 12 * fast * dt;
  const fx = Math.sin(car.h), fz = Math.cos(car.h);
  const rx = -fz, rz = fx;
  if (k.KeyW || k.ArrowUp) { car.x += fx * spd; car.z += fz * spd; }
  if (k.KeyS || k.ArrowDown) { car.x -= fx * spd; car.z -= fz * spd; }
  if (k.KeyD || k.ArrowRight) { car.x += rx * spd; car.z += rz * spd; }
  if (k.KeyA || k.ArrowLeft) { car.x -= rx * spd; car.z -= rz * spd; }
  if (k.Space) car.y += vsp;
  if (k.ShiftLeft || k.ShiftRight) car.y -= vsp;
  if (car.y < -25) car.y = -25; else if (car.y > 400) car.y = 400;
  if (car.x < S.GB.x0) car.x = S.GB.x0; else if (car.x > S.GB.x1) car.x = S.GB.x1;
  if (car.z < S.GB.z0) car.z = S.GB.z0; else if (car.z > S.GB.z1) car.z = S.GB.z1;
  car.speed = 0;
}

export function runCheat(i, api) {
  const car = api?.car;
  if (!api?.playing?.()) return;
  const d = CHEAT_DEFS[i];
  if (!d || !car) return;
  const toast = api.toast;
  switch (i) {
    case 0: toggleNoclip(undefined, api); break;
    case 1: warpLandmark(car, LM_CASTLE.x, LM_CASTLE.z, S.CASTLE_X, S.CASTLE_Z); break;
    case 2: {
      const nr1 = nearestRoute(LM_URBAN.x, LM_URBAN.z);
      warpLandmark(car, LM_URBAN.x, LM_URBAN.z, nr1.x, nr1.z);
      break;
    }
    case 3: {
      const bs = Math.max(4, S.bridgeS0 - 22);
      routePose(bs, S._v1, S._hWrap, 0);
      warpCar(car, S._v1.x, S._v1.z, S._hWrap.v);
      break;
    }
    case 4: {
      const nr0 = nearestRoute(LM_STATION.x, LM_STATION.z);
      warpLandmark(car, LM_STATION.x, LM_STATION.z, nr0.x, nr0.z);
      break;
    }
    case 5: case 6: fixCar(car, toast); break;
    case 7: toggleTurbo(toast); break;
  }
  cheatToast(d.name);
  // warp zmení pozíciu mimo slučku — daj vedieť main loopu
  if (i >= 1 && i <= 4 && api?.onWarp) api.onWarp();
}
