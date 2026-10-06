// src/world/ground.js — heightfield mesh + snap mriežky (verbatim port, js 3608–3633 + 5094–5440).
import * as THREE from 'three';
import { S } from './shared.js';
import { getTerrainHeight, heightAtAnalytic, smooth01, sxNoise } from './height.js';
import { ss01, sstep } from './textures.js';

const _ray = new THREE.Raycaster();
const _rayO = new THREE.Vector3(), _rayD = new THREE.Vector3(0,-1,0);

// Raycaster zhora nadol (Y=1000 -> Y=-1000): Y terénu pre kotvenie objektov
export function groundRayY(x, z, fallback){
  try{
    if(S.terrainMesh){
      _rayO.set(x, 1000, z); // zhora nadol: Y=1000 -> Y=-1000
      _ray.set(_rayO, _rayD);
      _ray.far = 2000;
      const hit = _ray.intersectObject(S.terrainMesh, false);
      if(hit && hit.length) return hit[0].point.y;
    }
  }catch(e){}
  return (fallback !== undefined) ? fallback : getTerrainHeight(x, z);
}

// statický mesh: tiene + frustum culling + zamrznutá matica (mobilný výkon)
export function staticDone(m, cast, receive){
  m.castShadow = !!cast;
  m.receiveShadow = (receive === undefined) ? true : !!receive;
  m.frustumCulled = true;
  m.updateMatrix();
  m.matrixAutoUpdate = false;
  return m;
}

export function computeBounds(){
  const bb = S.osm.bbox;
  S.GB.x0 = bb[0]-400; S.GB.z0 = bb[1]-400; S.GB.x1 = bb[2]+400; S.GB.z1 = bb[3]+400;
  // --- BANDLIMIT RELIEFU TERÉNU ---------------------------------------
  // Výšková mriežka má TER_SEG+1 vrcholov, teda bunka ~20 m. Zvlnenie, ktoré
  // do nej pustíme, MUSÍ mať vlnovú dĺžku aspoň ~5 buniek (Nyquist × 2.5),
  // inak sa na mriežke zaliasuje.
  // Pôvodne: sxFbm(x*0.004) má oktávy 250 / 117 / 56,7 m a extra sxNoise(x*0.02)
  // má 50 m -> 2,4 až 2,7 bunky. Obe sú POD Nyquistom, takže sa skladali do
  // pravidelného ~60 m "beatingu": meraná |d2h| sd 0,24 m / vrchol 0,80 m na
  // jednu bunku. To bolo tie tmavé pravidelné pruhy na teréne - mriežka nedokáže
  // takú vlnu vykresliť a len ju roztlačí do periodickej chyby sklonu.
  // Teraz frekvencie odvodené priamo z bunky, takže pri zmene hustoty mriežky
  // alebo rozlohy mapy zostanú bezpečné:
  //   fbm báza 1/(24*bunky) = 1/498 m -> oktávy 498 / 234 / 113 m (>= 5,4 bunky)
  //   detail   1/(8*bunky)  = 1/166 m
  S.TER_CELL = Math.max(S.GB.x1-S.GB.x0, S.GB.z1-S.GB.z0)/S.TER_SEG;
  S.TER_FBM_F = 1/(S.TER_CELL*24);
  S.TER_DET_F = 1/(S.TER_CELL*8);
}

export function gridAlloc(cs){
  const nx = Math.ceil((S.GB.x1-S.GB.x0)/cs), nz = Math.ceil((S.GB.z1-S.GB.z0)/cs);
  return { cs:cs, nx:nx, nz:nz, head:new Int32Array(nx*nz).fill(-1), next:null, n:0 };
}

export function gridAdd(g, x, z, id){
  let cx = Math.floor((x-S.GB.x0)/g.cs), cz = Math.floor((z-S.GB.z0)/g.cs);
  if(cx < 0) cx = 0; else if(cx >= g.nx) cx = g.nx-1;
  if(cz < 0) cz = 0; else if(cz >= g.nz) cz = g.nz-1;
  const c = cz*g.nx+cx;
  g.next[id] = g.head[c];
  g.head[c] = id;
}

