// src/world/buildings.js — OSM budovy, veža sv. Michala, fotofasády (verbatim port, js 5876–6440).
import * as THREE from 'three';
import { S } from './shared.js';
import { routePose } from './roads.js';
import { regLabel } from './labels.js';
import { getTerrainHeight } from './height.js';
import { groundRayY, staticDone } from './ground.js';
export const SEG = { map:null };
// Široká mriežka: jedna budova patrí do VIACERÝCH buniek ( až 240 ), takže na
// jednu budovicu nestačí jeden slot v `next` - predchádzajúca implementácia
// ho prepisovala pri každej bunke a spojový zoznam sa rozpadol. Teraz je
// slotu (uzlu) jeden na VKLADANIE (bunky,budovy); `nid[uzol]` = index budovy.
export function gridAddRect(x, z, hw, hl, c, s, id){
  const ex = Math.abs(hw*c)+Math.abs(hl*s), ez = Math.abs(hw*s)+Math.abs(hl*c);
  let x0 = Math.floor((x-ex-S.GB.x0)/S.BGRID.cs), x1 = Math.floor((x+ex-S.GB.x0)/S.BGRID.cs);
  let z0 = Math.floor((z-ez-S.GB.z0)/S.BGRID.cs), z1 = Math.floor((z+ez-S.GB.z0)/S.BGRID.cs);
  if(x0<0)x0=0; if(z0<0)z0=0;
  if(x1>=S.BGRID.nx)x1=S.BGRID.nx-1; if(z1>=S.BGRID.nz)z1=S.BGRID.nz-1;
  const next = S.BGRID.next, nid = S.BGRID.nid;
  for(let cx=x0;cx<=x1;cx++){ for(let cz=z0;cz<=z1;cz++){
    const cc = cz*S.BGRID.nx+cx;
    const node = S.BGRID.nn++;
    nid[node] = id;
    next[node] = S.BGRID.head[cc];
    S.BGRID.head[cc] = node;
  }}
}
// segmentová mriežka ciest pre EXAKTNÝ filter budov (LEN v init, alokácie OK)
export function buildSegGrid(){
  SEG.map = new Map();
  function key(cx,cz){ return (cx+500)*1000 + (cz+500); }
  function addSeg(ax,az,bx,bz,hw,mj){
    const x0 = Math.min(ax,bx)-4, x1 = Math.max(ax,bx)+4;
    const z0 = Math.min(az,bz)-4, z1 = Math.max(az,bz)+4;
    for(let cx=Math.floor((x0-S.GB.x0)/20); cx<=Math.floor((x1-S.GB.x0)/20); cx++){
      for(let cz=Math.floor((z0-S.GB.z0)/20); cz<=Math.floor((z1-S.GB.z0)/20); cz++){
        const k = key(cx,cz);
        let a = SEG.map.get(k);
        if(!a){ a = []; SEG.map.set(k, a); }
        a.push(ax,az,bx,bz,hw,mj);
      }
    }
  }
  for(let li=0;li<S.townRoads.length;li++){
    const R = S.townRoads[li];
    for(let i=1;i<R.n;i++){
      addSeg(R.pts[i*2-2], R.pts[i*2-1], R.pts[i*2], R.pts[i*2+1], R.hw, R.hw >= 2.5 ? 1 : 0);
    }
  }
  for(let i=2;i<=S.ROUTE_N;i+=2){
    addSeg(S.routeX[i-2], S.routeZ[i-2], S.routeX[i], S.routeZ[i], S.ROAD_HW, 1);
  }
  const rbs = S.osm.rounds;
  for(let r=0;r<rbs.length;r++){
    for(let a=0;a<24;a++){
      const t0 = a/24*6.2832, t1 = (a+1)/24*6.2832;
      addSeg(rbs[r][0]+Math.cos(t0)*rbs[r][2], rbs[r][1]+Math.sin(t0)*rbs[r][2],
             rbs[r][0]+Math.cos(t1)*rbs[r][2], rbs[r][1]+Math.sin(t1)*rbs[r][2], 3, 1);
    }
  }
}
// ---------- PRESNÝ TEST "BUDOVA NA VOZOVKE" ----------
// Pôvodný filter skústal LEN stred + 4 rohy OBB (orientovaného obdĺžnika
// footprintu). To je nesprávne z dvoch dôvodov:
//   1) rotácia do sveta mala prehodené znamienka, takže testované body neboli
//      rohy OBB, ale akýsi zrkadlový/otočený útvar - pre 2599 z 2600 budov
//      s nenulovou rotáciou boli "rohy" mimo obdĺžnika;
//   2) aj pri opravenej rotácii je OBB pre L-tvaré, U-tvaré a zložité
//      budovy väčší než skutočný obrys, takže roh OBB leží na ceste, kým
//      samotná budova má 3 m voľnosti.
// Výsledok: 258 budov zmizlo, hoci ich obrys sa cesty ani nedotýkal.
// Teraz testujeme SKUTOČNÝ obrys: kažú hranu proti každému segmentu cesty.
// Keďže cesta vstúpi dovnútra budovy, musí pretnúť niektorú jej hranu,
// takže test hrán (a tým aj vrcholov) stačí a je presný.
function ptSegD2(px, pz, ax, az, bx, bz){
  const dx = bx-ax, dz = bz-az;
  const L2 = dx*dx+dz*dz;
  let t = L2 > 0 ? ((px-ax)*dx+(pz-az)*dz)/L2 : 0;
  if(t < 0) t = 0; else if(t > 1) t = 1;
  const ex = px-(ax+dx*t), ez = pz-(az+dz*t);
  return ex*ex+ez*ez;
}
// vzdialenosť úsečiek (priesečník alebo najbližší koncový bod)
function segSegD2(ax,az,bx,bz,cx,cz,dx2,dz2){
  const d1x=bx-ax, d1z=bz-az, d2x=dx2-cx, d2z=dz2-cz;
  const den = d1x*d2z-d1z*d2x;
  if(den !== 0){
    const t = ((cx-ax)*d2z-(cz-az)*d2x)/den;
    if(t >= 0 && t <= 1){
      const u = ((cx-ax)*d1z-(cz-az)*d1x)/den;
      if(u >= 0 && u <= 1) return 0;   // pretínajú sa
    }
  }
  return Math.min(ptSegD2(ax,az,cx,cz,dx2,dz2), ptSegD2(bx,bz,cx,cz,dx2,dz2),
                  ptSegD2(cx,cz,ax,az,bx,bz), ptSegD2(dx2,dz2,ax,az,bx,bz));
}
// fp = plochý [x,z,...] obrys; hlavné cesty s rezervou 1.5 m, dvorové len hlboké prieniky
export function bldOnRoad(fp){
  const n = fp.length/2;
  if(n < 3) return false;
  let x0 = 1e18, x1 = -1e18, z0 = 1e18, z1 = -1e18;
  for(let p=0;p<n;p++){
    const px = fp[p*2], pz = fp[p*2+1];
    if(px<x0)x0=px; if(px>x1)x1=px; if(pz<z0)z0=pz; if(pz>z1)z1=pz;
  }
  const cx0 = Math.floor((x0-S.GB.x0)/20), cx1 = Math.floor((x1-S.GB.x0)/20);
  const cz0 = Math.floor((z0-S.GB.z0)/20), cz1 = Math.floor((z1-S.GB.z0)/20);
  for(let cx=cx0;cx<=cx1;cx++){
    for(let cz=cz0;cz<=cz1;cz++){
      const a = SEG.map.get((cx+500)*1000 + (cz+500));
      if(!a) continue;
      for(let s=0;s<a.length;s+=6){
        const lim = a[s+4] + (a[s+5] ? 1.5 : -1.0);
        const lim2 = lim*lim;
        const sax=a[s], saz=a[s+1], sbx=a[s+2], sbz=a[s+3];
        for(let p=0;p<n;p++){
          const ax = fp[p*2], az = fp[p*2+1];
          const q = p+1 < n ? p+1 : 0;
          if(segSegD2(ax,az,fp[q*2],fp[q*2+1],sax,saz,sbx,sbz) < lim2) return true;
        }
      }
    }
  }
  return false;
}
// prekopíruj jednu skupinu (0=vieká, 1=steny) extrúzie do chunkových polí
// (ExtrudeGeometry je neindexovaná: vrcholy idú sekvenčne)
// baseY = päta budovy: steny do 1.8 m nad terénom dostanú kontaktné stmavenie (AO),
// aby budovy prirodzene "sedeli" na teréne a neviseli vo vzduchu.
export function pushGeo(dst, g, grp, cr, cg, cb, baseY){
  const pos = g.attributes.position.array;
  const nor = g.attributes.normal.array;
  const uv = g.attributes.uv.array;
  const gr = g.groups[grp];
  const base = dst.v;
  const ao = (baseY !== undefined);
  for(let i=0;i<gr.count;i++){
    const vi = gr.start+i;
    const vy = pos[vi*3+1];
    dst.p.push(pos[vi*3], vy, pos[vi*3+2]);
    dst.n.push(nor[vi*3], nor[vi*3+1], nor[vi*3+2]);
    dst.u.push(uv[vi*2], uv[vi*2+1]);
    if(ao){
      let t = (vy-baseY)/1.8; // 0 pri päte -> 1 vo výške 1.8 m
      if(t < 0) t = 0; else if(t > 1) t = 1;
      const f = 0.55+0.45*t; // spodok 55 % jasu = kontaktný tieň
      dst.c.push(cr*f, cg*f, cb*f);
    } else {
      dst.c.push(cr, cg, cb);
    }
    dst.i.push(base + i);
  }
  dst.v += gr.count;
}
export function finishGeo(dst){
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(dst.p),3));
  g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(dst.n),3));
  g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(dst.u),2));
  g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(dst.c),3));
  g.setIndex(dst.i);
  S.DYN_GEO.push(g);
  return g;
}
// zóny budov podľa OSM tagov: 0 domy, 1 paneláky, 2 priemysel, 3 historické, 4 obchody, 5 technické
export function bldZone(tag, area){
  if(tag === "apartments") return 1;
  if(tag === "industrial" || tag === "warehouse") return 2;
  if(tag === "church") return 3;
  if(tag === "retail" || tag === "commercial" || tag === "office" || tag === "school" ||
     tag === "hospital" || tag === "kindergarten" || tag === "government") return 4;
  if(tag === "detached" || tag === "house") return 0;
  if(tag === "service" || tag === "roof" || tag === "greenhouse" || tag === "guardhouse" ||
     tag === "parking" || tag === "sports_centre" || tag === "train_station") return 5;
  if(area >= 1200) return 2; // veľký neoznačený kváder = hala
  return 0;
}
export const ZWALL = [
  [0xf2ebe1, 0xf5e3bc, 0xf0c8a0, 0xe6d7c3], // A domy: krémová, žltkastá, svetlooranžová, béžová
  [0xf2f2ee, 0xf5e3bc, 0xd4e0e8, 0xd8d3c8], // B paneláky: svetlosivá, bielo-žltá, bledomodrá, sivobéžová
  [0xa0a8b0, 0xbcc3cb], // C priemysel: strieborný plech + betónové panely
  [0xd9cebe, 0xcfc4ae], // D historické: kameň / historická omietka
  [0xd8dce0, 0xcfd4d8], // C obchody: svetlosivý plech
  [0xb9bec5]
];
export const ZROOF = [
  [0xc85a32, 0xb84725, 0xd96b43], // A šikmá terakotová škridla
  [0x5a5d64, 0x484b50, 0x6b6e75], // B plochá štrková/asfaltová
  [0xd3d8de, 0xa8b2bc], // C plochá svetlosivá
  [0x6e4a33, 0x54402e], // D tmavá historická
  [0xb9bec5, 0xd3d8de], // C plochá obchodná
  [0xa8b2bc]
];
export function hx3(c){ return [((c>>16)&255)/255, ((c>>8)&255)/255, (c&255)/255]; }
// ---------- ČISTÉ PBR FASÁDY (bez foto-textúr) ----------
// Načítavanie obrázkov zo zložky assets/tex je ZRUŠENÉ: bežné budovy používajú
// výhradne procedurálne CanvasTexture (TEX.winGrid + TEX.winRough + TEX.roofTile
// + TEX.sheet + TEX.gravel). Žiadny TextureLoader, žiadne externé PNG.
export const TEXPHOTOS = [];
export const MAT_PHOTO = [];
export const PHOTO_TINT = [[1,1,1],[0.93,0.93,0.93],[0.86,0.86,0.88]];
export const PHOTO_FILES = [];
export function photoPreload(){
  return Promise.resolve(0); // no-op: všetko je procedurálne, nič sa nenačítava
}
export const PHOTO_SRC = [];
export const CORR_EXCLUDE = {};
export const CORR_POOL = [];
export function photoMatFor(f){
  return -1; // foto-materiály neexistujú (čisté PBR)
}
export const LANDMARKS = [
  { file:null, x:-388, z:-396, r:45 },
  { file:null, x:129, z:119, r:45 },
  { file:null, x:-508, z:-426, r:35, multi:true },
  { file:null, x:-1729, z:168, r:25, forceZone:3 },
  { file:null, x:-1218, z:-624, r:80, zones:[0,3] }
];
export const TOWERS = [[287,82],[313,-965],[260,-1183]];
// Komíny na Manckovičovej (man_made=chimney z OSM): [x, z, výška, typ] — tehla vyšší, betón nižší
export const CHIMNEYS = [[-1702.3,-325.6,48,"concrete"],[-1687.9,-357.5,60,"brick"]];
export const LM_SEEN = [];
export let SNP_PTS = null;
export function nearSNP(x, z){
  if(!SNP_PTS) return false;
  for(let i=0;i<SNP_PTS.length;i+=2){
    const dx = SNP_PTS[i]-x, dz = SNP_PTS[i+1]-z;
    if(dx*dx+dz*dz < 4900) return true;
  }
  return false;
}
export function landmarkTex(k, ki){
  return -1; // čisté PBR: žiadne foto-textúry, vždy procedurálna fasáda kategórie
}
// ---------- VEŽA KOSTOLA sv. MICHALA ----------
// Kostol sv. Michala (OSM tag church) je v mape len garáž. Veža stojí v konci
// lode obrátenom k Námestiu sv. Michala: v orientovanej sústave kostola (os = jeho
// uhol `a`) je to diagonála u=v, takže pätu posunieme o DU/DV. Päta 9x9 m má
// ~5.4 m voľnosti od múzu polygonu (zmerané z OSM obrysu) - nikdy neprečníva.
export const CHURCH_TOWER = { du:-10.45, dv:-10.45 };
export function buildChurchTower(k){
  const ca = Math.cos(k.a), sa = Math.sin(k.a);
  const D = CHURCH_TOWER;
  const tx = k.x + D.du*ca - D.dv*sa, tz = k.z + D.du*sa + D.dv*ca;
  const y0 = k.baseY;                       // presne podložka kostola (rovina flattenu)
  if(!S.MAT.churchStone) S.MAT.churchStone = new THREE.MeshStandardMaterial({ color: 0xd9cebe, roughness: 0.92, metalness: 0.0 });
  if(!S.MAT.churchRoof)  S.MAT.churchRoof  = new THREE.MeshStandardMaterial({ color: 0x3f4650, roughness: 0.6, metalness: 0.25 });
  // zvonica je štvorcová (4 steny), kužeľ otočíme o 45°, aby jeho podstava sedela na rohoch
  const G = {
    plinth: new THREE.BoxGeometry(9.2, 1.8, 9.2),
    shaft:  new THREE.BoxGeometry(9, 21.0, 9),
    corbel: new THREE.BoxGeometry(10.4, 1.3, 10.4),
    belfry: new THREE.BoxGeometry(7.8, 4.2, 7.8),
    ledge:  new THREE.BoxGeometry(8.8, 0.8, 8.8),
    helmet: new THREE.ConeGeometry(5.657, 7.4, 4),
    lantern:new THREE.CylinderGeometry(1.1, 1.25, 2.2, 10),
    ball:   new THREE.SphereGeometry(0.45, 10, 8),
    crossV: new THREE.BoxGeometry(0.26, 2.8, 0.26),
    crossH: new THREE.BoxGeometry(1.6, 0.26, 0.26)
  };
  G.helmet.rotateY(Math.PI/4);
  for(const g in G) S.DYN_GEO.push(G[g]);
  const put = (geo, mat, dy, cast) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(tx, y0+dy, tz);
    m.rotation.y = k.a;
    S.scene.add(m);
    staticDone(m, cast !== false, true);
  };
  put(G.plinth, S.MAT.churchStone,  0.4);   // pätný sokel
  put(G.shaft,  S.MAT.churchStone, 11.8);    // teleso veže 21 m
  put(G.corbel, S.MAT.churchStone, 22.95);   // vola pod zvonicou (malý previs)
  put(G.belfry, S.MAT.churchStone, 25.7);    // zvonica s oknami
  put(G.ledge,  S.MAT.churchRoof,  28.2);    // manžel
  put(G.helmet, S.MAT.churchRoof,  32.3);    // baroková helma
  put(G.lantern,S.MAT.churchRoof,  37.1);    // laterna
  put(G.ball,   S.MAT.churchRoof,  38.55);
  put(G.crossV, S.MAT.churchRoof,  40.3, false);
  put(G.crossH, S.MAT.churchRoof,  40.8, false);
}
export function buildBuildings(){
  buildSegGrid();
  const list = S.osm.blds;
  const rbs = S.osm.rounds;
  const cells = new Map();
  const named = [];
  const kept = [];
  bld: for(let i=0;i<list.length;i++){
    const b = list[i];
    const npt = (b.length-5)/2;
    if(npt < 3) continue;
    // orientovaný bbox z footprintu (najdlhšia hrana = os X)
    let bi = 0, bl = 0;
    for(let k=0;k<npt;k++){
      const ax = b[5+k*2], az = b[5+k*2+1];
      const qx = b[5+((k+1)%npt)*2], qz = b[5+((k+1)%npt)*2+1];
      const L = Math.sqrt((qx-ax)*(qx-ax)+(qz-az)*(qz-az));
      if(L > bl){ bl = L; bi = k; }
    }
    const ex = b[5+((bi+1)%npt)*2]-b[5+bi*2], ez = b[5+((bi+1)%npt)*2+1]-b[5+bi*2+1];
    const ang = Math.atan2(-ez, ex);
    const c = Math.cos(-ang), s = Math.sin(-ang);
    let mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9;
    for(let k=0;k<npt;k++){
      const rx = (b[5+k*2]-b[0])*c - (b[5+k*2+1]-b[1])*s;
      const rz = (b[5+k*2]-b[0])*s + (b[5+k*2+1]-b[1])*c;
      if(rx < mnx) mnx = rx; if(rx > mxx) mxx = rx;
      if(rz < mnz) mnz = rz; if(rz > mxz) mxz = rz;
    }
    const w = mxx-mnx, d = mxz-mnz;
    if(w < 0.5 || d < 0.5) continue;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const ccx = b[0] + ((mnx+mxx)/2)*ca - ((mnz+mxz)/2)*sa;
    const ccz = b[1] + ((mnx+mxx)/2)*sa + ((mnz+mxz)/2)*ca;
    const hd = Math.sqrt(w*w+d*d)/2;
    let zone = bldZone(b[4], w*d);
    for(let li=0;li<LANDMARKS.length;li++){
      const L = LANDMARKS[li];
      if(L.forceZone === undefined) continue;
      const dx = ccx-L.x, dz = ccz-L.z;
      if(dx*dx+dz*dz < L.r*L.r){ zone = L.forceZone; break; }
    }
    let isLM = false;
    for(let li=0;li<LANDMARKS.length;li++){
      const L = LANDMARKS[li];
      const dx = ccx-L.x, dz = ccz-L.z;
      if(dx*dx+dz*dz < (L.r+hd)*(L.r+hd)){ isLM = true; break; }
    }
    if(!isLM && zone === 1){
      for(let si=0;si<S.streetS.length && !isLM;si++){
        if(S.streetS[si][2].indexOf("povstania") >= 0){
          const s0 = S.streetS[si][0], s1 = Math.min(S.streetS[si][1], s0+450);
          for(let s=s0;s<=s1;s+=15){
            const f = Math.max(0, Math.min(S.ROUTE_N-1, Math.floor(s/S.routeLen*S.ROUTE_N)));
            const dx = ccx-S.routeX[f], dz = ccz-S.routeZ[f];
            if(dx*dx+dz*dz < 4900){ isLM = true; break; }
          }
        }
      }
    }
    // 1) EXAKTNE: obrys budovy nesmie siahať na vozovku (landmarky pri ceste majú výnimku)
    if(!isLM && bldOnRoad(b.slice(5))) continue;
    // 2) mimo plôch kruháčov
    for(let r=0;r<rbs.length;r++){
      const lim = rbs[r][2]+4;
      let hit = false;
      for(let p=0;!hit && p<b.length-5;p+=2){
        const dx = b[5+p]-rbs[r][0], dz = b[5+p+1]-rbs[r][1];
        if(dx*dx+dz*dz < lim*lim) hit = true;
      }
      if(hit) continue bld;
    }
    // 3) mimo korýt vôd (PRESNE: obrys a VŠETKY body osi). Pôvodný krok k+=8
    //    preskakoval 3 zo 4 bodov osi a porovnával len stred budovy, takže
    //    budovy pri brehu Váhu občas prešli.
    const wl = S.osm.water;
    let wet = false;
    for(let wI=0;wI<wl.length && !wet;wI++){
      const L = wl[wI], lim = (L[0]+14)*(L[0]+14);
      for(let k=1;k<L.length && !wet;k+=2){
        const dx0 = L[k], dz0 = L[k+1];
        for(let p=5;p<b.length;p+=2){
          const ddx = b[p]-dx0, ddz = b[p+1]-dz0;
          if(ddx*ddx+ddz*ddz < lim){ wet = true; break; }
        }
      }
    }
    if(wet) continue;
    const bname = (b[3] || "").toLowerCase();
    if(zone !== 3 && (bname.indexOf("muzeum") >= 0 || bname.indexOf("múzeum") >= 0 ||
       bname.indexOf("divadlo") >= 0 || bname.indexOf("zamok") >= 0 || bname.indexOf("zám") >= 0 ||
       bname.indexOf("castle") >= 0)){ zone = 3; } // historické dominanty (zámok, divadlo, múzeum)
    let hh = b[2];
    if(zone === 0) hh = Math.max(3.5, Math.min(8.5, hh));
    else if(zone === 1) hh = Math.max(12, Math.min(30, hh));
    else if(zone === 2) hh = Math.max(5, Math.min(12, hh));
    kept.push({ x:ccx, z:ccz, w:w, d:d, a:ang, h:hh, fp:b, zone:zone });
    if(b[3]) named.push([hh, ccx, ccz, b[3]]);
  }
  for(let ti=0;ti<TOWERS.length;ti++){
    const tx = TOWERS[ti][0], tz = TOWERS[ti][1];
    const tb = getTerrainHeight(tx, tz)-0.5;
    kept.push({ x:tx, z:tz, w:14, d:14, a:0, h:26, zone:5, baseY:tb, skipMesh:true,
      fp:[tx,tz,26,"Vodná veža","tower",tx-7,tz-7,tx+7,tz-7,tx+7,tz+7,tx-7,tz+7] });
  }
  for(let ci=0;ci<CHIMNEYS.length;ci++){
    const cx = CHIMNEYS[ci][0], cz = CHIMNEYS[ci][1], ch = CHIMNEYS[ci][2];
    const cb = getTerrainHeight(cx, cz)-0.5;
    kept.push({ x:cx, z:cz, w:7, d:7, a:0, h:ch, zone:5, baseY:cb, skipMesh:true,
      fp:[cx,cz,ch,"Komín Manckovičova","chimney",cx-3.5,cz-3.5,cx+3.5,cz-3.5,cx+3.5,cz+3.5,cx-3.5,cz+3.5] });
  }
  // domček pri päte komínov (ako na fotke)
  kept.push({ x:-1695.1, z:-341.6, w:12, d:8, a:0.3, h:5, zone:0,
    fp:[-1695.1,-341.6,5,"","hall",-1701.1,-345.6,-1689.1,-345.6,-1689.1,-337.6,-1701.1,-337.6] });
  for(let li=0;li<LANDMARKS.length;li++){
    const L = LANDMARKS[li];
    if(L.multi || L.zones || L.file === null){ LM_SEEN.push(-2); continue; }
    let bi = -1, bd = L.r*L.r;
    for(let i=0;i<kept.length;i++){
      const dx = kept[i].x-L.x, dz = kept[i].z-L.z, d2 = dx*dx+dz*dz;
      if(d2 < bd){ bd = d2; bi = i; }
    }
    LM_SEEN.push(bi);
  }
  SNP_PTS = [];
  for(let si=0;si<S.streetS.length;si++){
    if(S.streetS[si][2].indexOf("povstania") >= 0){
      const s0 = S.streetS[si][0], s1 = Math.min(S.streetS[si][1], s0+450);
      for(let s=s0;s<=s1;s+=15){
        const f = Math.max(0, Math.min(S.ROUTE_N-1, Math.floor(s/S.routeLen*S.ROUTE_N)));
        SNP_PTS.push(S.routeX[f], S.routeZ[f]);
      }
    }
  }
  // chunkované mergnuté extrusie (presný footprint, 250 m bunky)
  for(let i=0;i<kept.length;i++){
    if(kept[i].skipMesh) continue;
    const k = kept[i];
    const sh = new THREE.Shape();
    for(let p=0;p<(k.fp.length-5)/2;p++){
      const lx = k.fp[5+p*2]-k.x, lz = -(k.fp[5+p*2+1]-k.z);
      if(p === 0) sh.moveTo(lx, lz); else sh.lineTo(lx, lz);
    }
    // MIN/MAX terénu pod celým obvodom (stred + rohy + stredy hrán).
    let lo2 = getTerrainHeight(k.x, k.z), hi2 = lo2, cnt = 1;
    const nb2 = (k.fp.length-5)/2;
    for(let p2=0;p2<nb2;p2++){
      const ax = k.fp[5+p2*2], az = k.fp[5+p2*2+1];
      const qx = k.fp[5+((p2+1)%nb2)*2], qz = k.fp[5+((p2+1)%nb2)*2+1];
      const ha = getTerrainHeight(ax, az), hm = getTerrainHeight((ax+qx)/2, (az+qz)/2);
      if(ha < lo2) lo2 = ha; if(hm < lo2) lo2 = hm;
      if(ha > hi2) hi2 = ha; if(hm > hi2) hi2 = hm;
      cnt += 2;
    }
    // ZÁKLAD BUDOVY = najvyšší bod podložia - 0.35 m: budova NIE JE ZARYTÁ DO KOPCA
    // ani nikdy nevisí. Steny kobia o (prevýšenie podložia) hlbšie než je najnižší
    // bod zemského povrchu pod obvodom, takže vznikne len oporná stena (reálny
    // svahový dom) a NIKDY medzera medzi múrom a terénom.
    k.baseY = hi2-0.35;
    const sink = (hi2-lo2)+0.6;
    const g = new THREE.ExtrudeGeometry(sh, { depth:k.h+sink, bevelEnabled:false });
    g.rotateX(-Math.PI/2);
    g.translate(k.x, k.baseY-sink, k.z);
    const uv = g.attributes.uv;
    for(let u=0;u<uv.count;u++){ uv.setXY(u, uv.getX(u)*0.125, uv.getY(u)*0.125); }
    const key = Math.floor((k.x-S.GB.x0)/250)*1000 + Math.floor((k.z-S.GB.z0)/250);
    let ch = cells.get(key);
    // Mergnuté geometrie PER CHUNK PER MATERIÁL (max 6 draw calls / chunk):
    // wHouse/wPanel/wHist/wInd = steny kategórií, rPitch/rFlat = strechy.
    // Distance culling (CHUNKS, 2 Hz) + frustum culling držia FPS na 60 aj pri vysokej dohľadnosti.
    if(!ch){ ch = { items:[],
      wHouse:{p:[],n:[],u:[],c:[],i:[],v:0}, wPanel:{p:[],n:[],u:[],c:[],i:[],v:0},
      wHist:{p:[],n:[],u:[],c:[],i:[],v:0}, wInd:{p:[],n:[],u:[],c:[],i:[],v:0},
      rPitch:{p:[],n:[],u:[],c:[],i:[],v:0}, rFlat:{p:[],n:[],u:[],c:[],i:[],v:0} };
      cells.set(key, ch); }
    ch.items.push({ x:k.x, z:k.z, hd:Math.sqrt(k.w*k.w+k.d*k.d)/2 });
    const wv = hx3(ZWALL[k.zone][(i*7+k.zone)%ZWALL[k.zone].length]);
    const rv = hx3(ZROOF[k.zone][(i*5+k.zone+1)%ZROOF[k.zone].length]);
    // Kat. A domy (0) -> pastel + šikmá škridla; B paneláky (1) -> mriežka + plochá štrková;
    // C priemysel/obchody (2,4) + technické (5) -> vlnitý plech + plochá; D historické (3) -> kameň + tmavá.
    if(k.zone === 0){ pushGeo(ch.wHouse, g, 1, wv[0], wv[1], wv[2], k.baseY); pushGeo(ch.rPitch, g, 0, rv[0], rv[1], rv[2]); }
    else if(k.zone === 1){ pushGeo(ch.wPanel, g, 1, wv[0], wv[1], wv[2], k.baseY); pushGeo(ch.rFlat, g, 0, rv[0], rv[1], rv[2]); }
    else if(k.zone === 3){ pushGeo(ch.wHist, g, 1, wv[0], wv[1], wv[2], k.baseY); pushGeo(ch.rPitch, g, 0, rv[0], rv[1], rv[2]); }
    else { pushGeo(ch.wInd, g, 1, wv[0], wv[1], wv[2], k.baseY); pushGeo(ch.rFlat, g, 0, rv[0], rv[1], rv[2]); }
  }
  // Kostol sv. Michala: veža (sokel + teleso + zvonica + helma + kríž), inak je to len garáž
  for(let i=0;i<kept.length;i++){
    const k = kept[i];
    if(k.skipMesh || !k.fp || k.fp[3] !== "Kostol sv. Michala") continue;
    buildChurchTower(k);   // páta je vnútrí kostolného kolízieho boxu = koliduje automaticky
    break;
  }
  if(!S.MAT.towerSide){
    S.MAT.towerSide = S.MAT.concrete; // čisté PBR: betón, žiadna foto-textúra vodnej veže
  }
  const towerShaft = new THREE.CylinderGeometry(5, 6.5, 20, 12);
  const towerTank = new THREE.SphereGeometry(7, 14, 10);
  S.DYN_GEO.push(towerShaft, towerTank);
  for(let ti=0;ti<TOWERS.length;ti++){
    const tx = TOWERS[ti][0], tz = TOWERS[ti][1];
    const tb = getTerrainHeight(tx, tz)-0.5;
    const sh = new THREE.Mesh(towerShaft, S.MAT.towerSide);
    sh.position.set(tx, tb+10, tz);
    S.scene.add(sh);
    staticDone(sh, true, true);
    const sp = new THREE.Mesh(towerTank, S.MAT.concrete);
    sp.position.set(tx, tb+21.5, tz);
    S.scene.add(sp);
    staticDone(sp, true, true);
    regLabel("VODNÁ VEŽA", 0.8, tx, tb+32, tz, true);
  }
  // Komíny Manckovičova: zužený valec + tmavé ústa + sokel (podľa fotky: tehla vyšší)
  const chimBrick = new THREE.CylinderGeometry(1.7, 2.8, 60, 12);
  const chimConc = new THREE.CylinderGeometry(1.5, 2.4, 48, 12);
  const chimMouthB = new THREE.CylinderGeometry(1.55, 1.55, 0.6, 12);
  const chimMouthC = new THREE.CylinderGeometry(1.35, 1.35, 0.6, 12);
  const chimBase = new THREE.BoxGeometry(7, 3, 7);
  S.DYN_GEO.push(chimBrick, chimConc, chimMouthB, chimMouthC, chimBase);
  for(let ci=0;ci<CHIMNEYS.length;ci++){
    const cx = CHIMNEYS[ci][0], cz = CHIMNEYS[ci][1], ch = CHIMNEYS[ci][2];
    const brick = CHIMNEYS[ci][3] === "brick";
    const cb = getTerrainHeight(cx, cz)-0.5;
    const plinth = new THREE.Mesh(chimBase, brick ? S.MAT.chimneyBrick : S.MAT.chimneyConcrete);
    plinth.position.set(cx, cb+1.5, cz);
    S.scene.add(plinth);
    staticDone(plinth, true, true);
    const shaft = new THREE.Mesh(brick ? chimBrick : chimConc, brick ? S.MAT.chimneyBrick : S.MAT.chimneyConcrete);
    shaft.position.set(cx, cb+ch/2, cz);
    S.scene.add(shaft);
    staticDone(shaft, true, true);
    const mouth = new THREE.Mesh(brick ? chimMouthB : chimMouthC, S.MAT.chimneyDark);
    mouth.position.set(cx, cb+ch+0.1, cz);
    S.scene.add(mouth);
    staticDone(mouth, false, false);
  }
  regLabel("KOMÍNY MANCKOVIČOVA", 0.8, -1695.1, getTerrainHeight(-1695.1, -341.6)+66, -341.6, true);
  let chIdx = 0;
  cells.forEach(function(ch){
    chIdx++;
    let cx = 0, cz = 0;
    for(let i=0;i<ch.items.length;i++){ cx += ch.items[i].x; cz += ch.items[i].z; }
    cx /= ch.items.length; cz /= ch.items.length;
    let r = 0;
    for(let i=0;i<ch.items.length;i++){
      const d = Math.sqrt((ch.items[i].x-cx)*(ch.items[i].x-cx)+(ch.items[i].z-cz)*(ch.items[i].z-cz)) + ch.items[i].hd;
      if(d > r) r = d;
    }
    const parts = [];
    // Všetky meshe budov: castShadow + receiveShadow (mäkké tiene na terén aj zástavbu).
    if(ch.wHouse.i.length){ const m = new THREE.Mesh(finishGeo(ch.wHouse), S.MAT.houseWall); S.scene.add(m); m.castShadow = true; m.receiveShadow = true; staticDone(m, true, true); parts.push(m); }
    if(ch.wPanel.i.length){ const m = new THREE.Mesh(finishGeo(ch.wPanel), S.MAT.panelWall); S.scene.add(m); m.castShadow = true; m.receiveShadow = true; staticDone(m, true, true); parts.push(m); }
    if(ch.wHist.i.length){ const m = new THREE.Mesh(finishGeo(ch.wHist), S.MAT.histWall); S.scene.add(m); m.castShadow = true; m.receiveShadow = true; staticDone(m, true, true); parts.push(m); }
    if(ch.wInd.i.length){ const m = new THREE.Mesh(finishGeo(ch.wInd), S.MAT.indWall); S.scene.add(m); m.castShadow = true; m.receiveShadow = true; staticDone(m, true, true); parts.push(m); }
    if(ch.rPitch.i.length){ const m = new THREE.Mesh(finishGeo(ch.rPitch), S.MAT.pitchedRoof); S.scene.add(m); m.castShadow = true; m.receiveShadow = true; staticDone(m, true, true); parts.push(m); }
    if(ch.rFlat.i.length){ const m = new THREE.Mesh(finishGeo(ch.rFlat), S.MAT.flatRoof); S.scene.add(m); m.castShadow = true; m.receiveShadow = true; staticDone(m, true, true); parts.push(m); }
    S.CHUNKS.push({ x:cx, z:cz, r:r, ms:parts });
  });
  // kolízne dáta budov do mriežky + exaktné footprinty (dvor test)
  const n = kept.length;
  S.BX.x = new Float32Array(n); S.BX.z = new Float32Array(n);
  S.BX.hw = new Float32Array(n); S.BX.hl = new Float32Array(n);
  S.BX.rot = new Float32Array(n); S.BX.by = new Float32Array(n); S.BX.bh = new Float32Array(n); S.BX.n = n;
  const bfP = [], bfO = [], bfN = [];
  let bfC = 0;
  S.BGRID.nx = Math.ceil((S.GB.x1-S.GB.x0)/S.BGRID.cs);
  S.BGRID.nz = Math.ceil((S.GB.z1-S.GB.z0)/S.BGRID.cs);
  S.BGRID.head = new Int32Array(S.BGRID.nx*S.BGRID.nz).fill(-1);
  // sloty = SÚČET vložení (bunky,budovy), nie počet budov: jedna budova je
  // vložená do všetkých buniek, ktoré zaberá, a jeden slot na budovicu by sa
  // pri každej bunke prepísal. Počítame ho presne (bez odhadu), aby sa
  // Int32Array nepretečil.
  let slots = 0;
  for(let i=0;i<n;i++){
    const k = kept[i];
    const c = Math.cos(k.a), s = Math.sin(k.a);
    const ex = Math.abs(k.w/2*c)+Math.abs(k.d/2*s), ez = Math.abs(k.w/2*s)+Math.abs(k.d/2*c);
    let x0 = Math.floor((k.x-ex-S.GB.x0)/S.BGRID.cs), x1 = Math.floor((k.x+ex-S.GB.x0)/S.BGRID.cs);
    let z0 = Math.floor((k.z-ez-S.GB.z0)/S.BGRID.cs), z1 = Math.floor((k.z+ez-S.GB.z0)/S.BGRID.cs);
    if(x0<0)x0=0; if(z0<0)z0=0;
    if(x1>=S.BGRID.nx)x1=S.BGRID.nx-1; if(z1>=S.BGRID.nz)z1=S.BGRID.nz-1;
    if(x1>=x0 && z1>=z0) slots += (x1-x0+1)*(z1-z0+1);
  }
  S.BGRID.next = new Int32Array(slots).fill(-1);
  S.BGRID.nid = new Int32Array(slots).fill(-1);
  S.BGRID.nn = 0;
  for(let i=0;i<n;i++){
    const k = kept[i];
    S.BX.x[i] = k.x; S.BX.z[i] = k.z;
    S.BX.hw[i] = k.w/2; S.BX.hl[i] = k.d/2; S.BX.rot[i] = k.a;
    S.BX.by[i] = k.baseY; S.BX.bh[i] = k.h+1;
    // (BoxCollider je nad základňou - zapustená časť je pod terénom)
    gridAddRect(k.x, k.z, k.w/2, k.d/2, Math.cos(k.a), Math.sin(k.a), i);
    bfO.push(bfC);
    const nb = (k.fp.length-5)/2;
    bfN.push(nb);
    for(let p=0;p<nb;p++){ bfP.push(k.fp[5+p*2], k.fp[5+p*2+1]); }
    bfC += nb;
  }
  S.BF.p = new Float32Array(bfP); S.BF.o = new Int32Array(bfO); S.BF.n = new Int32Array(bfN);
  if(!S.IS_MOBILE && S.terrainMesh && n > 0){
    let worst = 0;
    const step = Math.max(1, Math.floor(n/12));
    for(let vi=0;vi<n;vi+=step){
      const d = Math.abs(groundRayY(S.BX.x[vi], S.BX.z[vi], S.BX.by[vi])-(S.BX.by[vi]+0.3));
      if(d > worst) worst = d;
    }
    if(worst > 1.5) console.warn("odchýlka päty budovy od terénu:", worst.toFixed(2), "m");
  }
  // štítky len pre najväčšie dominanty
  named.sort(function(a,b){ return b[0]-a[0]; });
  for(let i=0;i<named.length && i<S.LABEL_MAX;i++){
    regLabel(named[i][3], 0.7, named[i][1], named[i][0]+4+getTerrainHeight(named[i][1], named[i][2]), named[i][2], false);
  }
  // tabule ulíc + POI (ďaleké: navigácia aj cez hmlu)
  for(let i=0;i<S.osm.streets.length;i++){
    const st = S.osm.streets[i];
    if(st[2] === "CESTA 513") continue;
    routePose((st[0]+st[1])/2, S._v1, S._hWrap, 14);
    regLabel(st[2], 0.9, S._v1.x, getTerrainHeight(S._v1.x, S._v1.z)+10, S._v1.z, true);
  }
  routePose((S.bridgeS0+S.bridgeS1)/2, S._v1, S._hWrap, 0);
  regLabel("MOST VÁH " + Math.round(S.bridgeLen) + " m", 1.0, S._v1.x, 9, S._v1.z, true);
  for(let i=0;i<S.osm.pois.length;i++){
    const p = S.osm.pois[i];
    regLabel(p[2], 0.8, p[0], getTerrainHeight(p[0], p[1])+9, p[1], true);
  }
  routePose(S.routeLen-8, S._v1, S._hWrap, 0);
  regLabel("ÚNIK >> VON", 1.0, S._v1.x, getTerrainHeight(S._v1.x, S._v1.z)+7, S._v1.z, true);
}
