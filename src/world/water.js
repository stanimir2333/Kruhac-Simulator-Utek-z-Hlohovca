// src/world/water.js — Váh: koryto + hladina + PBR vodný materiál (verbatim port).
import * as THREE from 'three';
import { S } from './shared.js';
import { resampleLine, riverWaterY, waterDist2 } from './height.js';

const BLOOM_LAYER = 5;   // selektívny bloom: žiarivky + okná + voda

const WAT = {
  mat:null, meshes:[], time:0, level:2, ready:false, live:false,
  nrmTex:null, reflRT:null, reflCam:null, texMat:new THREE.Matrix4(),
  every:2, tick:0, lastX:0, lastZ:0, planeY:0, dist:1e9,
  bb:{ x0:0, z0:0, x1:0, z1:0 },
  // predalokovaný scratch (v slučke sa nič nealokuje)
  _tgt:new THREE.Vector3()
};

const WAT_VS = [
"uniform mat4 uTexMat;",
"uniform float uTime;",
"attribute float aEdge;",
"varying vec3 vWPos;",
"varying vec4 vRefl;",
"varying float vEdge;",
"varying float vDist;",
// 3 nesúladné vlny: dve hlavné + jedna krížová (vlnenie s prúdnicou)
"float waveH(vec2 p, float t){",
"  return sin(p.x*0.42 + t*1.30)*0.55 + sin(p.y*0.31 - t*1.05)*0.40 + sin((p.x+p.y)*0.17 + t*0.63)*0.85;",
"}",
"void main(){",
"  vec3 pos = position;",
"  vec3 wp = (modelMatrix*vec4(pos, 1.0)).xyz;",
"  pos.y += waveH(wp.xz, uTime)*0.11*aEdge*aEdge;",   // brehy tuhé (aEdge=0)
"  wp.y = pos.y;",
"  vWPos = wp;",
"  vEdge = aEdge;",
"  vRefl = uTexMat*vec4(wp, 1.0);",
"  vec4 mv = modelViewMatrix*vec4(pos, 1.0);",
"  vDist = -mv.z;",
"  gl_Position = projectionMatrix*mv;",
"}"
].join("\n");

const WAT_FS = [
"uniform sampler2D tNormal;",
"uniform sampler2D tRefl;",
"uniform vec3 uCamPos, uSunDir, uSunCol, uSkyZen, uSkyHor, uFogCol, uDeep, uShallow;",
"uniform float uTime, uFogDensity, uReflMix, uSpec;",
"varying vec3 vWPos;",
"varying vec4 vRefl;",
"varying float vEdge;",
"varying float vDist;",
// rovnaká kupola ako buildSky(): analýza náhrada odrazu, keď je plánový
// odraz ďaleko/vypnutý (nulová cena, žiadne ďalšie vzorkovanie textúr)
"vec3 skyCol(vec3 d){",
"  float h = clamp(d.y, 0.0, 1.0);",
"  vec3 c = mix(uSkyHor, uSkyZen, pow(h, 0.55));",
"  if(d.y < 0.0) c = mix(uSkyHor, uSkyHor*0.9, clamp(-d.y*4.0, 0.0, 1.0));",
"  float s = max(dot(d, uSunDir), 0.0);",
"  c += uSunCol*(pow(s, 1200.0)*1.6 + pow(s, 24.0)*0.30 + pow(s, 6.0)*0.10);",
"  return c;",
"}",
"void main(){",
"  vec2 p1 = vWPos.xz*0.042 + vec2(uTime*0.020, uTime*0.013);",   // veľké vlnky
"  vec2 p2 = vWPos.xz*0.115 - vec2(uTime*0.031, uTime*0.020);",   // drobné vlnky
"  vec3 n1 = texture2D(tNormal, p1).xyz*2.0 - 1.0;",
"  vec3 n2 = texture2D(tNormal, p2).xyz*2.0 - 1.0;",
"  vec3 n = normalize(vec3((n1.x+n2.x)*0.55, 2.2, (n1.y+n2.y)*0.55));",
"  vec3 V = normalize(uCamPos - vWPos);",
"  if(dot(n, V) < 0.0) n = -n;",                       // hladina sa neotočí pod hľadisko
"  float fres = 0.025 + 0.975*pow(1.0 - clamp(dot(n, V), 0.0, 1.0), 5.0);",
// vzdialenosť tlmií vlnenie: voľný priestor má len pár pixelov na vlnku a
// UV deformácie by tam plavali (plávanie textúry = štipľavý šum)
"  float dfade = 1.0 - 0.85*smoothstep(70.0, 300.0, vDist);",
"  vec3 refl = skyCol(reflect(-V, n));",
"  vec2 suv = vRefl.xy/max(vRefl.w, 1e-4);",
"  suv += n.xz*(0.030 + 0.055*(1.0 - vEdge))*dfade;",     // zrazenina odrazu vlnkami
"  vec3 pr = texture2D(tRefl, clamp(suv, vec2(0.004), vec2(0.996))).rgb;",
"  refl = mix(refl, pr, uReflMix);",
"  vec3 body = mix(uShallow, uDeep, smoothstep(0.02, 0.50, vEdge));",
"  body *= 0.30 + 0.70*max(dot(n, uSunDir), 0.0);",
"  body += uSkyHor*0.10;",
"  vec3 col = mix(body, refl, fres);",
"  vec3 Hv = normalize(V + uSunDir);",
"  float nh = max(dot(n, Hv), 0.0);",
// HDR lesk -> bloom zachytí slnko na hladine; dfade krotí ďaleké iskrzenie
"  col += uSunCol*uSpec*dfade*(pow(nh, 420.0)*7.0 + pow(nh, 34.0)*0.45);",
"  float foam = smoothstep(0.13, 0.0, vEdge)*(0.45 + 0.55*sin(vWPos.x*0.55 + vWPos.z*0.42 + uTime*2.1));",
"  col = mix(col, uSkyHor*1.15, clamp(foam, 0.0, 1.0)*0.35*dfade);",
"  float fg = 1.0 - exp(-uFogDensity*uFogDensity*vDist*vDist);",
"  col = mix(col, uFogCol, clamp(fg, 0.0, 1.0));",
"  gl_FragColor = vec4(col, 1.0);",
"  #include <tonemapping_fragment>",
"  #include <colorspace_fragment>",
"}"
].join("\n");

