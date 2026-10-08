// src/ui/minimap.js — 2D mapa: vektorová minimapa + satelitné dlaždice + zoom/pan.
// Port z monolitu (index.monolith.legacy.html, riadky RELATÍVNE od `<script type="module">`):
//   js cca 8861–8934: MAPT_* + maptLon/maptLat/maptTileX/maptTileY/maptTileLon/maptTileLat/
//                     maptPickZ/maptFetch/maptCredit/maptWant/maptPump/maptDraw,
//   js cca 9009–9070: buildMapCache, mapXY, MO/MV, mapReset, mapClamp, mapTrans,
//                     mapZoomAt, mapPanBy,
//   js cca 9068–9190: miniStatic/bigStatic, drawMapStatic, renderMiniStatic, renderBigStatic,
//   js cca 9190–9258: drawMap (ADAPTOVANÉ: legacy traffic pooly -> api.cars + api.police),
//   js cca 9259–9342: mapDragEnd, mapWasDragged, mapClientToCanvas, mapBindInput,
//   js cca 9343–9367: sizeBigMap (toggleMap vedome VYNECHANÉ — toggle rieši menus.js).
// OSM dáta výhradne cez S.osm / S.routeX / S.routeZ / S.routeH / S.ROUTE_N /
// S.routeLen / S.bridgeS0 / S.bridgeS1 / S.streetS / S.GB (všetko existuje
// v src/world/shared.js). Žiadne `game`/legacy pooly/input — pozície áut cez api.
// Pri importe sa nič nevolá (žiadny DOM/fetch); všetko beží až vo factory/helproch.
import { S } from '../world/shared.js';

