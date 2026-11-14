// src/world/props.js — MOBILIÁR A DROBNOSTI: viac poly, viac detailu v meste.
//
// Kým doteraz mala scéna len terén, cesty, budovy a stromy, tu chýbalo všetko
// medzi ľuďmi a domami: lavičky, koše, zábradlové stĺpy, hydranty, schránky,
// značky, zastávky, traťové stĺpy s drôtmi, živé ploty, kvetináče, kanály,
// značniky a malé kaplnky pri ceste.
//
// ARCHITEKTÚRA: každý prop je zložený z jednoduchých telies (box, valec,
// kužeľ, guľa), ktoré sa zapisujú do chunkových košov podľa triedy POVRCHU
// (kov / omietka / drevo / listie / sklo / žiarivka). Farba je vo vertex
// colors, materiál určuje len ako sa povrch lesní (kov lesklý, omietka matná).
// Chunky (500 m) sa vypínajú podľa vzdialenosti cez S.CHUNKS (src/world/sky.js),
// takže v diaľke sa nekreslia vôbec.
import * as THREE from 'three';
import { S } from './shared.js';
import { getTerrainHeight } from './height.js';
import { roadDist2, routePose } from './roads.js';
import { vegInBld, vegWet } from './nature.js';

const CHUNK = 500;            // m — veľkosť chunku s propmi
const ROAD_CLEAR = 4.2;       // m od osi inej cesty: na asfalt sa nič nesmie
const ROAD_CLEAR2 = ROAD_CLEAR * ROAD_CLEAR;
const SIDEWALK_Y = 0.16;      // chodník leží o 16 cm nad terénom

// ---------- PALETA ----------
const C_METAL_D = 0x3c4147;   // tmavá oceľ (stĺpy, rámce)
const C_METAL_L = 0x8b9198;   // svetlá oceľ (koše, zábradlá)
const C_WOOD = 0x8a5f34;      // drevo (lavičky, ploty)
const C_WOOD_P = 0x6b533a;    // drevo stĺpov
const C_CONCRETE = 0xa8a49b;  // betón
const C_WHITE = 0xe9e7dd;     // biela (značky, značniky)
const C_RED = 0xb02020;       // červená (značniky, hydranty)
const C_BLUE = 0x2f5fa8;      // modrá (štítky značiek)
const C_GREEN = 0x3f6b30;     // živý plot
const C_FLOWER = 0xc46a8a;    // kvety
const C_LEAF2 = 0x4a7a34;     // listie v kvetináči
const C_LAMP = 0xfff0c0;      // žiarivka
const C_GLASS = 0x9fb4c0;     // sklo zastávky

// ---------- JEDNOTKOVÉ TELESÁ ----------
function primOf(g){
  return { p:g.attributes.position.array, n:g.attributes.normal.array,
           u:g.attributes.uv.array, i:g.index.array, v:g.attributes.position.count };
}
const P_BOX = primOf(new THREE.BoxGeometry(1, 1, 1));
const P_CYL6 = primOf(new THREE.CylinderGeometry(0.5, 0.5, 1, 6));
const P_CYL8 = primOf(new THREE.CylinderGeometry(0.5, 0.5, 1, 8));
const P_CONE = primOf(new THREE.ConeGeometry(0.5, 1, 8));
const P_SPH = primOf(new THREE.SphereGeometry(0.5, 6, 4));

// ---------- KOŠE A CHUNKY ----------
const BUCKETS = ['metal', 'matte', 'wood', 'leaf', 'glow', 'glass'];
const chunks = new Map();
let matOf = null;

function chunkFor(x, z){
  const key = Math.floor((x - S.GB.x0)/CHUNK)*1000 + Math.floor((z - S.GB.z0)/CHUNK);
  let c = chunks.get(key);
  if(!c){
    c = { x:0, z:0, r:0, minx:1e9, maxx:-1e9, minz:1e9, maxz:-1e9, b:{} };
    for(let i=0;i<BUCKETS.length;i++) c.b[BUCKETS[i]] = { p:[], n:[], u:[], c:[], i:[], v:0 };
    chunks.set(key, c);
  }
  if(x < c.minx) c.minx = x; if(x > c.maxx) c.maxx = x;
  if(z < c.minz) c.minz = z; if(z > c.maxz) c.maxz = z;
  return c;
}

