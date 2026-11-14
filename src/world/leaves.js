// src/world/leaves.js — PADAJÚCE LISTY zo stromov.
//
// Listy sa rodia v korune blízkeho listnatého stromu, padajú vo vetre
// (švihnutie + vietor), landingajú na zem, chvíľu ležia a potom sa znova
// rozpadnú do novej koruny. Zdroj stromov je S.VEG_TREES (src/world/nature.js
// — presne tie isté inštancie, ktoré vidí hráč, takže list padá z CESTY
// stromu, nie z náhodného bodu).
//
// Výkon: N inštancií (240 / 110 na slabom stroji) v jednom InstancedMesh,
// matice sa prepisujú každý snímok. Náklady sú úmerné počtu listov, nie
// veľkosti mapy — ďaleké stromy sa vôbec nehľadajú.
import * as THREE from 'three';
import { S } from './shared.js';
import { getTerrainHeight } from './height.js';

// ---------- PARAMETRE ----------
const NEAR_R = 58;          // polomer hľadania stromov okolo kamery (m)
const RESCAN = 0.45;        // ako často prehľadať stromy (s)
const LIFE = 13;            // životnosť listu vo vzduchu (s)
const GROUND_LIFE = 8;      // ako dlho leží na zemi (s)
const FADE = 1.0;           // zhasnutie pred recykláciou (s)
const FALL = 0.74;          // rýchlosť pádu (m/s)
const FLUTTER = 0.62;       // amplitúda kolísania listu vo vetre (m/s)
const SPREAD = 2.2;         // polomer koruny (v násobkoch mierky stromu)

// Farby opadnutky — jeseň, ale aj zelenkasté prehľadné listy.
const COLORS = [0xd7b23c, 0xc07a26, 0x9a6b2a, 0x8fae3c, 0xc9c04e, 0xb8842f];

let mesh = null;
let n = 0;
let px, py, pz, vx, vy, vz, rx, ry, rz, ax, ay, az, sp, ph, lt, gl, sc, ci;
const near = new Int32Array(2048);
let nearN = 0;
let rescanT = 0;
let cursor = 0;
let seed = 987654321;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

