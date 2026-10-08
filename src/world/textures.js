// src/world/textures.js — procedurálne PBR textúry + AssetManager (verbatim port z monolitu, js 4109–4842).
import * as THREE from 'three';
import { S } from './shared.js';

// Hra beží CELÁ aj keď assets/textures/ neexistuje (pozri assets/textures/README.md).
// Každý slot si hneď vytvorí syntetickú CanvasTexture, takže buildShared() môže bežať
// synchrónne, build nikdy neblikne a scéna nikdy nie je čierna. Ak sa súbor podarí
// načítať, prepíšeme IBA source.data tej istej textúry -> GPU prepíše existujúci
// upload (rovnaké POT rozmery), materiály ostanú napojené, nevzniká nový objekt ani
// leak. Chýbajúci, pokazený alebo ne-power-of-two súbor = tichý fallback na procedúru.
const ASSET_ROOT = "assets/textures/";
const ASSET_MAX_PX = 1024;                    // striktný strop: len 256/512/1024
const TEX_SLOTS = [];                         // [{key, path, tex, size, src}]
let TEX_PENDING = 0;                          // sloty, ktoré ešte čakajú na súbor
const ASSET_LOADER = new THREE.TextureLoader();

export function isPOT(n){ return n > 0 && (n & (n - 1)) === 0; }

// --- PERIODICKÝ value / fBm / ridged noise -----------------------------------
// Šum MUSÍ byť tileable: mriežka sa zvlná po svojom bode, takže ľavý == pravý a
// horný == spodný okraj. Bez toho je na každej dlažbe vidieť švík a mipmapy ho
// zosilňujú. (Pôvodný speckle() robil mriežku s krokom ~7,4 px - to bolo moiré.)

export function thash(ix, iy, n, seed){
  ix = ((ix % n) + n) % n; iy = ((iy % n) + n) % n;
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) * 2.3283064365386963e-10;   // /2^32
}

export function tval(x, y, n, seed){
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf*xf*(3 - 2*xf), v = yf*yf*(3 - 2*yf);
  const a = thash(xi, yi, n, seed), b = thash(xi + 1, yi, n, seed);
  const c = thash(xi, yi + 1, n, seed), d = thash(xi + 1, yi + 1, n, seed);
  const ab = a + (b - a)*u, cd = c + (d - c)*u;
  return ab + (cd - ab)*v;
}

export function tfbm(u, v, n, oct, seed){
  let a = 1, sum = 0, norm = 0, c = n;
  for(let o = 0; o < oct; o++){ sum += a*tval(u*c, v*c, c, seed + o*101); norm += a; a *= 0.5; c *= 2; }
  return sum / norm;
}
// ridged: 1-|2n-1| -> ostré hrebene = prirodzené trhliny a porezy povrchu

export function tridge(u, v, n, oct, seed){
  let a = 1, sum = 0, norm = 0, c = n;
  for(let o = 0; o < oct; o++){
    sum += a*(1 - Math.abs(2*tval(u*c, v*c, c, seed + o*211) - 1));
    norm += a; a *= 0.5; c *= 2;
  }
  return sum / norm;
}

export function ss01(t){ return t < 0 ? 0 : (t > 1 ? 1 : t); }

export function sstep(a, b, t){ t = ss01((t - a)/(b - a)); return t*t*(3 - 2*t); }

// --- canvas -> THREE.Texture (POT + mipmapy + anizotropia + tiling) ----------

export function newCanvas(size){
  const c = document.createElement("canvas");
  c.width = size; c.height = size;              // power-of-two = mipmapy sú povolené
  return c;
}

export function paintCanvas(size, painter){
  const c = newCanvas(size);
  painter(c.getContext("2d"), size);
  return c;
}

export function texFromCanvas(c, srgb, repeat){
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;  // normály/roughness = lineárne
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;                      // minifikácia v diaľke bez šípkov
  t.minFilter = THREE.LinearMipmapLinearFilter;  // trilinear
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = S.TEX_ANISO;                      // ostré aj pri ostrom uhle
  if(repeat) t.repeat.set(repeat[0], repeat[1]);
  return t;
}

export function makeTex(size, painter){ return texFromCanvas(paintCanvas(size, painter), true); }

// Slot = hotový canvas: založí textúru a POZADIA ju nahradiť súborom z disku.
// path === null -> čisto procedurálny slot (žiadny sieťový pokus).

export function texSlotCanvas(key, path, canvas, srgb, repeat, onAdopt){
  const tex = texFromCanvas(canvas, srgb, repeat);
  // onAdopt(tex) sa zavola, keď súbor z disku nahradí procedurálny canvas - sloty
  // so sprievodnými mapami odvodenými z obrázka (napr. fasáda) si tak prepočítajú
  // sprievodné mapy z tej istej fotografie, ktorá je práve naviazaná.
  const slot = { key:key, path:path, tex:tex, size:canvas.width, onAdopt:onAdopt,
                 src: path ? "caka" : "procedural" };
  S.TEX[key] = tex;
  TEX_SLOTS.push(slot);
  if(path){
    TEX_PENDING++;
    const done = function(){ TEX_PENDING--; if(TEX_PENDING === 0) texReport(); };
    try{
      ASSET_LOADER.load(ASSET_ROOT + path,
        function(loaded){ adoptAsset(slot, loaded); done(); },
        undefined,
        function(){ slot.src = "procedural (subor chyba)"; done(); });
    }catch(e){ slot.src = "procedural (subor chyba)"; done(); }
  }
  return tex;
}

export function texSlot(key, path, size, srgb, repeat, painter, onAdopt){
  return texSlotCanvas(key, path, paintCanvas(size, painter), srgb, repeat, onAdopt);
}
// TextureLoader posiela callbacku TEXTURE, nie HTMLImageElement. Kým by sme čítali
// img.naturalWidth priamo, dostali by sme undefined a každý súbor by skončil ako
// "0x0, nie je POT" - teda by sa nikdy nenačítal nič.

export function adoptAsset(slot, loaded){
  const img = loaded.image || loaded;             // ImageLoader dá img, TextureLoader texture
  const w = (img.naturalWidth  || img.width  || 0) | 0;
  const h = (img.naturalHeight || img.height || 0) | 0;
  if(!isPOT(w) || !isPOT(h) || w > ASSET_MAX_PX || h > ASSET_MAX_PX){
    slot.src = "procedural (odmietnuté " + w + "x" + h + ", nie je POT <= " + ASSET_MAX_PX + ")";
    if(typeof console !== "undefined") console.warn("[TEX] " + slot.key + ": " + slot.src + " -> ostáva procedúra");
    return;
  }
  slot.tex.image = img;           // r160: image je setter na source.data
  slot.tex.needsUpdate = true;    // GPU prepíše ten istý upload - žiadny nový objekt, žiadny leak
  slot.src = "subor " + w + "x" + h;
  if(slot.onAdopt){ try{ slot.onAdopt(slot.tex); }catch(e){} }
}