// Procedurálna TILEABLE normalová dlaždice: 26 celočíselných vlnových vektorov
// (celočíselné k + presné TAU = bezšvový tiling), výška -> centrálna derivácia
// -> RGB. Žiadne externé assety (projekt je monolit bez načítania súborov).
const TAU = Math.PI*2;

export function buildRiver(){
  // Váh (široké línie) = hlboké koryto s vlnitou hladinou; potoky = plytké
  // úzke korytá. Geometria je teraz PODELNÁ aj PRIEČNE DELENÁ mriežka
  // (mergedStrips dával 2 vrcholy na bod -> žiadny priestor na vlny), každý
  // vrchol má aEdge = 0 na brehu / 1 v osi (hrany vlnenia + penový lem).
  // Materiál sa musí spraviť TU, pred geometriou - buildRiver beží pred initWater.
  WAT.nrmTex = buildWaterNormals(256);
  WAT.mat = makeWaterMaterial();
  WAT.mat.uniforms.tNormal.value = WAT.nrmTex;
  const vah = [], str = [];
  const wl = S.osm.water;
  for(let i=0;i<wl.length;i++){ if(wl[i][0] >= 10) vah.push(wl[i]); else str.push(wl[i]); }
  WAT.bb.x0 = WAT.bb.z0 = 1e18; WAT.bb.x1 = WAT.bb.z1 = -1e18;
  if(vah.length) buildRiverSurface(vah, 8, 8);   // Váh: 120 m široká, 8 priečnych stĺpcov
  if(str.length) buildRiverSurface(str, 12, 3);  // potoky: 8 m, 3 stĺpce (detaily zadarmo)
}