export function gridQuery(g, x, z, ring){
  let n = 0;
  const ccx = Math.floor((x-S.GB.x0)/g.cs), ccz = Math.floor((z-S.GB.z0)/g.cs);
  for(let ax=-ring;ax<=ring;ax++){
    for(let az=-ring;az<=ring;az++){
      const cx = ccx+ax, cz = ccz+az;
      if(cx < 0 || cz < 0 || cx >= g.nx || cz >= g.nz) continue;
      let id = g.head[cz*g.nx+cx];
      while(id >= 0 && n < 160){ S.GQ[n++] = id; id = g.next[id]; }
    }
  }
  return n;
}

// ---------- FARBY TERÉNU (paleta Hlohovca, kompenzovaná o priemer textúry zeme) ----------
const GCPAL = (function(){
  function tcol(hx){
    return [Math.min(3, ((hx>>16)&255)/255/0.30),
            Math.min(3, ((hx>>8)&255)/255/0.33),
            Math.min(3, (hx&255)/255/0.23)];
  }
  return { bed:tcol(0x3f3a30), bank:tcol(0x8c8577), grass:tcol(0x4a7c36),
           grass2:tcol(0x3f7030), dry:tcol(0x8a8a5a), rock:tcol(0x7a756a),
           wheat:tcol(0xd4b248), plow:tcol(0x5a4531), meadow:tcol(0x6b9e43),
           forest:tcol(0x2d5022) };
})();

export function gmix(a, b, t){
  return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t];
}

// lesy: Zámocký kopec (Zámocká záhrada) + svah Malých Karpátov (Urbánek)
export function groundForest(x, z, h){
  const cdx = x-S.CASTLE_X, cdz = z-S.CASTLE_Z;
  if((cdx*cdx+cdz*cdz) < 480*480 && h > 3) return 1;
  const udx = x-S.URBAN_X, udz = z-S.URBAN_Z;
  if((udx*udx+udz*udz) < S.URBAN_R*S.URBAN_R && h > 24) return 1;
  return 0;
}

export function groundColor(h, x, z, urbD2){
  const C = GCPAL;
  let c;
  if(h < -9.5) c = C.bed;                                   // dno koryta
  else if(h < -7) c = gmix(C.bed, C.bank, (h+9.5)/2.5);    // breh
  else if(h < -1.5) c = C.bank;                             // náplavka
  else if(h < -0.5) c = gmix(C.bank, C.grass, (h+1.5)/1.0);
  // Celý zvyšok rampy je JEDEN MONOTÓNNY PRECHOD bez tvrdých stavov. Predtým to
  // boli tri vetvy s prehodenými faktorami, takže na h = -0,5 m farba skočila
  // SPÄŤ z C.grass na C.bank a na h = 8 m z C.grass na C.grass2 - tvrdé hrany
  // presne na izoliniách, ktoré sa na miernom terene vinú a kreslia pruhy.
  // Teraz: -0,5..8 m grass->grass2, 8..14 m drží grass2, 14..22 m -> C.dry.
  else if(h < 8) c = gmix(C.grass, C.grass2, (h+0.5)/8.5);   // mesto a lúky
  else if(h < 22) c = gmix(C.grass2, C.dry, Math.max(0,(h-14)/8)); // pahorkatiny
  else c = gmix(C.dry, C.rock, Math.min(1, (h-22)/24));     // skaly nad 22 m n.m.
  if(groundForest(x, z, h)) return C.forest;
  // parcely mimo mesta: pšenica / orná pôda / lúka (150x200 m pootočené o 20°)
  if(h > -0.5 && h < 10 && urbD2 > 16900){
    const pxr = x*0.94+z*0.34, pzr = -x*0.34+z*0.94;
    const fh = Math.abs(Math.sin(Math.floor(pxr/150)*12.9898+Math.floor(pzr/200)*78.233)*43758.5453) % 1;
    if(fh >= 0.3 && fh < 0.55) c = C.wheat;
    else if(fh >= 0.55 && fh < 0.68) c = C.plow;
    else if(fh >= 0.68 && fh < 0.83) c = C.meadow;
  }
  return c;
}

// ---------- MAPA Z OSM ----------
// Výšková mriežka terénu 256x256 z OSM dát: nadmorské výšky (ele), koryto rieky,
// výškové profily ciest a ploché podložie budov. (LEN v init)
const BLD_APRON = 14;    // mimo obvodu budovy ešte zostane terén urobený do roviny
const TER_MAX_SLOPE = 0.40; // tvrdý limit sklonu terénu (40 %) medzi vrcholmi mriežky