// ---------- ZÁPIS TELESA DO KOŠA ----------
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _nm = new THREE.Matrix3();

function emit(dst, prim, x, y, z, sx, sy, sz, rx, ry, rz, col, uvs){
  _e.set(rx||0, ry||0, rz||0);
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(sx, sy, sz);
  _m.compose(_p, _q, _s);
  _nm.getNormalMatrix(_m);
  const base = dst.v;
  const p = prim.p, n = prim.n, u = prim.u;
  const me = _m.elements, ne = _nm.elements;
  const cr = ((col>>16)&255)/255, cg = ((col>>8)&255)/255, cb = (col&255)/255;
  const su = uvs || 1, sv = uvs || 1;
  for(let i=0;i<prim.v;i++){
    const lx = p[i*3], ly = p[i*3+1], lz = p[i*3+2];
    dst.p.push(me[0]*lx + me[4]*ly + me[8]*lz + me[12],
               me[1]*lx + me[5]*ly + me[9]*lz + me[13],
               me[2]*lx + me[6]*ly + me[10]*lz + me[14]);
    const nx = n[i*3], ny = n[i*3+1], nz = n[i*3+2];
    dst.n.push(ne[0]*nx + ne[3]*ny + ne[6]*nz,
               ne[1]*nx + ne[4]*ny + ne[7]*nz,
               ne[2]*nx + ne[5]*ny + ne[8]*nz);
    dst.u.push(u[i*2]*su, u[i*2+1]*sv);
    dst.c.push(cr, cg, cb);
  }
  for(let k=0;k<prim.i.length;k++) dst.i.push(base + prim.i[k]);
  dst.v += prim.v;
}

// Jednotlivé zápisy (svetové súradnice, rotácia okolo Y v radiánoch).
function box(dst, x, y, z, sx, sy, sz, ry, col, uvs){
  emit(dst, P_BOX, x, y, z, sx, sy, sz, 0, ry||0, 0, col, uvs);
}
function cyl(dst, x, y, z, r, h, col, seg, rx, ry){
  emit(dst, seg === 6 ? P_CYL6 : P_CYL8, x, y, z, r*2, h, r*2, rx||0, ry||0, 0, col, 1);
}
function cone(dst, x, y, z, r, h, col, rx, ry){
  emit(dst, P_CONE, x, y, z, r*2, h, r*2, rx||0, ry||0, 0, col, 1);
}
function sph(dst, x, y, z, r, col){
  emit(dst, P_SPH, x, y, z, r*2, r*2, r*2, 0, 0, 0, col, 1);
}
// Drôt (valec) medzi dvoma bodmi — používa sa vlastná orientácia.
function wire(dst, ax, ay, az, bx, by, bz, r, col){
  const dx = bx-ax, dy = by-ay, dz = bz-az;
  const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
  if(len < 0.5) return;
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx/len, dy/len, dz/len));
  const p = new THREE.Vector3((ax+bx)/2, (ay+by)/2, (az+bz)/2);
  const s = new THREE.Vector3(r*2, len, r*2);
  const m = new THREE.Matrix4().compose(p, q, s);
  emitMat(dst, P_CYL6, m, col);
}
function emitMat(dst, prim, m, col){
  const base = dst.v;
  const p = prim.p, n = prim.n, u = prim.u;
  const me = m.elements;
  const nm = new THREE.Matrix3().getNormalMatrix(m);
  const ne = nm.elements;
  const cr = ((col>>16)&255)/255, cg = ((col>>8)&255)/255, cb = (col&255)/255;
  for(let i=0;i<prim.v;i++){
    const lx = p[i*3], ly = p[i*3+1], lz = p[i*3+2];
    dst.p.push(me[0]*lx + me[4]*ly + me[8]*lz + me[12],
               me[1]*lx + me[5]*ly + me[9]*lz + me[13],
               me[2]*lx + me[6]*ly + me[10]*lz + me[14]);
    const nx = n[i*3], ny = n[i*3+1], nz = n[i*3+2];
    dst.n.push(ne[0]*nx + ne[3]*ny + ne[6]*nz,
               ne[1]*nx + ne[4]*ny + ne[7]*nz,
               ne[2]*nx + ne[5]*ny + ne[8]*nz);
    dst.u.push(u[i*2], u[i*2+1]);
    dst.c.push(cr, cg, cb);
  }
  for(let k=0;k<prim.i.length;k++) dst.i.push(base + prim.i[k]);
  dst.v += prim.v;
}

