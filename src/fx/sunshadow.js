// src/fx/sunshadow.js — DYNAMICKÉ tiene: tieňový frustum cestuje s hráčom.
// Verbatim logika z monolitu (shadowLocalRange + shadowFrustum + applyShadowBias),
// adaptovaná: sunLight/player/game → parametre; rozlíšenie sa číta zo sun.shadow.mapSize.
import { S } from '../world/shared.js';

const SHADOW_LOCAL = { x: 1e9, z: 1e9, r: -1, min: 0, max: 0, ok: false };
const SHADOW_TALL = 45;   // najvyššie tieniace teleso nad terénom (veža kostola)
const SHADOW_SUN_LEN = Math.sqrt(
  S.SUN_OFF.x * S.SUN_OFF.x + S.SUN_OFF.y * S.SUN_OFF.y + S.SUN_OFF.z * S.SUN_OFF.z);
const SHADOW_BIAS_FLOOR = -0.0002;   // zdvojnásobená bezpečnostná rezerva
let rangeScale = 1;                  // TIENE RT slider (0–1.5)
let lastKey = '';

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
export function updateSunShadow(sun, x, y, z, viewDist, tierR) {
  if (!sun || !sun.shadow) return null;
  sun.position.set(x + S.SUN_OFF.x, y + S.SUN_OFF.y, z + S.SUN_OFF.z);
  sun.target.position.set(x, y, z);
  sun.target.updateMatrixWorld();
  let r = Math.min(viewDist, tierR) * rangeScale;
  if (r < 40) r = 40;
  shadowLocalRange(x, z, r);
  // Opsažná guľa: vodorovne r, zvisle (lokálny prevýšok/2 + veža).
  const hHalf = (SHADOW_LOCAL.max - SHADOW_LOCAL.min) * 0.5 + SHADOW_TALL;
  const R = Math.sqrt(r * r + hHalf * hHalf);
  const near = Math.max(0.5, SHADOW_SUN_LEN - R);
  const far = SHADOW_SUN_LEN + R;
  const res = sun.shadow.mapSize.width || 2048;
  const key = r.toFixed(1) + '|' + near.toFixed(1) + '|' + far.toFixed(1) + '|' + res;
  if (key === lastKey) return null;
  lastKey = key;
  const sh = sun.shadow, c = sh.camera;
  c.left = -r; c.right = r; c.top = r; c.bottom = -r;
  c.near = near; c.far = far;
  c.updateProjectionMatrix();
  // Bias z texelu (verbatim vzorec): normalBias šikmový ≤0.12 m + depth rezerva.
  const texel = (2 * r) / Math.max(1, res);
  const cotA = Math.hypot(S.SUN_OFF.x, S.SUN_OFF.z) / S.SUN_OFF.y;
  const need = texel * cotA * 0.5 * 1.5;
  const nb = Math.max(0.03, Math.min(0.12, texel * 0.8));
  const fromN = nb * (S.SUN_OFF.y / SHADOW_SUN_LEN);
  sh.normalBias = nb;
  sh.bias = Math.min(SHADOW_BIAS_FLOOR, -Math.max(0, need - fromN) / Math.max(1, far - near));
  sh.needsUpdate = true;
  return { texel, depth: far - near };
}
