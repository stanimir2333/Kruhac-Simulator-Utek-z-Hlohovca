// src/world/nature.js — vegetácia OSM scatter + lampy (verbatim port, js 6428–6686).
import * as THREE from 'three';
import { S } from './shared.js';
import { roadDist2, routePose, mergedBoxes } from './roads.js';
import { getTerrainHeight, dist2ToSamples } from './height.js';
import { gridQuery, GQ_MAX } from './ground.js';
// ---------- VEGETÁCIA: OSM scatter + THREE.InstancedMesh (LEN v init) ----------
// Body stromov nie sú v tomto module, ale v `S.osm.trees` (public/data/
// osmExtra.json) — generuje ich `python3 tools/gen_osm_extra.py` z nového OSM
// exportu (~/Downloads/map(3).osm). Predtým tu bol 125 kB literál na jednom
// riadku BEZ generátora, takže sa nedal znovu vyrobiť, len opraviť.
// Triedy (náhodný rozptyl vo vnútri OSM polygónov, seed 20260927):
//   A listnáč (parky/lesy/lúky) · B ihličnan (lesy) · C ker (lúky/kroviny
//   pri Váhu) · AVE aleje popri uliciach · T SKUTOČNE zmapované stromy
//   (`natural=tree`) — väčšie, ide o Platanusy na námestiach, ktoré boli
//   dovtedy v mape úplne nezobrazené.
// Render: 4 varianty (kmeň+ikosahedrón / kmeň+kužeľ / sploštená sféra),
// matný PBR (roughness 0.9+), 4 odtiene zelenej + 3 olivové cez instanceColor.
// Jeden InstancedMesh per typ per 250 m chunk (max 4/chunk), tiene + culling.
export function vegBuildWater(){
  S.VEGW.map = new Map();
  const wl = S.osm.water;
  for(let i=0;i<wl.length;i++){
    const L = wl[i], hw = L[0];
    for(let k=1;k<L.length;k+=4){
      const x = L[k], z = L[k+1];
      const key = (Math.floor((x-S.GB.x0)/20)+500)*1000 + (Math.floor((z-S.GB.z0)/20)+500);
      let a = S.VEGW.map.get(key);
      if(!a){ a = []; S.VEGW.map.set(key, a); }
      a.push(x, z, hw);
    }
  }
}
export function vegWet(x, z, pad){
  const cx = Math.floor((x-S.GB.x0)/20), cz = Math.floor((z-S.GB.z0)/20);
  for(let ax=-1;ax<=1;ax++){ for(let az=-1;az<=1;az++){
    const a = S.VEGW.map.get((cx+ax+500)*1000 + (cz+az+500));
    if(!a) continue;
    for(let s=0;s<a.length;s+=3){
      const dx = x-a[s], dz = z-a[s+1], lim = a[s+2]+pad;
      if(dx*dx+dz*dz < lim*lim) return true;
    }
  }}
  return false;
}
// Vlastný buffer pre vegetáciu — vegInBld je Init-only a nesmie zdieľať
// výstupný buffer s kolíziami hráča (pozri gridQuery).
const VEG_GQ = new Int32Array(GQ_MAX);

