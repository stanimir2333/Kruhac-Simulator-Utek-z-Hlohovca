// src/world/height.js — analytický výškový model OSM (verbatim port, js 2932–3547, bez sim-funkcií).
import { S } from './shared.js';
import { roadDist2 } from './roads.js'; //POZOR: deferred-use cyklus roads↔height — volá sa až za behu, nie pri importe

export const LANE_OFF = 1.75;   // pravý pruh v smere úniku (jazdíme vpravo)
// Hladina Váhu NIE JE rovinná konštanta: voda leží vždy RIVER_WATER_LIFT nad dnom
// svojho koryta (rieka tečie z kopca, brehy z OSM). RIVER_REF_Y je len
// referenčná nula pre rezervu podania mosta, ak by koryto chýbalo.
const RIVER_REF_Y = -8;
const RIVER_CLEAR = 4.5;      // minimálne podanie mosta nad hladinou Váhu
const DECK_RISE = 4.2;         // mostovka je o toľko nad okolitou nivóou (násyp/rampa)
// -- Zámocký kopec: vrch nad Zámockou záhradou (OSM park 563x652 m, stred -1883,-128) --
const CASTLE_R = 560, CASTLE_H = 30;
// Polomer podpory jedneho OSM meracieho bodu. OSM ma v exporte len 8 pouzitelnych
// uzlov ele, takze podpora musi pokryt medzery medzi nimi inak by pole nebolo
// spojite a medzi bodmi by vznikali diery. 900 m je nad polovickou vzdialenostou
// najdalsieho paru bodov (Zamocka zahrada / Podzamska ~113 m) a pod vacsinou
// ostatnych medzier, takze kazdy bod ma este Asupor vplyv na kazdy iny.
const ELE_RAD = 900;
// Odmietnutie chybnych nadmorskych vysk. Export obsahuje uzol mesta
// (id 26036344, ele=451 m) prevzaty z GNS - pre Hlohovec je to preklep, realna
// nadmorska vyska mesta je ~135 m a lezi o 291 m nad medianou. Takuto hodnotu
// vyfiltrujeme dvoma bránami: fyzikálny rozsah a odľahlost od mediany.
// Tolerancia 120 m je zvolena tak, aby NEPREKROČILA realny relief z mapy
// (rúdny svah Malých Karpátov "Urbánek" je 242 m, teda 82 m od mediany) - inak by
// sa odfiltrovala aj spravodajva vyska z vrcholu kopca.
const ELE_OUTLIER = 120;      // maximalna odchylka od mediany (m)
const ELE_FLOOR = 118, ELE_CEIL = 460;  // absolutny fyzikálny rozsah pre okolie (m)
// -- Simplex noise 2D (kompaktná seeded implementácia, žiadna závislosť) --
const SX_P = new Uint8Array(512);
(function(){
  let s = 1337;
  const p = new Uint8Array(256);
  for(let i=0;i<256;i++) p[i]=i;
  function rnd(){ s = (s*1103515245 + 12345) & 0x7fffffff; return s/0x7fffffff; }
  for(let i=255;i>0;i--){ const j = (rnd()*(i+1))|0; const t = p[i]; p[i] = p[j]; p[j] = t; }
  for(let i=0;i<512;i++) SX_P[i] = p[i&255];
})();
const SX_G = new Float32Array([1,1,-1,1,1,-1,-1,-1,1,0,-1,0,0,1,0,-1]);
// ---------- VODNÉ LÍNIE Z OSM + priestorová mriežka (rýchle dotazy bez O(n) skenu) ----------
let ROUND_C = null;
// Váh: rovné dno podľa OSM šírky (width 60 m, plná šírka koryta 90 m) + breh 75 m.
// Hlboké plytké koryto drží brehy OSM meracích bodov pri rieke (pri Váhu 58 m,
// mýtnica 82 m, Kozí vrch 134 m od osi) na ich nadmorských výškách.
const RIVER_BANK = 75;
const RIVER_DEPTH = 3.6;         // hĺbka koryta pod okolitou nivelou
const RIVER_WATER_LIFT = 1.5;   // hladina vody nad dnom koryta
const WGRID_REACH = 45+RIVER_BANK;   // max. dolet koryta
const WGRID_CS = WGRID_REACH+2;           // 3x3 bunky musia vždy pokryť celý vplyv
const RIV = [0, 0]; // [deltaY, riverF] - scratch (bez alokácií)
// ---------- OSM VÝŠKOVÝ MODEL: body ele -> C2 korekčné bumpy (presné cez každý bod) ----------
let ELE_N = 0, ELE_PX = null, ELE_PZ = null, ELE_TY = null, ELE_R = null, ELE_A = null;
// ---------- VÝŠKOVÉ PROFILY CIEST (zarovnanie terénu pod vozovkou) ----------
// Každá línia dostane vlastný vyhladený profil z terénu BEZ koryta (násyp pri
// rieke = premostenie) s tvrdým limitom sklonu. Terén sa k profilu stiahne.
const RDG = { cs:0, nx:0, nz:0, head:null, next:null };
const RDP = { x:null, z:null, y:null, deck:null };
const ROAD_MAX_GRADE = 0.12;    // 12 % limit sklonu cesty (symetrické obmedzenie)
const PROF_SMOOTH = 20;         // +/- m vyhladenia profilu cesty (2 priechody)
const CORR_FLAT = 13;           // rovina pod vozovkou (m)
const CORR_FADE = 46;           // hladký prechod násyp/zárez (m)
const CORR_MAX_FIX = 4.0;       // maximálna korekcia terénu pod vozovkou (m)
const RC = [0, 0];              // [výška, jeTrasa] - scratch
let roadsReady = false;