// Lokálny posun v rámci propu (rotovaný okolo Y).
function lx2(x, z, ox, oz, rot){
  const c = Math.cos(rot), s = Math.sin(rot);
  return [x + ox*c + oz*s, z - ox*s + oz*c];
}

// ---------- KONTROLA MIESTA ----------
const rounds = () => S.osm.rounds || [];
function okSpot(x, z){
  if(vegInBld(x, z)) return false;        // vnútro budovy
  if(vegWet(x, z, 3)) return false;       // breh/koryto rieky
  if(roadDist2(x, z) < ROAD_CLEAR2) return false;  // leží na asfalte inej cesty
  const y = getTerrainHeight(x, z);
  if(y < 0.3) return false;               // koryto
  const R = rounds();
  for(let i=0;i<R.length;i++){
    const dx = x - R[i][0], dz = z - R[i][1], lim = R[i][2] + 3;
    if(dx*dx + dz*dz < lim*lim) return false;   // kruháč
  }
  return true;
}
function okRoadSpot(x, z){
  if(vegInBld(x, z)) return false;
  if(vegWet(x, z, 3)) return false;
  return getTerrainHeight(x, z) > 0.2;
}

// ---------- PRECHÁDZANIE PO CESTE ----------
// Prejde cestu po krokoch a zavolá cb(x, z, ux, uz, nx, nz, k).
// nx/nz je kolmá na smer jazdy (vľavo), k je poradové číslo vzorky.
function walkRoad(R, spacing, cb){
  let rem = spacing * 0.5, k = 0;
  for(let i=1;i<R.n;i++){
    const ax = R.pts[i*2-2], az = R.pts[i*2-1];
    const bx = R.pts[i*2], bz = R.pts[i*2+1];
    const ex = bx-ax, ez = bz-az, L = Math.sqrt(ex*ex + ez*ez);
    if(L < 0.25) continue;
    const ux = ex/L, uz = ez/L, nx = -uz, nz = ux;
    let s = rem;
    while(s < L){
      const t = s/L;
      cb(ax + ex*t, az + ez*t, nx, nz, k++);
      s += spacing;
    }
    rem = s - L;
  }
}

// ---------- PROPY ----------
// Všetky propy stojia na chodníku (terén + 16 cm) a smerujú k ceste.
function placeProp(x, z, rot){
  const ch = chunkFor(x, z);
  const y = getTerrainHeight(x, z) + SIDEWALK_Y;
  return { ch:ch, y:y, rot:rot };
}

// Pouličná lampa: základ, stĺp, rameno nad vozovkou, hlava so žiarivkou.
function addLamp(x, z, rot){
  const p = placeProp(x, z, rot);
  const M = p.ch.b.metal, G = p.ch.b.glow;
  cyl(M, x, p.y + 0.28, z, 0.24, 0.56, C_METAL_D, 8);
  cyl(M, x, p.y + 3.05, z, 0.10, 6.10, C_METAL_D, 6);
  const a = lx2(x, z, 0, -0.60, rot);
  box(M, a[0], p.y + 6.02, a[1], 0.10, 0.10, 1.40, rot, C_METAL_D);
  const b = lx2(x, z, 0, -1.55, rot);
  box(M, b[0], p.y + 5.92, b[1], 0.32, 0.16, 0.80, rot, C_METAL_D);
  box(G, b[0], p.y + 5.82, b[1], 0.26, 0.05, 0.72, rot, C_LAMP);
}