export function buildGround(){
  const x0 = S.GB.x0, z0 = S.GB.z0, x1 = S.GB.x1, z1 = S.GB.z1;
  const W = x1-x0, D = z1-z0, cx = (x0+x1)/2, cz = (z0+z1)/2;
  const G = S.TER_SEG+1, MGW = W/S.TER_SEG, MGD = D/S.TER_SEG;
  // 1) výšková mriežka priamo z OSM modelu (analyticky, ešte bez obvodov budov)
  const H = new Float32Array(G*G);
  for(let iz=0;iz<G;iz++){
    const wz = z0+iz*MGD, row = iz*G;
    for(let ix=0;ix<G;ix++) H[row+ix] = heightAtAnalytic(x0+ix*MGW, wz);
  }
  // 2) mierny 3x3 prechod po mriežke (hladký základ pre ďalšie kroky)
  const Hs = new Float32Array(H);
  for(let iz=1;iz<G-1;iz++){
    const row = iz*G;
    for(let ix=1;ix<G-1;ix++){
      Hs[row+ix] = (H[row+ix]*4 + H[row-1+ix] + H[row+1+ix] + H[row+ix-1] + H[row+ix+1])/8;
    }
  }
  H.set(Hs);
  // 3) ZAROVNANIE TERÉNU POD BUDOVAMI: priemerná výška obvodu -> jedna rovina,
  //    s hladkým prechodom (apron) mimo obvodu (žiadne diery ani zarytie do kopca)
  flattenBuildings(H, G, MGW, MGD, x0, z0);
  // 4) limit sklonu: žiadne strmé hrany ani zlomy terénu
  limitSlope(H, G, MGW, MGD, 24, TER_MAX_SLOPE);
  // 5) rovina vrcholov (rovnaké poradie ako THREE.PlaneGeometry po rotateX)
  const g = new THREE.PlaneGeometry(W, D, S.TER_SEG, S.TER_SEG);
  g.rotateX(-Math.PI/2);
  const p = g.attributes.position;
  for(let i=0;i<p.count;i++){
    const ix = Math.round((p.getX(i)+cx-x0)/MGW), iz = Math.round((p.getZ(i)+cz-z0)/MGD);
    p.setY(i, H[iz*G+ix]);
  }
  // 5) maska zástavby: polia len mimo mesta (cesty + koridor + voda) - mriežkový dotaz
  const UGRID = { cs:64, nx:0, nz:0, head:null, next:null };
  const up = [];
  const pushU = function(L, step){
    const nn = (L.length-1)/2;
    for(let k=0;k<nn;k+=step) up.push(L[1+k*2], L[1+k*2+1]);
  };
  for(let li=0;li<S.osm.roads.length;li++) pushU(S.osm.roads[li], 6);
  for(let li=0;li<S.osm.dirt.length;li++) pushU(S.osm.dirt[li], 6);
  for(let k=0;k<S.ROUTE_SUB.length;k++) up.push(S.ROUTE_SUB[k]);
  for(let k=0;k<S.WPT.x.length;k+=4) up.push(S.WPT.x[k], S.WPT.z[k]);
  for(let ri=0;ri<S.osm.rounds.length;ri++) up.push(S.osm.rounds[ri][0], S.osm.rounds[ri][1]);
  UGRID.nx = Math.ceil((S.GB.x1-S.GB.x0)/UGRID.cs);
  UGRID.nz = Math.ceil((S.GB.z1-S.GB.z0)/UGRID.cs);
  UGRID.head = new Int32Array(UGRID.nx*UGRID.nz).fill(-1);
  UGRID.next = new Int32Array(up.length/2);
  for(let i=0;i<up.length/2;i++){
    let cxq = Math.floor((up[i*2]-S.GB.x0)/UGRID.cs), czq = Math.floor((up[i*2+1]-S.GB.z0)/UGRID.cs);
    if(cxq < 0) cxq = 0; else if(cxq >= UGRID.nx) cxq = UGRID.nx-1;
    if(czq < 0) czq = 0; else if(czq >= UGRID.nz) czq = UGRID.nz-1;
    const c = czq*UGRID.nx+cxq;
    UGRID.next[i] = UGRID.head[c]; UGRID.head[c] = i;
  }
  function urbD2(x, z){
    let best = 1e18;
    const ccx = Math.floor((x-S.GB.x0)/UGRID.cs), ccz = Math.floor((z-S.GB.z0)/UGRID.cs);
    for(let ax=-1;ax<=1;ax++){
      for(let az=-1;az<=1;az++){
        const cxq = ccx+ax, czq = ccz+az;
        if(cxq < 0 || czq < 0 || cxq >= UGRID.nx || czq >= UGRID.nz) continue;
        let id = UGRID.head[czq*UGRID.nx+cxq];
        while(id >= 0){
          const dx = up[id*2]-x, dz = up[id*2+1]-z, d = dx*dx+dz*dz;
          if(d < best) best = d;
          id = UGRID.next[id];
        }
      }
    }
    return best;
  }
  const colors = new Float32Array(p.count*3);
  const blend  = new Float32Array(p.count);
  for(let i=0;i<p.count;i++){
    const wx = p.getX(i)+cx, wz = p.getZ(i)+cz, h = p.getY(i);
    const c = groundColor(h, wx, wz, urbD2(wx, wz));
    const v = 0.92+(sxNoise(wx*0.013+9.1, wz*0.013-4.4)*0.5+0.5)*0.16;
    colors[i*3] = c[0]*v; colors[i*3+1] = c[1]*v; colors[i*3+2] = c[2]*v;
    // aBlend: 0 = trávnik, 1 = holá hlina. Teraz NEJDE o jednu opakovanú dlažku,
    // ale o zmes dvoch vrstiev (viditeľný shader MAT.ground), takže rozhoduje
    // sklon strmšie ako 17 %, skalnatina nad 22 m, breh pri rieke a dve mierky
    // šumu (200 m hrubé fliaky + 50 m roztrhané okraje). Bez toho sa dlažka trávnika
    // opakuje ako mriežka a je to vidieť na 4,5 km terénu.
    const ix = Math.round((p.getX(i)+cx-x0)/MGW), iz = Math.round((p.getZ(i)+cz-z0)/MGD);
    const gx = (H[iz*G+Math.min(G-1,ix+1)] - H[iz*G+Math.max(0,ix-1)])/(2*MGW);
    const gz = (H[Math.min(G-1,iz+1)*G+ix] - H[Math.max(0,iz-1)*G+ix])/(2*MGD);
    const slope = Math.sqrt(gx*gx+gz*gz);
    let b = sstep(0.06, 0.26, slope)*0.60;                             // strmé svahy
    b += ss01((h-22)/18)*0.55;                                        // holé skaly
    b += ss01((-h-0.6)/1.6)*0.80;                                     // breh pri rieke
    // dve mierky šumu sú VAŽENÉ NAD 0 (0.62 / 0.56), inak by sxNoise so stredom 0.5
    // hodil polovicu terénu do holov. Takto ostáva trávnik všade a holá pôda
    // vyrába len na vrcholoch tých najvyšších fliakov (približne 15 % plochy).
    b += (sxNoise(wx*0.0050+31.7, wz*0.0050-12.3)*0.5+0.5 - 0.62)*0.70;
    b += (sxNoise(wx*0.0200-5.1, wz*0.0200+8.8)*0.5+0.5 - 0.56)*0.30;
    blend[i] = ss01(b);
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  g.setAttribute("aBlend", new THREE.BufferAttribute(blend, 1));
  g.computeVertexNormals();
  S.meshGrid = H;
  // rozsah výšok terénu: tesný tieňový near/far bez zbytočných metrov hĺbky
  let ymin = Infinity, ymax = -Infinity;
  for(let i=0;i<H.length;i++){ const v = H[i]; if(v < ymin) ymin = v; if(v > ymax) ymax = v; }
  if(ymin < ymax){ S.terrMinY = ymin; S.terrMaxY = ymax; }
  S.meshReady = true; // odteraz getTerrainHeight() číta presne renderovanú sieť
  S.DYN_GEO.push(g);
  const m = new THREE.Mesh(g, S.MAT.ground);
  m.position.set(cx, 0, cz);
  S.scene.add(m);
  staticDone(m, false, true); // terén: len prijíma tiene
  S.terrainMesh = m; // cieľ pre Raycaster snapy objektov
  S.groundHoleOK = true;
}

// ---------- ZAROVNANIE TERÉNU POD OBVODMI BUDOV Z OSM ----------
// Pre každý obvod sa zmeria priemerná výška terénu (vzorovaná po obvode aj
// vo vnútri) a vrcholy mriežky v obvode + apron okolo sa k nej stiahnu.
// Výsledok: rovná podstava bez dier a bez zarytia do svahu, plynulý prechod von.
// DÔLEŽITÉ: všetky roviny sa merajú z ORIGINÁLNEHO terénu (H0), nie z postupne
// upravovanej mriežky - inak by sa podložia susedných budiev kumulovali.
export function flattenBuildings(H, G, MGW, MGD, x0, z0){
  const list = S.osm.blds;
  const H0 = H.slice(0);
  // 1) prechod 1: pre kazdu budovu spocitame rovinu z ORIGINALNEHO terenu
  const bmnx = [], bmxx = [], bmnz = [], bmxz = [], bap = [], bpl = [], bar = [];
  for(let bi=0;bi<list.length;bi++){
    const b = list[bi];
    const np = (b.length-5)/2;
    if(np < 3) continue;
    let mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9;
    for(let k=0;k<np;k++){
      const px = b[5+k*2], pz = b[5+k*2+1];
      if(px < mnx) mnx = px; if(px > mxx) mxx = px;
      if(pz < mnz) mnz = pz; if(pz > mxz) mxz = pz;
    }
    const w = mxx-mnx, d = mxz-mnz;
    if(w < 0.5 || d < 0.5) continue;
    // priemerna vyska z povodneho terenu: hrany obvodu + vsetky vrcholy mriezky vnutri
    let sum = 0, cnt = 0;
    for(let e=0;e<np;e++){
      const ax = b[5+e*2], az = b[5+e*2+1];
      const qx = b[5+((e+1)%np)*2], qz = b[5+((e+1)%np)*2+1];
      const el = Math.hypot(qx-ax, qz-az);
      const sub = Math.max(1, Math.min(6, Math.round(el/6)));
      for(let s2=0;s2<sub;s2++){
        const t = s2/sub;
        sum += gridAt(H0, G, MGW, MGD, x0, z0, ax+(qx-ax)*t, az+(qz-az)*t); cnt++;
      }
    }
    const gx0 = Math.max(0, Math.floor((mnx-x0)/MGW)), gx1 = Math.min(G-1, Math.ceil((mxx-x0)/MGW));
    const gz0 = Math.max(0, Math.floor((mnz-z0)/MGD)), gz1 = Math.min(G-1, Math.ceil((mxz-z0)/MGD));
    let lo = 1e9, hi = -1e9;
    for(let gz=gz0;gz<=gz1;gz++) for(let gx=gx0;gx<=gx1;gx++){
      const v = H0[gz*G+gx];
      if(v < lo) lo = v; if(v > hi) hi = v;
      sum += v; cnt++;
    }
    if(!cnt || lo > hi) continue;
    bmnx.push(mnx); bmxx.push(mxx); bmnz.push(mnz); bmxz.push(mxz);
    bar.push(Math.sqrt(w*d));
    // apron rastie s prevysenim podlozia (svah = mierna oporna stena, nie zlom terenu)
    bap.push(Math.min(56, Math.max(BLD_APRON, 12+2.0*(hi-lo))));
    bpl.push(sum/cnt);
  }
  // 2) prechod 2: vážený blend rovín do vrcholov mriežky. Váha je 1.0 pod obvodom,
  //    cez 1 bunku klesá a potom pokračuje apronom. Tvrdenie nároku (aM) rieši
  //    konflikt susedných obvodov, výška sa váži priemerom.
  // Vrchol mriežky si "vytiahne" tá rovina, ktorá ho pokrýva najviac - susedné
  // budovy sa tak spoja do jednej terasy a žiadna nestojí na svahu ani vo vzduchu.
  const aW = new Float32Array(G*G), aP = new Float32Array(G*G), aM = new Float32Array(G*G);
  const CELL = (MGW > MGD) ? MGW : MGD;   // velkosť bunky mriežky
  for(let bi2=0;bi2<bpl.length;bi2++){
    const mnx=bmnx[bi2], mxx=bmxx[bi2], mnz=bmnz[bi2], mxz=bmxz[bi2], ap=bap[bi2], plane=bpl[bi2];
    // malý obvod má väčší vplyv než veľký komplex, ktorý ho obsahuje
    const r2 = bar[bi2]/25; const wF = 1/(1+r2*r2);
    const ix0 = Math.max(0, Math.floor((mnx-ap-x0)/MGW));
    const ix1 = Math.min(G-1, Math.ceil((mxx+ap-x0)/MGW));
    const iz0 = Math.max(0, Math.floor((mnz-ap-z0)/MGD));
    const iz1 = Math.min(G-1, Math.ceil((mxz+ap-z0)/MGD));
    const ap2 = (ap > CELL+2) ? (ap-CELL) : 2;
    for(let iz=iz0;iz<=iz1;iz++){
      const wz = z0+iz*MGD, row = iz*G;
      for(let ix=ix0;ix<=ix1;ix++){
        const wx = x0+ix*MGW;
        const qx = (wx < mnx) ? (mnx-wx) : ((wx > mxx) ? (wx-mxx) : 0);
        const qz = (wz < mnz) ? (mnz-wz) : ((wz > mxz) ? (wz-mxz) : 0);
        const dd = Math.sqrt(qx*qx+qz*qz);
        if(dd > ap) continue;
        // wCore = tvrdenie nároku (1.0 pod obvodom), wAvg = váha do priemeru rovín
        const wCore = (dd <= 0) ? 1
          : ((dd <= CELL) ? 1-smooth01(dd/CELL) : 1-smooth01((dd-CELL)/ap2));
        if(wCore <= 0.002) continue;
        const w = wCore*wF;
        const i = row+ix;
        aW[i] += w; aP[i] += w*plane;
        if(wCore > aM[i]) aM[i] = wCore;
      }
    }
  }
  // tvrdenie roviny sa riadi NAJSILNEJŠÍM nárokom (aM), výška sa váži priemerom
  for(let i=0;i<G*G;i++){
    if(aW[i] <= 0) continue;
    const tw = (aM[i] < 1) ? aM[i] : 1;
    H[i] += ((aP[i]/aW[i]) - H[i])*tw;
  }
}

// ---------- LIMITOVANIE SKLONU MRIEŽKY ----------
// Symetrická relaxácia: ak rozdiel susedných vrcholov prekročí povolený sklon,
// výška sa symetricky posunie. Plochy pod budovami (sklon ~0) zostávajú rovné,
// prechody násyp/zarez sa stanú miernymi a terén nemá zlomy.
export function limitSlope(H, G, MGW, MGD, iters, maxK){
  const lx = maxK*MGW, lz = maxK*MGD;
  for(let it=0;it<iters;it++){
    let moved = 0;
    for(let iz=1;iz<G-1;iz++){
      const row = iz*G;
      for(let ix=1;ix<G-1;ix++){
        const i0 = row+ix, h0 = H[i0];
        let nb, d, lim, t;
        nb = i0-1; d = H[nb]-h0; lim = lx;
        if(d > lim){ t = (d-lim)*0.25; H[i0] += t; H[nb] -= t; moved++; }
        else if(d < -lim){ t = (-d-lim)*0.25; H[i0] -= t; H[nb] += t; moved++; }
        nb = i0+1; d = H[nb]-H[i0]; lim = lx;
        if(d > lim){ t = (d-lim)*0.25; H[i0] += t; H[nb] -= t; moved++; }
        else if(d < -lim){ t = (-d-lim)*0.25; H[i0] -= t; H[nb] += t; moved++; }
        nb = row-G+ix; d = H[nb]-H[i0]; lim = lz;
        if(d > lim){ t = (d-lim)*0.25; H[i0] += t; H[nb] -= t; moved++; }
        else if(d < -lim){ t = (-d-lim)*0.25; H[i0] -= t; H[nb] += t; moved++; }
        nb = row+G+ix; d = H[nb]-H[i0]; lim = lz;
        if(d > lim){ t = (d-lim)*0.25; H[i0] += t; H[nb] -= t; moved++; }
        else if(d < -lim){ t = (-d-lim)*0.25; H[i0] -= t; H[nb] += t; moved++; }
      }
    }
    if(!moved) break;
  }
}

// výška v mriežke s bilineárnou interpoláciou (bez ohľadu na diagonálu - len priemer)
export function gridAt(H, G, MGW, MGD, x0, z0, wx, wz){
  let fx = (wx-x0)/MGW, fz = (wz-z0)/MGD;
  if(fx < 0) fx = 0; else if(fx > G-1.001) fx = G-1.001;
  if(fz < 0) fz = 0; else if(fz > G-1.001) fz = G-1.001;
  const ix = fx|0, iz = fz|0, u = fx-ix, v = fz-iz, row = iz*G;
  return H[row+ix]*(1-u)*(1-v) + H[row+ix+1]*u*(1-v)
       + H[row+G+ix]*(1-u)*v + H[row+G+ix+1]*u*v;
}
