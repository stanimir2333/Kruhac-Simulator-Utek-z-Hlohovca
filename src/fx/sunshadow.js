// src/fx/sunshadow.js — DYNAMICKÉ tiene: tieňový frustum cestuje s hráčom.
// Verbatim logika z monolitu (shadowLocalRange + shadowFrustum + applyShadowBias),
// adaptovaná: sunLight/player/game → parametre; rozlíšenie sa číta zo sun.shadow.mapSize.
//
// VÝKON (B30): snímka tieňov je najdrahší priechod scény — celé mesto + všetky
// stromy sa kreslia druhý raz do hĺbkovej mapy. Preto sa už nekreslí KAŽDÝ snímok:
//  1) renderer.shadowMap.autoUpdate = false (engine.js) → mapa sa obnoví len keď
//     to tento modul povie cez shadow.needsUpdate,
//  2) frustum sa posúva v CELÝCH TEXELOCH (texel snap) — inak by každý posun
//     o zlomok texelu rozkmital hrany tieňov (crawl), takže by sa nedalo preskočiť,
//  3) obnova sa preskočí, keď sa od poslednej nezmenil ani jeden texel a neubehlo
//     viac než SHADOW_MAX_DT (dynamické objekty: autá, chodci, Peter).
// Pri státí/pomalom tempe sa tým ušetrí väčšina tieňových priechodov, pri rýchlej
// jazde sa mapa obnovuje prakticky každý snímok (žiadna viditeľná strata).
import * as THREE from 'three';
import { S } from '../world/shared.js';

const SHADOW_LOCAL = { x: 1e9, z: 1e9, r: -1, min: 0, max: 0, ok: false };
const SHADOW_TALL = 45;   // najvyššie tieniace teleso nad terénom (veža kostola)
const SHADOW_SUN_LEN = Math.sqrt(
  S.SUN_OFF.x * S.SUN_OFF.x + S.SUN_OFF.y * S.SUN_OFF.y + S.SUN_OFF.z * S.SUN_OFF.z);
const SHADOW_BIAS_FLOOR = -0.0002;   // zdvojnásobená bezpečnostná rezerva
// Krok posunu frustumu: aspoň 4 texely (pri 4K/220 m ≈ 43 cm), aby sa obnova
// naozaj dala preskočiť. Pod texel to nemá zmysel — mapa by sa prekresľovala
// kvôli neviditeľnému posunu.
const SNAP_TEXELS = 4;
// Strop medzi dvoma obnovami: autá a chodci sa hýbu aj keď stojíme.
// 45 ms = 22 Hz — otrasenie tieňa idúceho auta je pod hranicou viditeľnosti,
// ale pri státí to je 3x menej tieňových priechodov než dnes.
const SHADOW_MAX_DT = 0.045;

let rangeScale = 1;                  // TIENE RT slider (0–1.5)
let lastKey = '';
let lastX = 1e9, lastZ = 1e9, lastAt = -1;
export let shadowUpdates = 0;        // diagnostika: koľkokrát sa mapa obnovila
export let shadowSkips = 0;          // diagnostika: koľkokrát sa preskočila

// Báza tieňovej kamery. Smer slnka je konštantný, takže aj táto báza je
// konštantná — presne to potrebujeme na snap v texeloch.
const LZ = new THREE.Vector3(S.SUN_OFF.x, S.SUN_OFF.y, S.SUN_OFF.z).normalize();
const LX = new THREE.Vector3(0, 1, 0).cross(LZ).normalize();
const LY = new THREE.Vector3().crossVectors(LZ, LX).normalize();

export function setShadowRangeScale(v) {
  rangeScale = Math.max(0.2, Math.min(2, Number(v) || 1));
  lastKey = ''; // vynúti prepočet frustumu
}

function shadowLocalRange(x, z, r) {
  // Lokálny prevýškový rozsah z výškovej mriežky (cache 20 m, inak scan).
  const L = SHADOW_LOCAL;
  if (L.ok && (x - L.x) * (x - L.x) + (z - L.z) * (z - L.z) < 400 && L.r === r) return;
  L.x = x; L.z = z; L.r = r; L.ok = true;
  let lo = 1e18, hi = -1e18;
  if (S.meshGrid) {
    const x0 = S.GB.x0, z0 = S.GB.z0;
    const cw = (S.GB.x1 - x0) / S.TER_SEG, cd = (S.GB.z1 - z0) / S.TER_SEG;
    const G = S.TER_SEG + 1;
    let ix0 = Math.floor((x - r - x0) / cw), ix1 = Math.ceil((x + r - x0) / cw);
    let iz0 = Math.floor((z - r - z0) / cd), iz1 = Math.ceil((z + r - z0) / cd);
    if (ix0 < 0) ix0 = 0; if (iz0 < 0) iz0 = 0;
    if (ix1 > S.TER_SEG) ix1 = S.TER_SEG; if (iz1 > S.TER_SEG) iz1 = S.TER_SEG;
    for (let iz = iz0; iz <= iz1; iz++) {
      const row = iz * G;
      for (let ix = ix0; ix <= ix1; ix++) {
        const v = S.meshGrid[row + ix];
        if (v < lo) lo = v; if (v > hi) hi = v;
      }
    }
  }
  if (lo > hi) { lo = S.terrMinY; hi = S.terrMaxY; } // fallback pred buildGround
  L.min = lo; L.max = hi;
}

