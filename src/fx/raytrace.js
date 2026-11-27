// src/fx/raytrace.js — Screen-Space Ray Tracing effects (SSR + Contact Shadows + SSGI).
// Integruje sa do bloom composer pipeline (src/fx/bloom.js).
// Tri efekty v jednom priechode (Compute-like cez fragment shader):
//  1) Screen-Space Reflections (SSR) — voda, mokré cesty, karosérie, okná.
//     Pri miniatí lúča sa použije obloha (sky fallback), takže kovy nikdy
//     neostanú čierne; zmes je Fresnelova, nie "screen blend".
//  2) Ray-Traced Contact Shadows — jemné tiene pod autami, chodcami, drobnými
//     objektmi. Obmedzené na pár metrov, aby nedublovali tieňovú mapu.
//  3) Screen-Space Global Illumination (SSGI) — jemné odrazové svetlo v záveroch.
// Všetko beží na zníženom rozlíšení (podľa kvality LITE/STD/ULTRA) pre výkon.
//
// ! VÝSTUP NIE JE FINÁLNY OBRAZ — je to EFEKT (RGB = čo sa pripočíta k scéne,
// A = násobok scény). Zloženie robí full-res kompozit v src/fx/bloom.js.
// PREčO: RT pass si predtým vykreslil vlastný nízkores obraz a ten BLITOL do
// composera — tým nahradil ostrú scénu rozmazaným upscale-om a celý obraz
// skončil na rozlíšení RT cieľa (0.37× canvasu pri STANDARD). Teraz ostáva
// base obraz v plnom rozlíšení composera a rozmazaný je iba samotný efekt
// (odrazy/tiene/GI) — to je jediný spôsob, ako mať lacné lúče A ostrú scénu.
//
// Kvalita (RT_QUALITY) riadi: rozlíšenie RT cieľa, počet krokov lúčov, dosah
// SSR/contact shadows/SSGI, počet SSGI vzoriek a silu sky fallbacku.
// G-buffer (normály + metal/rough) sa NEKLONUJE každý snímok — klony materiálov
// sú cache-ované (Map), inak vznikalo ~stovky alokácií na snímok a GC sekanie.

import * as THREE from 'three';
import { S } from '../world/shared.js';
import { dayness } from '../world/daynight.js';