// bod v budove: hrubý kruh + presný footprint (BF) s 1.5 m ochranou kmeňa
export function vegInBld(x, z){
  const n = gridQuery(S.BGRID, x, z, 2, VEG_GQ);
  for(let i=0;i<n;i++){
    const b = VEG_GQ[i];
    const dx = x-S.BX.x[b], dz = z-S.BX.z[b];
    const rr = S.BX.hw[b]+S.BX.hl[b]+2;
    if(dx*dx+dz*dz > rr*rr) continue;
    const o = S.BF.o[b], nn = S.BF.n[b];
    let ins = false;
    for(let e=0,j=nn-1;e<nn;j=e++){
      const xi = S.BF.p[o+e*2], zi = S.BF.p[o+e*2+1];
      const xj = S.BF.p[o+j*2], zj = S.BF.p[o+j*2+1];
      if(((zi > z) !== (zj > z)) && (x < (xj-xi)*(z-zi)/(zj-zi)+xi)) ins = !ins;
    }
    if(ins) return true;
    for(let e=0;e<nn;e++){
      const ne = (e+1)%nn;
      const ax = S.BF.p[o+e*2], az = S.BF.p[o+e*2+1];
      const ex = S.BF.p[o+ne*2]-ax, ez = S.BF.p[o+ne*2+1]-az;
      const L2 = ex*ex+ez*ez || 1;
      let t = ((x-ax)*ex+(z-az)*ez)/L2;
      if(t<0)t=0; else if(t>1)t=1;
      const qx = x-(ax+ex*t), qz = z-(az+ez*t);
      if(qx*qx+qz*qz < 2.25) return true;
    }
  }
  return false;
}
export function buildVegInstanced(){
  vegBuildWater();
  if(!S.GEO.trunkV){
    S.GEO.trunkV = new THREE.CylinderGeometry(0.22, 0.34, 2.6, 6);
    S.GEO.trunkV.translate(0, 1.3, 0);
    S.GEO.crownV = new THREE.IcosahedronGeometry(1.9, 0);
    S.GEO.crownV.translate(0, 3.7, 0);
    S.GEO.coniferV = new THREE.ConeGeometry(1.7, 4.8, 7);
    S.GEO.coniferV.translate(0, 3.6, 0);
    S.GEO.bushV = new THREE.IcosahedronGeometry(1.0, 0);
    S.GEO.bushV.translate(0, 0.55, 0);
    S.DYN_GEO.push(S.GEO.trunkV, S.GEO.crownV, S.GEO.coniferV, S.GEO.bushV);
    // kmeny stromov vo svete sú 3953 inštancií GEO.trunkV (CylinderGeometry, UV 0..1)
    S.MAT.vegTrunk = new THREE.MeshStandardMaterial({ map: S.TEX.wood, normalMap: S.TEX.woodN, normalScale: new THREE.Vector2(0.5, 0.5), color: 0xc8b49c, roughness: 0.96, metalness: 0.0 });
    S.MAT.vegCrown = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0.0 });
    S.MAT.vegConifer = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0.0 });
    S.MAT.vegBush = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0.0 });
  }
  let seed = 770031;
  function rnd(){ seed = (seed*1103515245 + 12345) & 0x7fffffff; return seed/0x7fffffff; }
  const rounds = S.osm.rounds;
  const cells = new Map();
  function cellFor(x, z){
    const key = Math.floor((x-S.GB.x0)/250)*1000 + Math.floor((z-S.GB.z0)/250);
    let ch = cells.get(key);
    if(!ch){ ch = { tr:[], a:[], b:[], c:[], cx:0, cz:0, n:0 }; cells.set(key, ch); }
    return ch;
  }
  let skipRoad = 0, skipBld = 0, skipWet = 0, skipLow = 0, kept = 0;
  function tryTree(x, z, v, avenue){
    const rd = roadDist2(x, z);
    if(avenue){ if(rd < 26 || rd > 140){ skipRoad++; return; } } // alej drží 5.1–11.8 m od vozovky
    // zmapovaný strom je na svoje miesto OSM precízne (často 4 m od chodníka),
    // takže mu minimum 5,5 m od vozovky nerobíme — inak by zmizol v meste
    else if(rd < 30 && v !== 3){ skipRoad++; return; } // min. 5.5 m od ciest (aj poľných)
    if(vegWet(x, z, 9)){ skipWet++; return; }
    if(vegInBld(x, z)){ skipBld++; return; }
    for(let r=0;r<rounds.length;r++){
      const dx = x-rounds[r][0], dz = z-rounds[r][1], lim = rounds[r][2]+3;
      if(dx*dx+dz*dz < lim*lim) return;
    }
    if(!avenue && S.ROUTE_SUB && dist2ToSamples(x, z, S.ROUTE_SUB) < 60){ skipRoad++; return; }
    const y = getTerrainHeight(x, z);
    if(y < -0.5){ skipLow++; return; } // korýtá vôd bez stromov
    const ch = cellFor(x, z);
    // zmapovaný strom (natural=tree) je väčší a širší než náhodný rozptyl
    const sc = v === 3 ? 1.35+rnd()*0.55 : 0.8+rnd()*0.5;
    const it = { x:x, y:y-0.25, z:z, s:sc, sy:0.85+rnd()*0.4, rot:rnd()*6.2832, ci:(rnd()*4)|0 };
    if(v === 2){ ch.c.push(it); }
    else { ch.tr.push(it); if(v === 1) ch.b.push(it); else ch.a.push(it); }
    ch.cx += x; ch.cz += z; ch.n++;
    kept++;
  }
  const step = S.IS_MOBILE ? 2 : 1; // mobil: polovičná hustota
  const TD = S.osm.trees || { A:[], B:[], C:[], AVE:[], T:[] };
  if(!S.osm.trees) console.warn('[VEG] S.osm.trees chýba — bez stromov (python3 tools/gen_osm_extra.py)');
  const VA = TD.A, VB = TD.B, VC = TD.C, VV = TD.AVE, VT = TD.T;
  for(let i=0;i<VA.length;i+=step) tryTree(VA[i][0], VA[i][1], 0, false);
  for(let i=0;i<VB.length;i+=step) tryTree(VB[i][0], VB[i][1], 1, false);
  for(let i=0;i<VC.length;i+=step) tryTree(VC[i][0], VC[i][1], 2, false);
  for(let i=0;i<VV.length;i+=step) tryTree(VV[i][0], VV[i][1], 0, true);
  for(let i=0;i<VT.length;i++) tryTree(VT[i][0], VT[i][1], 3, false); // zmapované
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(),
        P = new THREE.Vector3(), SV = new THREE.Vector3(),
        E = new THREE.Euler(), CC = new THREE.Color();
  cells.forEach(function(ch){
    const cx = ch.cx/ch.n, cz = ch.cz/ch.n;
    let r = 0;
    const lists = [ch.tr, ch.a, ch.b, ch.c];
    for(let li=0;li<lists.length;li++){
      const L = lists[li];
      for(let i=0;i<L.length;i++){
        const d = Math.sqrt((L[i].x-cx)*(L[i].x-cx)+(L[i].z-cz)*(L[i].z-cz))+8;
        if(d > r) r = d;
      }
    }
    const parts = [];
    function makeIM(geo, mat, list, colors, bush){
      const m = new THREE.InstancedMesh(geo, mat, list.length);
      for(let i=0;i<list.length;i++){
        const t = list[i];
        E.set(0, t.rot, 0); Q.setFromEuler(E);
        P.set(t.x, t.y, t.z);
        if(bush) SV.set(t.s*1.2, t.s*0.7*t.sy, t.s*1.2);
        else SV.set(t.s, t.s*t.sy, t.s);
        M.compose(P, Q, SV);
        m.setMatrixAt(i, M);
        if(colors){ CC.setHex(colors[t.ci % colors.length]); m.setColorAt(i, CC); }
      }
      m.userData.veg = { list:list, bush:bush };
      m.instanceMatrix.needsUpdate = true;
      if(m.instanceColor) m.instanceColor.needsUpdate = true;
      m.castShadow = true; m.receiveShadow = true; // tiene na terén aj zástavbu
      if(m.computeBoundingSphere) m.computeBoundingSphere(); // presný frustum culling inštancií
      m.updateMatrix(); m.matrixAutoUpdate = false;
      S.scene.add(m); S.DYN_IM.push(m);
      parts.push(m);
    }
    if(ch.tr.length) makeIM(S.GEO.trunkV, S.MAT.vegTrunk, ch.tr, null, false);
    if(ch.a.length) makeIM(S.GEO.crownV, S.MAT.vegCrown, ch.a, S.VEG_GREENS, false);
    if(ch.b.length) makeIM(S.GEO.coniferV, S.MAT.vegConifer, ch.b, S.VEG_GREENS, false);
    if(ch.c.length) makeIM(S.GEO.bushV, S.MAT.vegBush, ch.c, S.VEG_OLIVE, true);
    S.CHUNKS.push({ x:cx, z:cz, r:r, ms:parts, vis:true }); // distance culling (2 Hz) ako budovy
  });
  console.log("vegetácia: " + kept + " inštancií v " + cells.size + " chunkoch (cesty:" + skipRoad + " budovy:" + skipBld + " voda:" + skipWet + " koryto:" + skipLow + ")");
}
// ---------- PRITIAHNUTIE STROMOV A KRIKOV NA TERÉN (getTerrainHeight) ----------
// Znovunastaví maticu každej inštancie: kmeň/krúžka leží presne na novej
// výškovovej mape terénu (0.25 m do zeme), žiadny strom neplave ani nie je
// zaborený do kopca. Volá sa po doplnení výškovej mriežky.
export const _vsQ = new THREE.Quaternion(), _vsE = new THREE.Euler();
export const _vsP = new THREE.Vector3(), _vsS = new THREE.Vector3(), _vsM = new THREE.Matrix4();
export function snapVegetationToTerrain(){
  let n = 0;
  for(let i=0;i<S.DYN_IM.length;i++){
    const m = S.DYN_IM[i];
    const v = m.userData && m.userData.veg;
    if(!v) continue;
    const L = v.list;
    for(let j=0;j<L.length;j++){
      const t = L[j];
      _vsE.set(0, t.rot, 0); _vsQ.setFromEuler(_vsE);
      _vsP.set(t.x, getTerrainHeight(t.x, t.z)-0.25, t.z);
      if(v.bush) _vsS.set(t.s*1.2, t.s*0.7*t.sy, t.s*1.2);
      else _vsS.set(t.s, t.s*t.sy, t.s);
      _vsM.compose(_vsP, _vsQ, _vsS);
      m.setMatrixAt(j, _vsM);
      t.y = _vsP.y;
    }
    m.instanceMatrix.needsUpdate = true;
    if(m.computeBoundingSphere) m.computeBoundingSphere();
    n += L.length;
  }
  return n;
}
export function buildLampsTrees(){
  function makeRnd(seed){
    let s = seed;
    return function(){ s = (s*1103515245 + 12345) & 0x7fffffff; return s/0x7fffffff; };
  }
  const rnd = makeRnd(987654321);
  const poles = [], heads = [], trunks = [], leaves = [];
  let k = 0;
  for(let s=50;s<S.routeLen-20;s+=100){
    routePose(s, S._v1, S._hWrap, (k%2===0) ? 5.6 : -5.6);
    const lgy = getTerrainHeight(S._v1.x, S._v1.z);
    poles.push([S._v1.x, 3.5+lgy, S._v1.z, 0.3, 7, 0.3, 0]);
    heads.push([S._v1.x, 7+lgy, S._v1.z, 1.4, 0.3, 0.5, 0]);
    k++;
  }
  for(let i=0;i<50;i++){
    const s = 30 + rnd()*(S.routeLen-60);
    if(s > S.bridgeS0-100 && s < S.bridgeS1+100) continue; // stromy nie do rieky
    routePose(s, S._v1, S._hWrap, (rnd()<0.5?-1:1)*(12+rnd()*18));
    let inRiver = false; // ani na vodu: kontrola koridorov všetkých vôd
    const wl = S.osm.water;
    for(let wI=0;wI<wl.length && !inRiver;wI++){
      const L = wl[wI];
      for(let k=1;k<L.length && !inRiver;k+=12){
        const dx = S._v1.x-L[k], dz = S._v1.z-L[k+1];
        if(dx*dx+dz*dz < 7225){ inRiver = true; }
      }
    }
    if(inRiver) continue;
    const sz = 2.2 + rnd()*2;
    const tgy = getTerrainHeight(S._v1.x, S._v1.z);
    trunks.push([S._v1.x, 1.2+tgy, S._v1.z, 0.5, 2.4, 0.5, 0]);
    leaves.push([S._v1.x, 2.4+sz*0.7+tgy, S._v1.z, sz, sz*1.6, sz, 0]);
  }
  const hillLeaves = [];
  for(let hi=0;hi<130;hi++){
    const ha = rnd()*6.2832, hr = 60+Math.sqrt(rnd())*340;
    const hx = S.CASTLE_X+Math.cos(ha)*hr, hz = S.CASTLE_Z+Math.sin(ha)*hr;
    const hg = getTerrainHeight(hx, hz);
    if(hg < 6 || hg > 40) continue;   // Zámocká záhrada: 20-40 m hernej Y
    if(roadDist2(hx, hz) < 150) continue;
    let inW = false;
    const wl2 = S.osm.water;
    for(let wI=0;wI<wl2.length && !inW;wI++){
      const L = wl2[wI];
      for(let k=1;k<L.length && !inW;k+=12){
        const dx = hx-L[k], dz = hz-L[k+1];
        if(dx*dx+dz*dz < 10000){ inW = true; }
      }
    }
    if(inW) continue;
    const sz = 2.6 + rnd()*2.4;
    trunks.push([hx, 1.4+hg, hz, 0.6, 2.8, 0.6, 0]);
    hillLeaves.push([hx, 2.8+sz*0.7+hg, hz, sz, sz*1.7, sz, 0]);
  }
  if(poles.length) mergedBoxes(poles, S.MAT.pole, S.GEO.cyl);
  if(heads.length) S.BLOOM.lampMesh = mergedBoxes(heads, S.MAT.lampOn, S.GEO.box); // žiarivky -> bloom vrstva
  if(trunks.length) mergedBoxes(trunks, S.MAT.trunk, S.GEO.cyl);
  if(leaves.length) mergedBoxes(leaves, S.MAT.leaf, S.GEO.cone);
  if(hillLeaves.length) mergedBoxes(hillLeaves, S.MAT.leafDark, S.GEO.cone);
}