// ---------- PODKLAD MAPY Z RASTROVÝCH DLAŽDÍC (minimapa + veľká mapa) ----------
// Podklad je cache dlaždíc, nie jeden obrázok: zoom si sám vyberie úroveň podľa
// aktuálneho priblíženia, takže pri priblížení sa dotiahne čerstvá detailná dlaždica
// a nič sa nerozmazáva. Vektorová vrstva (cesty/voda/koľaje/trasa/most/kruháče)
// ostáva vykresľovaná ako doteraz, len NAD podkladom.
export const MAPT_PROV = {
  // short = do úzkej minimapy (menej ako 170 px!), att = do širokej legendy veľkej mapy
  sat:  { sub:["server"], short:"© Esri · Maxar", att:"Podklad: © Esri, Maxar, Earthstar Geographics a GIS User Community",
          make:function(z,x,y){ return "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/"+z+"/"+y+"/"+x; } },
  topo: { sub:["server"], short:"© Esri · OSM", att:"Podklad: © Esri, HERE, Garmin a © OpenStreetMap prispievatelia",
          make:function(z,x,y){ return "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/"+z+"/"+y+"/"+x; } },
  gray: { sub:["server"], short:"© Esri · OSM", att:"Podklad: © Esri, HERE, Garmin a © OpenStreetMap prispievatelia",
          make:function(z,x,y){ return "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/"+z+"/"+y+"/"+x; } }
};
// Projekcia musí byť TOTOŽNÁ s OSM importom, inak je podklad posunutý voči vektorom.
export const MAPT_LON0 = 17.8136414, MAPT_LAT0 = 48.4212428;
export const MAPT_LONM = 73876.98,   MAPT_LATM = 110539.70;   // metrov na 1 stupeň
// Kolko metrov pripadá na jeden pixel dlaždice pri danom zoome: 2^-z * LONM*360/256.
export const MAPT_MPP = MAPT_LONM*360/256;                    // ~103890 m/px * 2^-z
export const MAPT = {
  on: true, provider: "sat", enabled: false,
  zMin: 12, zMax: 17,        // z12 = celé mesto (4 dlaždice), z17 = ~51 m na dlaždicu
  viewZoom: 25,              // koľkokrát smie byť pohľad zväčšený oproti "fit"
  conc: 6, timeout: 8000, tries: 2, maxQueue: 400,
  cache: new Map(), queued: new Set(), queue: [], inflight: 0,
  have: false
};
export function maptLon(x){ return x/MAPT_LONM + MAPT_LON0; }
export function maptLat(z){ return -z/MAPT_LATM + MAPT_LAT0; }
export function maptTileX(lon, z){ return (lon+180)/360 * (1<<z); }
export function maptTileY(lat, z){
  const r = lat*Math.PI/180;
  return (1 - Math.log(Math.tan(r) + 1/Math.cos(r))/Math.PI)/2 * (1<<z);
}
export function maptTileLon(tx, z){ return tx/(1<<z)*360 - 180; }
export function maptTileLat(ty, z){
  const n = Math.PI - 2*Math.PI*ty/(1<<z);
  return 180/Math.PI * Math.atan(0.5*(Math.exp(n) - Math.exp(-n)));
}
// Úroveň dlaždíc, ktorá najlepšie sedí na aktuálne priblíženie (sc = px na meter).
export function maptPickZ(sc){
  const z = Math.round(Math.log2(MAPT_MPP*sc));
  return Math.max(MAPT.zMin, Math.min(MAPT.zMax, z));
}
// Fetch s timeoutom, offline-tolerantný: chyba -> null ticho (ostane vektorový podklad).
export function maptFetch(url, ms){
  return new Promise(function(res){
    let done = false, tm = 0;
    const img = new Image();
    const fin = function(v){ if(done) return; done = true; clearTimeout(tm); res(v); };
    tm = setTimeout(function(){ img.src = ""; fin(null); }, ms);
    img.onload  = function(){ fin(img); };
    img.onerror = function(){ fin(null); };
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.src = url;
  });
}
export function maptCredit(){
  const prov = MAPT_PROV[MAPT.provider];
  if(!prov || !MAPT.have) return;
  const cr = document.getElementById("mapcred"), cb = document.getElementById("mapcred-big");
  if(cr) cr.textContent = prov.short;
  if(cb) cb.textContent = prov.att;
}
// Zaradia chýbajúcu dlaždicu; keď pribudne, označí obe vrstvy na prekreslenie.
export function maptWant(z, x, y){
  const key = z+"/"+x+"/"+y;
  if(MAPT.cache.has(key) || MAPT.queued.has(key)) return;
  MAPT.queued.add(key);
  if(MAPT.queue.length >= MAPT.maxQueue) MAPT.queue.shift();   // pri rýchlom ťahaní nepreplníme front
  MAPT.queue.push([z, x, y, key]);
  maptPump();
}
export function maptPump(){
  const prov = MAPT_PROV[MAPT.provider];
  if(!prov) return;
  while(MAPT.inflight < MAPT.conc && MAPT.queue.length){
    const job = MAPT.queue.shift();
    const url = prov.make(job[0], job[1], job[2]);
    MAPT.inflight++;
    let tries = 0;
    const go = function(){
      maptFetch(url, MAPT.timeout).then(function(img){
        if(!img && ++tries < MAPT.tries){ go(); return; }   // 2. pokus
        MAPT.inflight--;
        MAPT.cache.set(job[3], img || null);                // null = už to neskúš znova
        while(MAPT.cache.size > 120){ const k = MAPT.cache.keys().next().value; MAPT.cache.delete(k); } // LRU strop: satelitné PNG inak rastú bez hraníc
        if(img){
          MAPT.have = true;
          maptCredit();
          MV.mini.dirty = true; MV.big.dirty = true;
        }
        maptPump();
      });
    };
    go();
  }
}
// Vykreslí dlaždice viditeľnej časti a požiada o chýbajúce. Sever = horný riadok.
export function maptDraw(ctx, W, H, ox, oy, sc){
  const z = maptPickZ(sc);
  const wx0 = MAP.x0 + (0-ox)/sc, wz0 = MAP.z0 + (0-oy)/sc;
  const tx0 = Math.floor(maptTileX(maptLon(wx0), z)), tx1 = Math.floor(maptTileX(maptLon(wx0 + W/sc), z));
  const ty0 = Math.floor(maptTileY(maptLat(wz0), z)), ty1 = Math.floor(maptTileY(maptLat(wz0 + H/sc), z));
  const tw = (maptTileLon(1, z)-maptTileLon(0, z))*MAPT_LONM;   // šírka dlaždice v metroch
  ctx.imageSmoothingEnabled = true;
  for(let ty=ty0; ty<=ty1; ty++){
    const th = (maptTileLat(ty, z)-maptTileLat(ty+1, z))*MAPT_LATM;
    const py = oy + (-(maptTileLat(ty, z)-MAPT_LAT0)*MAPT_LATM - MAP.z0)*sc;
    const ph = th*sc;
    if(py > H || py+ph < 0) continue;
    for(let tx=tx0; tx<=tx1; tx++){
      const px = ox + ((maptTileLon(tx, z)-MAPT_LON0)*MAPT_LONM - MAP.x0)*sc;
      const pw = tw*sc;
      if(px > W || px+pw < 0) continue;
      const img = MAPT.cache.get(z+"/"+tx+"/"+ty);
      // +0.5 px prekrytia: bez vlasových švov medzi dlaždicami
      if(img) ctx.drawImage(img, px, py, pw+0.5, ph+0.5);
      else maptWant(z, tx, ty);
    }
  }
}
// Vstupný bod podkladu (adaptácia legacy loadMapTiles bez game/GB/QP globálov):
// podklad sa kreslí priamo do statickej vrstvy, takže tu stačí povoliť dlaždice
// a označiť obe vrstvy na prekreslenie — tie si prvé dlaždice vyžiadajú samy.
// ?maptiles=off|0 = vynútiť vektor; ?maptiles=16 = vynútiť úroveň. Chyby ticho.
export function enableTiles(onReady){
  try{
    if(!MAPT.on || !S.GB.x1 || !MAPT_PROV[MAPT.provider]) return false;
    let q = null;
    try{ q = new URLSearchParams(location.search).get("maptiles"); }catch(_){ q = null; }
    if(q === "off" || q === "0") return false;
    if(q !== null && /^\d+$/.test(q)){
      const z = Math.max(MAPT.zMin, Math.min(MAPT.zMax, +q));
      MAPT.zMin = MAPT.zMax = z;                     // ?maptiles=16 = vynútiť úroveň
    }
    MAPT.enabled = true;
    if(onReady) onReady();
    return true;
  }catch(_){
    return false;
  }
}