export function sxNoise(x, z){
  const F = 0.3660254037844386, G = 0.21132486540518713;
  const s = (x+z)*F, i = Math.floor(x+s), j = Math.floor(z+s);
  const t = (i+j)*G, x0 = x-(i-t), z0 = z-(j-t);
  const i1 = (x0 > z0) ? 1 : 0, j1 = (x0 > z0) ? 0 : 1;
  const x1 = x0-i1+G, z1 = z0-j1+G, x2 = x0-1+2*G, z2 = z0-1+2*G;
  const ii = i & 255, jj = j & 255;
  let n = 0, t0 = 0.5-x0*x0-z0*z0;
  if(t0 > 0){ t0 *= t0; const g = (SX_P[ii+SX_P[jj]] & 7)*2; n += t0*t0*(SX_G[g]*x0+SX_G[g+1]*z0); }
  let t1 = 0.5-x1*x1-z1*z1;
  if(t1 > 0){ t1 *= t1; const g = (SX_P[ii+i1+SX_P[jj+j1]] & 7)*2; n += t1*t1*(SX_G[g]*x1+SX_G[g+1]*z1); }
  let t2 = 0.5-x2*x2-z2*z2;
  if(t2 > 0){ t2 *= t2; const g = (SX_P[ii+1+SX_P[jj+1]] & 7)*2; n += t2*t2*(SX_G[g]*x2+SX_G[g+1]*z2); }
  return 70*n;
}

export function sxFbm(x, z){
  return sxNoise(x, z)*0.65 + sxNoise(x*2.13+7.3, z*2.13-3.1)*0.25 + sxNoise(x*4.41-5.2, z*4.41+9.7)*0.10;
}

export function smooth01(t){ t = t < 0 ? 0 : (t > 1 ? 1 : t); return t*t*(3-2*t); }

// najmenšia štvorcová vzdialenosť bodu od vzorkovanej línie S = [x,z,x,z,...]
export function dist2ToSamples(x, z, samples){
  let best = 1e18;
  for(let i=0;i<samples.length;i+=2){
    const dx = samples[i]-x, dz = samples[i+1]-z, d = dx*dx+dz*dz;
    if(d < best) best = d;
  }
  return best;
}

export function resampleLine(pts, step){   // pts = [x0,z0,x1,z1,...] -> [x,z,...] po `step` m
  const out = [];
  for(let i=2;i<pts.length;i+=2){
    const ax = pts[i-2], az = pts[i-1], bx = pts[i], bz = pts[i+1];
    const L = Math.sqrt((bx-ax)*(bx-ax)+(bz-az)*(bz-az)) || 1;
    const n = Math.max(1, Math.round(L/step));
    for(let k=(i===2?0:1);k<=n;k++){ out.push(ax+(bx-ax)*k/n, az+(bz-az)*k/n); }
  }
  if(out.length < 4) return [pts[0], pts[1], pts[pts.length-2], pts[pts.length-1]];
  return out;
}