const RT_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const RT_FRAGMENT = `
  // GLSL3 zapína three cez glslVersion na ShaderMaterial — verziu tu NEPÍŠeme,
  // inak by sa #version objavil dvakrát a shader by neprešiel kompiláciou.
  precision highp float;
  precision highp int;
  precision highp sampler2D;

  varying vec2 vUv;
  // GLSL3 nemá gl_FragColor — three ho pri GLSL3 nevytvára, treba vlastný output.
  out vec4 fragColor;

  // === UNIFORMS ===
  uniform sampler2D tDiffuse;        // scéna (farba)
  uniform sampler2D tDepth;          // hĺbka (raw window depth 0..1)
  uniform sampler2D tNormal;         // normály (view space, RGB = XYZ * 0.5 + 0.5)
  uniform sampler2D tMetalRough;     // metalness (R), roughness (G)
  uniform mat4 cameraProjectionMatrix;
  uniform mat4 projectionMatrixInv;
  uniform mat4 cameraMatrixWorld;    // inverz viewMatrix — smer lúča do sveta
  // viewMatrix už three deklaruje v prefixe fragment shaderu — duplicitná
  // deklarácia je v GLSL3 chyba kompilácie (a rovnako zbytočná viewMatrixInv).
  uniform vec2 resolution;           // rozlíšenie RT cieľa
  uniform float cameraNear;
  uniform float cameraFar;
  uniform float time;                // čas pre jitter
  uniform int maxSteps;              // max krokov raymarchu
  uniform float stepScale;           // škálovanie kroku (adaptívne)
  uniform float thickness;           // hrúbka povrchu pre SSR
  uniform float ssgiIntensity;       // intenzita SSGI
  uniform float ssrIntensity;        // intenzita SSR
  uniform float contactShadowIntensity; // intenzita contact shadows
  uniform float ssrMaxDist;          // max dĺžka SSR lúča (m)
  uniform float contactShadowMaxDist;// max dĺžka contact shadow lúča (m)
  uniform float ssgiMaxDist;         // max dĺžka SSGI lúča (m)
  uniform int ssgiSamples;           // počet SSGI vzoriek (LITE/STD/ULTRA)
  uniform vec3 sunDirection;         // smer slnka (view space)
  uniform vec3 sunWorld;             // smer slnka (world space, pre sky fallback)
  uniform float sunIntensity;        // intenzita slnka
  uniform bool enableSSR;
  uniform bool enableContactShadows;
  uniform bool enableSSGI;
  uniform float roughnessCutoff;     // SSR len pre roughness < cutoff
  uniform float metalnessBoost;      // posun metalness pre SSR
  uniform float skyIntensity;        // sila sky fallbacku (LITE/STD/ULTRA)
  uniform vec3 skyZenith;
  uniform vec3 skyHorizon;
  uniform vec3 skySun;

  // === KONŠTANTY ===
  #define PI 3.14159265359
  #define MAX_STEPS 64
  #define BINARY_SEARCH_STEPS 5

  // --- HĽBKA: surová window-depth [0,1] → metre vo view space ---
  float rawDepth(vec2 uv) { return texture(tDepth, uv).r; }
  float linearDepth(float raw) {
    return (cameraNear * cameraFar) / (cameraFar - raw * (cameraFar - cameraNear));
  }
  float linearDepth(vec2 uv) { return linearDepth(rawDepth(uv)); }

  // --- REKONŠTRUKCIA POZÍCIE Z HĽBKY ---
  // Sem PATRÍ surová hĺbka (NDC z = raw*2-1). Pôvodný kód sem dával
  // linearizovanú hodnotu, takže lúče začínali pri kamere a raymarch
  // nachádzal "hit" hneď v prvom kroku.
  vec3 reconstructPosition(vec2 uv, float raw) {
    vec4 clip = vec4(uv * 2.0 - 1.0, raw * 2.0 - 1.0, 1.0);
    vec4 view = projectionMatrixInv * clip;
    return view.xyz / view.w;
  }
  vec3 reconstructPosition(vec2 uv) { return reconstructPosition(uv, rawDepth(uv)); }

  // --- NORMÁLA Z G-BUFFERU ---
  vec3 getNormal(vec2 uv) {
    vec3 n = texture(tNormal, uv).rgb * 2.0 - 1.0;
    return normalize(n);
  }

  // --- MATERIÁL ---
  vec2 getMaterial(vec2 uv) {
    vec2 mr = texture(tMetalRough, uv).rg;
    // metalnessBoost je len jemný posun pre mokré povrchy — nikdy nad 1.
    return vec2(clamp(mr.r + metalnessBoost, 0.0, 1.0), clamp(mr.g, 0.0, 1.0));
  }

  // --- STABILNÝ HASH (bez animovaného šumu, aby obraz nekmital) ---
  float rand(vec2 co) {
    return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
  }

  // --- SKY FALLBACK ---
  // Keď SSR lúč minie, kov odráža oblohu. Bez toho boli odrazy na karosérii
  // a skle čierne (tDiffuse nemá čo vrátiť mimo obrazovky).
  vec3 skyColor(vec3 dir) {
    float y = clamp(dir.y, -0.15, 1.0);
    float t = smoothstep(-0.06, 0.55, y);
    vec3 col = mix(skyHorizon, skyZenith, t);
    float sd = max(dot(normalize(dir), normalize(sunWorld)), 0.0);
    col += skySun * (pow(sd, 512.0) * 1.4 + pow(sd, 64.0) * 0.28 + pow(sd, 8.0) * 0.08);
    return col * skyIntensity;
  }

  // --- SSR RAYMARCH (view space) ---
  // Vracia farbu zásahu; confidence (0..1) hovorí, ako veľmi je zásah
  // dôveryhodný (okraj obrazovky, vzdialenosť, drsnosť).
  vec3 traceSSR(vec3 origin, vec3 dir, float roughness, out float confidence) {
    confidence = 0.0;
    // Adaptívny krok: hrubší pre hrubšie povrchy, jemnejší pre zrkadlové.
    float stepSize = stepScale * mix(0.7, 2.0, roughness);
    // Štart až za vlastným povrchom (thickness bias) + stabilný per-pixel
    // offset, aby sa lúče nerozostupovali v pásoch.
    // Väčší počiatočný offset (3× hrúbka) zamedzí samootrazeniu lúča o vlastný
    // povrch (z-fighting/akné na zrkadlových plochách).
    float t = max(thickness * 3.0, abs(origin.z) * 0.002);
    t += rand(vUv * 97.0) * stepSize;
    vec3 pos = origin + dir * t;

    for (int i = 0; i < MAX_STEPS; i++) {
      if (i >= maxSteps || t > ssrMaxDist) break;

      float prevT = t;
      stepSize *= 1.11; // exponenciálny rast kroku
      t += stepSize;
      pos = origin + dir * t;

      // View space -> NDC kamery scény (nie projekcia full-screen quadu).
      vec4 clip = cameraProjectionMatrix * vec4(pos, 1.0);
      if (clip.w <= 0.0) break;
      vec2 ndc = clip.xy / clip.w;
      vec2 uv = ndc * 0.5 + 0.5;
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;

      float sceneDepth = linearDepth(uv);
      float rayDepth = -pos.z; // view space Z je záporný
      // Hrúbka rastie so vzdialenosťou — inak ďaleké lúče prepadnú cez steny.
      float thick = thickness * 2.0 + t * 0.015;

      // Hit: ray je za scénou (bližšie k kamere ako scéna)
      if (rayDepth > sceneDepth - thick) {
        // Binary search pre presnejší hit (medzi prevT a t).
        float nearT = prevT;
        float farT = t;
        for (int j = 0; j < BINARY_SEARCH_STEPS; j++) {
          float midT = (nearT + farT) * 0.5;
          vec3 midPos = origin + dir * midT;
          vec4 c2 = cameraProjectionMatrix * vec4(midPos, 1.0);
          if (c2.w <= 0.0) { nearT = midT; continue; }
          vec2 uv2 = (c2.xy / c2.w) * 0.5 + 0.5;
          if (uv2.x < 0.0 || uv2.x > 1.0 || uv2.y < 0.0 || uv2.y > 1.0) {
            nearT = midT;
            continue;
          }
          float sd = linearDepth(uv2);
          float mt = thickness + midT * 0.015;
          if (-midPos.z > sd - mt) farT = midT;
          else nearT = midT;
        }

        vec3 hitPos = origin + dir * farT;
        vec4 fc = cameraProjectionMatrix * vec4(hitPos, 1.0);
        if (fc.w <= 0.0) return vec3(0.0);
        vec2 fuv = (fc.xy / fc.w) * 0.5 + 0.5;
        if (fuv.x < 0.0 || fuv.x > 1.0 || fuv.y < 0.0 || fuv.y > 1.0) return vec3(0.0);

        // Okraj obrazovky = nespoľahlivý zásah; vzdialenosť a drsnosť tiež.
        float edge =
          smoothstep(0.0, 0.08, fuv.x) * (1.0 - smoothstep(0.92, 1.0, fuv.x)) *
          smoothstep(0.0, 0.08, fuv.y) * (1.0 - smoothstep(0.92, 1.0, fuv.y));
        float distFade = 1.0 - smoothstep(ssrMaxDist * 0.55, ssrMaxDist, farT);
        confidence = clamp(edge * distFade * (1.0 - roughness * 0.55), 0.0, 1.0);
        return texture(tDiffuse, fuv).rgb;
      }
    }
    return vec3(0.0);
  }

  // --- CONTACT SHADOWS (view space, smer slnka) ---
  // Len krátky dosah (pár metrov): dlhé tiene rieši tieňová mapa, toto sú
  // jemné dotykové tiene pod objektmi. Predtým lúč letel ~50 m a dubloval
  // celú tieňovú mapu.
  float traceContactShadow(vec3 origin, vec3 normal) {
    vec3 dir = normalize(sunDirection);
    float ndotl = dot(normal, dir);
    if (ndotl <= 0.05) return 0.0;

    float maxDist = contactShadowMaxDist;
    float stepSize = maxDist / 12.0;
    float jitter = rand(vUv * 53.0 + 0.37);
    vec3 pos;

    for (int i = 0; i < 24; i++) {
      if (i >= maxSteps / 3) break;
      float t = (float(i) + jitter) * stepSize;
      if (t > maxDist) break;

      // Väčší offset od normály (2× hrúbka) zamedzí self-shadow akné.
      pos = origin + dir * t + normal * (thickness * 2.0);
      vec4 clip = cameraProjectionMatrix * vec4(pos, 1.0);
      if (clip.w <= 0.0) break;
      vec2 uv = (clip.xy / clip.w) * 0.5 + 0.5;
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;

      float sceneDepth = linearDepth(uv);
      float rayDepth = -pos.z;
      float thick = thickness * 2.0 + t * 0.02;
      if (rayDepth > sceneDepth - thick) {
        float fade = 1.0 - smoothstep(maxDist * 0.55, maxDist, t);
        float sunAmt = clamp(sunIntensity * 0.5, 0.0, 1.0);
        return contactShadowIntensity * fade * smoothstep(0.0, 0.3, ndotl) * sunAmt;
      }
    }
    return 0.0;
  }

  // --- SSGI (cosine-weighted hemisphere trace) ---
  vec3 traceSSGI(vec3 origin, vec3 normal, float roughness) {
    vec3 irradiance = vec3(0.0);
    float jitter = rand(vUv * 31.7);
    float stepSize = ssgiMaxDist / 6.0;

    for (int s = 0; s < 8; s++) {
      if (s >= ssgiSamples) break;

      // Cosine-weighted vzorka v hemi-sfére (BRDF cosinus sa vykráti).
      float a = (float(s) + jitter) * 2.39996323; // zlatý uhol
      float r = rand(vUv + vec2(float(s) * 13.7, 3.1));
      float phi = acos(sqrt(r));
      vec3 sampleDir = vec3(
        sin(phi) * cos(a),
        sin(phi) * sin(a),
        cos(phi)
      );
      vec3 tangent = normalize(cross(normal, abs(normal.z) < 0.9 ? vec3(0, 0, 1) : vec3(0, 1, 0)));
      vec3 bitangent = cross(normal, tangent);
      vec3 worldDir = tangent * sampleDir.x + bitangent * sampleDir.y + normal * sampleDir.z;

      float t = stepSize * (0.35 + rand(vUv + float(s) * 7.3));
      for (int i = 0; i < 8; i++) {
        t += stepSize;
        if (t > ssgiMaxDist) break;
        vec3 pos = origin + worldDir * t;

        vec4 clip = cameraProjectionMatrix * vec4(pos, 1.0);
        if (clip.w <= 0.0) break;
        vec2 uv = (clip.xy / clip.w) * 0.5 + 0.5;
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;

        float sceneDepth = linearDepth(uv);
        float rayDepth = -pos.z;
        if (rayDepth > sceneDepth - (thickness * 2.0 + t * 0.03)) {
          irradiance += texture(tDiffuse, uv).rgb;
          break;
        }
      }
    }

    float inv = 1.0 / float(max(1, ssgiSamples));
    // Clamp proti fireflies (jasné slnko na vode by inak blikalo).
    irradiance = min(irradiance * inv, vec3(1.5));
    return irradiance * ssgiIntensity * (1.0 - roughness * 0.65);
  }

  // === MAIN ===
  void main() {
    float raw = rawDepth(vUv);
    float depth = linearDepth(raw);
    bool isSky = raw >= 0.99999 || depth >= cameraFar * 0.98;
    vec3 normal = getNormal(vUv);
    vec2 material = getMaterial(vUv);
    float metalness = material.x;
    float roughness = material.y;

    // Pozícia v view space
    vec3 pos = reconstructPosition(vUv, raw);

    // VÝSTUP = EFEKT, nie obraz: RGB sa pripočíta, A násobí base scénu.
    // (Pôvodne tu bola výsledná farba a pass ju blitol do composera.)
    vec3 sceneAdd = vec3(0.0);
    float sceneMul = 1.0;

    // --- SSR ---
    if (!isSky && enableSSR && (metalness > 0.02 || roughness < roughnessCutoff)) {
      vec3 V = normalize(-pos);
      // V mieri z povrchu ku kamere; dopadový lúč ide opačne.
      vec3 R = reflect(-V, normal);
      float hitConf = 0.0;
      vec3 hitColor = traceSSR(pos, R, roughness, hitConf);

      // Fresnel: dielektrikum odráža málo kolmo a takmer všetko na hrane;
      // kov odráža vždy. f0 = 0.04 pre sklo/asfalt, 1.0 pre kov.
      float ndotv = clamp(dot(normal, V), 0.0, 1.0);
      float fresnel = pow(1.0 - ndotv, 5.0);
      float f0 = mix(0.04, 1.0, metalness);
      float reflAmt = (f0 + (1.0 - f0) * fresnel) * ssrIntensity * (1.0 - roughness * 0.65);

      vec3 worldR = normalize(mat3(cameraMatrixWorld) * R);
      vec3 env = skyColor(worldR);
      // Miss = obloha (stlmenejšia), hit = farba scény.
      vec3 reflColor = mix(env, hitColor, hitConf);
      float amount = clamp(reflAmt * mix(0.55, 1.0, hitConf), 0.0, 1.0);
      // mix(scene, reflColor, amount) == scene*(1-amount) + reflColor*amount
      sceneMul *= (1.0 - amount);
      sceneAdd += reflColor * amount;
    }

    // --- CONTACT SHADOWS ---
    float shadow = 0.0;
    if (!isSky && enableContactShadows) {
      shadow = clamp(traceContactShadow(pos, normal), 0.0, 0.85);
    }

    // --- SSGI ---
    vec3 gi = vec3(0.0);
    if (!isSky && enableSSGI && roughness > 0.15) { // SSGI najviac na matných povrchoch
      gi = traceSSGI(pos, normal, roughness);
    }

    // Pôvodné poradie bolo: mix → násobenie tieňom → pričítanie GI, čiže
    // (scena*(1-a) + odraz*a) * (1-shadow) + gi. Tu to rozkladáme na
    // násobič scény a aditívny príspevok, aby base farba mohla zostať
    // v plnom rozlíšení (pozri hlavičku súboru).
    sceneMul *= (1.0 - shadow);
    sceneAdd = sceneAdd * (1.0 - shadow) + gi;

    // Tonemapping sa robí v OutputPass (bloom), tu len lineárna farba
    fragColor = vec4(sceneAdd, sceneMul);
  }
`;

