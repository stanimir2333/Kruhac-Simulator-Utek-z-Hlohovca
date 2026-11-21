// src/world/surface.js — ODRAZY POVRCHOV PODĽA MATERIÁLU (+ kaluže + mokré cesty).
//
// JEDINÝ ZDROJ PRAVDY o tom, ako sa ktorý zdieľaný materiál lesní. Tabuľka
// PROFILES (drsnosť / kovovosť / sila odrazu prostredia / vnímavosť na vodu)
// sa aplikuje na S.MAT.* a búrka už NEMÁ vlastný prepínač mokrých ciest —
// volá setSurfaceWetTarget() a vysušanie nechá tu (src/weather/storm.js).
//
// ODRAZY SÚ IBL: obloha sa raz vypálí do PMREM a nastaví ako scene.environment
// (src/world/sky.js). Každý MeshStandardMaterial ju vidí automaticky; my iba
// nastavujeme, AKO SILNO sa v nej zrkadlí (envMapIntensity) a AKO MATNÝ JE
// povrch (roughness). Sklo a chróm tak odrážajú naozaj oblohu, asfalt zostáva
// matný a po daždi má v kalužiach zrkadlo.
// KALUŽE: noise maska vo WORLD súradniciach znižuje drsnosť asfaltu na ~0,05
// (ostré zrkadlo oblohy) a tmavne albedo. Maska sa objaví s mokrostou (uWet).
import { S } from './shared.js';

// ---------- TABUĽKA POVRCHOV ----------
// r = drsnosť (roughness)  m = kovovosť (metalness)
// e = envMapIntensity (sila odrazu prostredia)
// w = vnímavosť na vodu (0 = nikdy, 1 = celý povrch)
// Detail-normal scale: koľko sa mikro-detail (TEX.detailNormal) aplicuje na
// povrch. Vyššia hodnota = výraznejšie mikro-trhlinky/kamienky pri blízkom pohľade.
const DETAIL_NORMAL_SCALE = 0.12;