// Lavička: drevené sedlo + operadlo, kovové nohy a podpera.
function addBench(x, z, rot){
  const p = placeProp(x, z, rot);
  const W = p.ch.b.wood, M = p.ch.b.metal;
  box(W, x, p.y + 0.45, z, 1.70, 0.07, 0.46, rot, C_WOOD, 1.6);
  const bk = lx2(x, z, 0, -0.21, rot);
  box(W, bk[0], p.y + 0.67, bk[1], 1.70, 0.42, 0.07, rot, C_WOOD, 1.6);
  const ar1 = lx2(x, z, 0.80, 0, rot), ar2 = lx2(x, z, -0.80, 0, rot);
  box(W, ar1[0], p.y + 0.62, ar1[1], 0.08, 0.06, 0.46, rot, C_WOOD);
  box(W, ar2[0], p.y + 0.62, ar2[1], 0.08, 0.06, 0.46, rot, C_WOOD);
  const l1 = lx2(x, z, 0.70, 0.17, rot), l2 = lx2(x, z, -0.70, 0.17, rot);
  const l3 = lx2(x, z, 0.70, -0.17, rot), l4 = lx2(x, z, -0.70, -0.17, rot);
  box(M, l1[0], p.y + 0.22, l1[1], 0.07, 0.44, 0.07, rot, C_METAL_D);
  box(M, l2[0], p.y + 0.22, l2[1], 0.07, 0.44, 0.07, rot, C_METAL_D);
  box(M, l3[0], p.y + 0.22, l3[1], 0.07, 0.44, 0.07, rot, C_METAL_D);
  box(M, l4[0], p.y + 0.22, l4[1], 0.07, 0.44, 0.07, rot, C_METAL_D);
}

// Kôš na odpadky: teleso + viko + podstavec.
function addBin(x, z, rot){
  const p = placeProp(x, z, rot);
  const M = p.ch.b.metal;
  cyl(M, x, p.y + 0.44, z, 0.28, 0.80, C_METAL_L, 8);
  cyl(M, x, p.y + 0.86, z, 0.31, 0.06, C_METAL_D, 8);
  cyl(M, x, p.y + 0.05, z, 0.22, 0.10, C_METAL_D, 8);
}

// Zábradlový stĺp: rúra + kužeľová viečko + biely pás.
function addBollard(x, z){
  const p = placeProp(x, z, 0);
  const M = p.ch.b.metal, T = p.ch.b.matte;
  cyl(M, x, p.y + 0.44, z, 0.085, 0.88, C_METAL_D, 6);
  cone(M, x, p.y + 0.92, z, 0.09, 0.10, C_METAL_D);
  cyl(T, x, p.y + 0.70, z, 0.088, 0.08, C_WHITE, 6);
}

// Hydrant: teleso, kužeľová strecha a dva bočné vývody.
function addHydrant(x, z, rot){
  const p = placeProp(x, z, rot);
  const M = p.ch.b.metal;
  cyl(M, x, p.y + 0.32, z, 0.12, 0.64, C_RED, 8);
  cone(M, x, p.y + 0.70, z, 0.13, 0.14, C_RED);
  // Vývody smerujú do strán (dlhá osa boxu je lokálne X → pootočí sa s propom).
  const o1 = lx2(x, z, 0.14, 0, rot), o2 = lx2(x, z, -0.14, 0, rot);
  box(M, o1[0], p.y + 0.44, o1[1], 0.18, 0.11, 0.11, rot, C_RED);
  box(M, o2[0], p.y + 0.44, o2[1], 0.18, 0.11, 0.11, rot, C_RED);
}

// Poštová schránka: stĺp + box.
function addMailbox(x, z, rot){
  const p = placeProp(x, z, rot);
  const M = p.ch.b.metal;
  cyl(M, x, p.y + 0.58, z, 0.05, 1.16, C_METAL_D, 6);
  box(M, x, p.y + 1.32, z, 0.30, 0.36, 0.22, rot, C_RED);
}

// Značka: stĺp + biela tabuľa s modrým pásom.
function addSign(x, z, rot){
  const p = placeProp(x, z, rot);
  const M = p.ch.b.metal, T = p.ch.b.matte;
  cyl(M, x, p.y + 1.15, z, 0.045, 2.30, C_METAL_D, 6);
  box(T, x, p.y + 1.98, z, 0.62, 0.46, 0.03, rot, C_WHITE);
  box(T, x, p.y + 2.13, z, 0.62, 0.13, 0.04, rot, C_BLUE);
}