// Kvality LITE/STANDARD/ULTRA. `resScale` je podiel rozlíšenia composeru, na
// ktorom sa počítajú lúče (1.0 = plné rozlíšenie composera, 1.25 = supersampling
// lúčov). `maxPixels` je tvrdý strop na počet pixelov RT cieľa — na HiDPI
// (DPR 2) by composer mal 4× pixely a RT by bol nerovnako drahý; škála sa
// preto zníži, aby RT zostal v rozumnom budgete.
const RT_QUALITY = [
  { // 0 = LITE (2K tieňová mapa)
    resScale: 0.75,
    maxPixels: 1600000,
    maxSteps: 28,
    stepScale: 1.5,
    ssrIntensity: 0.8,
    ssrMaxDist: 35,
    contactShadowIntensity: 0.6,
    contactShadowMaxDist: 4.0,
    ssgiIntensity: 0.45,
    ssgiSamples: 3,
    ssgiMaxDist: 6,
    skyIntensity: 0.9,
    enableSSR: true,
    enableContactShadows: true,
    enableSSGI: true,
  },
  { // 1 = STANDARD (4K tieňová mapa)
    resScale: 1.0,
    maxPixels: 3200000,
    maxSteps: 44,
    stepScale: 1.0,
    ssrIntensity: 0.95,
    ssrMaxDist: 60,
    contactShadowIntensity: 0.7,
    contactShadowMaxDist: 5.0,
    ssgiIntensity: 0.6,
    ssgiSamples: 4,
    ssgiMaxDist: 8,
    skyIntensity: 1.0,
    enableSSR: true,
    enableContactShadows: true,
    enableSSGI: true,
  },
  { // 2 = ULTRA (8K tieňová mapa)
    resScale: 1.25,
    maxPixels: 5000000,
    maxSteps: 64,
    stepScale: 0.7,
    ssrIntensity: 1.0,
    ssrMaxDist: 90,
    contactShadowIntensity: 0.85,
    contactShadowMaxDist: 6.0,
    ssgiIntensity: 0.75,
    ssgiSamples: 6,
    ssgiMaxDist: 10,
    skyIntensity: 1.0,
    enableSSR: true,
    enableContactShadows: true,
    enableSSGI: true,
  },
];

