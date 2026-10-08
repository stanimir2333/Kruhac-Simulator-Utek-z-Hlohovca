// src/world/labels.js — 3D textové štítky (canvas sprites, statické, distance-culled).
// Verbatim port z monolitu (git HEAD:index.html, js-línie 5953–5962).
// Vlastní: LBLN/LBLF. Importuje: makeLabel z textures.js, S.scene zo shared.js.
import { S } from './shared.js';
import { makeLabel } from './textures.js';

export const LBLN = [];     // {sp,x,z} blízke štítky (culling 400 m)
export const LBLF = [];     // {sp,x,z} ďaleké štítky (vždy vidieť)

// Vzdialenosť, za ktorou sa blízky štítok vypne. Ďaleké (POI, ulice, Peter)
// majú culling vypnutý — musia byť čitateľné cez hmlu.
const NEAR_CULL2 = 400 * 400;
let cullAt = 1e9;   // ďalší čas, kedy má zmysel prepočítať (sekundy od štartu)
let cullX = 1e18, cullZ = 1e18;

/**
 * 2 Hz distance culling blízkych štítkov (popis v S.SHARED kým boli LBLN/LBLF
 * zapísané a nikdy neprečítané — teda sa nekreslili vôbec). Kým sa hráč
 * neposunie o 25 m, culling sa neopakuje.
 */
export function cullLabels(x, z, now) {
  if (now < cullAt) return;
  const dx = x - cullX, dz = z - cullZ;
  if (dx * dx + dz * dz < 625) return;   // <25 m od poslednej kontroly
  cullAt = now + 0.5;
  cullX = x; cullZ = z;
  for (let i = 0; i < LBLN.length; i++) {
    const l = LBLN[i];
    const ex = l.x - x, ez = l.z - z;
    l.sp.visible = (ex * ex + ez * ez) < NEAR_CULL2;
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