// Zastávka: štyri stĺpy, strecha, sklenená zadná stena, lavička.
function addShelter(x, z, rot){
  const p = placeProp(x, z, rot);
  const M = p.ch.b.metal, G = p.ch.b.glass, W = p.ch.b.wood;
  const posts = [[1.85, 0.62], [-1.85, 0.62], [1.85, -0.62], [-1.85, -0.62]];
  for(let i=0;i<posts.length;i++){
    const q = lx2(x, z, posts[i][0], posts[i][1], rot);
    box(M, q[0], p.y + 1.18, q[1], 0.08, 2.36, 0.08, rot, C_METAL_D);
  }
  box(M, x, p.y + 2.42, z, 4.05, 0.09, 1.70, rot, C_METAL_D);
  const bk = lx2(x, z, 0, -0.58, rot);
  box(G, bk[0], p.y + 1.25, bk[1], 3.90, 1.85, 0.05, rot, C_GLASS);
  const sb = lx2(x, z, 0, -0.40, rot);
  box(W, sb[0], p.y + 0.47, sb[1], 2.60, 0.07, 0.36, rot, C_WOOD, 1.6);
  const sp = lx2(x, z, 2.05, 0, rot);
  box(M, sp[0], p.y + 1.70, sp[1], 0.10, 1.20, 0.60, rot, C_METAL_D);
}

// Živý plot: hrča + zvlnený vrchol z gúľ.
function addHedge(x, z, rot){
  const p = placeProp(x, z, rot);
  const L = p.ch.b.leaf;
  box(L, x, p.y + 0.50, z, 2.00, 1.00, 0.85, rot, C_GREEN);
  const q1 = lx2(x, z, 0.62, 0, rot), q2 = lx2(x, z, -0.62, 0, rot);
  sph(L, q1[0], p.y + 1.00, q1[1], 0.40, C_GREEN);
  sph(L, q2[0], p.y + 1.02, q2[1], 0.42, C_GREEN);
  sph(L, x, p.y + 1.05, z, 0.36, C_GREEN);
}

// Kvetináč: betónová štruka + kvety.
function addPlanter(x, z, rot){
  const p = placeProp(x, z, rot);
  const T = p.ch.b.matte, L = p.ch.b.leaf;
  box(T, x, p.y + 0.22, z, 0.95, 0.44, 0.95, rot, C_CONCRETE);
  const q1 = lx2(x, z, 0.22, 0.18, rot), q2 = lx2(x, z, -0.22, -0.18, rot);
  sph(L, q1[0], p.y + 0.58, q1[1], 0.26, C_LEAF2);
  sph(L, q2[0], p.y + 0.58, q2[1], 0.26, C_LEAF2);
  sph(L, x, p.y + 0.56, z, 0.24, C_FLOWER);
}

// Kanal (kanálový poklop) uprostred vozovky.
function addManhole(x, z){
  const ch = chunkFor(x, z);
  const M = ch.b.metal;
  const y = getTerrainHeight(x, z) + 0.15;
  cyl(M, x, y + 0.015, z, 0.36, 0.05, C_METAL_D, 8);
}

// Značnik pri ceste: biely stĺp s červeným pásom.
function addDelineator(x, z){
  const p = placeProp(x, z, 0);
  const T = p.ch.b.matte;
  box(T, x, p.y + 0.52, z, 0.05, 1.04, 0.05, 0, C_WHITE);
  box(T, x, p.y + 0.80, z, 0.056, 0.16, 0.056, 0, C_RED);
}

// Drobná kaplnka pri ceste: podstavec, otvor, strecha a kríž.
function addShrine(x, z, rot){
  const p = placeProp(x, z, rot);
  const T = p.ch.b.matte;
  box(T, x, p.y + 0.42, z, 0.95, 0.84, 0.70, rot, C_CONCRETE);
  const n = lx2(x, z, 0, 0.34, rot);
  box(T, n[0], p.y + 0.52, n[1], 0.42, 0.48, 0.06, rot, 0x2a2622);
  cone(T, x, p.y + 1.00, z, 0.62, 0.32, C_CONCRETE, 0, rot);
  box(T, x, p.y + 1.30, z, 0.05, 0.28, 0.05, rot, C_METAL_D);
  box(T, x, p.y + 1.34, z, 0.18, 0.05, 0.05, rot, C_METAL_D);
}