export function buildWaterSamples(){
  const xs = [], zs = [], hw = [], bg = [];
  const wl = S.osm.water;
  for(let li=0;li<wl.length;li++){
    const L = wl[li], n = (L.length-1)/2;
    if(n < 2) continue;
    const pts = L.slice(1);
    const big = (L[0] >= 10);
    const r = resampleLine(pts, big ? 20 : 14);
    const halfW = big ? L[0]*0.75 : Math.max(4, L[0]*0.5+3);
    for(let k=0;k<r.length;k+=2){ xs.push(r[k]); zs.push(r[k+1]); hw.push(halfW); bg.push(big?1:0); }
  }
  const n = xs.length;
  S.WPT.x = new Float32Array(xs); S.WPT.z = new Float32Array(zs);
  S.WPT.hw = new Float32Array(hw); S.WPT.big = new Float32Array(bg);
  S.WGRID.cs = WGRID_CS;   // >= WGRID_REACH: 3x3 bunky vždy pokryjú celý vplyv
  S.WGRID.nx = Math.ceil((S.GB.x1-S.GB.x0)/S.WGRID.cs);
  S.WGRID.nz = Math.ceil((S.GB.z1-S.GB.z0)/S.WGRID.cs);
  S.WGRID.head = new Int32Array(S.WGRID.nx*S.WGRID.nz).fill(-1);
  S.WGRID.next = new Int32Array(n);
  for(let i=0;i<n;i++){
    let cx = Math.floor((S.WPT.x[i]-S.GB.x0)/S.WGRID.cs), cz = Math.floor((S.WPT.z[i]-S.GB.z0)/S.WGRID.cs);
    if(cx < 0) cx = 0; else if(cx >= S.WGRID.nx) cx = S.WGRID.nx-1;
    if(cz < 0) cz = 0; else if(cz >= S.WGRID.nz) cz = S.WGRID.nz-1;
    const c = cz*S.WGRID.nx+cx;
    S.WGRID.next[i] = S.WGRID.head[c]; S.WGRID.head[c] = i;
  }
}

// Koryto z OSM vodných línií. RIV[0] = zmena Y (m, <= 0), RIV[1] = vplyv rieky 0..1.
// Váh: koryto vyrezané RIVER_DEPTH pod okolitou nivelou, breh RIVER_BANK.
// Potoky: plytké (2.2 m) úzke koryto relatívne k terénu.
export function riverCarveAt(x, z, h){
  let best = 0, riverF = 0;
  if(!S.WPT.x) { RIV[0] = 0; RIV[1] = 0; return RIV; }
  const ring = 1;
  const ccx = Math.floor((x-S.GB.x0)/S.WGRID.cs), ccz = Math.floor((z-S.GB.z0)/S.WGRID.cs);
  for(let ax=-ring;ax<=ring;ax++){
    for(let az=-ring;az<=ring;az++){
      const cx = ccx+ax, cz = ccz+az;
      if(cx < 0 || cz < 0 || cx >= S.WGRID.nx || cz >= S.WGRID.nz) continue;
      let id = S.WGRID.head[cz*S.WGRID.nx+cx];
      while(id >= 0){
        const dx = S.WPT.x[id]-x, dz = S.WPT.z[id]-z;
        const d2 = dx*dx+dz*dz;
        if(d2 < WGRID_REACH*WGRID_REACH){
          const d = Math.sqrt(d2), w = S.WPT.hw[id];
          if(S.WPT.big[id] > 0.5){
            // Váh: koryto vyrezané RIVER_DEPTH pod okolitou nivelou, breh RIVER_BANK
            const t = 1-smooth01((d-w)/RIVER_BANK);
            if(-RIVER_DEPTH*t < best) best = -RIVER_DEPTH*t;
            if(t > riverF) riverF = t;
          }else if(d < w+40){
            // potok: plytké úzke koryto (2.2 m pod okolím)
            const t = 1-smooth01((d-w)/30);
            if(-2.2*t < best) best = -2.2*t;
          }
        }
        id = S.WGRID.next[id];
      }
    }
  }
  RIV[0] = best; RIV[1] = riverF;
  return RIV;
}

// Dno koryta a hladina vody: voda leží vždy RIVER_WATER_LIFT nad dnom vlastného
// koryta, takže rieka tečie z kopca a nikdy neunikne z terénu ani sa nezakope.
export function riverBedY(x, z){
  const land = landAt(x, z);
  return land + riverCarveAt(x, z, land)[0];
}

export function riverWaterY(x, z){
  return riverBedY(x, z)+RIVER_WATER_LIFT;
}

// vzdialenosť k najbližšej vodnej línii (kvadrát). Volá ju riverbankSlowdown
// (src/world/water.js), ktorý používa mŕtvy src/ai/police.js.
export function waterDist2(x, z){
  if(!S.WPT.x) return 1e18;
  let best = 1e18;
  const ring = 1;
  const ccx = Math.floor((x-S.GB.x0)/S.WGRID.cs), ccz = Math.floor((z-S.GB.z0)/S.WGRID.cs);
  for(let ax=-ring;ax<=ring;ax++){
    for(let az=-ring;az<=ring;az++){
      const cx = ccx+ax, cz = ccz+az;
      if(cx < 0 || cz < 0 || cx >= S.WGRID.nx || cz >= S.WGRID.nz) continue;
      let id = S.WGRID.head[cz*S.WGRID.nx+cx];
      while(id >= 0){
        const dx = S.WPT.x[id]-x, dz = S.WPT.z[id]-z, d = dx*dx+dz*dz;
        if(d < best) best = d;
        id = S.WGRID.next[id];
      }
    }
  }
  return best;
}

