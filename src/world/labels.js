// src/world/labels.js — 3D textové štítky (canvas sprites, statické, distance-culled).
// Verbatim port z monolitu (git HEAD:index.html, js-línie 5953–5962).
// Vlastní: LBLN/LBLF. Importuje: makeLabel z textures.js, S.scene zo shared.js.
import { S } from './shared.js';
import { makeLabel } from './textures.js';

export const LBLN = [];     // {sp,x,z} blízke štítky (culling 400 m)
export const LBLF = [];     // {sp,x,z} ďaleké štítky (vždy vidieť)

export function regLabel(text, scale, x, y, z, far){
  const lbl = makeLabel(text, scale);
  lbl.position.set(x, y, z);
  S.scene.add(lbl);
  lbl.updateMatrix(); lbl.matrixAutoUpdate = false; // štítok je statický
  (far ? LBLF : LBLN).push({ sp:lbl, x:x, z:z });
  return lbl;
}