const PROFILES = {
  // --- vozovky a chodníky ---
  asphalt:      { r: 0.62, m: 0.02, e: 0.62, w: 1.00, dn: 1.0 },
  routeAsphalt: { r: 0.62, m: 0.02, e: 0.62, w: 1.00, dn: 1.0 },
  bridge:       { r: 0.70, m: 0.08, e: 0.85, w: 0.95, dn: 0.8 },
  sidewalk:     { r: 0.82, m: 0.00, e: 0.55, w: 0.85, dn: 1.0 },
  cycle:        { r: 0.88, m: 0.00, e: 0.55, w: 0.85, dn: 0.9 },
  dirt:         { r: 0.95, m: 0.00, e: 0.22, w: 0.75, dn: 1.0 },
  ballast:      { r: 0.90, m: 0.00, e: 0.35, w: 0.70, dn: 1.0 },
  park:         { r: 0.94, m: 0.00, e: 0.30, w: 0.60, dn: 0.6 },
  island:       { r: 0.88, m: 0.00, e: 0.40, w: 0.70, dn: 0.7 },
  // --- GTA SA decality (vozovka opotrebovaná v ťahach, crosstisky) ---
  tireMark:     { r: 0.36, m: 0.04, e: 0.55, w: 1.00, dn: 0 },
  crosswalk:    { r: 0.88, m: 0.00, e: 0.55, w: 0.70, dn: 0 },
  shrubs:       { r: 0.92, m: 0.00, e: 0.35, w: 0.50, dn: 0.5 },
  // --- terén ---
  // Trávnik/hlina sa lesknú len jemne: vlhká zem je matná, ostrý odraz oblohy
  // by vyzeral ako mokrá fólia.
  ground:       { r: 0.96, m: 0.00, e: 0.22, w: 0.35, dn: 0.8 },
  // --- budovy ---
  houseWall:    { r: 0.82, m: 0.02, e: 0.60, w: 0.35, dn: 0.7 },
  panelWall:    { r: 0.86, m: 0.06, e: 0.70, w: 0.35, dn: 0.6 },
  histWall:     { r: 0.88, m: 0.00, e: 0.55, w: 0.35, dn: 0.8 },
  indWall:      { r: 0.48, m: 0.38, e: 1.00, w: 0.30, dn: 0.9 },
  pitchedRoof:  { r: 0.94, m: 0.02, e: 0.70, w: 0.90, dn: 0.8 },
  flatRoof:     { r: 0.92, m: 0.02, e: 0.65, w: 0.90, dn: 0.9 },
  concrete:     { r: 0.86, m: 0.00, e: 0.55, w: 0.60, dn: 0.9 },
  pillar:       { r: 0.86, m: 0.00, e: 0.55, w: 0.60, dn: 0.9 },
  trim:         { r: 0.83, m: 0.00, e: 0.60, w: 0.45, dn: 0.8 },
  chimneyBrick: { r: 0.92, m: 0.00, e: 0.50, w: 0.55, dn: 1.0 },
  chimneyConcrete: { r: 0.90, m: 0.00, e: 0.50, w: 0.55, dn: 0.9 },
  // --- sklo a kov (najviac viditeľné odrazy) ---
  glass:        { r: 0.06, m: 0.72, e: 1.75, dn: 0.0 },
  chrome:       { r: 0.12, m: 0.96, e: 1.60, dn: 0.0 },
  rail:         { r: 0.32, m: 0.62, e: 1.15, dn: 0.5 },
  pole:         { r: 0.40, m: 0.68, e: 1.10, dn: 0.5 },
  dark:         { r: 0.60, m: 0.40, e: 0.90, dn: 0.4 },
  playerCar:    { r: 0.24, m: 0.55, e: 1.30, dn: 0.0 },
  tail:         { r: 0.33, m: 0.25, e: 0.95, dn: 0.0 },
  plate:        { r: 0.53, m: 0.05, e: 0.80, dn: 0.2 },
  // --- zeleň (listie sa lesní najmä vďaka rozptylu, nie zrkadlu) ---
  vegTrunk:     { r: 0.92, m: 0.00, e: 0.40, dn: 1.0 },
  vegCrown:     { r: 0.86, m: 0.00, e: 0.45, dn: 0.5 },
  vegConifer:   { r: 0.88, m: 0.00, e: 0.40, dn: 0.5 },
  vegBush:      { r: 0.91, m: 0.00, e: 0.40, dn: 0.5 },
  trunk:        { r: 0.92, m: 0.00, e: 0.35, dn: 1.0 },
  leaf:         { r: 0.83, m: 0.00, e: 0.55, dn: 0.4 },
  leafDark:     { r: 0.88, m: 0.00, e: 0.45, dn: 0.4 },
  tuft:         { r: 0.94, m: 0.00, e: 0.30, dn: 0.3 },
  // --- mobiliár (src/world/props.js) ---
  propMetal:    { r: 0.32, m: 0.80, e: 1.25, w: 0.80, dn: 0.4 },
  propMatte:    { r: 0.84, m: 0.00, e: 0.60, w: 0.70, dn: 0.6 },
  propWood:     { r: 0.88, m: 0.00, e: 0.35, w: 0.70, dn: 1.0 },
  propLeaf:     { r: 0.91, m: 0.00, e: 0.40, w: 0.50, dn: 0.4 },
  propGlass:    { r: 0.08, m: 0.60, e: 1.40, w: 0.90, dn: 0.0 },
};

// Suchý stav každého materiálu (pred zmenou) — držíme ho, aby sa dal
// obnoviť presne, a aby vedelo, či sme materiál už upravovali my.
const BASE = new Map();
let wetCur = 0, wetTarget = 0, puddleT = 0;

// ---------- GLSL: šum a kaluže ----------
const NOISE_GLSL = [
  'float surfHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }',
  'float surfNoise(vec2 p){',
  '  vec2 i = floor(p), f = fract(p);',
  '  vec2 u = f*f*(3.0-2.0*f);',
  '  return mix(mix(surfHash(i), surfHash(i+vec2(1.0,0.0)), u.x),',
  '             mix(surfHash(i+vec2(0.0,1.0)), surfHash(i+vec2(1.0,1.0)), u.x), u.y);',
  '}',
].join('\n');

// Kaluže: hrubý šum (veľké jamy) + jemný (okraje). Čím väčšia mokrosť, tým
// nižší prah → viac kaluží. Kaluža je ZRKADLO: drsnosť padá na ~0,05.
// Vlnky v kaluži sa NErobia tu: `normalScale` je uniform a GLSL zakazuje zápis
// do uniformu (`l-value required`) — celý shader asfaltu sa vtedy neskompiluje
// a vozovka zmizne. Vlnky preto skladáme až do lokálnej tangensovej normály
// v detailNormalFrag() nižšie.
const PUDDLE_FRAG = [
  '  float pud = 0.0;',
  '  if(uWet > 0.002){',
  '    float pn = surfNoise(vSurfPos.xz * 0.17) * 0.56',
  '             + surfNoise(vSurfPos.xz * 0.58) * 0.29',
  '             + surfNoise(vSurfPos.xz * 1.85) * 0.15;',
  '    float thr = 0.60 - uWet * 0.24;',
  '    pud = clamp((pn - thr) / 0.13, 0.0, 1.0) * uWet;',
  '    diffuseColor.rgb *= mix(1.0, 0.46, pud);',
  '  }',
].join('\n');