// Wendland C2 radial kernel: q^4*(4q+1). C2 na okraji (nulovy sklon aj zvlnenie),
// takze teren nema zlom ani hard edge a je spojity s base trendom. Oproti kubickemu
// bumpu q^3 je pri rovnakom polomere vyrazne lepsie kondicionovany (mensi amplitudy
// pri rovnakom presnom prechode cez body) a netlumi susedne body.
export function bumpK(d2, R){
  const q = 1-d2/(R*R);
  if(q <= 0) return 0;
  const q2 = q*q;
  return q2*q2*(4*q+1);
}

// regionálny trend: svah od koryta Váhu (západ, nízko) na východ (vysoko) + Zámocký kopec
export function trendAt(x, z){
  let h = (x+600)*0.003;
  const cdx = x-S.CASTLE_X, cdz = z-S.CASTLE_Z;
  const cd2 = (cdx*cdx+cdz*cdz)/(CASTLE_R*CASTLE_R);
  if(cd2 < 9) h += CASTLE_H*Math.exp(-cd2*2.2);   // verné stúpanie k Zámockému parku
  return h;
}

// korekčné pole z OSM nadmorských výšok (0 mimo podpory, C² na okraji)
export function osmElevAt(x, z){
  let s = 0;
  for(let i=0;i<ELE_N;i++){
    const c = ELE_A[i];
    if(c > -0.05 && c < 0.05) continue;
    const dx = x-ELE_PX[i], dz = z-ELE_PZ[i], d2 = dx*dx+dz*dz, R = ELE_R[i];
    if(d2 < R*R) s += c*bumpK(d2, R);
  }
  return s;
}

// Zvlnenie terénu (nie je to výška, len bázový reliéf). Frekvencie sú
// BANDLIMITOVANÉ na mriežku TER_SEG - pozri computeBounds().
export function terrainRelief(x, z){
  return sxFbm(x*S.TER_FBM_F, z*S.TER_FBM_F)*2.0 + sxNoise(x*S.TER_DET_F+3.7, z*S.TER_DET_F-1.2)*0.35;
}

// terén BEZ koryta = podklad výškových profilov ciest (násyp cez rieku = premostenie)
export function landAt(x, z){
  return trendAt(x, z) + osmElevAt(x, z) + terrainRelief(x, z);
}