// --- polia na canvas ---------------------------------------------------------
// Jeden alokovaný RGBA buffer + výškové pole: všetky mapy z jedného prechodu po
// texeli (žiadne tri canvas prepisy, žiadne alokácie vo vykresľovacích slučkách).

export function newField(size){
  const c = newCanvas(size), g = c.getContext("2d"), img = g.createImageData(size, size);
  return { size:size, c:c, g:g, img:img, d:img.data, hf:new Float32Array(size*size) };
}

export function putField(f, i, r, gr, b){
  const j = i*4;
  f.d[j] = r; f.d[j+1] = gr; f.d[j+2] = b; f.d[j+3] = 255;
}

export function commitField(f){ f.g.putImageData(f.img, 0, 0); return f.c; }
// výškové pole -> tangent-space normálová mapa (sobel zo zabaleného poľa)

export function normalCanvas(size, hf, strength){
  const c = newCanvas(size), g = c.getContext("2d"), img = g.createImageData(size, size), d = img.data;
  for(let y = 0; y < size; y++){
    const row = y*size, ym = ((y - 1 + size) % size)*size, yp = ((y + 1) % size)*size;
    for(let x = 0; x < size; x++){
      const xm = (x - 1 + size) % size, xp = (x + 1) % size;
      const nx = (hf[row + xm] - hf[row + xp])*strength;
      const ny = (hf[ym + x] - hf[yp + x])*strength;
      const inv = 1/Math.sqrt(nx*nx + ny*ny + 1);
      const i = (row + x)*4;
      d[i] = (nx*inv*0.5 + 0.5)*255;
      d[i+1] = (ny*inv*0.5 + 0.5)*255;
      d[i+2] = (inv*0.5 + 0.5)*255;
      d[i+3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}
// ľubovoľné pole -> sivá (lineárna) mapa, napr. roughness

export function grayCanvas(size, f){
  const c = newCanvas(size), g = c.getContext("2d"), img = g.createImageData(size, size), d = img.data;
  for(let i = 0, n = size*size; i < n; i++){
    const j = i*4, v = ss01(f[i])*255;
    d[j] = v; d[j+1] = v; d[j+2] = v; d[j+3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

// ŠKVRNTY MUSIA BYŤ ROZMIESTNENÉ NÁHODNE, nie aritmetickou postupnosťou.
// Pôvodne to bolo g.fillRect((i*37)%size, (i*91)%size, 2, 2). Keďže gcd(37,256)=1,
// postupnosť (i*37)%size prejde všetkých 256 stĺpcov a každý stĺpec dostane
// takmer rovnaký počet škvrnt (4-5). Výsledok preto NIE JE šum, ale mriežka s krokom
// ~7.4 texela, ktorá bije proti mriežke pixelov a po minifikácii robí PRAVIDELNÉ
// MOIRÉ PRUHY. Náhodná (hash) rozmiestnenie sa dá správne vyfiltrovať mipmapami.

export function speckleHash(i){
  let x = (i + 0x9e3779b9) | 0;
  x ^= x >>> 16; x = Math.imul(x, 0x21f0aaad);
  x ^= x >>> 15; x = Math.imul(x, 0x735a2d97);
  x ^= x >>> 15;
  return x >>> 0;
}

export function speckle(g, size, n, alpha){
  for(let i=0;i<n;i++){
    const v = speckleHash(i*4) % 256;
    const x = speckleHash(i*4+1) % size, y = speckleHash(i*4+2) % size;
    const w = 1 + (speckleHash(i*4+3) % 2);
    g.fillStyle = "rgba(" + v + "," + v + "," + v + "," + alpha + ")";
    g.fillRect(x, y, w, w);
  }
}

// ---------- PROCEDURÁLNE PBR TEXTÚRY (fallback pre assets/textures/**) ----------
// Veľkosť 512 pri dlažbe 4 m = 128 px/m: zrno asfaltu je čitateľné z kabíny aj zo
// 300 m a anizotropia (TEX_ANISO) to udrží ostré namiesto rozmazanej šedej plochy.

// ASFALT (GTA:SA look): jeden prechod po texeli vyrobí VŠETKY tri mapy naraz -
// výšku (normálová mapa), svetlosť (difúzia) a drsnost. Žiadny druhý prechod.

export function fAsphalt(SZ){
  const f = newField(SZ), rg = new Float32Array(SZ*SZ);
  for(let y = 0; y < SZ; y++) for(let x = 0; x < SZ; x++){
    const u = x/SZ, v = y/SZ, i = y*SZ + x;
    const grain = tfbm(u, v, 64, 3, 11);                          // hrubé zrno
    const fine  = tfbm(u, v, 256, 2, 29);                         // jemné zrno
    const stone = sstep(0.58, 0.82, tfbm(u, v, 96, 2, 47));       // svetlé kamienky
    const crack = 1 - sstep(0.02, 0.13, tridge(u, v, 24, 3, 83)); // trhliny
    const patch = tfbm(u, v, 4, 2, 131);                          // fliaky živice
    const h = grain*0.40 + fine*0.22 + stone*0.50 - crack*0.60;
    f.hf[i] = h;
    let l = 38 + h*52 + (patch - 0.5)*13 + (thash(x, y, SZ, 7) - 0.5)*7;
    if(stone > 0.55) l += (stone - 0.55)*46;                      // svetlý štrk
    if(crack > 0.25) l -= (crack - 0.25)*34;                      // tieň v trhline
    l = Math.max(13, Math.min(118, l));
    putField(f, i, l*0.98, l*1.00, l*1.10);                       // asfalt je studený
    // drsnost: vyleštený štrk 0,70 / matné jamky 0,97 - žiaden jednotný 0,9
    rg[i] = 0.90 - stone*0.20 + (crack > 0.25 ? 0.07 : 0) + (patch - 0.5)*0.10;
  }
  return { S:SZ, dif:commitField(f), hf:f.hf, rg:rg };
}

// TRÁVNIK. Priemerná svetlosť MUSÍ sedieť na GCPAL (tint je vo vertexColors a
// násobí mapu), inak terén zosilnie alebo stmavne. Base je držaný na ~#4a5238.

export function fGrass(SZ){
  const f = newField(SZ);
  for(let y = 0; y < SZ; y++) for(let x = 0; x < SZ; x++){
    const u = x/SZ, v = y/SZ, i = y*SZ + x;
    const clump = tfbm(u, v, 16, 3, 5);                          // zhluky rastliny
    const blade = tfbm(u, v, 128, 2, 61);                        // steblá
    const dry   = sstep(0.58, 0.86, tfbm(u, v, 6, 2, 97));       // vyschnuté škvrny
    const bare  = sstep(0.74, 0.92, tfbm(u, v, 48, 2, 131));     // holá pôda medzi zhlukmi
    f.hf[i] = clump*0.55 + blade*0.30 + dry*0.10 - bare*0.35;
    const t = ss01(clump*1.15 + blade*0.35 - 0.25);
    let r = 58 + t*30 + dry*16 + bare*22;
    let g = 70 + t*30 + dry*10 + bare*14;
    let b = 42 + t*22 + dry*6  + bare*4;
    const j = (thash(x, y, SZ, 17) - 0.5)*8;
    putField(f, i, r + j, g + j, b + j);
  }
  return f;
}

// HLINA / POĎ: rovnaká priemerná svetlosť ako trávnik (aby sa pri prelínaní
// terénu nerozsvietil), len hnedá a s kamienkami.

export function fDirt(SZ){
  const f = newField(SZ);
  for(let y = 0; y < SZ; y++) for(let x = 0; x < SZ; x++){
    const u = x/SZ, v = y/SZ, i = y*SZ + x;
    const base = tfbm(u, v, 12, 3, 313);                         // základ pôdy
    const grit = tfbm(u, v, 160, 2, 331);                        // zrno
    const peb  = sstep(0.72, 0.92, tfbm(u, v, 80, 2, 347));     // kamienky
    const wet  = sstep(0.70, 0.94, tfbm(u, v, 5, 2, 359));      // vlhké kaluže
    f.hf[i] = base*0.45 + grit*0.25 + peb*0.45;
    const t = ss01(base*1.2 + grit*0.3 - 0.25);
    let r = 74 + t*34 - wet*16, g = 62 + t*26 - wet*14, b = 46 + t*18 - wet*12;
    r += peb*26; g += peb*24; b += peb*20;
    const j = (thash(x, y, SZ, 23) - 0.5)*8;
    putField(f, i, r + j, g + j, b + j);
  }
  return f;
}

// ZVLNENIE TERÉNU: nízkoamplitúdové fBm. Terén má 20 m bunky a dlažbu 32 m, takže
// mapa smie byť len jemný reliéf - zodpovedá skalám a hrbkám, nie makro-vlnám.

export function fTerrainN(){
  const SZ = 256, hf = new Float32Array(SZ*SZ);
  for(let y = 0; y < SZ; y++) for(let x = 0; x < SZ; x++){
    const u = x/SZ, v = y/SZ;
    hf[y*SZ + x] = tfbm(u, v, 8, 3, 401)*0.7 + tfbm(u, v, 32, 2, 409)*0.3;
  }
  return hf;
}

// BETÓN: bezfarebný izotropný povrch (mydlý, takže sa zneskutočne ani na vertikálne
// stiahnutých UV nepozná). Priemerná svetlosť ~150/255 = lineárne 0,30.

export function fConcrete(SZ){
  const f = newField(SZ);
  for(let y = 0; y < SZ; y++) for(let x = 0; x < SZ; x++){
    const u = x/SZ, v = y/SZ, i = y*SZ + x;
    const base  = tfbm(u, v, 24, 3, 211);
    const grit  = tfbm(u, v, 192, 2, 223);
    const pit   = sstep(0.80, 0.95, tfbm(u, v, 96, 2, 227));    // dierky v zmesi
    const agg   = sstep(0.62, 0.80, tfbm(u, v, 64, 2, 229));    // kamienky
    const stain = sstep(0.60, 0.92, tfbm(u, v, 5, 3, 233));     // voda stekajúca z fasády
    f.hf[i] = base*0.35 + grit*0.30 + agg*0.35 - pit*0.55;
    const l = 150 + f.hf[i]*44 - stain*32 + (thash(x, y, SZ, 19) - 0.5)*7;
    putField(f, i, l, l*1.00, l*1.03);
  }
  return f;
}

// DREVO: kôra (zvislé vlákna + hrčové očká) a doskové drážky. Použije sa na
// kmeny stromov (MAT.trunk) a neskôr na drevené fasády / ploty.

export function fWood(SZ){
  const f = newField(SZ), plankH = SZ/6;
  for(let y=0;y<SZ;y++) for(let x=0;x<SZ;x++){
    const u = x/SZ, v = y/SZ, i = y*SZ + x;
    // kôra: ťahané zvislé vlákna (fBm so silne stlačenou osou x) + hrčové očká
    const fib  = tfbm(u*3, v, 128, 3, 617);
    const fib2 = tfbm(u*3, v, 32, 2, 619);
    const knot = sstep(0.80, 0.95, tfbm(u*0.5, v*0.5, 8, 2, 631));
    const rough= tfbm(u, v, 192, 2, 641);
    f.hf[i] = fib*0.45 + fib2*0.35 + rough*0.20 + knot*0.30;
    const t = ss01(fib*1.3 + fib2*0.5 - 0.35);
    let r = 92 + t*54, g = 66 + t*42, b = 44 + t*26;
    r -= knot*34; g -= knot*26; b -= knot*16;                 // tmavé očko
    const j = (thash(x, y, SZ, 31) - 0.5)*8;
    putField(f, i, r + j, g + j, b + j);
  }
  return f;
}

// TEHLA: 8 courses / 4 tehly na dlažku + väzba o pol tehly. Smerová textúra, preto
// ide na vlastný slot s vlastným tilingom (komíny sú 3 x 60 m).

export function fBrick(){
  const SZ = 256, f = newField(SZ), bw = SZ/4, bh = SZ/8;
  for(let y = 0; y < SZ; y++) for(let x = 0; x < SZ; x++){
    const u = x/SZ, v = y/SZ, i = y*SZ + x;
    const row = Math.floor(y/bh);
    const xs = x + ((row % 2) ? bw*0.5 : 0);       // väzba tehly o pol tehly
    const fx = ((xs % SZ) + SZ) % SZ;
    const mortar = ((y % bh) < bh*0.80) && ((fx % bw) < bw*0.86) ? 0 : 1;
    const bid = (row*17 + Math.floor(fx/bw)*29) % 5;
    const grain = tfbm(u, v, 128, 2, 307);
    f.hf[i] = mortar ? 0.10 : (0.5 + grain*0.3);
    let r, g, b;
    if(mortar){ r = 176; g = 172; b = 162; }
    else{
      const tone = 0.80 + bid*0.09, j = (grain - 0.5)*30;
      r = 158*tone + j; g = 86*tone + j; b = 64*tone + j;
    }
    putField(f, i, r, g, b);
  }
  return f;
}

// ŠTRK / BALLAST (železničné lôžko, ploché strechy).

export function fBallast(){
  const SZ = 256, f = newField(SZ);
  for(let y = 0; y < SZ; y++) for(let x = 0; x < SZ; x++){
    const u = x/SZ, v = y/SZ, i = y*SZ + x;
    const st = sstep(0.52, 0.74, tfbm(u, v, 72, 2, 503));       // jednotlivé kamene
    const base = tfbm(u, v, 16, 2, 509);
    f.hf[i] = base*0.25 + st*0.75;
    const l = 96 + base*26 + st*56;
    putField(f, i, l*1.0, l*0.99, l*0.96);
  }
  return f;
}

// ---------- FASÁDA: mriežka okien + sprievodné mapy ODVODENÉ z obrázka ----------
// Rozvradenie okien používa iba procedurálny fallback (paintFacade). Pre
// FOTOGRAFIU je mriežka nepodstatná: sprievodné mapy sa odvodia z jasu samotného
// obrázka (vidz facadeAux), takže sadu 3x2 netreba dodržať.

export function winLayout(SZ){
  const k = SZ/128;
  return { S:SZ, x:8*k, y:12*k, dx:40*k, dy:64*k, w:26*k, h:42*k,
           fr:2*k, balY:4*k, balH:6*k, rail:8*k, sill:5*k, foot:10*k };
}
// Omietka + okenná mriežka 3x2 + balkónový pás + odlesk skla. Takmer biela omietka
// je neutrálny základ, ktorý vertex-tint (vertexColors) prefarbí do odtieňov
// kategórií A-D. Zdieľaný s tools/gen_placeholders.mjs.

export function paintFacade(g,s,W){
  g.fillStyle = "#ece8e0"; g.fillRect(0,0,s,s);
  speckle(g,s,Math.round(260*s/128),0.08);
  for(let r=0;r<2;r++){
    // balkónový pás nad každým radom okien (štylizované balkóny panelákov)
    const by = W.balY+r*W.dy;
    g.fillStyle = "#c9cdd3"; g.fillRect(0, by, s, W.balH);
    g.fillStyle = "rgba(60,64,70,0.55)";
    for(let bx=0;bx<s;bx+=W.rail){ g.fillRect(bx, by, Math.max(1,W.rail/8), W.balH); } // zábradlie
    for(let c=0;c<3;c++){
      const x = W.x+c*W.dx, y = W.y+r*W.dy, w = W.w, h = W.h;
      const lit = ((c*7+r*3)%5===0);
      g.fillStyle = "#f5f2ea"; g.fillRect(x-W.fr, y-W.fr, w+2*W.fr, h+2*W.fr); // okenný rám
      g.fillStyle = lit ? "#d8c86a" : "#232a33"; // sklo (svietiace / tmavé)
      g.fillRect(x, y, w, h);
      g.fillStyle = "rgba(255,255,255,0.20)"; // jemný odlesk skla hore
      g.fillRect(x, y, w, W.sill);
      g.fillStyle = "rgba(0,0,0,0.35)"; // parapetný tieň
      g.fillRect(x-W.fr, y+h+W.fr, w+2*W.fr, 3*s/128);
    }
  }
  g.fillStyle = "rgba(20,14,8,0.35)"; g.fillRect(0, s-W.foot, s, W.foot); // zapečený kontaktný tieň päty
}

// --- ODVODENIE sprievodných fasádnych máp Z OBÁRKA ----------------------------
// Difúzia fasády môže byť ľubovoľná (fotka paneláku, tehla, omietka) a preto sa
// roughness / normálová mapa NEDRŽIA V RUKÁ. Obe sa odvodia z jasu difúzie, takže
// vždy sedia na tie isté okná:
//
//   sklo = pixel MIESTAMI výrazne tmavší ako jeho okolie (lokálne priemer)
//          -> hladké (roughness 0,28) + vyrezané do steny (normálová mapa)
//   stena = rovnomerný jas
//          -> drsná (roughness 0,88) a s jemným reliéfom z vlastného reliéfu
//
// Nepotrebujeme teda vedieť, kde okná sú - funguje to s ľubovoľnou fotografiou.
// Bez toho by fotka s iným rozvodom okien nechala vyrezané zosklony a hladké
// odlesky na holých stenách.
//
// (Fasády NEMAJÚ emisívnu mapu - rozsvietené okná boli vypnuté na žiadosť.)

export function boxBlur(src, SZ, r){        // dva prechody separableho box bluru
  const a = new Float32Array(SZ*SZ), b = new Float32Array(SZ*SZ), inv = 1/(2*r+1);
  for(let y=0;y<SZ;y++){             // vodorovne (okraj = okrajový bod)
    let sum = 0;
    for(let x=-r;x<=r;x++) sum += src[y*SZ + Math.min(SZ-1, Math.max(0,x))];
    for(let x=0;x<SZ;x++){
      a[y*SZ+x] = sum*inv;
      sum += src[y*SZ + Math.min(SZ-1, x+r+1)] - src[y*SZ + Math.max(0, x-r)];
    }
  }
  for(let x=0;x<SZ;x++){             // zvisle
    let sum = 0;
    for(let y=-r;y<=r;y++) sum += a[Math.min(SZ-1, Math.max(0,y))*SZ + x];
    for(let y=0;y<SZ;y++){
      b[y*SZ+x] = sum*inv;
      sum += a[Math.min(SZ-1, y+r+1)*SZ + x] - a[Math.max(0, y-r)*SZ + x];
    }
  }
  return b;
}

// Prekreslí tri canvasy TEXTÚR na mieste (putImageData ignoruje transform, takže
// netreba nič posúvať) a povie GPU, nech znovu uploadne ten istý upload.

export function facadeAux(SZ){
  const src = S.TEX.wall.image;
  if(!src) return false;
  const work = newCanvas(SZ), wg = work.getContext("2d");
  let gray;
  try{
    wg.drawImage(src, 0, 0, SZ, SZ);                       // canvas aj <img> ide
    const d = wg.getImageData(0, 0, SZ, SZ).data;          // rovnako ako predtým
    gray = new Float32Array(SZ*SZ);
    // LINEARIZUJEME: kontrast, rozmazanie aj derivácie musia bežať v lineárnom
    // svetle, inak by tmavé okná vyzerali výraznejšie, než sú.
    for(let i=0;i<SZ*SZ;i++){
      const l = (d[i*4]*0.2126 + d[i*4+1]*0.7152 + d[i*4+2]*0.0722)/255;
      gray[i] = l <= 0.04045 ? l/12.92 : Math.pow((l+0.055)/1.055, 2.4);
    }
  }catch(e){
    if(typeof console !== "undefined"){
      console.warn("[TEX] fasádu sa nepodarilo prečítať do canvasu (tainted, " +
        "napr. file:// bez --allow-file-access-from-files) - sprievodné fasádne " +
        "mapy ostávajú na mriežke winLayout()");
    }
    return false;
  }
  // 1) lokálna úroveň steny = silne rozmazaný jas (polomer ~1/64 dlažby)
  const wall = boxBlur(gray, SZ, Math.max(2, SZ>>6));
  // 2) sklo = relatívne tmavšie ako okolie; 0.10 pokles = plná hustota skla
  const glass = new Float32Array(SZ*SZ);
  for(let i=0;i<SZ*SZ;i++) glass[i] = ss01(((wall[i] - gray[i])/(wall[i] + 0.12) - 0.03) * 9.0);
  // 3) roughness + výškové pole na normálovú mapu
  const rc = newCanvas(SZ), rg = rc.getContext("2d"), ri = rg.createImageData(SZ, SZ), rd = ri.data;
  const hf = new Float32Array(SZ*SZ);
  for(let i=0;i<SZ*SZ;i++){
    const g = glass[i];
    rd[i*4] = rd[i*4+1] = rd[i*4+2] = (0.88 - g*0.60)*255;   // stena 0,88 / sklo 0,28
    rd[i*4+3] = 255;
    hf[i] = (gray[i] - wall[i])*0.9 - g*0.55;                 // reliéf steny + vyrezanie skla
  }
  // 4) prepíšeme pixely PRIAMO do existujúcich canvasov textúr (žiadny nový objekt)
  S.TEX.winRough.image.getContext("2d").putImageData(ri, 0, 0);
  S.TEX.winNormal.image.getContext("2d").drawImage(normalCanvas(SZ, hf, 1.2), 0, 0);
  S.TEX.winRough.needsUpdate = true;
  S.TEX.winNormal.needsUpdate = true;
  return true;
}

export function buildTextures(){
  // Časovanie jednotlivých fáz. fGrass/fDirt/fConcrete sú generátory pixelov
  // (512² × niekoľko fBm oktáv) a spolu zaberú najviac času z celého bootu;
  // bez čísel je každá ďalšia optimalizácia bootu odhadom.
  const T = (typeof performance !== 'undefined' && performance.now) ? () => performance.now() : () => 0;
  let _t = T();
  const mark = (name) => { const n = T(); if (n) console.log("[TEX] " + name + " " + (n - _t).toFixed(0) + " ms"); _t = n; };

  // ---------- ROAD: asfalt (difúzia + normála + drsnost) ----------
  // UV pásu je v METROCH (pozri buildStrip/mergedStrips), takže repeat = 1/4 znamená
  // dlažbu každé 4 m: 512 px / 4 m = 128 px/m. Zrno asfaltu čitateľné z kabíny.
  const ROAD_TILE = 4;
  const ROAD_REP = [1/ROAD_TILE, 1/ROAD_TILE];
  const HQ = S.IS_MOBILE ? 256 : 512;   // mobil: 256 px = ~64 px/m, stalejsi grafika
  const A = fAsphalt(HQ);
  S.TEX.asphalt  = texSlotCanvas("asphalt",  "road/asphalt_diffuse.jpg",   A.dif, true,  ROAD_REP);
  S.TEX.asphaltN = texSlotCanvas("asphaltN", "road/asphalt_normal.png", normalCanvas(A.S, A.hf, 1.4), false, ROAD_REP);
S.TEX.asphaltR = texSlotCanvas("asphaltR", "road/asphalt_roughness.png", grayCanvas(A.S, A.rg),  false,  ROAD_REP);
  mark("asphalt");

  // ---------- TERRAIN: trávnik + hlina + zvlnenie ----------
  // repeat je odvodený z reálnej šírky mapy: 1 dlažba = ~32 m, teda 128 px / 32 m.
  const TW = (S.osm.bbox[2] - S.osm.bbox[0]) + 800;
  const TD = (S.osm.bbox[3] - S.osm.bbox[1]) + 800;
  // 1024 px / 16 m = 64 px/m: steblá trávnika sú čitateľné z kabíny. Pri 32 m by
  // fotka bola rozmazaná na polovicu. Opakovanie dlažby (281x cez 4,5 km) kryje
  // druhá vrstva v inom meradle a pod 34° (pozri GROUND_DIRT_XF).
  const GRASS_TILE = 16;
  const GRASS_REP = [Math.max(8, Math.round(TW/GRASS_TILE)), Math.max(8, Math.round(TD/GRASS_TILE))];
  const G = fGrass(HQ);
  S.TEX.grass   = texSlotCanvas("grass",   "terrain/grass_diffuse.jpg", commitField(G), true, GRASS_REP);
  S.TEX.terrainN = texSlotCanvas("terrainN", "terrain/terrain_normal.png",
                               normalCanvas(256, fTerrainN(), 6.0), false, GRASS_REP);
  // TEX.dirt je DVE mapy naraz: 2. vrstva terénu (scale berie z tDirtX v shadere
  // MAT.ground) a povrch nespevnených ciest (tu berie vlastný repeat 1/6 m).
  const D = fDirt(HQ);
  S.TEX.dirt    = texSlotCanvas("dirt",    "terrain/dirt_diffuse.png", commitField(D), true, [1/6, 1/6]);
  mark("trávnik+hlina");

  // ---------- BUILDINGS: betón + tehla ----------
  // Betón je bez smeru, takže jeden slot zdieľajú komíny, veža, stĺpy aj pamätník.
  const C = fConcrete(HQ);
  S.TEX.concrete  = texSlotCanvas("concrete", "buildings/concrete_diffuse.jpg", commitField(C), true, [2, 2]);
  S.TEX.concreteN = texSlotCanvas("concreteN", "buildings/concrete_normal.png", normalCanvas(C.size, C.hf, 1.6), false, [2, 2]);
  const BR = fBrick();
  S.TEX.brick  = texSlotCanvas("brick",  "buildings/brick.jpg", commitField(BR), true, [3, 12]);
  S.TEX.brickN = texSlotCanvas("brickN", "buildings/brick_normal.png", normalCanvas(BR.size, BR.hf, 2.2), false, [3, 12]);
  const WD = fWood(S.IS_MOBILE ? 128 : 256);
  S.TEX.wood  = texSlotCanvas("wood",  "buildings/wood.png", commitField(WD), true, [1, 3]);
  S.TEX.woodN = texSlotCanvas("woodN", "buildings/wood_normal.png", normalCanvas(WD.size, WD.hf, 1.8), false, [1, 3]);
  mark("betón+tehla+drevo");

  // ---------- FASÁDA: difúzia zo slotu + 3 sprievodné mapy ODOVIDENÉ z nej ----
  // Difúzia je SLOT (buildings/wall.png): kým ten neexistuje, kreslí sa omietka
  // s oknami. Vertex-tint (vertexColors) ju prefarbí do odtieňov kategórií A-D.
  // Emisívnu / roughness / normálovú mapu NEDRŽÍME - facadeAux() ich prepočíta
  // z jasu difúzie, takže sadu 3x2 netreba dodržať a funguje ľubovoľná fotka.
  const FS = HQ;                 // 512 px / 8 m steny = 64 px/m (mobile 256)
  const W  = winLayout(FS);
  S.TEX.winGrid = texSlot("wall", "buildings/wall.png", FS, true, null,
    function(g,s){ paintFacade(g, s, W); },
    function(){ facadeAux(FS); });          // súbor dobehol -> prepočítaj z fotky
  // Dve sprievodné mapy: najprv čisto placeholder (facadeAux ich hneď prepíše),
  // canvas musí existovať, lebo doň potom kreslíme pixely z odvodených polí.
  S.TEX.winRough = makeTex(FS, function(g,s){ g.fillStyle = "#d9d9d9"; g.fillRect(0,0,s,s); });
  S.TEX.winNormal= makeTex(FS, function(g,s){ g.fillStyle = "#8080ff"; g.fillRect(0,0,s,s); });
  facadeAux(FS);                           // odvodiť z procedurálnej omietky
  // FLIP VERTIKÁLNE. ExtrudeGeometry dáva bočnej stene UV v = y (výška) RASTÚCU
  // nahor, no textura má predvolene flipY = true -> horný riadok obrázka dopadne
  // na pätu steny. Pri procedurálnej omietke to nebolo vidieť (mriežka je skoro
  // symetrická), ale fotka paneláku visela obrátene a "kontaktný tieň päty" bol
  // hore. Všetky TRI fasádne mapy musia mať flipY = 0 NARAZ, inak by sa
  // roughness / normal s difúziou rozšli.
  S.TEX.wall.flipY = false;
  S.TEX.winRough.flipY = S.TEX.winNormal.flipY = false;
  S.TEX.wall.needsUpdate = true;
  S.TEX.winRough.needsUpdate = S.TEX.winNormal.needsUpdate = true;

  // Škridlový bump pre šikmé terakotové strechy (lineárny, do bumpMap).
  S.TEX.roofTile = (function(){
    const c = newCanvas(128);
    const g = c.getContext("2d");
    g.fillStyle = "#808080"; g.fillRect(0,0,128,128);
    for(let y=0;y<128;y+=16){
      g.fillStyle = "#3d3d3d"; g.fillRect(0, y, 128, 2); // rad škridiel
      for(let x=0;x<128;x+=16){
        const ox = ((y/16)%2) ? 8 : 0;
        g.fillStyle = "#5a5a5a"; g.fillRect((x+ox)%128, y+2, 2, 14); // zvislá drážka
        g.fillStyle = "rgba(255,255,255,0.25)"; g.fillRect((x+ox)%128+2, y+2, 12, 2); // hrana
      }
    }
    return texFromCanvas(c, false);
  })();
  // Vlnitý plech pre priemysel/obchody (Kat. C).
  S.TEX.sheet = texSlot("sheet", null, 256, true, null, function(g,s){
    g.fillStyle = "#c3c9d1"; g.fillRect(0,0,s,s);
    for(let x=0;x<s;x+=16){
      g.fillStyle = "rgba(255,255,255,0.30)"; g.fillRect(x, 0, 2, s);
      g.fillStyle = "rgba(40,46,54,0.30)"; g.fillRect(x+8, 0, 3, s);
    }
    speckle(g,s,300,0.08);
  });
  // Štrková/asfaltová plochá strecha (Kat. B/C) - tá istá textúra železničného lôžka.
  const BA = fBallast();
  S.TEX.gravel = texSlotCanvas("gravel", "buildings/gravel.png", commitField(BA), true, null);
  S.TEX.facade = S.TEX.winGrid; // spätná kompatibilita (starý názov -> nová mriežka)
  S.TEX.bridge = texSlot("bridge", null, 256, true, [1/8, 1/8], function(g,s){
    g.fillStyle="#6f6f72"; g.fillRect(0,0,s,s);
    speckle(g,s,500,0.16);
    g.fillStyle="rgba(50,40,25,0.35)";
    for(let i=0;i<12;i++){ g.fillRect(0,(i*23)%s,s,3); }
  });
  mark("fasády+strechy");
  texReport(true);
}

// ---------- REPORT: čo je naozaj naviazané na GPU (do konzoly) ----------
// Volá sa dvakrát: raz hneď po založení slotov (len jednoriadkový stav) a
// raz, keď posledný súbor dobehne - vtedy tabuľka, ktorá je už definitívna.

export function texReport(quiet){
  if(!(typeof console !== "undefined" && console.log)) return;
  const files = TEX_SLOTS.filter(function(s){ return s.src.indexOf("subor") === 0; }).length;
  if(quiet || TEX_PENDING > 0){
    console.log("%c[TEX] " + TEX_SLOTS.length + " slotov, " + TEX_PENDING + " sa zatial nacitava " +
      "z " + ASSET_ROOT + " (proceduralny fallback medzicasom)...",
      "color:#c9a227;font-weight:bold");
    return;
  }
  for(let i=0;i<TEX_SLOTS.length;i++){
    const s = TEX_SLOTS[i], t = s.tex, im = t.image;
    const px = im ? ((im.naturalWidth || im.width || (im.canvas && im.canvas.width) || s.size)) : s.size;
    const col = s.src.indexOf("subor") === 0 ? "#7fd67f" : "#c9a227";
    console.log("%c[TEX] " + (s.key + "                ").slice(0, 16) +
      ("" + px + "px").slice(-6) +
      "  repeat " + t.repeat.x.toFixed(3) + "x" + t.repeat.y.toFixed(3) +
      "  aniso " + t.anisotropy + "  " + (t.colorSpace === THREE.SRGBColorSpace ? "sRGB " : "linear") +
      "  mip " + (t.generateMipmaps ? "ano" : "nie") +
      "  <- " + s.src, "color:" + col);
  }
  console.log("%c[TEX] " + TEX_SLOTS.length + " slotov hotovych: " + files + " z disku, " +
    (TEX_SLOTS.length - files) + " proceduralnych · anizotropia " + S.TEX_ANISO +
    "x · POT <= " + ASSET_MAX_PX + " · mipmapy + trilinear",
    "color:#7fd67f;font-weight:bold");
}

export function makeLabel(text, scale){
  const c = document.createElement("canvas");
  c.width = 512; c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "rgba(8,6,2,0.85)"; g.fillRect(0,0,512,128);
  g.strokeStyle = "#ffb000"; g.lineWidth = 6; g.strokeRect(4,4,504,120);
  g.fillStyle = "#ffb000";
  const fs = text.length > 10 ? Math.max(30, Math.floor(620/text.length)) : 52;
  g.font = "bold " + fs + "px Courier"; g.textAlign = "center";
  g.fillText(text, 256, 84);
  const t = new THREE.CanvasTexture(c);
  const m = new THREE.SpriteMaterial({ map: t, fog: false });
  const sp = new THREE.Sprite(m);
  const wf = text.length > 8 ? text.length/8 : 1;
  sp.scale.set(24*scale*wf, 6*scale, 1);
  S.TEX["lbl_"+text] = t; S.MAT["lbl_"+text] = m;
  return sp;
}

// ---------- MATERIÁLY A GEOMETRIE (raz, zdieľané) ----------

export function buildShared(){
  S.GEO.box   = new THREE.BoxGeometry(1,1,1);
  S.GEO.cyl   = new THREE.CylinderGeometry(0.5,0.5,1,10);
  S.GEO.cone  = new THREE.ConeGeometry(0.5,1,8);
  S.GEO.body  = new THREE.BoxGeometry(1.8, 0.65, 4.2);
  S.GEO.bodyP = S.GEO.body.clone(); // klon LEN pre hráča (deformácia damage, AI zdieľa GEO.body)
  S.GEO.bodyP.userData.base = S.GEO.bodyP.attributes.position.array.slice(); // panenský stav pre reset
  S.GEO.cabin = new THREE.BoxGeometry(1.6, 0.55, 2.0);
  S.GEO.wheel = new THREE.CylinderGeometry(0.33, 0.33, 0.25, 10);
  S.GEO.light = new THREE.BoxGeometry(0.42, 0.22, 0.12);
  S.GEO.blob  = new THREE.CircleGeometry(1.2, 10);
  S.GEO.blob.rotateX(-Math.PI/2); // tieňová elipsa naležato

  // VOZOVKA: difúzia + normálová mapa (zrno/trhliny reálne menia smer svetla) +
  // drsnostná mapa (lesklý štrk vs. matné jamky). UV pásu je v METROCH a repeat
  // textúry je 1/4 -> dlažba každé 4 m, teda 512 px / 4 m = 128 px/m. Na dlhej
  // úsečke OSM to znamená, že zrno ostáva rovnaké od začiatku po koniec a vďaka
  // mipmapám + anizotropii sa v diaľke nerozpadá na šedú plochu.
  const roadPBR = { map: S.TEX.asphalt, normalMap: S.TEX.asphaltN, roughnessMap: S.TEX.asphaltR,
                    roughness: 0.92, metalness: 0.0, side: THREE.DoubleSide,
                    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 };
  S.MAT.asphalt = new THREE.MeshStandardMaterial(roadPBR);
  // vozovka trasy misie: rovnak\u00fd asfalt, ale silnej\u0161\u00ed depth bias - mestske cesty
  // v\u00f3dy\u0161aj\u00fa pod \u0161irku trasy a musia pod\u011ba\u0165 (samy o sebe by sa zob\u013eovali)
  roadPBR.polygonOffsetFactor = -4; roadPBR.polygonOffsetUnits = -8;
  S.MAT.routeAsphalt = new THREE.MeshStandardMaterial(roadPBR);
  // nespevnené cesty: tá istá hlina ako 2. vrstva terénu, dlažka 6 m (repeat 1/6)
  S.MAT.dirt    = new THREE.MeshStandardMaterial({ map: S.TEX.dirt, color: 0xffffff, roughness: 0.97, metalness: 0.0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  S.MAT.ballast = new THREE.MeshStandardMaterial({ color: 0x55524e, roughness: 0.9, metalness: 0.0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  S.MAT.park    = new THREE.MeshStandardMaterial({ color: 0x4a6b3f, roughness: 0.9, metalness: 0.0,
                     polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  // TERÉN = DVE VRSTVY, nie jedna dlažba. Tráva (map) a hlina (tDirt) sa miešajú
  // podľa aBlend z výšky/sklonu/poľa, každá v INOM meradle a pod INÝM uhlom
  // (34°) - dve periodicité sa nedajú spoĺať do jednej viditeľnej mriežky.
  // repeat trávnika je 1 dlažba / ~32 m (odvodené v buildTextures z bbox mapy).
  S.MAT.ground  = new THREE.MeshStandardMaterial({ map: S.TEX.grass, normalMap: S.TEX.terrainN, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 1.0, metalness: 0.0, vertexColors: true, dithering: true });
  // DETAIL FADE PODĽA SKUTOČNEJ MINIFIKÁCIE. Pri pohľade nízko po zemi alebo
  // z výšky pokrýva jeden pixel v hĺbke aj desiatky metrov terénu, ale naprieč
  // len desiatky centimetrov. Akákoľkova 2D textúra sa tak vertikálne spriemeruje,
  // ale horizontálne nie - a vzniknú vodorovné pruhy (moiré medzi textúrou a
  // mriežkou pixelov, preto sa menia s rozlíšením aj výškou kamery). Vzdialenosť
  // sama o sebe nestačí, lebo rovnaká diaľka pri inom uhle minifikuje inak -
  // preto sa meria priamo stopa pixelu v metroch cez derivácie view pozície.
  // Keď pixel presiahne ~2 texely mapy, detail sa stiahne na STREDNÚ hodnotu
  // (nie na bielu - MAT.ground nemá color a vertex farby sú >1, takže fade na
  // bielu by diaľku prepálil do biela) a zostanú hladké vertex farby.
  // GROUND_DIRT_XF = (scale.xy, offset.xy) pre ručný odber druhej vrstvy; tento
  // texture2D() je MIMO repeatu textúry (ten patrí povrchu nespevnených ciest).
  const GROUND_DIRT_XF = new THREE.Vector4(1.55, 1.55, 0.3137, 0.6741);
  const GROUND_AVERAGE = new THREE.Vector3(0.075, 0.088, 0.049);
  S.MAT.ground.onBeforeCompile = function(sh){
    sh.uniforms.tDirt = { value: S.TEX.dirt };
    sh.uniforms.tDirtX = { value: GROUND_DIRT_XF };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aBlend;\nvarying float vBlend;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvBlend = aBlend;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>",
        "#include <common>\nuniform sampler2D tDirt;\nuniform vec4 tDirtX;\nvarying float vBlend;")
      .replace("#include <map_fragment>",
        // mat2 je v GLSL stĺpcovo: toto je rotácia o ~34° (det = 1, teda bez zmeny mierky)
        "  vec2 guvD = mat2(0.8253, -0.5646, 0.5646, 0.8253) * vMapUv * tDirtX.xy + tDirtX.zw;\n" +
        "#include <map_fragment>\n" +
        "  vec3 gDirt = texture2D(tDirt, guvD).rgb;\n" +
        "  float wpix = length(dFdx(vViewPosition)) + length(dFdy(vViewPosition));\n" +
        "  float gfade = 1.0 - smoothstep(0.30, 1.20, wpix);\n" +
        // hrana prelínania sa necha riadiť z vlastnej mapy trávnika (zelený
        // kanál), inak by bola každá fliaha geometrický ostrý obdĺžnik 20 m
        "  float gblend = clamp(vBlend + (sampledDiffuseColor.g - 0.5)*0.85, 0.0, 1.0);\n" +
        "  vec3 gtex = mix(sampledDiffuseColor.rgb, gDirt, gblend);\n" +
        "  gtex = mix(vec3(" + GROUND_AVERAGE.x.toFixed(4) + ", " + GROUND_AVERAGE.y.toFixed(4) +
        ", " + GROUND_AVERAGE.z.toFixed(4) + "), gtex, gfade);\n" +
        "  diffuseColor.rgb = gtex;");
  };
  S.MAT.ground.customProgramCacheKey = function(){ return "ground-grass-dirt-fade"; };
  // ---- Čisté PBR fasády podľa kategórie budov (multi-material setup) ----
  // Kat. A - RODINNÉ DOMY: teplé pastelové omietky (tint cez vertexColors), roughness 0.85.
  S.MAT.houseWall = new THREE.MeshStandardMaterial({ map: S.TEX.winGrid, roughnessMap: S.TEX.winRough, normalMap: S.TEX.winNormal, normalScale: new THREE.Vector2(0.55, 0.55), roughness: 0.85, metalness: 0.02, vertexColors: true });
  // Kat. B - PANELÁKY: slovenské odtiene + okenná mriežka s balkónmi + jemný odlesk skiel.
  S.MAT.panelWall = new THREE.MeshStandardMaterial({ map: S.TEX.winGrid, roughnessMap: S.TEX.winRough, normalMap: S.TEX.winNormal, normalScale: new THREE.Vector2(0.55, 0.55), roughness: 0.9, metalness: 0.08, vertexColors: true });
  // Kat. C - PRIEMYSEL/OBCHODY: svetlosivý vlnitý plech + betón (#a0a8b0), plochá strecha.
  S.MAT.indWall = new THREE.MeshStandardMaterial({ map: S.TEX.sheet, color: 0xa0a8b0, roughness: 0.55, metalness: 0.35, vertexColors: true });
  // Kat. D - HISTORICKÉ: kameň/omietka (#d9cebe cez tint), zvýraznené kontúry (plný jas mapy).
  S.MAT.histWall = new THREE.MeshStandardMaterial({ map: S.TEX.winGrid, roughnessMap: S.TEX.winRough, normalMap: S.TEX.winNormal, normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.9, metalness: 0.0, vertexColors: true });
  // Strechy: šikmá terakotová škridla s bump vzorom vs. plochá štrková/asfaltová.
  S.MAT.pitchedRoof = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.05, vertexColors: true, bumpMap: S.TEX.roofTile, bumpScale: 0.6 });
  S.MAT.flatRoof = new THREE.MeshStandardMaterial({ map: S.TEX.gravel, roughness: 0.95, metalness: 0.0, vertexColors: true });
  // Spätné aliasy (kód mimo buildBuildings ich nepoužíva, buildBuildings ide na nové maty).
  S.MAT.facade  = S.MAT.panelWall;
  S.MAT.facade2 = new THREE.MeshStandardMaterial({ map: S.TEX.winGrid, normalMap: S.TEX.winNormal, normalScale: new THREE.Vector2(0.55, 0.55), color: 0xe6d9c2, roughness: 0.85, metalness: 0.02 });
  S.MAT.facade3 = new THREE.MeshStandardMaterial({ map: S.TEX.winGrid, normalMap: S.TEX.winNormal, normalScale: new THREE.Vector2(0.55, 0.55), color: 0xc9d2d8, roughness: 0.9, metalness: 0.05 });
  S.MAT.concrete= new THREE.MeshStandardMaterial({ map: S.TEX.concrete, normalMap: S.TEX.concreteN, normalScale: new THREE.Vector2(0.5, 0.5), color: 0xffffff, roughness: 0.9, metalness: 0.0 });
  S.MAT.chimneyBrick = new THREE.MeshStandardMaterial({ map: S.TEX.brick, normalMap: S.TEX.brickN, normalScale: new THREE.Vector2(0.85, 0.85), color: 0xffffff, roughness: 0.94, metalness: 0.0 }); // tehlový komín
  S.MAT.chimneyConcrete = new THREE.MeshStandardMaterial({ map: S.TEX.concrete, normalMap: S.TEX.concreteN, normalScale: new THREE.Vector2(0.5, 0.5), color: 0xd6dade, roughness: 0.92, metalness: 0.0 }); // betónový komín
  S.MAT.chimneyDark = new THREE.MeshStandardMaterial({ color: 0x2a2320, roughness: 0.95, metalness: 0.0 }); // ústa komína
  S.MAT.bridge  = new THREE.MeshStandardMaterial({ map: S.TEX.bridge, color: 0x2a2b2e, roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  S.MAT.dark    = new THREE.MeshStandardMaterial({ color: 0x1c1c20, roughness: 0.7, metalness: 0.3 });
  S.MAT.glass   = new THREE.MeshStandardMaterial({ color: 0x18242f, roughness: 0.22, metalness: 0.6, envMapIntensity: 1.0 });
  S.MAT.roof    = S.MAT.pitchedRoof; // alias: všetky strechy cez pitched/flat maty
  S.MAT.facadeInd = S.MAT.indWall; // alias: priemyselné steny cez vlnitý plech
  S.MAT.white   = new THREE.MeshBasicMaterial({ color: 0xd8d8d2, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  S.MAT.rail    = new THREE.MeshStandardMaterial({ color: 0x1a5fb4, roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide }); // mostná modrá
  S.MAT.sidewalk = new THREE.MeshStandardMaterial({ color: 0xa3a8b0, roughness: 0.9, metalness: 0.0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  S.MAT.cycle   = new THREE.MeshStandardMaterial({ color: 0xa02828, roughness: 0.9, metalness: 0.0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  S.MAT.pillar  = new THREE.MeshStandardMaterial({ map: S.TEX.concrete, normalMap: S.TEX.concreteN, normalScale: new THREE.Vector2(0.45, 0.45), color: 0xa8adb2, roughness: 0.9, metalness: 0.0 });
  S.MAT.island  = new THREE.MeshStandardMaterial({ color: 0x5c6248, roughness: 0.9, metalness: 0.0 });
  S.MAT.trunk   = new THREE.MeshStandardMaterial({ map: S.TEX.wood, normalMap: S.TEX.woodN, normalScale: new THREE.Vector2(0.5, 0.5), color: 0xc8b49c, roughness: 0.96, metalness: 0.0 });
  S.MAT.leaf    = new THREE.MeshStandardMaterial({ color: 0x3d5231, roughness: 0.9, metalness: 0.0 });
  S.MAT.leafDark = new THREE.MeshStandardMaterial({ color: 0x2d5022, roughness: 0.95, metalness: 0.0 });
  S.MAT.pole    = new THREE.MeshStandardMaterial({ color: 0x2c2c30, roughness: 0.6, metalness: 0.5 });
  S.MAT.lampOn  = new THREE.MeshBasicMaterial({ color: 0xffd98a });
  S.MAT.head    = new THREE.MeshBasicMaterial({ color: 0xfff2c0 });
  S.MAT.brakeOn = new THREE.MeshBasicMaterial({ color: 0xff1a1a });
  S.MAT.brakeOff= new THREE.MeshBasicMaterial({ color: 0x550a0a });
  S.MAT.escape  = new THREE.MeshBasicMaterial({ color: 0x39ff6a, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  S.MAT.blob    = new THREE.MeshBasicMaterial({ color: 0x000000, transparent:true, opacity:0.35, depthWrite:false });
  S.MAT.playerCar = new THREE.MeshStandardMaterial({ color: 0xd42a1e, roughness: 0.32, metalness: 0.4, envMapIntensity: 0.7 }); // exkluzívna červená hráča
  S.MAT.chrome = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.22, metalness: 0.9, envMapIntensity: 1.0 }); // lišty + puklice
  S.MAT.tail = new THREE.MeshStandardMaterial({ color: 0x7a0f0f, roughness: 0.4, metalness: 0.2 }); // kryty zadných svetiel
  S.MAT.plate = new THREE.MeshStandardMaterial({ color: 0xe8e8e4, roughness: 0.6, metalness: 0.0 }); // EČV
  const palette = [0xb03030, 0x2b5aa0, 0xc7c7c7, 0x303035, 0xc07a20, 0x3f7a3f, 0x7a7a8a, 0xd42a1e];
  for(let i=0;i<palette.length;i++){ S.CAR_COLORS.push(new THREE.Color(palette[i])); }
}