// Traťový stĺp: drevený hriadeľ, rameno a izolátory.
// ry = natočenie ramena (dlhá osa ramena je lokálne X).
function addPowerPole(x, z, ry){
  const p = placeProp(x, z, 0);
  const W = p.ch.b.wood, T = p.ch.b.matte;
  cyl(W, x, p.y + 4.30, z, 0.13, 8.60, C_WOOD_P, 6);
  box(T, x, p.y + 8.00, z, 2.10, 0.12, 0.12, ry, C_WHITE);
  const o = [-0.85, -0.30, 0.30, 0.85];
  for(let i=0;i<o.length;i++){
    const q = lx2(x, z, o[i], 0, ry);
    cyl(T, q[0], p.y + 8.16, q[1], 0.05, 0.18, C_WHITE, 6);
  }
}

// ---------- ROZMIEŠŤOVANIE ----------
const cnt = { lamp:0, bench:0, bin:0, bollard:0, hydrant:0, mailbox:0, sign:0,
              shelter:0, hedge:0, planter:0, manhole:0, delin:0, shrine:0, pole:0 };
const CAP = { lamp:260, bench:170, bin:110, bollard:520, hydrant:40, mailbox:36,
              sign:300, shelter:14, hedge:150, planter:110, manhole:190, delin:300,
              shrine:10, pole:170 };
const SCALE = S.LOW_END ? 0.45 : 1;   // slabý stroj: menej propov
for(const k in CAP) CAP[k] = Math.max(4, Math.round(CAP[k] * SCALE));

function cap(k){ return cnt[k] < CAP[k]; }

function placeTownProps(rnd){
  for(let li=0; li<S.townRoads.length; li++){
    const R = S.townRoads[li];
    if(R.hw < 2.8) continue;            // chodník existuje od hw 2,8
    const main = R.hw >= 3.2;
    // ---- LÁMY ----
    if(main && cap('lamp')){
      walkRoad(R, 46, function(x, z, nx, nz, k){
        if(!cap('lamp')) return;
        const s = (k % 2) ? 1 : -1;
        const off = R.hw + 2.15;
        const px = x + nx*off*s, pz = z + nz*off*s;
        if(!okSpot(px, pz)) return;
        addLamp(px, pz, Math.atan2(s*nx, s*nz));
        cnt.lamp++;
      });
    }
    // ---- LAVIČKY ----
    if(cap('bench')){
      walkRoad(R, 62, function(x, z, nx, nz, k){
        if(!cap('bench')) return;
        const s = (k % 2) ? 1 : -1;
        const off = R.hw + 1.65;
        const px = x + nx*off*s, pz = z + nz*off*s;
        if(!okSpot(px, pz)) return;
        addBench(px, pz, Math.atan2(-s*nx, -s*nz));
        cnt.bench++;
      });
    }
    // ---- KOŠE ----
    if(cap('bin')){
      walkRoad(R, 105, function(x, z, nx, nz, k){
        if(!cap('bin')) return;
        const s = (k % 2) ? 1 : -1;
        const off = R.hw + 2.0;
        const px = x + nx*off*s, pz = z + nz*off*s;
        if(!okSpot(px, pz)) return;
        addBin(px, pz, Math.atan2(s*nx, s*nz));
        cnt.bin++;
      });
    }
    // ---- ZÁBRADLOVÉ STĺPY (len hlavné ulice) ----
    if(main && cap('bollard')){
      walkRoad(R, 7.5, function(x, z, nx, nz, _k){
        if(!cap('bollard')) return;
        const off = R.hw + 0.95;
        const px = x + nx*off, pz = z + nz*off;
        if(!okSpot(px, pz)) return;
        addBollard(px, pz);
        cnt.bollard++;
      });
    }
    // ---- ZNAČKY ----
    if(cap('sign')){
      walkRoad(R, 36, function(x, z, nx, nz, k){
        if(!cap('sign')) return;
        const s = (k % 2) ? 1 : -1;
        const off = R.hw + 2.3;
        const px = x + nx*off*s, pz = z + nz*off*s;
        if(!okSpot(px, pz)) return;
        addSign(px, pz, Math.atan2(s*nx, s*nz));
        cnt.sign++;
      });
    }
    // ---- HYD RANTY ----
    if(cap('hydrant')){
      walkRoad(R, 210, function(x, z, nx, nz, k){
        if(!cap('hydrant')) return;
        const s = (k % 2) ? 1 : -1;
        const off = R.hw + 2.4;
        const px = x + nx*off*s, pz = z + nz*off*s;
        if(!okSpot(px, pz)) return;
        addHydrant(px, pz, Math.atan2(s*nx, s*nz));
        cnt.hydrant++;
      });
    }
    // ---- SCHRÁNKY ----
    if(cap('mailbox')){
      walkRoad(R, 165, function(x, z, nx, nz, k){
        if(!cap('mailbox')) return;
        const s = (k % 2) ? 1 : -1;
        const off = R.hw + 2.2;
        const px = x + nx*off*s, pz = z + nz*off*s;
        if(!okSpot(px, pz)) return;
        addMailbox(px, pz, Math.atan2(s*nx, s*nz));
        cnt.mailbox++;
      });
    }
    // ---- ZASTÁVKY ----
    if(main && cap('shelter')){
      walkRoad(R, 520, function(x, z, nx, nz, _k){
        if(!cap('shelter')) return;
        const off = R.hw + 3.1;
        const px = x + nx*off, pz = z + nz*off;
        if(!okSpot(px, pz)) return;
        addShelter(px, pz, Math.atan2(-nx, -nz));
        cnt.shelter++;
      });
    }
    // ---- ŽIVÉ PLOTY ----
    if(main && cap('hedge')){
      walkRoad(R, 74, function(x, z, nx, nz, k){
        if(!cap('hedge')) return;
        const s = (k % 2) ? 1 : -1;
        const off = R.hw + 3.5;
        const px = x + nx*off*s, pz = z + nz*off*s;
        if(!okSpot(px, pz)) return;
        addHedge(px, pz, Math.atan2(0, 1) + (s > 0 ? 0 : Math.PI));
        cnt.hedge++;
      });
    }
    // ---- KVETINÁČE ----
    if(cap('planter')){
      walkRoad(R, 88, function(x, z, nx, nz, k){
        if(!cap('planter')) return;
        const s = (k % 2) ? 1 : -1;
        const off = R.hw + 1.45;
        const px = x + nx*off*s, pz = z + nz*off*s;
        if(!okSpot(px, pz)) return;
        addPlanter(px, pz, Math.atan2(s*nx, s*nz));
        cnt.planter++;
      });
    }
    // ---- KANÁLY (uprostred vozovky) ----
    if(cap('manhole')){
      walkRoad(R, 46, function(x, z, _nx, _nz, _k){
        if(!cap('manhole')) return;
        if(!okRoadSpot(x, z)) return;
        addManhole(x, z);
        cnt.manhole++;
      });
    }
  }
  // ---- KAPLNKY: len pár kusov popri hlavnej trase ----
  placeShrines(rnd);
}