// ZMEROVANÁ vlnitá hladina z viacerých línií (jeden draw call, LEN v init).
// ways = [[halfW, x,z,x,z,...], ...]; step = dĺžka pozdĺžnej bunky (m);
// lat = počet priečnych delení (stĺpcov - 1) cez celú šírku.
// Úroveň Y = riverWaterY() teda presne ten istý koridor koryta, ktorý terén
// vyrezal do RBF/OSM výšek - rieka tečie z kopca a hladina nikdy neunikne.
export function buildRiverSurface(ways, step, lat){
  const rows = [];
  let nv = 0, ni = 0;
  for(let w=0; w<ways.length; w++){
    const src = ways[w];
    if(((src.length-1) & 1) !== 0) continue;   // lichý počet súradníc = chybný vstup
    const r = resampleLine(src.slice(1), step);
    const n = r.length/2;
    if(n < 2) continue;
    rows.push({ hw:src[0], r:r, n:n });
    nv += n*(lat+1);
    ni += (n-1)*lat*6;
    for(let k=0;k<n;k++){
      const x = r[k*2], z = r[k*2+1], hw = src[0];
      if(x-hw < WAT.bb.x0) WAT.bb.x0 = x-hw; if(x+hw > WAT.bb.x1) WAT.bb.x1 = x+hw;
      if(z-hw < WAT.bb.z0) WAT.bb.z0 = z-hw; if(z+hw > WAT.bb.z1) WAT.bb.z1 = z+hw;
    }
  }
  if(!nv) return null;
  const pos = new Float32Array(nv*3);
  const nor = new Float32Array(nv*3);   // hladina je rovina: (0,1,0) — RT prepass to číta
  const edge = new Float32Array(nv);
  const idx = new Uint32Array(ni);
  let v = 0, ii = 0, ymin = 1e18, ymax = -1e18;
  for(let w=0; w<rows.length; w++){
    const R = rows[w], hw = R.hw, n = R.n, r = R.r;
    const base = v;
    for(let i=0;i<n;i++){
      const x = r[i*2], z = r[i*2+1];
      const a = (i > 0) ? i-1 : 0, b = (i < n-1) ? i+1 : n-1;
      let dx = r[b*2]-r[a*2], dz = r[b*2+1]-r[a*2+1];
      const L = Math.sqrt(dx*dx+dz*dz) || 1; dx /= L; dz /= L;
      const nx = -dz, nz = dx;                       // priečna jednotka v rovine (x,z)
      for(let j=0;j<=lat;j++){
        const u = j/lat;
        const off = (u-0.5)*2*hw;
        const px = x + nx*off, pz = z + nz*off;
        const py = riverWaterY(px, pz);
        if(py < ymin) ymin = py; if(py > ymax) ymax = py;
        const o3 = v*3;
        pos[o3] = px; pos[o3+1] = py; pos[o3+2] = pz;
        nor[o3+1] = 1;                              // (0,1,0)
        edge[v] = Math.sin(u*Math.PI);               // 0 na brehoch, 1 v osi rieky
        v++;
      }
    }
    for(let i=0;i<n-1;i++){
      const k = base + i*(lat+1);
      for(let j=0;j<lat;j++){
        // poradie CCQS zhora: normála smeruje nahor (hladina neodráža spodok)
        idx[ii++] = k+j;     idx[ii++] = k+j+1;   idx[ii++] = k+j+lat+1;
        idx[ii++] = k+j+1;   idx[ii++] = k+j+lat+2; idx[ii++] = k+j+lat+1;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("aEdge", new THREE.BufferAttribute(edge, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  S.DYN_GEO.push(g);
  const m = new THREE.Mesh(g, WAT.mat);
  m.frustumCulled = true;
  m.matrixAutoUpdate = false;
  m.updateMatrix();
  S.scene.add(m);
  WAT.meshes.push(m);
  m.layers.enable(BLOOM_LAYER);   // slnečný lesk na vode má svietiť
  console.log("[VODA] hladina " + (ymin+S.ELE_DATUM).toFixed(1) + ".." + (ymax+S.ELE_DATUM).toFixed(1)
    + " m n.m. · " + nv + " vrcholov · " + (ni/3) + " trojuholníkov");
  return m;
}

export function buildWaterNormals(size){
  const h = new Float32Array(size*size);
  const wv = [];
  let sd = 20260901;
  const rnd = function(){ sd = (sd*1103515245 + 12345) & 0x7fffffff; return sd/0x7fffffff; };
  for(let i=0;i<26;i++){
    let kx = Math.round((rnd()*2-1)*6), ky = Math.round((rnd()*2-1)*6);
    if(kx === 0 && ky === 0) ky = 1;
    wv.push(kx, ky, (0.5+rnd())/Math.pow(Math.abs(kx)+Math.abs(ky), 1.4), rnd()*TAU);
  }
  for(let y=0;y<size;y++){
    const v = y/size;
    for(let x=0;x<size;x++){
      const u = x/size;
      let s = 0;
      for(let i=0;i<wv.length;i+=4){
        s += wv[i+2]*Math.sin(TAU*(wv[i]*u + wv[i+1]*v) + wv[i+3]);
      }
      h[y*size+x] = s;
    }
  }
  const c = document.createElement("canvas");
  c.width = size; c.height = size;
  const g = c.getContext("2d");
  const img = g.createImageData(size, size);
  const d = img.data;
  const sGrad = 3.2;   // zisk gradientu (sklon ~15-25°, ne prepäté vlnky)
  for(let y=0;y<size;y++){
    const yp = ((y+1)%size)*size, ym = ((y-1+size)%size)*size, y0 = y*size;
    for(let x=0;x<size;x++){
      const xp = (x+1)%size, xm = (x-1+size)%size;
      const dx = (h[y0+xp]-h[y0+xm])*0.5*sGrad;
      const dz = (h[yp+x]-h[ym+x])*0.5*sGrad;
      const nx = -dx, ny = 1.0, nz = -dz;
      const L = Math.sqrt(nx*nx+ny*ny+nz*nz);
      const o = (y0+x)*4;
      d[o]   = ((nx/L)*0.5+0.5)*255;
      d[o+1] = ((nz/L)*0.5+0.5)*255;
      d[o+2] = ((ny/L)*0.5+0.5)*255;
      d[o+3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = Math.min(8, S.TEX_ANISO);
  return t;
}

export function makeWaterMaterial(){
  const m = new THREE.ShaderMaterial({
    uniforms:{
      tNormal:{ value:null },
      tRefl:{ value:null },
      uTexMat:{ value:new THREE.Matrix4() },
      uTime:{ value:0 },
      uCamPos:{ value:new THREE.Vector3() },
      uSunDir:{ value:new THREE.Vector3(S.SUN_OFF.x, S.SUN_OFF.y, S.SUN_OFF.z).normalize() },
      uSunCol:{ value:new THREE.Color(S.SKY_SUN) },
      uSkyZen:{ value:new THREE.Color(S.SKY_ZENITH) },
      uSkyHor:{ value:new THREE.Color(S.SKY_HORIZON) },
      uFogCol:{ value:new THREE.Color(S.SKY_FOG) },
      uDeep:{ value:new THREE.Color(0x123039) },
      uShallow:{ value:new THREE.Color(0x356d63) },
      uFogDensity:{ value:0.0008 },
      uReflMix:{ value:0 },
      uSpec:{ value:1 }
    },
    vertexShader:WAT_VS, fragmentShader:WAT_FS,
    side:THREE.FrontSide, transparent:false, depthWrite:true, depthTest:true, fog:false
  });
  // hodnoty pre RT prepass (rtMatFor): voda nesmie byť zrkadlová pre SSR
  m.roughness = 0.95;
  m.metalness = 0.0;
  return m;
}

// Hladina v najbližšom bode osi rieky = rovina odrazu. Rieka má sklon, takže
// rovina od oblohy k brehu by nesedela; 300 m úseok rieky sa zdvihne len o ~0,3 m.
export function nearestWaterY(x, z){
  if(!S.WPT.x) return riverWaterY(x, z);
  let best = 1e18, bi = -1;
  const ccx = Math.floor((x-S.GB.x0)/S.WGRID.cs), ccz = Math.floor((z-S.GB.z0)/S.WGRID.cs);
  for(let ax=-2;ax<=2;ax++){
    for(let az=-2;az<=2;az++){
      const cx = ccx+ax, cz = ccz+az;
      if(cx < 0 || cz < 0 || cx >= S.WGRID.nx || cz >= S.WGRID.nz) continue;
      let id = S.WGRID.head[cz*S.WGRID.nx+cx];
      while(id >= 0){
        const dx = S.WPT.x[id]-x, dz = S.WPT.z[id]-z, d = dx*dx+dz*dz;
        if(d < best){ best = d; bi = id; }
        id = S.WGRID.next[id];
      }
    }
  }
  if(bi < 0) return riverWaterY(x, z);
  return riverWaterY(S.WPT.x[bi], S.WPT.z[bi]);
}

// Taktika brehov Váhu (Heat-únik): off-road pás pozdĺž rieky spomaľuje
// policajné SUV viac než hráčovo auto. Vlastná helperka (v monolitu nebola).
export function riverbankSlowdown(x, z) {
  const d2 = waterDist2(x, z);
  if (d2 < 120 * 120) return 0.62; // v koryte / tesne pri brehu
  if (d2 < 260 * 260) return 0.8;  // rozbahnený pás
  return 1.0;
}

// STAGE-2 addition (nie verbatim): prepínač kvality vody pre nastavenia.
// 0 = lacný standard materiál, 1 = shader + normály 128, 2 = shader + normály 256.
let _cheapWaterMat = null;
export function setWaterQuality(q) {
  if (!WAT.mat || !WAT.meshes.length) return;
  if (q <= 0) {
    if (!_cheapWaterMat) {
      _cheapWaterMat = new THREE.MeshStandardMaterial({ color: 0x2a4a5a, roughness: 0.35, metalness: 0.4 });
    }
    for (const m of WAT.meshes) m.material = _cheapWaterMat;
    return;
  }
  const size = q === 1 ? 128 : 256;
  const cur = WAT.nrmTex?.image?.width || 0;
  if (cur !== size) {
    try { WAT.nrmTex?.dispose?.(); } catch {}
    WAT.nrmTex = buildWaterNormals(size);
    WAT.mat.uniforms.tNormal.value = WAT.nrmTex;
  }
  for (const m of WAT.meshes) m.material = WAT.mat;
}