// Detail-normal blending: mikro-detail (kamienky, zrno, mikro-trhlinky) sa
// primiešava do tangensovej normály AŽ po normal mape, takže hlavná normálová
// mapa (asfalt, dlažba, omietka) ostáva dominantná. `mapN` a `tbn` sú v scope
// len vtedy, keď materiál má tangent-space normalMap — preto ten #if.
// `ripple` = materiál má PUDDLE_FRAG, teda aj `pud`; vlnky v kaluži sa
// pridávajú do dnT AŽ po fade, aby ich mokrosť nevypla (uDetailFade → 1).
function detailNormalFrag(ripple){
  const lines = [
    '  #if defined( USE_NORMALMAP_TANGENTSPACE )',
    '  if(uDetailScale > 0.001){',
    '    vec3 dnT = texture2D(tDetailNormal, vDetailUv).xyz * 2.0 - 1.0;',
    '    dnT.xy *= normalScale * uDetailScale * (1.0 - uDetailFade);',
  ];
  if(ripple){
    lines.push(
      '    // kaluža nikdy nie je dokonale rovná: jemné vlnky rozbijú zrkadlo',
      '    float pr = sin(vSurfPos.x * 0.3 + uTimePuddle) * 0.08',
      '             + cos(vSurfPos.z * 0.25 + uTimePuddle * 0.7) * 0.06;',
      '    dnT.xy += vec2(pr) * pud;',
    );
  }
  lines.push(
    '    normal = normalize(tbn * normalize(mapN + dnT));',
    '  }',
    '  #endif',
  );
  return lines.join('\n');
}

// Vlhký povrch bez kaluží (trávnik, strechy, hlina): iba stmavnutie.
const WET_FRAG = [
  '  float wetK = uWet * WET_AMT;',
  '  diffuseColor.rgb *= mix(1.0, 0.58, wetK);',
].join('\n');

// Drsnosť: kaluža prepíše drsnosť na sklo, inak len profil z PROFILES.
const ROUGH_FRAG = [
  '  roughnessFactor = mix(roughnessFactor, 0.05, pud);',
].join('\n');

// ---------- PATCH SHADEROV ----------
// onBeforeCompile je reťazený (MAT.ground si už svoj patch má) a customProgram
// CacheKey je VŽDY vlastný — inak by tri zdielil program medzi dvoma
// materiálmi s rovnakým zdrojovým kódom patchu.
function patchMat(mat, key, frag, rough, wetAmt, ripple){
  if(!mat || mat.userData.surfPatched) return;
  mat.userData.surfPatched = true;
  const prev = mat.onBeforeCompile;
  const dn = mat.userData.detailNormal !== undefined ? mat.userData.detailNormal : 0;
  mat.onBeforeCompile = function(sh, renderer){
    if(prev) prev.call(mat, sh, renderer);
    sh.uniforms.uWet = S.UNI.wet;
    sh.uniforms.uDetailScale = { value: DETAIL_NORMAL_SCALE * dn };
    sh.uniforms.uDetailFade = { value: 0 };
    sh.uniforms.uTimePuddle = { value: puddleT };
    sh.uniforms.tDetailNormal = { value: S.TEX.detailNormal };
    // Referencie na uniformy pre applyWet()/updatePuddleTime() — materiál sám
    // `uniforms` nemá (to je len ShaderMaterial), tak si ich odložíme.
    mat.userData.surfUniforms = sh.uniforms;
    // Detail-normal UV: vSurfPos-based, tiled at 4x (matches TEX.detailNormal repeat)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSurfPos;\nvarying vec2 vDetailUv;')
      .replace('#include <begin_vertex>', [
        '#include <begin_vertex>',
        '#ifdef USE_INSTANCING',
        '  vSurfPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;',
        '#else',
        '  vSurfPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
        '#endif',
        '  vDetailUv = vSurfPos.xz * 0.25;', // 4 m tiling for detail normal
      ].join('\n'));
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', [
        '#include <common>',
        'varying vec3 vSurfPos;',
        'varying vec2 vDetailUv;',
        'uniform float uWet;',
        'uniform float uDetailScale;',
        'uniform float uDetailFade;',
        'uniform float uTimePuddle;',
        'uniform sampler2D tDetailNormal;',
        NOISE_GLSL,
      ].join('\n'))
      .replace('#include <color_fragment>',
        '#include <color_fragment>\n' + frag.split('WET_AMT').join(wetAmt.toFixed(3)))
      .replace('#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\n' + rough.split('WET_AMT').join(wetAmt.toFixed(3)))
      // Detail normal AŽ po normal mape (pred osvetlením), nie pred ňou
      .replace('#include <normal_fragment_maps>',
        '#include <normal_fragment_maps>\n' + detailNormalFrag(ripple));
  };
  mat.customProgramCacheKey = function(){ return 'surf-' + key; };
}