// Fallback rozlíšenie, kým bloom nezavolá resize() so skutočnou veľkosťou
// composeru. 0.75 = BLOOM_RENDER_SCALE v bloom.js (RT je podiel z composeru).
const RT_BASE_SCALE = 0.75;

export function createRayTracer(renderer, camera) {
  let rtPass = null;
  let currentQuality = 1; // STANDARD
  let failed = false;
  let enabled = true;
  let thickness = 0.05;
  // Nižší prah: aj matnejšie povrchy (suchý asfalt, omietky) dostanú jemný
  // screen-space odraz okolia/oblohy — inak pôsobila scéna plocho.
  let roughnessCutoff = 0.55;
  let metalnessBoost = 0.0;
  let baseW = 2, baseH = 2;

  // G-buffer: dva jednoduché passy (normály, metal/rough). Pôvodný pokus o
  // GLSL3 MRT so štyrmi `out` premennými sa nikdy nekompiloval — ShaderMaterial
  // nemal glslVersion a nebolo naviazané drawBuffers, takže obe textúry
  // obsahovali len albedo (alebo nič). Teraz jeden GLSL1 shader s uMode = 0/1.
  const gBufferVertex = `
    varying vec3 vNormal;
    varying vec2 vUv;
    void main() {
      vUv = uv;
      vec4 p = vec4(position, 1.0);
      vec3 n = normal;
      // Mesto je plné InstancedMesh (autá, chodci, stromy, lístie) — bez
      // instanceMatrix by sa všetky inštancie zložili na základný transform.
      #ifdef USE_INSTANCING
        p = instanceMatrix * p;
        mat3 im = mat3(instanceMatrix);
        n /= vec3(dot(im[0], im[0]), dot(im[1], im[1]), dot(im[2], im[2]));
        n = im * n;
      #endif
      vNormal = normalize(normalMatrix * n);
      gl_Position = projectionMatrix * modelViewMatrix * p;
    }
  `;
  const gBufferFragment = `
    precision highp float;
    varying vec3 vNormal;
    varying vec2 vUv;
    uniform sampler2D map;
    uniform float metalness;
    uniform float roughness;
    uniform float alphaTest;
    uniform int uMode;
    void main() {
      // Alpha test pre listy/koruny. map je vzdy platna (whitePixel fallback),
      // sample neplatnej textury by inak discardlo cely G-buffer.
      if (texture2D(map, vUv).a < alphaTest) discard;
      if (uMode == 0) gl_FragColor = vec4(normalize(vNormal) * 0.5 + 0.5, 1.0);
      else gl_FragColor = vec4(metalness, roughness, 0.0, 1.0);
    }
  `;
  const whitePixel = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  whitePixel.needsUpdate = true;
  const gbufMat = new THREE.ShaderMaterial({
    vertexShader: gBufferVertex,
    fragmentShader: gBufferFragment,
    uniforms: {
      map: { value: whitePixel },
      metalness: { value: 0.0 },
      roughness: { value: 0.5 },
      alphaTest: { value: 0.1 },
      uMode: { value: 0 },
    },
  });

  // Cache klonov G-buffer materiálov: kľúč = zdrojový materiál. Klon sa
  // použije pre všetky meshe s tým istým materiálom a medzi snímkami sa len
  // obnovia uniforms. Predtým sa každý snímok klonoval materiál pre každý
  // mesh (stovky alokácií + dispose → GC sekanie).
  const gbufCache = new Map();
  const usedClones = new Set();

  function gbufFor(src) {
    let clone = gbufCache.get(src);
    if (!clone) {
      clone = gbufMat.clone();
      gbufCache.set(src, clone);
    }
    const u = clone.uniforms;
    const map = src.map || whitePixel;
    if (u.map.value !== map) u.map.value = map;
    const metal = typeof src.metalness === 'number' ? src.metalness : 0;
    if (u.metalness.value !== metal) u.metalness.value = metal;
    const rough = typeof src.roughness === 'number' ? src.roughness : 0.5;
    if (u.roughness.value !== rough) u.roughness.value = rough;
    const at = typeof src.alphaTest === 'number' ? src.alphaTest : 0.1;
    if (u.alphaTest.value !== at) u.alphaTest.value = at;
    if (clone.side !== src.side) clone.side = src.side;
    usedClones.add(clone);
    return clone;
  }

  // Hĺbku berieme priamo z DepthTexture hlavného renderu (bloom.js).
  const _sunDir = new THREE.Vector3();
  const _sunWorld = new THREE.Vector3();
  const _skyHorizon = new THREE.Color(S.SKY_HORIZON);
  const _skyZenith = new THREE.Color(S.SKY_ZENITH);
  const _skySun = new THREE.Color(S.SKY_SUN);
  const _zenithBase = new THREE.Color(S.SKY_ZENITH);

  function targetSize() {
    const cfg = RT_QUALITY[currentQuality];
    let scale = cfg.resScale;
    // TvrDÝ strop na pixelácie: na HiDPI je composer 4× väčší a RT lúče by
    // stáli 4× viac. Škála sa zníži úmernie (plocha rastie so švorcom).
    const px = baseW * baseH;
    if (px > 0 && px * scale * scale > cfg.maxPixels) {
      scale = Math.sqrt(cfg.maxPixels / px);
    }
    return [
      Math.max(2, Math.round(baseW * scale)),
      Math.max(2, Math.round(baseH * scale)),
    ];
  }

  function ensureRT(passW, passH) {
    if (rtPass) return true;
    try {
      const rt = new THREE.WebGLRenderTarget(passW, passH, {
        // Composer (readBuffer) je UnsignedByte (bloom.js), takže RT cieľ
        // nemá čo stratiť — 8 bitov je presná kópia vstupu a polovičná
        // priepustnosť oproti HalfFloat. (Predtým tu HalfFloat ostal po
        // diagnostike čierneho obrazu, ktorého príčinou bol `projectionMatrix`
        // v material.uniforms — pozri komentár nižšie.)
        type: THREE.UnsignedByteType,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        generateMipmaps: false,
        depthBuffer: false,
      });
      const cfg = RT_QUALITY[currentQuality];
      const material = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: RT_VERTEX,
        fragmentShader: RT_FRAGMENT,
        uniforms: {
          tDiffuse: { value: null },
          tDepth: { value: null },
          tNormal: { value: null },
          tMetalRough: { value: null },
          // `projectionMatrix` NEPATRÍ do uniforms — three ho nastavuje ako
          // built-in pre každý program. Keď je aj v material.uniforms, jeho
          // upload zneplatní celý draw (RT cieľ ostal čierny bez chyby v logu).
          // Raymarch projekcia patrí kamere scény, nie ortografickej kamere quadu.
          cameraProjectionMatrix: { value: camera.projectionMatrix },
          projectionMatrixInv: { value: new THREE.Matrix4().copy(camera.projectionMatrix).invert() },
          cameraMatrixWorld: { value: camera.matrixWorld },
          resolution: { value: new THREE.Vector2(passW, passH) },
          cameraNear: { value: camera.near },
          cameraFar: { value: camera.far },
          time: { value: 0 },
          maxSteps: { value: cfg.maxSteps },
          stepScale: { value: cfg.stepScale },
          thickness: { value: thickness },
          ssgiIntensity: { value: cfg.ssgiIntensity },
          ssrIntensity: { value: cfg.ssrIntensity },
          contactShadowIntensity: { value: cfg.contactShadowIntensity },
          ssrMaxDist: { value: cfg.ssrMaxDist },
          contactShadowMaxDist: { value: cfg.contactShadowMaxDist },
          ssgiMaxDist: { value: cfg.ssgiMaxDist },
          ssgiSamples: { value: cfg.ssgiSamples },
          sunDirection: { value: new THREE.Vector3() },
          sunWorld: { value: new THREE.Vector3() },
          sunIntensity: { value: 1.0 },
          enableSSR: { value: cfg.enableSSR },
          enableContactShadows: { value: cfg.enableContactShadows },
          enableSSGI: { value: cfg.enableSSGI },
          roughnessCutoff: { value: roughnessCutoff },
          metalnessBoost: { value: metalnessBoost },
          skyIntensity: { value: cfg.skyIntensity },
          skyZenith: { value: _skyZenith },
          skyHorizon: { value: _skyHorizon },
          skySun: { value: _skySun },
        },
        depthWrite: false,
        depthTest: false,
      });
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
      const rtScene = new THREE.Scene();
      rtScene.add(quad);
      const rtCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

      rtPass = {
        scene: rtScene,
        camera: rtCamera,
        material,
        renderTarget: rt,
        quad,
      };
      return true;
    } catch (e) {
      console.warn('[raytrace] RT pass nedostupný:', e?.message);
      failed = true;
      rtPass = null;
      return false;
    }
  }

  // Render G-buffer (normály + metal/rough) do separátnych targetov.
  // Materiály sa na dva passy vymenia priamo na mesh-och (nie overrideMaterial),
  // lebo metalness/roughness sú per-materiál uniforms. Klony sú cache-ované.
  let gBufferNormalTarget = null;
  let gBufferMetalRoughTarget = null;

  function ensureGBuffer(passW, passH) {
    if (gBufferNormalTarget) return true;
    try {
      const opts = {
        // 8-bit postačuje pre normály a metal/rough; netreba float color-buffer extension.
        type: THREE.UnsignedByteType,
        format: THREE.RGBAFormat,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        generateMipmaps: false,
        // Bez depth bufferu by vyhrával neskôr nakreslený objekt, nie najbližší —
        // G-buffer by nepatril viditeľnému povrchu.
        depthBuffer: true,
      };
      gBufferNormalTarget = new THREE.WebGLRenderTarget(passW, passH, opts);
      // RGFormat nie je na každom driveri renderovateľný — stačí RGBA, číta sa .rg.
      gBufferMetalRoughTarget = new THREE.WebGLRenderTarget(passW, passH, opts);
      return true;
    } catch (e) {
      console.warn('[raytrace] G-buffer nedostupný:', e?.message);
      failed = true;
      gBufferNormalTarget?.dispose();
      gBufferMetalRoughTarget?.dispose();
      gBufferNormalTarget = null;
      gBufferMetalRoughTarget = null;
      return false;
    }
  }

  // Mesh patrí do G-bufferu, len ak je to nepriehľadný povrch. Sklo (nízka
  // roughness) berieme aj napriek depthWrite=false — odrazy na oknách sú
  // žiadané; skybox, decaly a časticové plochy (depthWrite=false, matné) nie.
  function isGBufferSurface(obj) {
    if (!obj.isMesh || !obj.material) return false;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (let i = 0; i < mats.length; i++) {
      const m = mats[i];
      if (!m || m.visible === false) return false;
      if (m.transparent && m.opacity < 0.2) return false;
      if (m.depthWrite === false) {
        const glass = m.transparent && typeof m.roughness === 'number' && m.roughness < 0.3;
        if (!glass) return false;
      }
    }
    return true;
  }

  function renderGBuffer(renderer, scene, camera, passW, passH) {
    if (!ensureGBuffer(passW, passH)) return null;

    usedClones.clear();
    const originals = [];
    scene.traverse((obj) => {
      if (!isGBufferSurface(obj)) return;
      originals.push([obj, obj.material]);
      const srcMats = Array.isArray(obj.material) ? obj.material : [obj.material];
      const gbufMats = srcMats.map(gbufFor);
      obj.material = Array.isArray(obj.material) ? gbufMats : gbufMats[0];
    });
    // G-buffer potrebuje len geometriu, nie tieňový priechod — bez toho by
    // renderer spravil dva extra full shadow passes každý snímok.
    const prevShadowAuto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;

    try {
      for (const c of usedClones) c.uniforms.uMode.value = 0; // normály (view space)
      renderer.setRenderTarget(gBufferNormalTarget);
      renderer.render(scene, camera);

      for (const c of usedClones) c.uniforms.uMode.value = 1; // metalness / roughness
      renderer.setRenderTarget(gBufferMetalRoughTarget);
      renderer.render(scene, camera);
    } finally {
      renderer.shadowMap.autoUpdate = prevShadowAuto;
      for (let i = 0; i < originals.length; i++) originals[i][0].material = originals[i][1];
      renderer.setRenderTarget(null);
    }
    return {
      normal: gBufferNormalTarget.texture,
      metalRough: gBufferMetalRoughTarget.texture,
    };
  }

  function applySize() {
    const [w, h] = targetSize();
    if (rtPass) {
      rtPass.renderTarget.setSize(w, h);
      rtPass.material.uniforms.resolution.value.set(w, h);
    }
    if (gBufferNormalTarget) {
      gBufferNormalTarget.setSize(w, h);
      gBufferMetalRoughTarget.setSize(w, h);
    }
  }

  function applyQuality(q) {
    currentQuality = Math.max(0, Math.min(RT_QUALITY.length - 1, q | 0));
    if (rtPass) {
      const cfg = RT_QUALITY[currentQuality];
      const u = rtPass.material.uniforms;
      u.maxSteps.value = cfg.maxSteps;
      u.stepScale.value = cfg.stepScale;
      u.ssrIntensity.value = cfg.ssrIntensity;
      u.ssrMaxDist.value = cfg.ssrMaxDist;
      u.contactShadowIntensity.value = cfg.contactShadowIntensity;
      u.contactShadowMaxDist.value = cfg.contactShadowMaxDist;
      u.ssgiIntensity.value = cfg.ssgiIntensity;
      u.ssgiSamples.value = cfg.ssgiSamples;
      u.ssgiMaxDist.value = cfg.ssgiMaxDist;
      u.skyIntensity.value = cfg.skyIntensity;
      u.enableSSR.value = cfg.enableSSR;
      u.enableContactShadows.value = cfg.enableContactShadows;
      u.enableSSGI.value = cfg.enableSSGI;
    }
    applySize();
  }

  return {
    setEnabled(v) { enabled = v; },
    isEnabled() { return enabled; },
    setQuality(q) { applyQuality(q); },
    getQuality() { return currentQuality; },
    setThickness(v) { thickness = v; if (rtPass) rtPass.material.uniforms.thickness.value = v; },
    setRoughnessCutoff(v) { roughnessCutoff = v; if (rtPass) rtPass.material.uniforms.roughnessCutoff.value = v; },
    setMetalnessBoost(v) { metalnessBoost = v; if (rtPass) rtPass.material.uniforms.metalnessBoost.value = v; },

    // Hlavná render funkcia — volá sa z bloom composeru PO scéne, PRED bloom.
    // Vracia { texture, effect }: effect=true znamená, že textúra je EFECTOVÁ
    // vrstva (RGB = príspevok, A = násobok scény) a composit ju musí zložiť
    // s plným rozlíšením scény. effect=false = nič sa netrackovalo, vracia
    // sa pôvodná scéna (bloom ju len skopíruje).
    render(renderer, scene, camera, sunLight, mainColorTarget, mainDepthTexture) {
      // RT vyžaduje WebGL2/GLSL3 aj platný depth target. Pri nepodpore
      // alebo chybe necháme bežať pôvodný composer obraz bez opakovaných pokusov.
      if (!enabled || failed || !mainColorTarget || !mainDepthTexture
        || renderer.capabilities?.isWebGL2 === false) {
        return { texture: mainColorTarget?.texture || null, effect: false };
      }

      try {
        const [passW, passH] = targetSize();
        if (!ensureRT(passW, passH)) return { texture: mainColorTarget.texture, effect: false };

        // 1) Render G-buffer (normály + metal/rough)
        const gbuf = renderGBuffer(renderer, scene, camera, passW, passH);
        if (!gbuf) return { texture: mainColorTarget.texture, effect: false };

        // 2) Smer slnka. DirectionalLight NEMÁ `.direction` — pôvodný kód tam
        // čítal undefined a každý snímok spadol na TypeError.
        _sunWorld.set(0, 1, 0);
        if (sunLight && sunLight.position) {
          _sunWorld.copy(sunLight.position);
          if (sunLight.target) _sunWorld.sub(sunLight.target.position);
        }
        _sunWorld.normalize();
        _sunDir.copy(_sunWorld).transformDirection(camera.matrixWorldInverse).normalize();

        // 3) Sky farby pre fallback: horizont ber zo scene.background (daynight
        // ho mení deň/noc/búrka), zenit z konštanty stmavenej podľa dňa.
        const bg = scene.background;
        if (bg && bg.isColor) _skyHorizon.copy(bg);
        else _skyHorizon.set(S.SKY_HORIZON);
        const day = dayness();
        _skyZenith.copy(_zenithBase).multiplyScalar(0.18 + 0.82 * day);
        if (sunLight && sunLight.color) _skySun.copy(sunLight.color);
        else _skySun.set(S.SKY_SUN);

        const u = rtPass.material.uniforms;
        u.sunDirection.value.copy(_sunDir);
        u.sunWorld.value.copy(_sunWorld);
        u.sunIntensity.value = sunLight ? sunLight.intensity : 0;
        u.time.value = performance.now() * 0.001;
        u.cameraProjectionMatrix.value.copy(camera.projectionMatrix);
        u.projectionMatrixInv.value.copy(camera.projectionMatrixInverse);
        u.cameraMatrixWorld.value.copy(camera.matrixWorld);
        u.resolution.value.set(passW, passH);
        u.cameraNear.value = camera.near;
        u.cameraFar.value = camera.far;

        // 4) Bind textúr
        u.tDiffuse.value = mainColorTarget.texture;
        u.tDepth.value = mainDepthTexture; // depth texture z hlavného renderu
        u.tNormal.value = gbuf.normal;
        u.tMetalRough.value = gbuf.metalRough;

        // 5) Render RT pass — do svojho cieľa, NESÚSA j so scénou.
        renderer.setRenderTarget(rtPass.renderTarget);
        renderer.render(rtPass.scene, rtPass.camera);
        renderer.setRenderTarget(null);

        return { texture: rtPass.renderTarget.texture, effect: true };
      } catch (e) {
        try { renderer.setRenderTarget(null); } catch (_e) { /* kontext môže byť stratený */ }
        failed = true;
        console.warn('[raytrace] RT pass vypnutý po chybe:', e?.message);
        return { texture: mainColorTarget.texture, effect: false };
      }
    },

    // Odhad pamäte RT bufferov (G-buffery + RT cieľ) v bajtoch — vramGuard
    // v src/ui/settings.js to používa ako podnet na zníženie tieňovej mapy.
    estimateVRAM() {
      if (!enabled || failed) return 0;
      const [w, h] = targetSize();
      const px = w * h;
      // 2× G-buffer (farba 4 B + hĺbka 4 B) + RT cieľ (4 B)
      return px * 24;
    },

    // bloom.js posiela plné rozlíšenie composera (0.75 DPR) — RT si z neho
    // vezme podiel podľa kvality. Predtým si RT počítal vlastných 0.5 DPR,
    // takže sa po resize rozchádzala veľkosť targetu s uniformom `resolution`.
    resize(w, h) {
      if (w > 1 && h > 1) {
        baseW = w;
        baseH = h;
      } else {
        const pr = renderer.getPixelRatio ? renderer.getPixelRatio() : 1;
        baseW = Math.max(2, Math.round(innerWidth * pr * RT_BASE_SCALE));
        baseH = Math.max(2, Math.round(innerHeight * pr * RT_BASE_SCALE));
      }
      applySize();
    },

    dispose() {
      if (rtPass) {
        rtPass.renderTarget.dispose();
        rtPass.material.dispose();
        rtPass.quad.geometry.dispose();
        rtPass = null;
      }
      if (gBufferNormalTarget) {
        gBufferNormalTarget.dispose();
        gBufferMetalRoughTarget.dispose();
        gBufferNormalTarget = null;
        gBufferMetalRoughTarget = null;
      }
      for (const m of gbufCache.values()) m.dispose();
      gbufCache.clear();
      usedClones.clear();
      gbufMat.dispose();
      whitePixel.dispose();
    },
  };
}

// Quality preset labels
export const RT_QUALITY_NAMES = ['LITE', 'STANDARD', 'ULTRA'];
