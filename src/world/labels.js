// src/world/labels.js — 3D textové štítky (canvas sprites, statické, distance-culled).
// Verbatim port z monolitu (git HEAD:index.html, js-línie 5953–5962).
// Vlastní: LBLN/LBLF. Importuje: makeLabel z textures.js, S.scene zo shared.js.
import { S } from './shared.js';
import { makeLabel } from './textures.js';
import { PERF } from '../core/config.js';

export const LBLN = [];     // {sp,x,z} blízke štítky (culling 400 m)
export const LBLF = [];     // {sp,x,z} ďaleké štítky (vždy vidieť)

// Vzdialenosť, za ktorou sa blízky štítok vypne. Ďaleké (POI, ulice, Peter)
// majú culling vypnutý — musia byť čitateľné cez hmlu.
const NEAR_CULL_DISTANCE_M = 400;
const NEAR_CULL_DISTANCE2 = NEAR_CULL_DISTANCE_M * NEAR_CULL_DISTANCE_M;
const CULL_RECHECK_DISTANCE_M = 25;
const CULL_RECHECK_DISTANCE2 = CULL_RECHECK_DISTANCE_M * CULL_RECHECK_DISTANCE_M;
const LABEL_CULL_INTERVAL = 1 / PERF.cullHz;
let cullAt = 0;     // prvý culling prebehne hneď pri prvom ticku
let cullX = Infinity, cullZ = Infinity;

/**
 * 2 Hz distance culling blízkych štítkov (popis v S.SHARED kým boli LBLN/LBLF
 * zapísané a nikdy neprečítané — teda sa nekreslili vôbec). Kým sa hráč
 * neposunie o 25 m, culling sa neopakuje.
 */
export function cullLabels(x, z, now) {
  if (now < cullAt) return;
  const dx = x - cullX, dz = z - cullZ;
  if (dx * dx + dz * dz < CULL_RECHECK_DISTANCE2) return;
  cullAt = now + LABEL_CULL_INTERVAL;
  cullX = x; cullZ = z;
  for (let i = 0; i < LBLN.length; i++) {
    const l = LBLN[i];
    const ex = l.x - x, ez = l.z - z;
    l.sp.visible = (ex * ex + ez * ez) < NEAR_CULL_DISTANCE2;
  }
}

export function regLabel(text, scale, x, y, z, far){
  const lbl = makeLabel(text, scale);
  lbl.position.set(x, y, z);
  S.scene.add(lbl);
  lbl.updateMatrix(); lbl.matrixAutoUpdate = false; // štítok je statický
  (far ? LBLF : LBLN).push({ sp:lbl, x:x, z:z });
  return lbl;
}