// Kaplnky na brehu cesty (trasa 513) — slovenská detailka.
function placeShrines(rnd){
  const out = new THREE.Vector3(), h = { v:0 };
  for(let s = 120; s < S.routeLen - 120 && cap('shrine'); s += 420 + rnd()*260){
    routePose(s, out, h, 0);
    const nx = -Math.cos(h.v), nz = Math.sin(h.v);
    const side = rnd() < 0.5 ? 1 : -1;
    const off = S.ROAD_HW + 4.2;
    const px = out.x + nx*off*side, pz = out.z + nz*off*side;
    if(!okSpot(px, pz)) continue;
    if(s > S.bridgeS0 - 60 && s < S.bridgeS1 + 60) continue;
    addShrine(px, pz, Math.atan2(-side*nx, -side*nz));
    cnt.shrine++;
  }
}

// Trasa 513: značniky po ceste + traťové stĺpy s drôtmi.
function placeRouteProps(){
  const out = new THREE.Vector3(), h = { v:0 };
  const poles = [];
  let k = 0;
  for(let s = 20; s < S.routeLen - 20; s += 24){
    routePose(s, out, h, 0);
    const nx = -Math.cos(h.v), nz = Math.sin(h.v);
    const side = (k++ % 2) ? 1 : -1;
    if(cap('delin')){
      const off = S.ROAD_HW + 1.7;
      const px = out.x + nx*off*side, pz = out.z + nz*off*side;
      if(okRoadSpot(px, pz) && roadDist2(px, pz) > 9){
        addDelineator(px, pz);
        cnt.delin++;
      }
    }
  }
  // Traťové stĺpy: len mimo mosta, na jednej strane.
  for(let s = 30; s < S.routeLen - 30; s += 46){
    if(!cap('pole')) break;
    if(s > S.bridgeS0 - 60 && s < S.bridgeS1 + 60) continue;
    routePose(s, out, h, 0);
    const nx = -Math.cos(h.v), nz = Math.sin(h.v);
    const off = S.ROAD_HW + 6.2;
    const px = out.x + nx*off, pz = out.z + nz*off;
    if(!okRoadSpot(px, pz)) continue;
    if(roadDist2(px, pz) < 25) continue;
    const y = getTerrainHeight(px, pz);
    // Rameno stĺpa je kolmé na trasu (teda pozdĺž pričnej osi).
    addPowerPole(px, pz, h.v + Math.PI);
    cnt.pole++;
    poles.push({ x:px, y:y + 8.16, z:pz, dx:nx, dz:nz });
  }
  // Drôty medzi susednými stĺpmi ( previs = vklad).
  for(let i=1;i<poles.length;i++){
    const a = poles[i-1], b = poles[i];
    const dx = b.x-a.x, dz = b.z-a.z;
    const L = Math.sqrt(dx*dx + dz*dz);
    if(L > 62) continue;
    const ch = chunkFor((a.x+b.x)/2, (a.z+b.z)/2);
    const M = ch.b.metal;
    const offs = [-0.85, -0.30, 0.30, 0.85];
    for(let j=0;j<offs.length;j++){
      const o = offs[j];
      const ax = a.x + a.dx*o, az = a.z + a.dz*o;
      const bx = b.x + b.dx*o, bz = b.z + b.dz*o;
      const sag = L * 0.030;
      const mx = (ax+bx)/2, mz = (az+bz)/2, my = (a.y+b.y)/2 - sag;
      wire(M, ax, a.y, az, mx, my, mz, 0.03, C_METAL_D);
      wire(M, mx, my, mz, bx, b.y, bz, 0.03, C_METAL_D);
    }
  }
}