export function buildElevModel(){
  const raw = S.osm.elev || [];
  // --- 1) Filtrovanie OSM uzlov: fyzikálne možné a nie odľahlé hodnoty ---
  const ok = [];
  for(let i=0;i<raw.length;i++){
    const e = raw[i][2];
    if(!(e > ELE_FLOOR && e < ELE_CEIL)) continue;          // mimo fyzikálneho rozptylu
    ok.push([raw[i][0], raw[i][1], e, raw[i][3] || ""]);
  }
  if(ok.length){
    const sv = ok.map(function(p){ return p[2]; }).sort(function(a, b){ return a-b; });
    const med = sv[sv.length >> 1];
    let iw = ok.length;
    for(let i=ok.length-1;i>=0;i--){
      if(Math.abs(ok[i][2]-med) <= ELE_OUTLIER) continue;
      ok[i] = ok[iw-1]; iw--;                                  // odľahlý bod vyradený
    }
    ok.length = iw;
  }
  // --- 2) Jeden bump na každý OSM bod: interpolácia, nie podanie ---
  // Starý model zoskupoval blízke body do ŤAŽISKA (ELE_MERGE) a riešil
  // nadurčenú sústavu (N ťažiskových + N jednotlivých riadkov), čo je
  // najmenších štvorcov kompromis - terén potom NA OSM BODOCH neprechádzal
  // (namerané chyby až 75 m). Teraz je sústava štvorcová s N rovnicami a
  // N neznámymi, takže každý OSM bod je preklepovo dodrzaný.
  ELE_N = ok.length;
  ELE_PX = new Float32Array(ELE_N); ELE_PZ = new Float32Array(ELE_N);
  ELE_TY = new Float32Array(ELE_N); ELE_R = new Float32Array(ELE_N);
  const b = new Float64Array(ELE_N);
  for(let i=0;i<ELE_N;i++){
    ELE_PX[i] = ok[i][0]; ELE_PZ[i] = ok[i][1]; ELE_TY[i] = ok[i][2]-S.ELE_DATUM;
    ELE_R[i] = ELE_RAD;
    b[i] = ELE_TY[i]-trendAt(ELE_PX[i], ELE_PZ[i]);   // korekcia regionálneho trendu
  }
  // Symetrická sústava KᵀKa = Kᵀb (K[i][j] = jadro od bodu i k bodu j)
  const K = [];
  for(let i=0;i<ELE_N;i++){
    const row = new Float64Array(ELE_N);
    for(let j=0;j<ELE_N;j++){
      const dx = ELE_PX[j]-ELE_PX[i], dz = ELE_PZ[j]-ELE_PZ[i];
      row[j] = bumpK(dx*dx+dz*dz, ELE_R[j]);
    }
    K.push(row);
  }
  const AtA = [], Atb = new Float64Array(ELE_N);
  for(let i=0;i<ELE_N;i++){ AtA.push(new Float64Array(ELE_N)); }
  for(let i=0;i<ELE_N;i++){
    for(let j=0;j<ELE_N;j++){
      let s = 0;
      for(let k=0;k<ELE_N;k++) s += K[k][i]*K[k][j];
      AtA[i][j] = s;
    }
    let t = 0;
    for(let k=0;k<ELE_N;k++) t += K[k][i]*b[k];
    Atb[i] = t;
  }
  // ridge stabilizácia (numerická bezpečnosť, prakticky nemá vplyv)
  let tr = 0;
  for(let i=0;i<ELE_N;i++) tr += AtA[i][i];
  const lam = tr*1e-7;
  for(let i=0;i<ELE_N;i++) AtA[i][i] += lam;
  const M = [];
  for(let i=0;i<ELE_N;i++){ const row = new Float64Array(ELE_N+1); row.set(AtA[i]); row[ELE_N] = Atb[i]; M.push(row); }
  for(let c=0;c<ELE_N;c++){
    let piv = c;
    for(let r=c;r<ELE_N;r++) if(Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    const t = M[c]; M[c] = M[piv]; M[piv] = t;
    const d = M[c][c];
    if(Math.abs(d) < 1e-9) continue;
    for(let k=c;k<=ELE_N;k++) M[c][k] /= d;
    for(let r=0;r<ELE_N;r++){
      if(r === c) continue;
      const f = M[r][c];
      if(f === 0) continue;
      for(let k=c;k<=ELE_N;k++) M[r][k] -= f*M[c][k];
    }
  }
  ELE_A = new Float32Array(ELE_N);
  for(let i=0;i<ELE_N;i++) ELE_A[i] = M[i][ELE_N];
  // Overenie interpolacie. Musi sa dat BEZ stopy po zaplneni ELE_A - inak by
  // kontrola v zanikajucich sa amplitudahach vracala zavodne cisla.
  let worst = 0;
  for(let i=0;i<ELE_N;i++){
    let got = trendAt(ELE_PX[i], ELE_PZ[i]);
    for(let j=0;j<ELE_N;j++){
      const dx = ELE_PX[j]-ELE_PX[i], dz = ELE_PZ[j]-ELE_PZ[i];
      got += ELE_A[j]*bumpK(dx*dx+dz*dz, ELE_R[j]);
    }
    const e = Math.abs(got-ELE_TY[i]);
    if(e > worst) worst = e;
  }
  if(console && console.log) console.log("teren z OSM: " + raw.length + " uzlov ele -> " +
    ELE_N + " pouzitych, max. odchylka " + worst.toFixed(4) + " m");
}

export function buildRouteSub(){
  const n = Math.floor(S.ROUTE_N/8)+1;
  S.ROUTE_SUB = new Float32Array(n*2);
  for(let i=0,k=0;i<=S.ROUTE_N;i+=8,k+=2){ S.ROUTE_SUB[k] = S.routeX[i]; S.ROUTE_SUB[k+1] = S.routeZ[i]; }
}

// Symetrické obmedzenie sklonu: prebytok výšky sa rovnomerne rozdelí medzi
// susedné body, takže KONCE profilu (výška na začiatku aj konci cesty) zostanú
// zachované a vyhladí sa len prudkosť - na strmom svahuProfil nekĺzne do inej výšky.
export function limitGrade(y, ds){
  const n = y.length, lim = ROAD_MAX_GRADE*ds;
  for(let it=0;it<24;it++){
    let moved = 0;
    for(let i=1;i<n;i++){
      const d = y[i]-y[i-1];
      if(d > lim){ const t = (d-lim)*0.5; y[i] -= t; y[i-1] += t; moved++; }
      else if(d < -lim){ const t = (-d-lim)*0.5; y[i] += t; y[i-1] -= t; moved++; }
    }
    if(!moved) break;
  }
}

export function smoothBox(src, w, passes){
  const n = src.length;
  const a = new Float32Array(n), b = new Float32Array(n);
  a.set(src);
  for(let p=0;p<passes;p++){
    for(let i=0;i<n;i++){
      let s = 0, c = 0;
      for(let k=-w;k<=w;k++){
        const j = i+k;
        if(j < 0 || j >= n) continue;
        s += a[j]; c++;
      }
      b[i] = s/c;
    }
    a.set(b);
  }
  return a;
}

export function buildRoadProfiles(){
  const X = [], Z = [], Y = [], D = [];
  // a) trasa misie: 1601 bodov po ~2.8 m, profil z terénu bez koryta
  const ds = Math.max(0.5, S.routeLen/S.ROUTE_N);
  for(let i=0;i<=S.ROUTE_N;i++){
    X.push(S.routeX[i]); Z.push(S.routeZ[i]);
    Y.push(landAt(S.routeX[i], S.routeZ[i])); D.push(1);
  }
  {
    const sm = smoothBox(Y, Math.max(1, Math.round(PROF_SMOOTH/ds)), 2);
    limitGrade(sm, ds);
    for(let i=0;i<=S.ROUTE_N;i++) Y[i] = sm[i];
    // mostovka: rovná zvýšená úroveň nad riekou + nájazdové rampy z oboch strán
    const ia = Math.max(0, Math.min(S.ROUTE_N, Math.round(S.bridgeS0/ds)));
    const ib = Math.max(0, Math.min(S.ROUTE_N, Math.round(S.bridgeS1/ds)));
    // Mostovka = pevná ZVÝŠENÁ úroveň nad riekou: nad nivóou náplavky (násyp
    // nájazdov) a zároveň s rezervou nad hladinou Váhu.
    let dk = Math.max(Y[ia], Y[ib])+DECK_RISE;
    // podanie: mostovka musí byť aspoň RIVER_CLEAR nad dnom koryta pod celým mostom
    let bedMax = RIVER_REF_Y+RIVER_DEPTH;
    for(let s2=S.bridgeS0-20; s2<=S.bridgeS1+20; s2+=4){
      const j2 = Math.max(0, Math.min(S.ROUTE_N, Math.round(s2/ds)));
      const by = riverBedY(S.routeX[j2], S.routeZ[j2]);
      if(by > bedMax) bedMax = by;
    }
    if(dk < bedMax+RIVER_CLEAR) dk = bedMax+RIVER_CLEAR;
    S.DECK_Y = dk;
    for(let i=0;i<=S.ROUTE_N;i++){
      const b = deckBlend(i*ds);
      if(b > 0) Y[i] += (dk-Y[i])*b;
    }
  }
  // b) všetky cesty a polné cesty z OSM: najprv pravidelné prevzorkovanie po 10 m
  //    (OSM vrcholy su nerovnomorne huste), potom vyhladenie + tvrdý limit sklonu
  const push = function(lists, step){
    for(let li=0;li<lists.length;li++){
      const L = lists[li], n = (L.length-1)/2;
      if(n < 2) continue;
      const flat = L.slice(1);
      const rs = resampleLine(flat, step);   // [x,z,...] -> [x,z,...] po `step` m
      const rn = rs.length/2;
      if(rn < 2) continue;
      const yy = new Float32Array(rn);
      let total = 0;
      for(let i=0;i<rn;i++){
        yy[i] = landAt(rs[i*2], rs[i*2+1]);
        if(i > 0) total += Math.hypot(rs[i*2]-rs[i*2-2], rs[i*2+1]-rs[i*2-1]);
      }
      if(total < 5) continue;
      const sm = smoothBox(yy, Math.max(1, Math.round(PROF_SMOOTH/step)), 2);
      limitGrade(sm, step);
      for(let i=0;i<rn;i++){ X.push(rs[i*2]); Z.push(rs[i*2+1]); Y.push(sm[i]); D.push(0); }
    }
  };
  push(S.osm.roads, 10);
  push(S.osm.dirt, 10);
  // c) mriežka dotazov
  const nx = new Float32Array(X), nz = new Float32Array(Z);
  const ny = new Float32Array(Y), nd = new Float32Array(D);
  RDP.x = nx; RDP.z = nz; RDP.y = ny; RDP.deck = nd;
  RDG.cs = CORR_FADE+6;   // >= CORR_FADE: 3x3 bunky vždy pokryjú koridor
  RDG.nx = Math.ceil((S.GB.x1-S.GB.x0)/RDG.cs);
  RDG.nz = Math.ceil((S.GB.z1-S.GB.z0)/RDG.cs);
  RDG.head = new Int32Array(RDG.nx*RDG.nz).fill(-1);
  RDG.next = new Int32Array(nx.length);
  for(let i=0;i<nx.length;i++){
    let cx = Math.floor((nx[i]-S.GB.x0)/RDG.cs), cz = Math.floor((nz[i]-S.GB.z0)/RDG.cs);
    if(cx < 0) cx = 0; else if(cx >= RDG.nx) cx = RDG.nx-1;
    if(cz < 0) cz = 0; else if(cz >= RDG.nz) cz = RDG.nz-1;
    const c = cz*RDG.nx+cx;
    RDG.next[i] = RDG.head[c]; RDG.head[c] = i;
  }
  roadsReady = true;
}

// najbližší bod cesty: RC[0] = výška profilu, RC[1] = 1 ak je to trasa misie
export function roadCorridorAt(x, z){
  const ring = 1;
  const ccx = Math.floor((x-S.GB.x0)/RDG.cs), ccz = Math.floor((z-S.GB.z0)/RDG.cs);
  let bd = 1e18, by = 0, deck = 0, sy = 0, sn = 0;
  for(let ax=-ring;ax<=ring;ax++){
    for(let az=-ring;az<=ring;az++){
      const cx = ccx+ax, cz = ccz+az;
      if(cx < 0 || cz < 0 || cx >= RDG.nx || cz >= RDG.nz) continue;
      let id = RDG.head[cz*RDG.nx+cx];
      while(id >= 0){
        const dx = RDP.x[id]-x, dz = RDP.z[id]-z;
        const d = dx*dx+dz*dz;
        // trasa misie má pri rovnakom/do dvoch metroch vzdialenosti prioritu
        if(d < bd-0.01 || (d < bd+0.01 && RDP.deck[id] > deck)){ bd = d; by = RDP.y[id]; deck = RDP.deck[id]; }
        // body v tesnom okolí (križovatky, spojnice) sa spriahajú -> žiadne zlomy
        if(d <= 25){ sy += RDP.y[id]; sn++; }
        id = RDG.next[id];
      }
    }
  }
  if(sn > 1) by = sy/sn;
  RC[0] = by; RC[1] = deck;
  return bd;
}

// ---------- kruháče: plochý tanier pod okružnou križovatkou ----------
export function buildRoundHeights(){
  const rb = S.osm.rounds;
  // DVA PRECHODY: výšky tanierov sa najprv vypočítajú bez tanierov (inak by sa
  // stred prvého kruháča prilepil na vlastnú neinicializovanú (0) hodnotu).
  const ph = new Float64Array(rb.length);
  for(let i=0;i<rb.length;i++) ph[i] = heightAtAnalytic(rb[i][0], rb[i][1]);
  ROUND_C = new Float32Array(rb.length*4);
  for(let i=0;i<rb.length;i++){
    ROUND_C[i*4] = rb[i][0]; ROUND_C[i*4+1] = rb[i][1];
    ROUND_C[i*4+2] = rb[i][2];
    ROUND_C[i*4+3] = ph[i];
  }
}

// ---------- ANALYTICKÝ TERÉN (pred buildGround) ----------
export function heightAtAnalytic(x, z){
  // 1) regionálny trend + OSM nadmorské výšky
  let h = trendAt(x, z) + osmElevAt(x, z);
  // 2) koryto Váhu a potokov (z OSM vodných línií)
  const rc = riverCarveAt(x, z, h);
  const riverF = rc[1];
  // 3) simplex zvlnenie (tlmené v koryte rieky)
  h += terrainRelief(x, z)*(1-0.8*riverF);
  h += rc[0];
  // 4) koridory ciest: terén sa stiahne na vlastný vyhladený profil vozovky
  if(roadsReady && RDP.x){
    const d2 = roadCorridorAt(x, z);
    if(d2 < CORR_FADE*CORR_FADE){
      const d = Math.sqrt(d2);
      let w = 1-smooth01((d-CORR_FLAT)/(CORR_FADE-CORR_FLAT));
      w *= (1-riverF);   // v koryte rieky koridor ustupuje (mostovka rieši prechod)
      if(w > 0){
        const df = RC[0]-h;
        // korekcia je vždy ohraničená: na prudkom svahu sa terén NEvyhradí,
        // koridor len urovná miestne hrudy (cesta nikne vo vzduchu ani v zemi)
        h += df*w*((df > CORR_MAX_FIX || df < -CORR_MAX_FIX) ? (CORR_MAX_FIX/(df < 0 ? -df : df)) : 1);
      }
    }
  }
  // 5) kruháče: plochý tanier pod okružnou križovatkou
  if(ROUND_C){
    for(let ri=0;ri<ROUND_C.length;ri+=4){
      const rdx = x-ROUND_C[ri], rdz = z-ROUND_C[ri+1];
      const rd2 = rdx*rdx+rdz*rdz;
      const inner = ROUND_C[ri+2]+8, rr = inner+30;
      if(rd2 < rr*rr){
        const rt = 1-smooth01((Math.sqrt(rd2)-inner)/22);
        h += (ROUND_C[ri+3]-h)*rt;
      }
    }
  }
  return h;
}

export function meshSample(x, z){
  const x0 = S.GB.x0, z0 = S.GB.z0;
  const cw = (S.GB.x1-x0)/S.TER_SEG, cd = (S.GB.z1-z0)/S.TER_SEG;
  let fx = (x-x0)/cw, fz = (z-z0)/cd;
  if(fx < 0) fx = 0; else if(fx > S.TER_SEG-0.001) fx = S.TER_SEG-0.001;
  if(fz < 0) fz = 0; else if(fz > S.TER_SEG-0.001) fz = S.TER_SEG-0.001;
  const ix = fx|0, iz = fz|0;
  const u = fx-ix, v = fz-iz;
  const W = S.TER_SEG+1;
  const Ya = S.meshGrid[iz*W+ix], Yb = S.meshGrid[(iz+1)*W+ix], Yd = S.meshGrid[iz*W+ix+1];
  if(u+v <= 1) return Ya + (Yb-Ya)*v + (Yd-Ya)*u;
  const Yc = S.meshGrid[(iz+1)*W+ix+1];
  return Yc + (Yb-Yc)*(1-u) + (Yd-Yc)*(1-v);
}

// ============ GLOBÁLNA VÝŠKOVÁ FUNKCIA TERÉNU ============
// getTerrainHeight(x, z) = presná výška terénu pre akékoľvek súradnice X, Z v hre.
//   * po buildGround: bilinear/trojuhelníková interpolácia renderovanej mriežky
//     (bitovo zhodná s tým, čo vykreslí GPU - žiadny odchýlkový "výškový" fyzikálny model),
//   * pred buildGround: analytický OSM model (trend + ele body + koryto + koridory).
export function getTerrainHeight(x, z){
  if(S.meshReady && S.meshGrid) return meshSample(x, z);
  return heightAtAnalytic(x, z);
}

// (historický alias heightAt odstránený: žiadny call-site ho nepoužíval.)

// výška pod kolesom: mostovka s rampami až na pevninu, inde collider + lift vozovky
export function driveY(x, z, s, lat){ return wheelGroundY(x, z, s, lat); }

// ---------- FYZIKA: prichytenie áut k terénu (heightfield collider + odpruženie) ----------
// Fyzikálny collider terénu číta PRIAMO heightfield dáta = presne kopíruje vizuál.
// Dynamická výška Y sa počíta každý snímok z polohy X/Z (fuldt + 4 kolesá).
export function terrainColliderY(x, z){ return getTerrainHeight(x, z); }

// vozovka nesie auto nad terénom (kolesá presne na asfalte, nie v ňom)
export function roadLift(x, z){ return roadDist2(x, z) < 30 ? 0.15 : 0; }

// plynulý nájazd/zjazd mosta z oboch strán (ramp interpolation, žiadny skok Y)
export function deckBlend(s){
  const R = S.RAMP_LEN;
  if(s <= S.bridgeS0-R || s >= S.bridgeS1+R) return 0;
  if(s >= S.bridgeS0 && s <= S.bridgeS1) return 1;
  if(s < S.bridgeS0) return smooth01((s-(S.bridgeS0-R))/R);
  return smooth01(((S.bridgeS1+R)-s)/R);
}

// Kanonická výška pod kolesom: mostovka s nájazdami, inde collider + lift vozovky.
// JEDINÝ zdroj pravdy pre obe varianty (roads.js routeDeckY aj tento export)
// — vzorec bol predtým skopírovaný na dvoch miestach a hrozilo ich rozdrift.
// `lat` je priečna odchýlka od osi trasy: mostovka platí len do ±7 m, lebo pri
// lat=0 by deckBlend dvíhal auto do nekonečna do strán.
export function wheelGroundY(x, z, s, lat){
  if(lat > -7 && lat < 7){
    const b = deckBlend(s);
    if(b > 0){
      const t = terrainColliderY(x, z)+roadLift(x, z);
      return t+(S.DECK_Y-t)*b;
    }
  }
  return terrainColliderY(x, z)+roadLift(x, z);
}