// ---------- ZOOM A POSÚVANIE MAPY ----------
// MO je transform pre AKTUÁLNE kreslenú mapu (bez alokácií). Pohľad (priblíženie
// + stred) je NA SAMOSTATNÝ stav pre minimapu a pre veľkú mapu: obidve štartujú
// na "fit" (celé mesto) a dajú sa priblížiť nezávisle.
export const MAP = { x0:0, z0:0, sc:1, bw:0, bh:0, pts:null, npts:0, bi0:0, bi1:0, ready:false };
export function buildMapCache(){
  if(!S.GB.x1 || !S.routeX || !S.routeLen) return false;
  MAP.x0 = S.GB.x0; MAP.z0 = S.GB.z0;
  MAP.bw = S.GB.x1-S.GB.x0; MAP.bh = S.GB.z1-S.GB.z0;
  const n = Math.floor(S.ROUTE_N/8)+1;
  MAP.pts = new Float32Array(n*2);
  for(let i=0,k=0;i<=S.ROUTE_N;i+=8,k+=2){ MAP.pts[k] = S.routeX[i]; MAP.pts[k+1] = S.routeZ[i]; }
  MAP.npts = n;
  MAP.bi0 = Math.max(0, Math.floor(S.bridgeS0/S.routeLen*S.ROUTE_N));
  MAP.bi1 = Math.min(S.ROUTE_N, Math.ceil(S.bridgeS1/S.routeLen*S.ROUTE_N));
  MAP.ready = true;
  return true;
}
// Scratch bez alokácií (legacy _v3): mapXY nastaví _mxy a vráti ho.
const _mxy = { x:0, y:0 };
export function mapXY(x, z, ox, oy, sc){
  _mxy.x = ox + (x-MAP.x0)*sc; _mxy.y = oy + (z-MAP.z0)*sc;
  return _mxy;
}
export const MO = { sc:1, ox:0, oy:0, fit:1 }; // transform mapy (bez alokácií)
export const MV = {
  mini:{ zoom:1, px:null, pz:null, dirty:true },
  big: { zoom:1, px:null, pz:null, dirty:true }
};
export function mapReset(view){
  view.zoom = 1; view.px = null; view.pz = null; view.dirty = true;
}
// Zoom obmedzíme a stred udržíme nad mapou (pokiaľ je pohľad menší ako celé mesto,
// je centrovaný; inak sa posúvať nemožno).
export function mapClamp(view, W, H){
  const fit = Math.min(W/MAP.bw, H/MAP.bh);
  const zoom = Math.max(1, Math.min(MAPT.viewZoom, view.zoom));
  const vw = W/(fit*zoom), vh = H/(fit*zoom);
  const cx = (view.px === null) ? MAP.x0 + MAP.bw/2 : view.px;
  const cz = (view.pz === null) ? MAP.z0 + MAP.bh/2 : view.pz;
  view.zoom = zoom;
  view.px = (vw >= MAP.bw) ? MAP.x0 + MAP.bw/2 : Math.max(MAP.x0+vw/2, Math.min(MAP.x0+MAP.bw-vw/2, cx));
  view.pz = (vh >= MAP.bh) ? MAP.z0 + MAP.bh/2 : Math.max(MAP.z0+vh/2, Math.min(MAP.z0+MAP.bh-vh/2, cz));
  return fit;
}
export function mapTrans(W, H, view){
  MO.fit = mapClamp(view, W, H);
  MO.sc = MO.fit*view.zoom;
  MO.ox = W/2 - (view.px-MAP.x0)*MO.sc;
  MO.oy = H/2 - (view.pz-MAP.z0)*MO.sc;
}
// Priblíženie/oddialenie TAK, aby bod pod kurzorom (alebo prstom) zostal na mieste.
export function mapZoomAt(view, W, H, factor, sx, sy){
  mapTrans(W, H, view);
  const wx = MAP.x0 + (sx-MO.ox)/MO.sc, wz = MAP.z0 + (sy-MO.oy)/MO.sc;
  view.zoom *= factor;
  mapTrans(W, H, view);
  view.px += wx - (MAP.x0 + (sx-MO.ox)/MO.sc);
  view.pz += wz - (MAP.z0 + (sy-MO.oy)/MO.sc);
  mapTrans(W, H, view);
  view.dirty = true;
}
export function mapPanBy(view, W, H, dxPx, dyPx){
  mapTrans(W, H, view);
  view.px -= dxPx/MO.sc;
  view.pz -= dyPx/MO.sc;
  view.dirty = true;
}
// Bod trasy s bočným offsetom pre popisky ulíc — matematika zhodná
// s routePose() (src/world/roads.js), ale bez importu (importy bez cyklov).
const _lp = { x:0, z:0 };
export function mapRoutePoint(s, lat){
  const N = S.ROUTE_N, RL = S.routeLen || 1;
  let f = (s / RL) * N;
  if(f < 0) f = 0; else if(f > N - 1) f = N - 1;
  const i = Math.floor(f), t = f - i;
  const cx = S.routeX[i] + (S.routeX[i+1]-S.routeX[i])*t;
  const cz = S.routeZ[i] + (S.routeZ[i+1]-S.routeZ[i])*t;
  let d = S.routeH[i+1]-S.routeH[i];
  if(d > Math.PI) d -= Math.PI*2; else if(d < -Math.PI) d += Math.PI*2;
  const h = S.routeH[i] + d*t;
  const L = lat || 0;
  _lp.x = cx + (-Math.cos(h))*L; _lp.z = cz + (Math.sin(h))*L;
  return _lp;
}
// statická vrstva mapy (cesty/voda/koľaje/trasa/most/kruháče) sa kreslí RAZ
export function drawMapStatic(ctx, W, H, full, view){
  mapTrans(W, H, view);
  const sc = MO.sc, ox = MO.ox, oy = MO.oy;
  const mw = MAP.bw*sc, mh = MAP.bh*sc;
  ctx.fillStyle = "#0b0906";
  ctx.fillRect(0, 0, W, H);
  const osm = S.osm;
  if(!osm || !MAP.ready) return;
  // dlaždicový podklad (ak sa podarilo načítať). mapXY() používa rovnaké mapovanie
  // x->vpravo / z->nadol, kompozit je sever-nahor, takže ide rovno do písmenca.
  // enabled = kresliť/žiadať dlaždice (od prvého snímku, inak by sa nikdy nepožiadali)
  // have    = aspoň jedna stihla -> až potom stmavíme fotku a prepneme farby vektorov
  const ON = MAPT.have;
  if(MAPT.enabled){
    ctx.save();
    ctx.beginPath(); ctx.rect(ox, oy, mw, mh); ctx.clip();
    maptDraw(ctx, W, H, ox, oy, sc);
    if(ON){
      ctx.fillStyle = "rgba(11,9,6,0.42)";   // stmavenie fotky, nech vystupujú vektorové prvky
      ctx.fillRect(ox, oy, mw, mh);
    }
    ctx.restore();
  }
  // celá sieť mesta (tenko, tlmene)
  ctx.strokeStyle = ON ? "#d9c27e" : "#5a4a20";
  ctx.lineWidth = ON ? 0.9 : 1;
  ctx.beginPath();
  const allR = osm.roads;
  for(let li=0;li<allR.length;li++){
    const L = allR[li];
    for(let i=1;i<L.length;i+=6){
      mapXY(L[i], L[i+1], ox, oy, sc);
      if(i === 1) ctx.moveTo(_mxy.x, _mxy.y); else ctx.lineTo(_mxy.x, _mxy.y);
    }
  }
  ctx.stroke();
  // vody mesta
  ctx.strokeStyle = ON ? "#63d6ef" : "#2e5a52";
  ctx.lineJoin = "round";
  const wlines = osm.water;
  for(let li=0;li<wlines.length;li++){
    const L = wlines[li];
    ctx.lineWidth = Math.max(1.5, L[0]*2*sc);
    ctx.beginPath();
    for(let i=1;i<L.length;i+=6){
      mapXY(L[i], L[i+1], ox, oy, sc);
      if(i === 1) ctx.moveTo(_mxy.x, _mxy.y); else ctx.lineTo(_mxy.x, _mxy.y);
    }
    ctx.stroke();
  }
  // železnica
  ctx.strokeStyle = ON ? "#b9b9c4" : "#777";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const rls = osm.rails;
  if(rls){
    for(let li=0;li<rls.length;li++){
      const L = rls[li];
      for(let i=0;i<L.length;i+=6){
        mapXY(L[i], L[i+1], ox, oy, sc);
        if(i === 0) ctx.moveTo(_mxy.x, _mxy.y); else ctx.lineTo(_mxy.x, _mxy.y);
      }
    }
  }
  ctx.stroke();
  // trasa
  ctx.strokeStyle = ON ? "#ffb000" : "#8a5f00";
  ctx.lineWidth = full ? 4 : 2.5;
  ctx.beginPath();
  for(let i=0;i<MAP.npts;i++){
    mapXY(MAP.pts[i*2], MAP.pts[i*2+1], ox, oy, sc);
    if(i === 0) ctx.moveTo(_mxy.x, _mxy.y); else ctx.lineTo(_mxy.x, _mxy.y);
  }
  if(ON){ ctx.strokeStyle = "rgba(20,12,0,0.85)"; ctx.lineWidth = (full ? 4 : 2.5)+2.5; ctx.stroke(); }
  ctx.strokeStyle = ON ? "#ffb000" : "#8a5f00";
  ctx.lineWidth = full ? 4 : 2.5;
  ctx.stroke();
  // most (zelený úsek)
  ctx.strokeStyle = "#39ff6a";
  ctx.lineWidth = full ? 5 : 3.5;
  ctx.beginPath();
  for(let i=MAP.bi0;i<=MAP.bi1;i+=4){
    mapXY(S.routeX[i], S.routeZ[i], ox, oy, sc);
    if(i === MAP.bi0) ctx.moveTo(_mxy.x, _mxy.y); else ctx.lineTo(_mxy.x, _mxy.y);
  }
  ctx.stroke();
  // kruháče (všetky)
  ctx.strokeStyle = "#ffb000";
  ctx.lineWidth = 1.5;
  const rbs = osm.rounds;
  for(let i=0;i<rbs.length;i++){
    mapXY(rbs[i][0], rbs[i][1], ox, oy, sc);
    ctx.beginPath();
    ctx.arc(_mxy.x, _mxy.y, Math.max(2, rbs[i][2]*sc), 0, 6.2832);
    ctx.stroke();
  }
  // štart / cieľ
  mapXY(S.routeX[0], S.routeZ[0], ox, oy, sc);
  ctx.fillStyle = "#ffb000";
  ctx.fillRect(_mxy.x-2, _mxy.y-2, 4, 4);
  mapXY(S.routeX[S.ROUTE_N], S.routeZ[S.ROUTE_N], ox, oy, sc);
  ctx.fillStyle = "#39ff6a";
  ctx.fillRect(_mxy.x-3, _mxy.y-3, 6, 6);
}
export function renderMiniStatic(staticCvs, targetCvs, force){
  if(!staticCvs || !targetCvs) return;
  const v = MV.mini;
  if(!force && !v.dirty) return;
  v.dirty = false;
  if(staticCvs.width !== targetCvs.width) staticCvs.width = targetCvs.width;
  if(staticCvs.height !== targetCvs.height) staticCvs.height = targetCvs.height;
  drawMapStatic(staticCvs.getContext("2d"), staticCvs.width, staticCvs.height, false, v);
}
export function renderBigStatic(staticCvs, targetCvs, force){
  if(!staticCvs || !targetCvs) return;
  const v = MV.big;
  if(!force && !v.dirty) return;
  v.dirty = false;
  if(staticCvs.width !== targetCvs.width) staticCvs.width = targetCvs.width;
  if(staticCvs.height !== targetCvs.height) staticCvs.height = targetCvs.height;
  drawMapStatic(staticCvs.getContext("2d"), staticCvs.width, staticCvs.height, true, v);
}
// dynamická vrstva: statický podklad + živé body.
// ADAPTÁCIA legacy drawMap: trafficPool/incomingPool/ambientPool neexistujú —
// autá cez cars ([{x,z,h,dir}]; dir<0 = protismer), polícia cez police
// ({units:[{x,z}], roadblocks:[{x,z}]}). Hráč cez player ({x,z,h}).
// Peter (zadávateľ misií) cez peter ({x,z}, fialová).
export function drawMap(ctx, W, H, full, staticCvs, view, player, cars, police, peter){
  mapTrans(W, H, view);
  const sc = MO.sc, ox = MO.ox, oy = MO.oy;
  ctx.drawImage(staticCvs, 0, 0, W, H);
  if(cars){
    // protismer (oranžová)
    ctx.fillStyle = "#c07a20";
    for(let i=0;i<cars.length;i++){
      const c = cars[i];
      if(!(c.dir < 0)) continue;
      mapXY(c.x, c.z, ox, oy, sc);
      ctx.fillRect(_mxy.x-1.5, _mxy.y-1.5, 3, 3);
    }
    // kolóna (červená)
    ctx.fillStyle = "#ff2b2b";
    for(let i=0;i<cars.length;i++){
      const c = cars[i];
      if(c.dir < 0) continue;
      mapXY(c.x, c.z, ox, oy, sc);
      const s = full ? 4 : 3;
      ctx.fillRect(_mxy.x-s/2, _mxy.y-s/2, s, s);
    }
  }
  if(police){
    // hliadky (modré)
    const units = police.units;
    if(units){
      ctx.fillStyle = "#4aa8ff";
      for(let i=0;i<units.length;i++){
        mapXY(units[i].x, units[i].z, ox, oy, sc);
        const s = full ? 4 : 3;
        ctx.fillRect(_mxy.x-s/2, _mxy.y-s/2, s, s);
      }
    }
    // zátarasy (červené krížiky)
    const blocks = police.roadblocks;
    if(blocks){
      ctx.strokeStyle = "#ff2b2b";
      ctx.lineWidth = full ? 2 : 1.5;
      for(let i=0;i<blocks.length;i++){
        mapXY(blocks[i].x, blocks[i].z, ox, oy, sc);
        const r = full ? 4 : 3;
        ctx.beginPath();
        ctx.moveTo(_mxy.x-r, _mxy.y-r); ctx.lineTo(_mxy.x+r, _mxy.y+r);
        ctx.moveTo(_mxy.x+r, _mxy.y-r); ctx.lineTo(_mxy.x-r, _mxy.y+r);
        ctx.stroke();
      }
    }
  }
  // hráč (šípka v smere jazdy; mapa: sever hore)
  if(player){
    mapXY(player.x, player.z, ox, oy, sc);
    ctx.save();
    ctx.translate(_mxy.x, _mxy.y);
    ctx.rotate(Math.PI - player.h);
    ctx.fillStyle = "#39ff6a";
    const a = full ? 9 : 7;
    ctx.beginPath();
    ctx.moveTo(0, -a); ctx.lineTo(a*0.7, a*0.7); ctx.lineTo(-a*0.7, a*0.7);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  // Peter (fialová — zadávateľ misií)
  if(peter && typeof peter.x === "number"){
    mapXY(peter.x, peter.z, ox, oy, sc);
    ctx.fillStyle = "#c26bff";
    const s = full ? 6 : 4;
    ctx.fillRect(_mxy.x-s/2, _mxy.y-s/2, s, s);
  }
  if(full){
    const osm = S.osm;
    // názvy ulíc + POI
    ctx.fillStyle = "#ffd97a";
    ctx.font = "13px Courier";
    ctx.textAlign = "center";
    for(let i=0;i<S.streetS.length;i++){
      const smid = (S.streetS[i][0]+S.streetS[i][1])/2;
      mapRoutePoint(smid, 26);
      mapXY(_lp.x, _lp.z, ox, oy, sc);
      ctx.fillText(S.streetS[i][2], _mxy.x, _mxy.y);
    }
    if(osm){
      ctx.fillStyle = "#ffb000";
      for(let i=0;i<osm.pois.length;i++){
        const p = osm.pois[i];
        mapXY(p[0], p[1], ox, oy, sc);
        ctx.fillText(p[2], _mxy.x, _mxy.y-8);
      }
      ctx.fillStyle = "#8a9a5b";
      ctx.font = "11px Courier";
      for(let i=0;i<osm.tlabels.length;i++){
        const t = osm.tlabels[i];
        mapXY(t[0], t[1], ox, oy, sc);
        ctx.fillText(t[2], _mxy.x, _mxy.y);
      }
    }
    if(player){
      ctx.fillStyle = "#39ff6a";
      ctx.font = "bold 15px Courier";
      mapXY(player.x, player.z, ox, oy, sc);
      ctx.fillText("TY", _mxy.x, _mxy.y-12);
    }
    if(peter && typeof peter.x === "number"){
      ctx.fillStyle = "#c26bff";
      ctx.font = "bold 13px Courier";
      mapXY(peter.x, peter.z, ox, oy, sc);
      ctx.fillText("PETER", _mxy.x, _mxy.y-10);
    }
  }
}
// ---------- OVLÁDANIE MAPY: koliesko = zoom, ťahanie = posun, dva prsty = pinch ----
export let mapDragEnd = 0;       // koniec ťahania; klik do 350 ms po ňom sa ignoruje (a neotvorí veľkú mapu)
export function setMapDragEnd(t){ mapDragEnd = t; }
export function mapWasDragged(){ return (performance.now() - mapDragEnd) < 350; }
export function mapClientToCanvas(canvas, e){
  const r = canvas.getBoundingClientRect();
  return { x:canvas.width*(e.clientX-r.left)/(r.width || 1),
           y:canvas.height*(e.clientY-r.top)/(r.height || 1) };
}
export function mapBindInput(canvas, view, opts){
  opts = opts || {};
  const redraw = (typeof opts.redraw === "function") ? opts.redraw : function(){};
  canvas.style.touchAction = "none";         // vlastný posun, nie posun stránky
  canvas.addEventListener("contextmenu", function(e){ e.preventDefault(); });
  canvas.addEventListener("wheel", function(e){
    e.preventDefault();
    const p = mapClientToCanvas(canvas, e);
    mapZoomAt(view, canvas.width, canvas.height, e.deltaY < 0 ? 1.2 : 1/1.2, p.x, p.y);
    redraw();
  }, { passive:false });

  let drag = false, moved = 0, lx = 0, ly = 0;
  let pinch = 0;
  canvas.addEventListener("pointerdown", function(e){
    try{ canvas.setPointerCapture(e.pointerId); }catch(_){ void _; }
    const p = mapClientToCanvas(canvas, e);
    if(e.pointerType === "touch"){
      // druhý prst = štipka
      const pts = canvas.__pts || (canvas.__pts = new Map());
      pts.set(e.pointerId, p);
      if(pts.size === 2){
        const a = [...pts.values()];
        pinch = Math.hypot(a[0].x-a[1].x, a[0].y-a[1].y);
        drag = false;
        return;
      }
    }
    drag = true; moved = 0;
    lx = p.x; ly = p.y;
  });
  canvas.addEventListener("pointermove", function(e){
    const p = mapClientToCanvas(canvas, e);
    if(e.pointerType === "touch" && canvas.__pts && canvas.__pts.has(e.pointerId)) canvas.__pts.set(e.pointerId, p);
    if(canvas.__pts && canvas.__pts.size === 2){
      const a = [...canvas.__pts.values()];
      const d = Math.hypot(a[0].x-a[1].x, a[0].y-a[1].y);
      if(pinch > 0 && d > 0){
        mapZoomAt(view, canvas.width, canvas.height, d/pinch,
                  (a[0].x+a[1].x)/2, (a[0].y+a[1].y)/2);
        redraw();
      }
      pinch = d;
      return;
    }
    if(!drag) return;
    const dx = p.x-lx, dy = p.y-ly;
    lx = p.x; ly = p.y;
    moved += Math.abs(dx) + Math.abs(dy);
    if(moved > 3){
      mapPanBy(view, canvas.width, canvas.height, dx, dy);
      redraw();
    }
  });
  const up = function(e){
    if(canvas.__pts) canvas.__pts.delete(e.pointerId);
    if(canvas.__pts && canvas.__pts.size < 2){
      pinch = 0;
      // po skončení štipky zostane jeden prst -> pokračujeme v ťahaní
      if(canvas.__pts.size === 1){ const q = [...canvas.__pts.values()][0]; drag = true; moved = 99; lx = q.x; ly = q.y; return; }
    }
    if(drag && moved > 3) mapDragEnd = performance.now();   // označ ťahanie pre klik
    drag = false;
  };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  if(opts.resetOnDblClick){
    canvas.addEventListener("dblclick", function(e){
      e.preventDefault(); e.stopPropagation();
      mapReset(view); redraw();
    });
  } else {
    // minimapa: dvojklik by kolidoval s "klik = otvoriť veľkú mapu"
    canvas.addEventListener("dblclick", function(e){ e.preventDefault(); });
  }
}

// Veľká mapa na stred obrazovky (volá sa pri OTVORENÍ, nie každý frame).
// Toggle (#bigmap.hidden + M klávesa + klik na minimap-wrap) rieši menus.js —
// tento modul sa stará len o render/zoom, nie o prepínanie.
export function sizeBigMap(bigCvs, bigStatic){
  if(!bigCvs) return;
  const vw = (typeof globalThis.innerWidth === "number") ? globalThis.innerWidth : 800;
  const vh = (typeof globalThis.innerHeight === "number") ? globalThis.innerHeight : 600;
  const w = Math.min(700, Math.floor(vw*0.86));
  const h = Math.min(460, Math.floor(vh*0.6));
  bigCvs.width = w; bigCvs.height = h;
  if(bigStatic){ bigStatic.width = w; bigStatic.height = h; }
  renderBigStatic(bigStatic, bigCvs, true);
}

export function createMinimap(state, api){
  const miniCvs = document.getElementById("minimap");
  const bigCvs = document.getElementById("bigmap-canvas");
  const bigEl = document.getElementById("bigmap");
  const miniCtx = miniCvs ? miniCvs.getContext("2d") : null;
  const bigCtx = bigCvs ? bigCvs.getContext("2d") : null;
  // statické vrstvy: offscreen cache, prekresľujú sa len pri dirty/zoom/pan
  const miniStatic = document.createElement("canvas");
  const bigStatic = document.createElement("canvas");
  let tilesTried = false;
  let bigWasOpen = false;
  const carsOf = function(){ return (api && api.traffic && api.traffic.cars) ? api.traffic.cars : []; };
  const policeOf = function(){
    if(api && api.police) return api.police;
    return state.police || null;
  };
  const peterOf = function(){ return (api && api.peter && api.peter.built) ? api.peter : null; };
  const redrawBig = function(){
    renderBigStatic(bigStatic, bigCvs);
    if(bigCtx && bigCvs && MAP.ready){
      drawMap(bigCtx, bigCvs.width, bigCvs.height, true, bigStatic, MV.big, state.player, carsOf(), policeOf(), peterOf());
    }
  };
  // Zoom/pan len na veľkej mape (minimapa bez zoomu, stále "fit" celého mesta).
  if(bigCvs){
    mapBindInput(bigCvs, MV.big, { resetOnDblClick:true, redraw:redrawBig });
  }
  function update(){
    // cache sa dá postaviť až po computeBounds()+buildRoute() (S.GB + S.routeX)
    if(!MAP.ready) buildMapCache();
    if(!tilesTried && MAP.ready){
      tilesTried = true;
      enableTiles(function(){ MV.mini.dirty = true; MV.big.dirty = true; });
      renderMiniStatic(miniStatic, miniCvs, true);
      renderBigStatic(bigStatic, bigCvs, true);
    }
    if(!MAP.ready) return;
    // Minimapa sa prekresľuje každý frame (lacno: statika z cache + živé body).
    if(miniCtx && miniCvs){
      renderMiniStatic(miniStatic, miniCvs);
      drawMap(miniCtx, miniCvs.width, miniCvs.height, false, miniStatic, MV.mini, state.player, carsOf(), policeOf(), peterOf());
    }
    // Veľká mapa len keď je otvorená (+ pri zoom/pan cez redrawBig).
    const open = bigEl ? !bigEl.classList.contains("hidden") : false;
    if(open && bigCtx && bigCvs){
      if(!bigWasOpen) sizeBigMap(bigCvs, bigStatic);
      renderBigStatic(bigStatic, bigCvs);
      drawMap(bigCtx, bigCvs.width, bigCvs.height, true, bigStatic, MV.big, state.player, carsOf(), policeOf(), peterOf());
    }
    bigWasOpen = open;
  }
  return {
    update: update,
    sizeBigMap: function(){ sizeBigMap(bigCvs, bigStatic); },
    renderMini: function(force){ renderMiniStatic(miniStatic, miniCvs, force); },
    renderBig: function(force){ renderBigStatic(bigStatic, bigCvs, force); },
  };
}
