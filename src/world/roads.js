// src/world/roads.js — vozovky, trasa 513, kruháče, most, koľaje, zeleň (verbatim port).
import * as THREE from 'three';
import { S } from './shared.js';
import { getTerrainHeight, riverBedY, meshSample, deckBlend } from './height.js';
import { groundRayY, staticDone, gridAdd, gridQuery } from './ground.js';
import { makeLabel } from './textures.js';
import { regLabel } from './labels.js';

export function putBox(mat, sx, sy, sz, x, y, z, ry){
  const m = new THREE.Mesh(S.GEO.box, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  if(ry){ m.rotation.y = ry; }
  S.scene.add(m);
  staticDone(m, true, true);
  return m;
}

export function buildStrip(ptsFlat, halfW, y, mat, lat, sArr){
  const n = ptsFlat.length/2;
  const LO = lat || 0;
  const pos = new Float32Array(n*2*3);
  const uv = new Float32Array(n*2*2);
  const idx = [];
  let dist = 0;
  for(let i=0;i<n;i++){
    const x = ptsFlat[2*i], z = ptsFlat[2*i+1];
    const a = Math.max(0,i-1)*2, b = Math.min(n-1,i+1)*2;
    let dx = ptsFlat[b]-ptsFlat[a], dz = ptsFlat[b+1]-ptsFlat[a+1];
    const L = Math.sqrt(dx*dx+dz*dz) || 1; dx/=L; dz/=L;
    const h = Math.atan2(dx, dz);
    const rx = -Math.cos(h), rz = Math.sin(h);
    const nx = -dz, nz = dx;
    const ox = x+rx*LO, oz = z+rz*LO;
    const sv = sArr ? sArr[i] : 0;
    const yL = (typeof y === "function") ? y(ox+nx*halfW, oz+nz*halfW, sv) : y;
    const yR = (typeof y === "function") ? y(ox-nx*halfW, oz-nz*halfW, sv) : y;
    pos[i*6]=ox+nx*halfW; pos[i*6+1]=yL; pos[i*6+2]=oz+nz*halfW;
    pos[i*6+3]=ox-nx*halfW; pos[i*6+4]=yR; pos[i*6+5]=oz-nz*halfW;
    if(i>0) dist += Math.sqrt((x-ptsFlat[2*i-2])*(x-ptsFlat[2*i-2])+(z-ptsFlat[2*i-1])*(z-ptsFlat[2*i-1]));
    // UV v METROCH (U = cela sirka pasu, V = najazdena dlzka). Tiling uz NIE JE
    // v UV, ale v texture.repeat (1/dlažka) - tak ma jedna zdieľana textúra
    // spravne meradlo na kazdej sirke cesty aj na dlhej trasovej usecke.
    const v = dist, u1 = halfW*2;
    uv[i*4]=0; uv[i*4+1]=v; uv[i*4+2]=u1; uv[i*4+3]=v;
    if(i<n-1){ const k=i*2; idx.push(k, k+1, k+2, k+1, k+3, k+2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos,3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv,2));
  g.setIndex(idx);
  g.computeVertexNormals();
  S.DYN_GEO.push(g);
  const m = new THREE.Mesh(g, mat);
  S.scene.add(m);
  staticDone(m, false, true); // vozovka: len prijíma tiene (tenký pás nekreslí tiene)
  return m;
}

export function buildWall(ptsFlat, lateral, y0, y1, mat, sArr){
  const n = ptsFlat.length/2;
  const pos = new Float32Array(n*2*3);
  const idx = [];
  for(let i=0;i<n;i++){
    const x = ptsFlat[2*i], z = ptsFlat[2*i+1];
    const a = Math.max(0,i-1)*2, b = Math.min(n-1,i+1)*2;
    let dx = ptsFlat[b]-ptsFlat[a], dz = ptsFlat[b+1]-ptsFlat[a+1];
    const L = Math.sqrt(dx*dx+dz*dz) || 1; dx/=L; dz/=L;
    const h = Math.atan2(dx, dz);
    const rx = -Math.cos(h), rz = Math.sin(h);
    const sv = sArr ? sArr[i] : 0;
    const y0v = (typeof y0 === "function") ? y0(x+rx*lateral, z+rz*lateral, sv) : y0;
    const y1v = (typeof y1 === "function") ? y1(x+rx*lateral, z+rz*lateral, sv) : y1;
    pos[i*6]=x+rx*lateral; pos[i*6+1]=y0v; pos[i*6+2]=z+rz*lateral;
    pos[i*6+3]=x+rx*lateral; pos[i*6+4]=y1v; pos[i*6+5]=z+rz*lateral;
    if(i<n-1){ const k=i*2; idx.push(k, k+1, k+2, k+1, k+3, k+2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos,3));
  g.setIndex(idx);
  g.computeVertexNormals();
  S.DYN_GEO.push(g);
  const m = new THREE.Mesh(g, mat);
  S.scene.add(m);
  staticDone(m, true, true);
  return m;
}

const ROUTE_BB = { x0:0, z0:0, x1:0, z1:0 };

export function routeDist2(x, z){
  let best = 1e18;
  for(let i=1;i<=S.ROUTE_N;i++){
    const ax = S.routeX[i-1], az = S.routeZ[i-1];
    const dx = S.routeX[i]-ax, dz = S.routeZ[i]-az;
    const l2 = dx*dx+dz*dz;
    let t = l2 > 0 ? ((x-ax)*dx+(z-az)*dz)/l2 : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    const ex = x-(ax+dx*t), ez = z-(az+dz*t);
    const d = ex*ex+ez*ez;
    if(d < best) best = d;
  }
  return best;
}

export function routeBB(){
  ROUTE_BB.x0 = ROUTE_BB.z0 = 1e18; ROUTE_BB.x1 = ROUTE_BB.z1 = -1e18;
  for(let i=0;i<=S.ROUTE_N;i++){
    const x = S.routeX[i], z = S.routeZ[i];
    if(x < ROUTE_BB.x0) ROUTE_BB.x0 = x; if(x > ROUTE_BB.x1) ROUTE_BB.x1 = x;
    if(z < ROUTE_BB.z0) ROUTE_BB.z0 = z; if(z > ROUTE_BB.z1) ROUTE_BB.z1 = z;
  }
}

export function clipWayRoute(L, r, out){
  const hw = L[0], MAXL = 4, r2 = r*r, n = (L.length-1)/2;
  if(n < 2) return;
  let run = null;
  const close = () => { if(run && run.length >= 5) out.push(run); run = null; };
  const push = (x, z) => { if(!run) run = [hw, x, z]; else run.push(x, z); };
  // počiatočný stav MUSÍ byť z prvého vrcholu - inak by sa prvý bod vo vnútri
  // koridoru vykreslil (bol by to zvyšok starej cesty priamo na trase)
  let pin = routeDist2(L[1], L[2]) <= r2;
  let sx = L[1], sz = L[2];
  for(let i=0;i<n-1;i++){
    const ax = L[1+i*2], az = L[1+i*2+1], bx = L[1+(i+1)*2], bz = L[1+(i+1)*2+1];
    // úsek celý mimo koridorovej obdľážnejšiny: bez delenia a bez dotazov na trasu
    if(!(Math.min(ax,bx) <= ROUTE_BB.x1+r && Math.max(ax,bx) >= ROUTE_BB.x0-r &&
         Math.min(az,bz) <= ROUTE_BB.z1+r && Math.max(az,bz) >= ROUTE_BB.z0-r)){
      if(!pin) push(bx, bz);
      sx = bx; sz = bz;
      continue;
    }
    const seg = Math.hypot(bx-ax, bz-az);
    const k = Math.max(1, Math.ceil(seg/MAXL));
    for(let t=1;t<=k;t++){
      const qx = ax+(bx-ax)*t/k, qz = az+(bz-az)*t/k;
      const qin = routeDist2(qx, qz) <= r2;
      if(qin !== pin){                       // priesečík hranice koridoru (bisekcia)
        let lo = 0, hi = 1;
        for(let it=0; it<9; it++){
          const m = (lo+hi)*0.5;
          if((routeDist2(sx+(qx-sx)*m, sz+(qz-sz)*m) <= r2) === pin) lo = m; else hi = m;
        }
        const ix = sx+(qx-sx)*hi, iz = sz+(qz-sz)*hi;
        if(pin) close(); else push(ix, iz);
        pin = qin;
      }
      if(!pin) push(qx, qz);
      sx = qx; sz = qz;
    }
  }
  close();
}

export function mergedStrips(lists, y, mat, lat, cutR){
  const LO = lat || 0;
  let paths = lists;
  if(cutR > 0){
    routeBB();
    const cut = [], r = cutR+2;
    for(let li=0;li<lists.length;li++){
      const L = lists[li], n = (L.length-1)/2;
      let bx0=1e18, bz0=1e18, bx1=-1e18, bz1=-1e18;
      for(let k=1;k<L.length;k+=2){
        const x = L[k], z = L[k+1];
        if(x<bx0) bx0=x; if(x>bx1) bx1=x; if(z<bz0) bz0=z; if(z>bz1) bz1=z;
      }
      if(n < 2 || bx0 > ROUTE_BB.x1+r || bx1 < ROUTE_BB.x0-r || bz0 > ROUTE_BB.z1+r || bz1 < ROUTE_BB.z0-r){
        cut.push(L); continue;   // way celý mimo koridoru - bez zásahu
      }
      clipWayRoute(L, cutR, cut);
    }
    paths = cut;
  }
  let nv = 0, ni = 0;
  for(let li=0;li<paths.length;li++){
    const n = (paths[li].length-1)/2;
    nv += n*2; ni += (n-1)*6;
  }
  const pos = new Float32Array(nv*3);
  const uv = new Float32Array(nv*2);
  const idx = new Uint32Array(ni);
  let v = 0, ii = 0;
  for(let li=0;li<paths.length;li++){
    const L = paths[li], n = (L.length-1)/2;
    let dist = 0;
    for(let i=0;i<n;i++){
      const x = L[1+i*2], z = L[1+i*2+1];
      const a = Math.max(0,i-1), b = Math.min(n-1,i+1);
      let dx = L[1+b*2]-L[1+a*2], dz = L[1+b*2+1]-L[1+a*2+1];
      const Ll = Math.sqrt(dx*dx+dz*dz) || 1; dx/=Ll; dz/=Ll;
      const h = Math.atan2(dx, dz);
      const rx = -Math.cos(h), rz = Math.sin(h);
      const nx = -dz, nz = dx;
      const ox = x+rx*LO, oz = z+rz*LO;
      const yA = (typeof y === "function") ? y(ox+nx*L[0], oz+nz*L[0], L[0]) : y;
      const yB = (typeof y === "function") ? y(ox-nx*L[0], oz-nz*L[0], L[0]) : y;
      pos[v*3]=ox+nx*L[0]; pos[v*3+1]=yA; pos[v*3+2]=oz+nz*L[0];
      pos[v*3+3]=ox-nx*L[0]; pos[v*3+4]=yB; pos[v*3+5]=oz-nz*L[0];
      if(i>0) dist += Math.sqrt((x-L[1+(i-1)*2])*(x-L[1+(i-1)*2])+(z-L[1+(i-1)*2+1])*(z-L[1+(i-1)*2+1]));
      const vv = dist, uu = L[0]*2;   // UV v metroch (vysvetlenie v buildStrip)
      uv[v*2]=0; uv[v*2+1]=vv; uv[v*2+2]=uu; uv[v*2+3]=vv;
      if(i<n-1){ const k=v; idx[ii++]=k; idx[ii++]=k+1; idx[ii++]=k+2; idx[ii++]=k+1; idx[ii++]=k+3; idx[ii++]=k+2; }
      v += 2;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos,3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv,2));
  g.setIndex(new THREE.BufferAttribute(idx,1));
  g.computeVertexNormals();
  S.DYN_GEO.push(g);
  const m = new THREE.Mesh(g, mat);
  S.scene.add(m);
  staticDone(m, false, true);
  return m;
}

export function mergedBoxes(list, mat, tpl){
  tpl = tpl || S.GEO.box;
  const tp = tpl.attributes.position.array;
  const tn = tpl.attributes.normal.array;
  const tu = tpl.attributes.uv.array;
  const ti = tpl.index.array;
  const n = list.length, NV = tpl.attributes.position.count, NI = tpl.index.count;
  const pos = new Float32Array(n*NV*3);
  const nor = new Float32Array(n*NV*3);
  const uv = new Float32Array(n*NV*2);
  const idx = new Uint32Array(n*NI);
  for(let i=0;i<n;i++){
    const b = list[i];
    const c = Math.cos(b[6]||0), s = Math.sin(b[6]||0);
    for(let v=0;v<NV;v++){
      const lx = tp[v*3]*b[3], ly = tp[v*3+1]*b[4], lz = tp[v*3+2]*b[5];
      const o3 = (i*NV+v)*3, o2 = (i*NV+v)*2;
      pos[o3] = b[0] + lx*c + lz*s;
      pos[o3+1] = b[1] + ly;
      pos[o3+2] = b[2] - lx*s + lz*c;
      let nx = tn[v*3]/b[3], ny = tn[v*3+1]/b[4], nz = tn[v*3+2]/b[5];
      let wx = nx*c + nz*s, wy = ny, wz = -nx*s + nz*c;
      const L = Math.sqrt(wx*wx+wy*wy+wz*wz) || 1;
      nor[o3] = wx/L; nor[o3+1] = wy/L; nor[o3+2] = wz/L;
      uv[o2] = tu[v*2]; uv[o2+1] = tu[v*2+1];
    }
    for(let k=0;k<NI;k++){ idx[i*NI+k] = i*NV + ti[k]; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos,3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor,3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv,2));
  g.setIndex(new THREE.BufferAttribute(idx,1));
  S.DYN_GEO.push(g);
  const m = new THREE.Mesh(g, mat);
  S.scene.add(m);
  staticDone(m, true, true);
  return m;
}

let RS = []; // s-vzorky posledneho routeSamplesFlat (indexovo zhodné s bodmi)

export function routeSamplesFlat(s0, s1, step){
  const pts = [];
  RS = [];
  const i0 = Math.max(0, Math.floor(s0/S.routeLen*S.ROUTE_N));
  const i1 = Math.min(S.ROUTE_N, Math.ceil(s1/S.routeLen*S.ROUTE_N));
  for(let i=i0;i<=i1;i+=step){ pts.push(S.routeX[i], S.routeZ[i]); RS.push(i*S.routeLen/S.ROUTE_N); }
  if(pts.length < 4){ pts.push(S.routeX[i1], S.routeZ[i1]); RS.push(i1*S.routeLen/S.ROUTE_N); }
  return pts;
}

export function routeDeckY(x, z, s){
  const t = getTerrainHeight(x, z)+0.15;
  const b = deckBlend(s);
  return b > 0 ? t+(S.DECK_Y-t)*b : t;
}

export function buildRoads(){
  const roadY = function(x, z){ return getTerrainHeight(x, z)+0.15; }; // vozovka kopíruje terén
  const lineY = function(x, z){ return getTerrainHeight(x, z)+0.20; };
  // Nájazdy mosta sa kreslia presne po fyzike (terén -> DECK_Y), žiadne skoky.
  const rY = function(x, z, s){ return routeDeckY(x, z, s); };
  const lY = function(x, z, s){ return routeDeckY(x, z, s)+0.05; };
  const pre = routeSamplesFlat(0, S.bridgeS0-2, 4); const preS = RS;
  const post = routeSamplesFlat(S.bridgeS1+2, S.routeLen, 4); const postS = RS;
  buildStrip(pre, S.ROAD_HW, rY, S.MAT.routeAsphalt, 0, preS);   // vozovka 7 m (bias proti miestnym cestám)
  buildStrip(pre, 0.15, lY, S.MAT.white, 0, preS);             // stredová čiara
  buildStrip(post, S.ROAD_HW, rY, S.MAT.routeAsphalt, 0, postS);
  buildStrip(post, 0.15, lY, S.MAT.white, 0, postS);
  const deck = routeSamplesFlat(S.bridgeS0-2, S.bridgeS1+2, 2);
  buildStrip(deck, 4.5, S.DECK_Y, S.MAT.bridge);          // mostovka 9 m, tmavý asfalt
  buildStrip(deck, 0.45, S.DECK_Y+0.03, S.MAT.cycle, 2.85); // červené cyklopruhy
  buildStrip(deck, 0.45, S.DECK_Y+0.03, S.MAT.cycle, -2.85);
  buildStrip(deck, 0.5, S.DECK_Y+0.06, S.MAT.sidewalk, 3.8); // svetlé chodníky
  buildStrip(deck, 0.5, S.DECK_Y+0.06, S.MAT.sidewalk, -3.8);
  // zábradlá sprevádzajú aj nájazdy (y0 = terén, y1 = vozovka + 1 m)
  const rail = routeSamplesFlat(S.bridgeS0-S.RAMP_LEN, S.bridgeS1+S.RAMP_LEN, 2); const railS = RS;
  const railTop = function(x, z, s){ return routeDeckY(x, z, s)+1.0; };
  buildWall(rail, 4.35, rY, railTop, S.MAT.rail, railS);  // modré zábradlá
  buildWall(rail, -4.35, rY, railTop, S.MAT.rail, railS);
  // piliere POD mostovkou až na dno koryta Váhu (dno z OSM koryta)
  for(let k=0;k<5;k++){
    const s = S.bridgeS0 + (S.bridgeS1-S.bridgeS0)*(0.12 + k*0.19);
    routePose(s, S._v1, S._hWrap, 0);
    const bot = riverBedY(S._v1.x, S._v1.z)-1.2;
    putBox(S.MAT.pillar, 7, S.DECK_Y-bot, 3, S._v1.x, (S.DECK_Y+bot)/2, S._v1.z, S._hWrap.v);
  }
  const esc = routeSamplesFlat(S.routeLen-14, S.routeLen-4, 1); // úniková brána
  buildStrip(esc, 4, function(x, z){ return getTerrainHeight(x, z)+0.21; }, S.MAT.escape);
  buildTownRoads(); // celá sieť (ramená kryje priamo)
}

const RGRID = { cs:10, nx:0, nz:0, head:null, next:null };

const RPTS = { a:null };

export function buildTownRoads(){
  // koridor = polovica šírky trasy: pod mission asfaltom už užiaden zvyšok starej cesty
  const CUT = S.ROAD_HW;
  mergedStrips(S.osm.roads, function(x, z){ return getTerrainHeight(x, z)+0.15; }, S.MAT.asphalt, 0, CUT);
  mergedStrips(S.osm.dirt, function(x, z){ return getTerrainHeight(x, z)+0.13; }, S.MAT.dirt, 0, CUT);
  const all = S.osm.roads.concat(S.osm.dirt);
  const alinks = S.osm.links;
  for(let li=0;li<all.length;li++){
    const L = all[li], n = (L.length-1)/2;
    if(n < 2) continue; // v dátach sa nevyskytuje (indexy musia sedieť s links)
    const pts = new Float32Array(n*2), cum = new Float32Array(n);
    let dist = 0;
    for(let i=0;i<n;i++){
      pts[i*2] = L[1+i*2]; pts[i*2+1] = L[1+i*2+1];
      if(i>0) dist += Math.hypot(pts[i*2]-pts[i*2-2], pts[i*2+1]-pts[i*2-1]);
      cum[i] = dist;
    }
    S.townRoads.push({ pts:pts, cum:cum, len:dist, n:n, hw:L[0],
      l0: alinks[li] ? alinks[li][0] : [], l1: alinks[li] ? alinks[li][1] : [] });
  }
  // vzorky každého povrchu do mriežky (trasa + mesto + okruhy kruháčov)
  // POZOR: interpolácia po 3 m pozdĺž segmentov (vrcholy OSM sú riedke!)
  const samples = [];
  for(let i=0;i<=S.ROUTE_N;i+=2){ samples.push(S.routeX[i], S.routeZ[i]); }
  for(let li=0;li<all.length;li++){
    const L = all[li], n = (L.length-1)/2;
    for(let i=1;i<n;i++){
      const ax = L[1+(i-1)*2], az = L[1+(i-1)*2+1];
      const bx = L[1+i*2], bz = L[1+i*2+1];
      const segL = Math.sqrt((bx-ax)*(bx-ax)+(bz-az)*(bz-az));
      const steps = Math.max(1, Math.round(segL/3));
      for(let k=(i===1?0:1);k<=steps;k++){
        samples.push(ax+(bx-ax)*k/steps, az+(bz-az)*k/steps);
      }
    }
  }
  const rbs = S.osm.rounds;
  for(let r=0;r<rbs.length;r++){
    for(let a=0;a<24;a++){
      const t = a/24*Math.PI*2;
      samples.push(rbs[r][0]+Math.cos(t)*rbs[r][2], rbs[r][1]+Math.sin(t)*rbs[r][2]);
    }
  }
  const ns = samples.length/2;
  RPTS.a = new Float32Array(samples);
  RGRID.nx = Math.ceil((S.GB.x1-S.GB.x0)/RGRID.cs);
  RGRID.nz = Math.ceil((S.GB.z1-S.GB.z0)/RGRID.cs);
  RGRID.head = new Int32Array(RGRID.nx*RGRID.nz).fill(-1);
  RGRID.next = new Int32Array(ns);
  for(let i=0;i<ns;i++){ gridAdd(RGRID, RPTS.a[i*2], RPTS.a[i*2+1], i); }
}

export function roadDist2(x, z){
  const n = gridQuery(RGRID, x, z, 1);
  let best = 1e18;
  for(let i=0;i<n;i++){
    const id = S.GQ[i];
    const dx = RPTS.a[id*2]-x, dz = RPTS.a[id*2+1]-z;
    const d = dx*dx+dz*dz;
    if(d < best) best = d;
  }
  return best;
}

export function buildRoundabouts(){
  const numerals = ["I", "II", "III", "IV"];
  const order = [];
  for(let i=0;i<S.osm.roundabouts.length;i++){ order.push([S.osm.roundabouts[i][3], i]); }
  order.sort(function(a,b){ return a[0]-b[0]; });
  const rank = [];
  for(let k=0;k<order.length;k++){ rank[order[k][1]] = k; }
  // okruhy + ostrovčeky VŠETKÝCH kruháčov mesta
  const all = S.osm.rounds;
  for(let i=0;i<all.length;i++){
    const ring = new THREE.RingGeometry(all[i][2]-3, all[i][2]+3, 56);
    ring.rotateX(-Math.PI/2);
    S.DYN_GEO.push(ring);
    const rgy = getTerrainHeight(all[i][0], all[i][1]);
    const rp = ring.attributes.position;
    for(let v=0;v<rp.count;v++){
      rp.setY(v, meshSample(all[i][0]+rp.getX(v), all[i][1]+rp.getZ(v))-rgy);
    }
    ring.computeVertexNormals(); // správne PBR svetlo na sklopenom okruhu
    // UV okruhu v METROCH (RingGeometry dáva 0..1 cez celý obdĺžnik, takže pri
    // tilingu 1/4 by sa asfalt roztiahol na 40 m dlhú dlažbu). Radiálne aj
    // obvodovo od stredu v centroch - mriežka asfaltu na kruháči je tak v
    // rovnakom meradle ako na vozovkách.
    const ru = ring.attributes.uv, rpp = ring.attributes.position;
    for(let v=0;v<ru.count;v++) ru.setXY(v, rpp.getX(v), rpp.getZ(v));
    ru.needsUpdate = true;
    const m = new THREE.Mesh(ring, S.MAT.asphalt);
    m.position.set(all[i][0], rgy+0.16, all[i][1]);
    S.scene.add(m);
    staticDone(m, false, true);
    const isl = new THREE.Mesh(S.GEO.cyl, S.MAT.island);
    isl.scale.set((all[i][2]-3)*2, 0.5, (all[i][2]-3)*2);
    // Raycaster zhora nadol: ostrovček presne na terén
    isl.position.set(all[i][0], groundRayY(all[i][0], all[i][1], rgy)+0.25, all[i][1]);
    S.scene.add(isl);
    staticDone(isl, true, true);
  }
  // pamätník stojacej kolóny na jednotke (prvý v smere úniku)
  const r0 = S.osm.roundabouts[order[0][1]];
  const mgy = groundRayY(r0[0], r0[1], getTerrainHeight(r0[0], r0[1])); // Raycaster kotva
  const mon = new THREE.Mesh(S.GEO.cone, S.MAT.concrete);
  mon.scale.set(3, 5, 3);
  mon.position.set(r0[0], mgy+3.0, r0[1]);
  S.scene.add(mon);
  staticDone(mon, true, true);
  const ball = new THREE.Mesh(S.GEO.box, S.MAT.brakeOn);
  ball.scale.set(0.8,0.8,0.8);
  ball.position.set(r0[0], mgy+5.8, r0[1]);
  S.scene.add(ball);
  staticDone(ball, false, false);
  for(let i=0;i<S.osm.roundabouts.length;i++){
    const r = S.osm.roundabouts[i];
    regLabel("KRUHÁČ " + (numerals[rank[i]] || "?"), 0.9, r[0], getTerrainHeight(r[0], r[1])+9.5, r[1], true);
  }
}

export function buildRails(){
  // štrk + koľaje + železničné mosty ponad vodu
  const rl = S.osm.rails;
  if(rl && rl.length){
    const ball = [], tops = [];
    for(let i=0;i<rl.length;i++){ ball.push([2].concat(rl[i])); tops.push([0.8].concat(rl[i])); }
    mergedStrips(ball, function(x, z){ return getTerrainHeight(x, z)+0.12; }, S.MAT.ballast);
    mergedStrips(tops, function(x, z){ return getTerrainHeight(x, z)+0.17; }, S.MAT.dark);
  }
  const rb = S.osm.rbridges;
  if(rb){
    for(let i=0;i<rb.length;i++){
      putBox(S.MAT.concrete, 6, 2.5, rb[i][3]+8, rb[i][0], -1.0, rb[i][1], rb[i][2]);
    }
  }
}

export function pointInRing(px, pz, ring, mar){
  const n = ring.length/2;
  if(n < 3) return false;
  const m2 = mar*mar;
  let inside = false;
  for(let i=0, j=n-1;i<n;j=i++){
    const ax = ring[i*2], az = ring[i*2+1], bx = ring[j*2], bz = ring[j*2+1];
    // vzdialenosť bodu od úsečky AB
    const ex = bx-ax, ez = bz-az;
    const t = Math.max(0, Math.min(1, ((px-ax)*ex+(pz-az)*ez)/(ex*ex+ez*ez || 1)));
    const dx = px-(ax+ex*t), dz = pz-(az+ez*t);
    if(dx*dx+dz*dz <= m2) return true;
    if(((az > pz) !== (bz > pz)) && (px < (bx-ax)*(pz-az)/(bz-az)+ax)) inside = !inside;
  }
  return inside;
}

export function buildGreens(){
  // parky + cintoríny: fľaky + tabule (mimo korýt vôd, mimo Námestia)
  const gs = S.osm.greens;
  if(!gs) return;
  let sqX = -1165, sqZ = -644; // fallback: Námestie sv. Michala
  const tl = S.osm.tlabels;
  for(let ti=0;ti<tl.length;ti++){
    if(tl[ti][2].indexOf("Námestie") === 0){ sqX = tl[ti][0]; sqZ = tl[ti][1]; break; }
  }
  const wl = S.osm.water;
  const CELL = 16;      // hrana podmriežky: jemnejšie = plynulejší svah
  const LIFT = 0.06;    // nad terénom, aby neblikalo
  for(let i=0;i<gs.length;i++){
    const g = gs[i], ring = g[5], flag = g[6]|0;
    if(!ring || ring.length < 6) continue;
    if(flag & 1) continue;   // súkromné obytné záhrady (access=private) sa nekreslia
    // voda: preskočiť len keď koryto rieky (os vody) pretína SAMOTNÝ obrys parku,
    // nie keď je park blízko brehu - inak by zmizol aj cintorín pri brehu Váhu
    let wet = false;
    for(let wI=0;wI<wl.length && !wet;wI++){
      const L = wl[wI];
      for(let k=1;k+1<L.length && !wet;k+=2){
        if(pointInRing(L[k], L[k+1], ring, 0)) wet = true;
      }
    }
    if(wet) continue;
    // trávniky na Námestí: celé zmazané (levitovali nad dláždeným námestím)
    const sdx = g[0]-sqX, sdz = g[1]-sqZ;
    if(sdx*sdx+sdz*sdz < 150*150) continue;
    // 1) triangulácia skutočného obrysu (ShapeUtils = earcut, drží aj vykrojené plochy)
    const cont = [];
    for(let k=0;k<ring.length;k+=2) cont.push(new THREE.Vector2(ring[k], ring[k+1]));
    let tris = [];
    try{ tris = THREE.ShapeUtils.triangulateShape(cont, []) || []; }
    catch(e){ tris = []; }
    if(tris.length && tris[0].length === undefined){   // staršie three vracalo plochý zoznam
      const f = [];
      for(let k=0;k+2<tris.length;k+=3) f.push([tris[k], tris[k+1], tris[k+2]]);
      tris = f;
    }
    // 2) delenie na trojuholníky s hranou <= CELL, každý vrchol zavesený na terén
    const pos = [], idx = [], vmap = new Map();
    const vtx = (x, z) => {
      const kk = ((x*8)|0)+'|'+((z*8)|0);   // 12.5 cm raster: spoločné vrcholy sa spoja
      let id = vmap.get(kk);
      if(id === undefined){
        id = pos.length/3;
        vmap.set(kk, id);
        pos.push(x, getTerrainHeight(x, z)+LIFT, z);
      }
      return id;
    };
    for(let t=0;t<tris.length;t++){
      const A = cont[tris[t][0]], B = cont[tris[t][1]], C = cont[tris[t][2]];
      if(!A || !B || !C) continue;
      const stack = [[A.x, A.y, B.x, B.y, C.x, C.y]];
      let guard = 0;
      while(stack.length && guard++ < 100000){
        const q = stack.pop();
        const ax=q[0], az=q[1], bx=q[2], bz=q[3], cx=q[4], cz=q[5];
        const m = Math.max(Math.hypot(bx-ax,bz-az), Math.hypot(cx-bx,cz-bz), Math.hypot(ax-cx,az-cz));
        if(m > CELL){   // delenie na 4 podtroj.
          const mx=(ax+bx)/2, mz=(az+bz)/2, nx=(bx+cx)/2, nz=(bz+cz)/2, ox=(cx+ax)/2, oz=(cz+az)/2;
          stack.push([ax,az,mx,mz,ox,oz], [mx,mz,bx,bz,nx,nz], [ox,oz,nx,nz,cx,cz], [mx,mz,nx,nz,ox,oz]);
        }else{
          const i0 = vtx(ax,az), i1 = vtx(bx,bz), i2 = vtx(cx,cz);
          if(i0 !== i1 && i1 !== i2 && i0 !== i2) idx.push(i0, i1, i2);
        }
      }
    }
    if(idx.length){
      // poradie vrcholov: 2D kontúra v rovine (x,z) dáva normálu dole - otočiť, nech
      // plocha svieti zhora a nepodlieha zadným stenám
      let a2 = 0;
      for(let t=0;t<idx.length;t+=3){
        const a = idx[t]*3, b = idx[t+1]*3, c = idx[t+2]*3;
        a2 += (pos[b]-pos[a])*(pos[c+2]-pos[a+2]) - (pos[b+2]-pos[a+2])*(pos[c]-pos[a]);
      }
      if(a2 > 0){
        for(let t=0;t<idx.length;t+=3){ const s = idx[t+1]; idx[t+1] = idx[t+2]; idx[t+2] = s; }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, S.MAT.park);
      S.scene.add(staticDone(mesh, false, true));
    }
    if(g[4]){
      const pgy = getTerrainHeight(g[0], g[1]);
      const lbl = makeLabel(g[4], 0.8);
      lbl.position.set(g[0], pgy+8, g[1]);
      S.scene.add(lbl);
      lbl.updateMatrix(); lbl.matrixAutoUpdate = false;
    }
  }
}

export function buildCemetery(){
  let cx = -583, cz = -266, hw = 180, hl = 166;
  const gs = S.osm.greens;
  for(let gi=0;gi<gs.length;gi++){
    if(gs[gi][4] && gs[gi][4].indexOf("Cintor") === 0){ cx = gs[gi][0]; cz = gs[gi][1]; hw = gs[gi][2]/2; hl = gs[gi][3]/2; break; }
  }
  let seed = 424242;
  function rnd(){ seed = (seed*1103515245 + 12345) & 0x7fffffff; return seed/0x7fffffff; }
  const crossV = [], crossH = [], posts = [];
  for(let gx=0;gx<8;gx++){
    for(let gz=0;gz<6;gz++){
      const x = cx-hw+40+gx*((hw*2-80)/7)+(rnd()-0.5)*8;
      const z = cz-hl+40+gz*((hl*2-80)/5)+(rnd()-0.5)*8;
      if(roadDist2(x, z) < 40) continue;
      const gy = getTerrainHeight(x, z);
      const s = 0.9+rnd()*0.4;
      crossV.push([x, gy+0.55*s, z, 0.25, 1.1*s, 0.25, rnd()*3.14]);
      crossH.push([x, gy+0.75*s, z, 0.7, 0.18, 0.18, 0]);
    }
  }
  const per = 2*(hw*2+hl*2);
  const nP = Math.floor(per/8);
  for(let pi=0;pi<nP;pi++){
    const t = pi/nP*per;
    const w2 = hw*2, h2 = hl*2;
    let x, z;
    if(t < w2){ x = cx-hw+t; z = cz-hl; }
    else if(t < w2+h2){ x = cx+hw; z = cz-hl+(t-w2); }
    else if(t < 2*w2+h2){ x = cx+hw-(t-w2-h2); z = cz+hl; }
    else { x = cx-hw; z = cz+hl-(t-2*w2-h2); }
    x = Math.max(cx-hw+3, Math.min(cx+hw-3, x));
    z = Math.max(cz-hl+3, Math.min(cz+hl-3, z));
    posts.push([x, getTerrainHeight(x, z)+0.55, z, 0.3, 1.1, 0.3, 0]);
  }
  if(crossV.length) mergedBoxes(crossV, S.MAT.concrete, S.GEO.box);
  if(crossH.length) mergedBoxes(crossH, S.MAT.concrete, S.GEO.box);
  if(posts.length) mergedBoxes(posts, S.MAT.concrete, S.GEO.box);
}

export function buildRoute(){
  const flat = S.osm.route;
  const n = flat.length/2;
  const pts = [];
  for(let i=0;i<n;i++){ pts.push(new THREE.Vector3(flat[2*i], 0, flat[2*i+1])); }
  // centripetalná parametrizácia: žiadne slučky/špičky v zákrutách
  const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
  S.routeLen = curve.getLength();
  const spaced = curve.getSpacedPoints(S.ROUTE_N);
  for(let i=0;i<=S.ROUTE_N;i++){
    S.routeX[i] = spaced[i].x;
    S.routeZ[i] = spaced[i].z;
  }
  for(let i=0;i<=S.ROUTE_N;i++){
    const a = Math.max(0, i-1), b = Math.min(S.ROUTE_N, i+1);
    S.routeH[i] = Math.atan2(S.routeX[b]-S.routeX[a], S.routeZ[b]-S.routeZ[a]);
  }
  // rozbal uhly do spojitej vetvy + kĺzavý priemer: riadenie bez trhnutí
  // (pozície ostávajú presne na krivke, vyhladzuje sa len kurz áut)
  let prev = S.routeH[0];
  const uw = new Float64Array(S.ROUTE_N+1);
  uw[0] = prev;
  for(let i=1;i<=S.ROUTE_N;i++){
    let d = S.routeH[i]-prev;
    if(d > Math.PI) d -= Math.PI*2; else if(d < -Math.PI) d += Math.PI*2;
    prev += d; uw[i] = prev;
  }
  for(let i=0;i<=S.ROUTE_N;i++){
    let s = 0, c = 0;
    for(let j=Math.max(0,i-4);j<=Math.min(S.ROUTE_N,i+4);j++){ s += uw[j]; c++; }
    S.routeH[i] = s/c;
  }
  // preškáluj OSM staničenia na dĺžku vyhladenej krivky
  const k = S.routeLen / S.osm.length;
  S.bridgeS0 = S.osm.bridge[0]*k; S.bridgeS1 = S.osm.bridge[1]*k;
  S.bridgeLen = S.osm.bridge[2];
  S.roundS.length = 0;
  for(let i=0;i<S.osm.roundabouts.length;i++){ S.roundS.push(S.osm.roundabouts[i][3]*k); }
  S.streetS.length = 0;
  for(let i=0;i<S.osm.streets.length;i++){
    const st = S.osm.streets[i];
    S.streetS.push([st[0]*k, st[1]*k, st[2]]);
  }
}

export function routePose(s, out, outH, lat){
  let f = (s / S.routeLen) * S.ROUTE_N;
  if(f < 0) f = 0;
  if(f > S.ROUTE_N - 1) f = S.ROUTE_N - 1;
  const i = Math.floor(f), t = f - i;
  const cx = S.routeX[i] + (S.routeX[i+1]-S.routeX[i])*t;
  const cz = S.routeZ[i] + (S.routeZ[i+1]-S.routeZ[i])*t;
  let d = S.routeH[i+1]-S.routeH[i];
  if(d > Math.PI) d -= Math.PI*2; else if(d < -Math.PI) d += Math.PI*2;
  const h = S.routeH[i] + d*t;
  const L = lat || 0;
  out.set(cx + (-Math.cos(h))*L, 0, cz + (Math.sin(h))*L);
  outH.v = h;
  return h;
}