// ---------- ZLOŽENIE CHUNKOV ----------
function flushChunks(){
  let meshes = 0, tris = 0;
  chunks.forEach(function(c){
    const cx = (c.minx + c.maxx)/2, cz = (c.minz + c.maxz)/2;
    c.x = cx; c.z = cz;
    c.r = Math.sqrt((c.maxx-cx)*(c.maxx-cx) + (c.maxz-cz)*(c.maxz-cz)) + 12;
    const ms = [];
    for(let i=0;i<BUCKETS.length;i++){
      const b = c.b[BUCKETS[i]];
      if(!b.i.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(b.p), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(b.n), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(b.u), 2));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(b.c), 3));
      g.setIndex(b.i);
      g.computeBoundingSphere();
      S.DYN_GEO.push(g);
      const mat = matOf[BUCKETS[i]];
      const m = new THREE.Mesh(g, mat);
      m.castShadow = (BUCKETS[i] !== 'glow' && BUCKETS[i] !== 'glass');
      m.receiveShadow = true;
      S.scene.add(m);
      ms.push(m);
      meshes++;
      tris += b.i.length / 3;
    }
    if(ms.length) S.CHUNKS.push({ x:c.x, z:c.z, r:c.r, ms:ms, vis:true });
  });
  console.log('[propy] ' + meshes + ' meshov, ' + Math.round(tris) + ' trojuholníkov: ' +
    'lampy ' + cnt.lamp + ', lavičky ' + cnt.bench + ', koše ' + cnt.bin +
    ', stíly ' + cnt.bollard + ', značky ' + cnt.sign + ', hydranty ' + cnt.hydrant +
    ', schránky ' + cnt.mailbox + ', zastávky ' + cnt.shelter + ', ploty ' + cnt.hedge +
    ', kvetináče ' + cnt.planter + ', kanály ' + cnt.manhole + ', značniky ' + cnt.delin +
    ', kaplnky ' + cnt.shrine + ', stĺpy ' + cnt.pole);
}

// ---------- VEREJNÉ API ----------
export function buildProps(){
  if(chunks.size) return;                 // idempotentné
  matOf = { metal: S.MAT.propMetal, matte: S.MAT.propMatte, wood: S.MAT.propWood,
            leaf: S.MAT.propLeaf, glow: S.MAT.propGlow, glass: S.MAT.propGlass };
  let seed = 771103;
  const rnd = function(){ seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  placeTownProps(rnd);
  placeRouteProps();
  flushChunks();
}