function rnd(){
  seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

// ---------- INICIALIZÁCIA ----------
export function initLeaves(scene){
  if(mesh) return;
  n = S.LOW_END ? 110 : 240;
  const g = new THREE.PlaneGeometry(0.16, 0.22);
  S.DYN_GEO.push(g);
  const mat = new THREE.MeshStandardMaterial({
    map: S.TEX.leafCard, alphaTest: 0.45, side: THREE.DoubleSide,
    roughness: 0.82, metalness: 0.0, envMapIntensity: 0.5,
  });
  S.MAT.leafCard = mat;

  px = new Float32Array(n); py = new Float32Array(n); pz = new Float32Array(n);
  vx = new Float32Array(n); vy = new Float32Array(n); vz = new Float32Array(n);
  rx = new Float32Array(n); ry = new Float32Array(n); rz = new Float32Array(n);
  ax = new Float32Array(n); ay = new Float32Array(n); az = new Float32Array(n);
  sp = new Float32Array(n); ph = new Float32Array(n); lt = new Float32Array(n);
  gl = new Float32Array(n); sc = new Float32Array(n); ci = new Int32Array(n);

  mesh = new THREE.InstancedMesh(g, mat, n);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.castShadow = false;        // drobné listy: tieň by stál za svetlo
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;     // pool sa presúva po celej mape
  // Farba listu je instanceColor: textúra je biela, takže žltá, oranžová aj
  // hnedá list má jednu kartičku. Inštancie sa inicializujú na bielu.
  for(let i=0;i<n;i++){
    lt[i] = 0; sc[i] = 0;
    _c.setHex(0xffffff);
    mesh.setColorAt(i, _c);
    hide(i);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if(mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  scene.add(mesh);
  console.log('listy: ' + n + ' inštancií');
}

// ---------- HĽADANIE STROMOV ----------
function rescanTrees(cx, cz){
  nearN = 0;
  const T = S.VEG_TREES;
  const r2 = NEAR_R * NEAR_R;
  for(let i=0;i<T.length;i++){
    const t = T[i];
    const dx = t.x - cx, dz = t.z - cz;
    if(dx*dx + dz*dz > r2) continue;
    if(nearN < near.length) near[nearN++] = i;
  }
  cursor = 0;
}

// ---------- ŽIVOT LISTU ----------
function hide(i){
  _m.makeScale(0, 0, 0);
  mesh.setMatrixAt(i, _m);
}

function spawn(i){
  if(nearN === 0){ lt[i] = 0; sc[i] = 0; hide(i); return; }
  const k = near[(cursor + i) % nearN];
  cursor = (cursor + 7) % Math.max(1, nearN);
  const t = S.VEG_TREES[k];
  const rr = SPREAD * t.s;
  const a = rnd() * 6.2832;
  const r = Math.sqrt(rnd()) * rr;
  px[i] = t.x + Math.cos(a) * r;
  pz[i] = t.z + Math.sin(a) * r;
  // List sa rodí na SPODNOM OKRAJI koruny (koruna je guľa s lumpy cievou,
  // jej spodok je asi 1,3 lokálnej jednotky nad pätou stromu) — v strede
  // koruny by bol list schovaný vo foliage a nebolo by ho vidieť.
  py[i] = t.y + 1.5 * t.s * t.sy + (rnd() - 0.5) * 0.7;
  // Malý bočný impulz: list vypadne z koruny smerom von, nie do jej stredu.
  vx[i] = Math.cos(a) * 0.25; vy[i] = -0.12; vz[i] = Math.sin(a) * 0.25;
  // Tumble: vlastná osa otáčania, rýchlosť a fáza švihnutia.
  const th = rnd() * 6.2832, ph2 = rnd() * 3.1416;
  ax[i] = Math.sin(ph2); ay[i] = 0; az[i] = Math.cos(ph2);
  sp[i] = 1.1 + rnd() * 2.6;
  ph[i] = th;
  rx[i] = rnd() * 6.2832; ry[i] = rnd() * 6.2832; rz[i] = rnd() * 6.2832;
  sc[i] = 0.75 + rnd() * 0.55;
  lt[i] = LIFE;
  gl[i] = 0;
  const c = COLORS[(rnd() * COLORS.length) | 0];
  ci[i] = c;
  _c.setHex(c);
  mesh.setColorAt(i, _c);
  if(mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

function land(i){
  const gy = getTerrainHeight(px[i], pz[i]);
  py[i] = gy + 0.03;
  gl[i] = 1;
  lt[i] = GROUND_LIFE;
  // List leží na zemi: takmer vodorovne, pootočený podľa vetra.
  rx[i] = -Math.PI / 2 + (rnd() - 0.5) * 0.45;
  ry[i] = rnd() * 6.2832;
  rz[i] = (rnd() - 0.5) * 0.5;
}

// ---------- POHYB ----------
export function updateLeaves(dt, cx, cz){
  if(!mesh) return;
  rescanT -= dt;
  if(rescanT <= 0){ rescanT = RESCAN; rescanTrees(cx, cz); }
  const t = S.UNI.time.value;
  // Vietor: pomalý náraz + základný prefuk. Zdieľaný pre všetky listy.
  const gust = 0.55 + 0.45 * Math.sin(t * 0.29);
  const wx = 0.85 * Math.cos(t * 0.21) * gust;
  const wz = 0.70 * Math.sin(t * 0.17) * gust;

  for(let i=0;i<n;i++){
    if(lt[i] <= 0){ spawn(i); if(lt[i] <= 0) continue; }
    if(gl[i] === 0){
      const p = ph[i];
      // Švihnutie: list nepadí rovno, kýve sa a krúži.
      vx[i] = wx * 0.45 + 0.42 * Math.sin(t * 2.3 + p);
      vz[i] = wz * 0.45 + 0.42 * Math.cos(t * 1.9 + p * 1.3);
      vy[i] = -FALL + FLUTTER * 0.5 * Math.sin(t * 3.1 + p * 2.3);
      px[i] += vx[i] * dt;
      py[i] += vy[i] * dt;
      pz[i] += vz[i] * dt;
      // Preklápanie okolo vlastnej osy.
      const s = sp[i] * dt;
      rx[i] += ax[i] * s; ry[i] += ay[i] * s; rz[i] += az[i] * s;
      const gy = getTerrainHeight(px[i], pz[i]);
      if(py[i] <= gy + 0.05){ land(i); }
      lt[i] -= dt;
      if(lt[i] <= 0) lt[i] = 0.0001;
    } else {
      // Na zemi: list sa pomaly posúva s vetrom a zhasne, potom sa recykluje.
      px[i] += wx * 0.08 * dt;
      pz[i] += wz * 0.08 * dt;
      lt[i] -= dt;
    }
    // Mierka: posledná chvíľa života sa list zmenšuje (odplavuje / rozpadá).
    const fade = gl[i] === 1 ? Math.min(1, lt[i] / FADE) : 1;
    const s = sc[i] * fade;
    _e.set(rx[i], ry[i], rz[i]);
    _q.setFromEuler(_e);
    _p.set(px[i], py[i], pz[i]);
    _s.set(s, s, s);
    _m.compose(_p, _q, _s);
    mesh.setMatrixAt(i, _m);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

// Nulovanie pri reštarte hry (listy sa znova rozpadnú do korún).
export function resetLeaves(){
  if(!mesh) return;
  for(let i=0;i<n;i++){ lt[i] = 0; sc[i] = 0; hide(i); }
  mesh.instanceMatrix.needsUpdate = true;
  rescanT = 0;
}