// Polohuje slnko + uťahuje orto frustum na minimum (vracia diagnostiku,
// alebo null keď sa od posledného volania nič nezmenilo).
export function updateSunShadow(sun, x, y, z, viewDist, tierR, nowSec) {
  if (!sun || !sun.shadow) return null;
  const sh = sun.shadow;
  let r = Math.min(viewDist, tierR) * rangeScale;
  if (!Number.isFinite(r) || r < 40) r = 40;
  shadowLocalRange(x, z, r);
  // Opsažná guľa: vodorovne r, zvisle (lokálny prevýšok/2 + veža).
  const hHalf = (SHADOW_LOCAL.max - SHADOW_LOCAL.min) * 0.5 + SHADOW_TALL;
  if (!Number.isFinite(hHalf)) return null; // deravá výšková mriežka — kameru neotráviť
  const R = Math.sqrt(r * r + hHalf * hHalf);
  const near = Math.max(0.5, SHADOW_SUN_LEN - R);
  const far = SHADOW_SUN_LEN + R;
  if (!Number.isFinite(near) || !Number.isFinite(far) || far <= near) return null;
  const res = sh.mapSize.width || 2048;
  const key = r.toFixed(1) + '|' + near.toFixed(1) + '|' + far.toFixed(1) + '|' + res;
  const texel = (2 * r) / Math.max(1, res);
  // --- TEXEL SNAP: stred frustumu v báze tieňovej kamery ---
  // Smer pohľadu (LZ) nechávame presný, len priečne osi LX/LY zaokrúhlime na
  // násobok texelu → mapa sa posúva po celých texeloch a hrany tieňov nekmitujú.
  const step = texel * SNAP_TEXELS;
  const a0 = x * LX.x + y * LX.y + z * LX.z;
  const b0 = x * LY.x + y * LY.y + z * LY.z;
  const c0 = x * LZ.x + y * LZ.y + z * LZ.z;
  const a = Math.round(a0 / step) * step;
  const b = Math.round(b0 / step) * step;
  const sx = LX.x * a + LY.x * b + LZ.x * c0;
  const sy = LX.y * a + LY.y * b + LZ.y * c0;
  const sz = LX.z * a + LY.z * b + LZ.z * c0;
  const now = Number.isFinite(nowSec) ? nowSec : 0;
  const due = (now - lastAt) >= SHADOW_MAX_DT;
  const sameCell = (sx === lastX && sz === lastZ);
  if (key === lastKey && sameCell && !due) {
    shadowSkips++;
    return null; // mapa z minulého snímku sedí presne na toto miesto
  }
  lastKey = key;
  lastX = sx; lastZ = sz; lastAt = now;
  shadowUpdates++;
  sun.position.set(sx + S.SUN_OFF.x, sy + S.SUN_OFF.y, sz + S.SUN_OFF.z);
  sun.target.position.set(sx, sy, sz);
  sun.target.updateMatrixWorld();
  const c = sh.camera;
  c.left = -r; c.right = r; c.top = r; c.bottom = -r;
  c.near = near; c.far = far;
  c.updateProjectionMatrix();
  // Bias z texelu (verbatim vzorec): normalBias šikmový ≤0.12 m + depth rezerva.
  const cotA = Math.hypot(S.SUN_OFF.x, S.SUN_OFF.z) / S.SUN_OFF.y;
  const need = texel * cotA * 0.5 * 1.5;
  const nb = Math.max(0.03, Math.min(0.12, texel * 0.8));
  const fromN = nb * (S.SUN_OFF.y / SHADOW_SUN_LEN);
  sh.normalBias = nb;
  sh.bias = Math.min(SHADOW_BIAS_FLOOR, -Math.max(0, need - fromN) / Math.max(1, far - near));
  sh.needsUpdate = true;
  return { texel, depth: far - near };
}