// ---------- VEREJNÉ API ----------
// Aplikuje suchý profil + nastaví shadery kaluží. Volá sa RAZ po zložení
// sveta (všetky materiály musia existovať).
export function applySurfaces(){
  for(const key in PROFILES){
    const p = PROFILES[key];
    const m = S.MAT[key];
    if(!m || !m.isMeshStandardMaterial) continue;
    if(!BASE.has(key)){
      BASE.set(key, { r: m.roughness, m: m.metalness, e: m.envMapIntensity });
    }
    m.roughness = p.r;
    m.metalness = p.m;
    m.envMapIntensity = p.e;
    if(p.dn !== undefined) m.userData.detailNormal = p.dn;
  }
  // Kaluže: len vodorovné povrchy, po ktorých sa voda dá zbierať. `true` =
  // materiál má `pud`, takže do detailnej normály môže pridať vlnky v kaluži.
  patchMat(S.MAT.asphalt,      'puddle-asphalt',      PUDDLE_FRAG, ROUGH_FRAG, 0, true);
  patchMat(S.MAT.routeAsphalt, 'puddle-routeAsphalt', PUDDLE_FRAG, ROUGH_FRAG, 0, true);
  patchMat(S.MAT.sidewalk,     'puddle-sidewalk',     PUDDLE_FRAG, ROUGH_FRAG, 0, true);
  patchMat(S.MAT.bridge,       'puddle-bridge',       PUDDLE_FRAG, ROUGH_FRAG, 0, true);
  // Vlhký povrch bez kaluží: trávnik, hlina, strechy.
  patchMat(S.MAT.ground,      'wet-ground',      WET_FRAG, '', 0.55);
  patchMat(S.MAT.dirt,        'wet-dirt',        WET_FRAG, '', 0.60);
  patchMat(S.MAT.pitchedRoof, 'wet-pitchedRoof', WET_FRAG, '', 0.55);
  patchMat(S.MAT.flatRoof,    'wet-flatRoof',    WET_FRAG, '', 0.55);
  surfaceReport();
}

// Cielová mokrosť 0..1 (búrka volá 1, koniec búrky 0). Prechod je plynulý —
// cesty nemôžu skočiť z matných na zrkadlové.
export function setSurfaceWetTarget(w){
  wetTarget = w < 0 ? 0 : (w > 1 ? 1 : w);
}

export function updateSurfaceWet(dt){
  const d = wetTarget - wetCur;
  if(d === 0) return;
  const step = dt * 0.35;               // ~3 s do mokra aj do sucha
  if(Math.abs(d) <= step) wetCur = wetTarget;
  else wetCur += (d > 0 ? step : -step);
  applyWet();
}

// Okamžitý stav bez prechodu (iniciálizácia).
export function resetSurfaceWet(){
  wetCur = 0; wetTarget = 0;
  applyWet();
}

export function surfaceWetLevel(){ return wetCur; }

function applyWet(){
  S.UNI.wet.value = wetCur;
  for(const key in PROFILES){
    const p = PROFILES[key];
    const m = S.MAT[key];
    if(!m || !m.isMeshStandardMaterial) continue;
    const w = (p.w || 0) * wetCur;
    m.roughness = p.r * (1 - 0.80 * w);
    m.envMapIntensity = p.e * (1 + 0.55 * w);
    // Detail normal sa stmieva, keď je povrch mokrý (voda vyhladí mikro-detail)
    const u = m.userData.surfUniforms;
    if(u && u.uDetailFade) u.uDetailFade.value = w;
    if(u && u.uTimePuddle) u.uTimePuddle.value = puddleT;
  }
}

// Animovaný čas pre puddle vlnky (volá sa z main.js ticku).
export function updatePuddleTime(dt){
  puddleT += dt;
  for(const key in PROFILES){
    const m = S.MAT[key];
    if(!m || !m.isMeshStandardMaterial) continue;
    const u = m.userData.surfUniforms;
    if(u && u.uTimePuddle) u.uTimePuddle.value = puddleT;
  }
}

// ---------- REPORT ----------
export function surfaceReport(){
  let n = 0;
  const lines = [];
  for(const key in PROFILES){
    const m = S.MAT[key];
    if(!m || !m.isMeshStandardMaterial) continue;
    n++;
    lines.push(key + ' r' + m.roughness.toFixed(2) + ' m' + m.metalness.toFixed(2) + ' e' + m.envMapIntensity.toFixed(2));
  }
  console.log('[odrazy] ' + n + ' povrchov: ' + lines.join(' | '));
}
