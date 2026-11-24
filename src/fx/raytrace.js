// src/fx/raytrace.js — Screen-Space Ray Tracing effects (SSR + Contact Shadows).
// Integruje sa do bloom composer pipeline (src/fx/bloom.js).
// Tri efekty v jednom priechode (Compute-like cez fragment shader):
//  1) Screen-Space Reflections (SSR) — voda, mokré cesty, karosérie, okná.
//  2) Ray-Traced Contact Shadows — jemné tieňy pod autami, chodcami, drobnými objektmi.
//  3) Screen-Space Global Illumination (SSGI) — jemné odrazové svetlo v záverych.
// Všetko beží na polovičnom rozlíšení (ako bloom) pre výkon.

import * as THREE from 'three';
import { S } from '../world/shared.js';

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
  precision highp sampler2D;
  precision highp usampler2D;

  varying vec2 vUv;
  // GLSL3 nemá gl_FragColor — three ho pri GLSL3 nevytvára, treba vlastný output.
  out vec4 fragColor;

  // === UNIFORMS ===
  uniform sampler2D tDiffuse;        // scéna (farba)
  uniform sampler2D tDepth;          // hĺbka (linear 0..1)
  uniform sampler2D tNormal;         // normály (view space, RGB = XYZ * 0.5 + 0.5)
  uniform sampler2D tMetalRough;     // metalness (R), roughness (G)
  uniform mat4 projectionMatrix;
  uniform mat4 projectionMatrixInv;
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
  uniform vec3 sunDirection;         // smer slnka (view space)
  uniform float sunIntensity;        // intenzita slnka
  uniform bool enableSSR;
  uniform bool enableContactShadows;
  uniform bool enableSSGI;
  uniform float roughnessCutoff;     // SSR len pre roughness < cutoff
  uniform float metalnessBoost;      // posun metalness pre SSR

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
    return vec2(mr.r + metalnessBoost, mr.g); // metalness, roughness
  }

  // --- JITTER PRE TEMPORÁLNE ZRKADLENIE ---
  float rand(vec2 co) {
    return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
  }
  vec2 jitterUV(vec2 uv, float t) {
    float j = rand(uv * 17.0 + t * 0.01) * 0.5 + 0.5;
    return uv + (j - 0.5) * (1.0 / resolution);
  }

  // --- SSR RAYMARCH (view space) ---
  vec3 traceSSR(vec3 origin, vec3 dir, float roughness) {
    // Adaptívny krok: hrubší pre hrubšie povrchy, jemnejší pre zrkadlové
    float stepSize = stepScale * mix(0.5, 2.0, roughness);
    float dist = 0.0;
    vec3 pos = origin;
    vec3 hitPos = vec3(0.0);
    bool hit = false;
    float hitDepth = 0.0;

    // Začiatok: posuneme sa z povrchu von (thickness bias)
    pos += dir * thickness;

    for (int i = 0; i < MAX_STEPS; i++) {
      if (i >= maxSteps) break;

      dist += stepSize * (1.0 + dist * 0.1); // exponenciálny rast kroku
      pos = origin + dir * dist;

      // View space -> NDC
      vec4 clip = projectionMatrix * vec4(pos, 1.0);
      if (clip.w <= 0.0) break;
      vec2 ndc = clip.xy / clip.w;
      vec2 uv = ndc * 0.5 + 0.5;

      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;

      float sceneDepth = linearDepth(uv);
      float rayDepth = -pos.z; // view space Z je záporný

      // Hit: ray je za scénou (bližšie k kamere ako scéna)
      if (rayDepth > sceneDepth - thickness) {
        hit = true;
        hitPos = pos;
        hitDepth = sceneDepth;
        break;
      }
    }

    if (!hit) return vec3(0.0);

    // Binary search pre presnejší hit
    float nearDist = dist - stepSize * (1.0 + (dist - stepSize) * 0.1);
    float farDist = dist;
    vec3 nearPos = origin + dir * nearDist;
    vec3 farPos = hitPos;

    for (int i = 0; i < BINARY_SEARCH_STEPS; i++) {
      float midDist = (nearDist + farDist) * 0.5;
      vec3 midPos = origin + dir * midDist;
      vec4 clip = projectionMatrix * vec4(midPos, 1.0);
      if (clip.w <= 0.0) { farDist = midDist; farPos = midPos; continue; }
      vec2 uv = (clip.xy / clip.w) * 0.5 + 0.5;
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { farDist = midDist; farPos = midPos; continue; }
      float sceneDepth = linearDepth(uv);
      float rayDepth = -midPos.z;
      if (rayDepth > sceneDepth - thickness) {
        farDist = midDist;
        farPos = midPos;
      } else {
        nearDist = midDist;
        nearPos = midPos;
      }
    }

    // Finiálna UV pre farebný vzork
    vec4 finalClip = projectionMatrix * vec4(farPos, 1.0);
    vec2 finalUV = (finalClip.xy / finalClip.w) * 0.5 + 0.5;

    if (finalUV.x < 0.0 || finalUV.x > 1.0 || finalUV.y < 0.0 || finalUV.y > 1.0) return vec3(0.0);

    vec3 reflColor = texture(tDiffuse, finalUV).rgb;

    // Fade podľa uhlu (Fresnel-like) a hrubosti
    float ndotv = max(0.0, dot(normalize(-origin), normalize(dir)));
    float fade = pow(1.0 - ndotv, 2.0) * (1.0 - roughness * 0.5);

    return reflColor * fade * ssrIntensity;
  }

  // --- CONTACT SHADOWS (view space, smer slnka) ---
  float traceContactShadow(vec3 origin, vec3 normal) {
    // Ray v smere slnka (view space)
    vec3 dir = normalize(sunDirection);
    float ndotl = dot(normal, dir);
    if (ndotl <= 0.02) return 0.0; // povrch nevidí slnko

    float stepSize = stepScale * 0.3;
    float dist = 0.0;
    vec3 pos = origin + normal * thickness; // posun z povrchu

    for (int i = 0; i < 32; i++) {
      if (i >= maxSteps / 2) break;
      dist += stepSize * (1.0 + dist * 0.15);
      pos = origin + dir * dist;

      vec4 clip = projectionMatrix * vec4(pos, 1.0);
      if (clip.w <= 0.0) break;
      vec2 uv = (clip.xy / clip.w) * 0.5 + 0.5;
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;

      float sceneDepth = linearDepth(uv);
      float rayDepth = -pos.z;
      if (rayDepth > sceneDepth - thickness) {
        // V tieni
        return contactShadowIntensity * (1.0 - ndotl * 0.5);
      }
    }
    return 0.0;
  }

  // --- SSGI (jednoduchý cone trace pre indirect lighting) ---
  vec3 traceSSGI(vec3 origin, vec3 normal, float roughness) {
    vec3 irradiance = vec3(0.0);
    const int SAMPLES = 4;
    const int STEPS = 8;

    for (int s = 0; s < SAMPLES; s++) {
      // Generuj smer v hemi-sfére okolo normály
      float a = rand(vUv + vec2(s * 17.0, time * 0.1)) * PI * 2.0;
      float r = rand(vUv + vec2(s * 31.0, time * 0.13)) * 0.5 + 0.5;
      float phi = acos(1.0 - r);
      vec3 sampleDir = normalize(vec3(
        sin(phi) * cos(a),
        sin(phi) * sin(a),
        cos(phi)
      ));
      // Rotuj do normaly
      vec3 tangent = normalize(cross(normal, abs(normal.z) < 0.9 ? vec3(0,0,1) : vec3(0,1,0)));
      vec3 bitangent = cross(normal, tangent);
      vec3 worldDir = tangent * sampleDir.x + bitangent * sampleDir.y + normal * sampleDir.z;

      float dist = 0.0;
      float stepSize = stepScale * 0.5;
      vec3 pos = origin + normal * thickness;

      for (int i = 0; i < STEPS; i++) {
        dist += stepSize * (1.0 + dist * 0.2);
        pos = origin + worldDir * dist;

        vec4 clip = projectionMatrix * vec4(pos, 1.0);
        if (clip.w <= 0.0) break;
        vec2 uv = (clip.xy / clip.w) * 0.5 + 0.5;
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;

        float sceneDepth = linearDepth(uv);
        float rayDepth = -pos.z;
        if (rayDepth > sceneDepth - thickness) {
          vec3 hitColor = texture(tDiffuse, uv).rgb;
          vec3 hitNormal = getNormal(uv);
          float hitNdotL = max(0.0, dot(hitNormal, -worldDir));
          irradiance += hitColor * hitNdotL * (1.0 / float(SAMPLES));
          break;
        }
      }
    }
    return irradiance * ssgiIntensity * (1.0 - roughness * 0.7);
  }

  // === MAIN ===
  void main() {
    vec4 sceneColor = texture(tDiffuse, vUv);
    float depth = linearDepth(vUv);
    vec3 normal = getNormal(vUv);
    vec2 material = getMaterial(vUv);
    float metalness = material.x;
    float roughness = material.y;

    // Pozícia v view space
    vec3 pos = reconstructPosition(vUv);

    vec3 result = sceneColor.rgb;

    // --- SSR ---
    if (enableSSR && (metalness > 0.1 || roughness < roughnessCutoff)) {
      // View vector
      vec3 V = normalize(-pos);
      // Reflekcia
      vec3 R = reflect(V, normal);
      // Jitter pre temporálnu stabilitu
      vec2 jitteredUV = jitterUV(vUv, time);
      vec3 ssr = traceSSR(pos, R, roughness);
      // Blend: additívne pre metalické, screen pre dielektrické
      if (metalness > 0.5) {
        result = mix(result, result + ssr, metalness);
      } else {
        result = result * (1.0 - ssr) + ssr; // screen blend
      }
    }

    // --- CONTACT SHADOWS ---
    if (enableContactShadows) {
      float shadow = traceContactShadow(pos, normal);
      result *= (1.0 - shadow);
    }

    // --- SSGI ---
    if (enableSSGI && roughness > 0.1) { // SSGI najviac na matných povrchoch
      vec3 gi = traceSSGI(pos, normal, roughness);
      result += gi;
    }

    // Tonemapping sa robí v OutputPass (bloom), tu len lineárna farba
    fragColor = vec4(result, sceneColor.a);
  }
`;

// Default nastavenia kvalít (LITE/STANDARD/ULTRA)
const RT_QUALITY = [
  { // 0 = LITE (2K tieň mapy)
    maxSteps: 32,
    stepScale: 1.5,
    ssrIntensity: 0.6,
    contactShadowIntensity: 0.4,
    ssgiIntensity: 0.3,
    enableSSR: true,
    enableContactShadows: true,
    enableSSGI: false,
  },
  { // 1 = STANDARD (4K tieň mapy)
    maxSteps: 48,
    stepScale: 1.0,
    ssrIntensity: 0.8,
    contactShadowIntensity: 0.6,
    ssgiIntensity: 0.5,
    enableSSR: true,
    enableContactShadows: true,
    enableSSGI: true,
  },
  { // 2 = ULTRA (8K tieň mapy)
    maxSteps: 64,
    stepScale: 0.7,
    ssrIntensity: 1.0,
    contactShadowIntensity: 0.8,
    ssgiIntensity: 0.7,
    enableSSR: true,
    enableContactShadows: true,
    enableSSGI: true,
  },
];

export function createRayTracer(renderer, scene, camera) {
  let rtPass = null;
  let currentQuality = 1; // STANDARD
  let enabled = true;
  let thickness = 0.05;
  let roughnessCutoff = 0.4;
  let metalnessBoost = 0.0;

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
    uniform int uMode;
    void main() {
      // Alpha test pre listy/koruny. map je vzdy platna (whitePixel fallback),
      // sample neplatnej textury by inak discardlo cely G-buffer.
      if (texture2D(map, vUv).a < 0.1) discard;
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
      uMode: { value: 0 },
    },
  });

  // Hĺbku berieme priamo z DepthTexture hlavného renderu (bloom.js).
  const _sunDir = new THREE.Vector3();

  function ensureRT(passW, passH) {
    if (rtPass) return true;
    try {
      const rt = new THREE.WebGLRenderTarget(passW, passH, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        generateMipmaps: false,
        depthBuffer: false,
      });
      const material = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: RT_VERTEX,
        fragmentShader: RT_FRAGMENT,
        uniforms: {
          tDiffuse: { value: null },
          tDepth: { value: null },
          tNormal: { value: null },
          tMetalRough: { value: null },
          projectionMatrix: { value: camera.projectionMatrix },
          projectionMatrixInv: { value: new THREE.Matrix4().copy(camera.projectionMatrix).invert() },
          resolution: { value: new THREE.Vector2(passW, passH) },
          cameraNear: { value: camera.near },
          cameraFar: { value: camera.far },
          time: { value: 0 },
          maxSteps: { value: RT_QUALITY[currentQuality].maxSteps },
          stepScale: { value: RT_QUALITY[currentQuality].stepScale },
          thickness: { value: thickness },
          ssgiIntensity: { value: RT_QUALITY[currentQuality].ssgiIntensity },
          ssrIntensity: { value: RT_QUALITY[currentQuality].ssrIntensity },
          contactShadowIntensity: { value: RT_QUALITY[currentQuality].contactShadowIntensity },
          sunDirection: { value: new THREE.Vector3() },
          sunIntensity: { value: 1.0 },
          enableSSR: { value: RT_QUALITY[currentQuality].enableSSR },
          enableContactShadows: { value: RT_QUALITY[currentQuality].enableContactShadows },
          enableSSGI: { value: RT_QUALITY[currentQuality].enableSSGI },
          roughnessCutoff: { value: roughnessCutoff },
          metalnessBoost: { value: metalnessBoost },
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
      rtPass = null;
      return false;
    }
  }

  // Render G-buffer (normály + metal/rough) do separátnych targetov.
  // Materiály sa na dva passy vymenia priamo na mesh-och (nie overrideMaterial),
  // lebo metalness/roughness sú per-materiál uniforms.
  let gBufferNormalTarget = null;
  let gBufferMetalRoughTarget = null;

  function ensureGBuffer(passW, passH) {
    if (gBufferNormalTarget) return true;
    try {
      const opts = {
        type: THREE.HalfFloatType,
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
      gBufferNormalTarget?.dispose();
      gBufferMetalRoughTarget?.dispose();
      gBufferNormalTarget = null;
      gBufferMetalRoughTarget = null;
      return false;
    }
  }

  function renderGBuffer(renderer, scene, camera, passW, passH) {
    if (!ensureGBuffer(passW, passH)) return null;

    const originals = new Map();
    const clones = [];
    scene.traverse((obj) => {
      if (!obj.isMesh || !obj.material) return;
      originals.set(obj, obj.material);
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      // Jeden clone na materiál, medzi passami len prepneme uMode — polovica
      // alokácií oproti clone-per-pass.
      const gbufMats = mats.map((mat) => {
        const clone = gbufMat.clone();
        clone.uniforms.map.value = mat.map || whitePixel;
        clone.uniforms.metalness.value = mat.metalness !== undefined ? mat.metalness : 0;
        clone.uniforms.roughness.value = mat.roughness !== undefined ? mat.roughness : 0.5;
        clones.push(clone);
        return clone;
      });
      obj.material = gbufMats.length === 1 ? gbufMats[0] : gbufMats;
    });
    const restore = () => {
      for (const [obj, orig] of originals) obj.material = orig;
    };
    // G-buffer potrebuje len geometriu, nie tieňový priechod — bez toho by
    // renderer spravil dva extra full shadow passes každý snímok.
    const prevShadowAuto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;

    try {
      for (const c of clones) c.uniforms.uMode.value = 0; // normály (view space)
      renderer.setRenderTarget(gBufferNormalTarget);
      renderer.render(scene, camera);

      for (const c of clones) c.uniforms.uMode.value = 1; // metalness / roughness
      renderer.setRenderTarget(gBufferMetalRoughTarget);
      renderer.render(scene, camera);
    } finally {
      renderer.shadowMap.autoUpdate = prevShadowAuto;
      restore();
      renderer.setRenderTarget(null);
      originals.clear();
      for (const c of clones) c.dispose();
    }
    return {
      normal: gBufferNormalTarget.texture,
      metalRough: gBufferMetalRoughTarget.texture,
    };
  }

  return {
    setEnabled(v) { enabled = v; },
    isEnabled() { return enabled; },
    setQuality(q) {
      currentQuality = Math.max(0, Math.min(2, q | 0));
      if (rtPass) {
        const cfg = RT_QUALITY[currentQuality];
        rtPass.material.uniforms.maxSteps.value = cfg.maxSteps;
        rtPass.material.uniforms.stepScale.value = cfg.stepScale;
        rtPass.material.uniforms.ssrIntensity.value = cfg.ssrIntensity;
        rtPass.material.uniforms.contactShadowIntensity.value = cfg.contactShadowIntensity;
        rtPass.material.uniforms.ssgiIntensity.value = cfg.ssgiIntensity;
        rtPass.material.uniforms.enableSSR.value = cfg.enableSSR;
        rtPass.material.uniforms.enableContactShadows.value = cfg.enableContactShadows;
        rtPass.material.uniforms.enableSSGI.value = cfg.enableSSGI;
      }
    },
    getQuality() { return currentQuality; },
    setThickness(v) { thickness = v; if (rtPass) rtPass.material.uniforms.thickness.value = v; },
    setRoughnessCutoff(v) { roughnessCutoff = v; if (rtPass) rtPass.material.uniforms.roughnessCutoff.value = v; },
    setMetalnessBoost(v) { metalnessBoost = v; if (rtPass) rtPass.material.uniforms.metalnessBoost.value = v; },

    // Hlavná render funkcia — volá sa z bloom composeru PO scéne, PRED bloom
    render(renderer, scene, camera, sunLight, mainColorTarget, mainDepthTexture) {
      if (!enabled) return mainColorTarget;

      const pr = renderer.getPixelRatio ? renderer.getPixelRatio() : 1;
      const passW = Math.max(2, Math.round(innerWidth * pr * 0.5)); // polovičné rozlíšenie
      const passH = Math.max(2, Math.round(innerHeight * pr * 0.5));

      if (!ensureRT(passW, passH)) return mainColorTarget;

      // 1) Render G-buffer (normály + metal/rough)
      const gbuf = renderGBuffer(renderer, scene, camera, passW, passH);
      if (!gbuf) return mainColorTarget;

      // 2) Smer slnka do view space. DirectionalLight NEMÁ `.direction` —
      // pôvodný kód tam čítal undefined a každý snímok spadol na TypeError.
      _sunDir.set(0, 1, 0);
      if (sunLight && sunLight.position) {
        _sunDir.copy(sunLight.position);
        if (sunLight.target) _sunDir.sub(sunLight.target.position);
      }
      _sunDir.transformDirection(camera.matrixWorldInverse).normalize();
      rtPass.material.uniforms.sunDirection.value.copy(_sunDir);
      rtPass.material.uniforms.sunIntensity.value = sunLight ? sunLight.intensity : 0;
      rtPass.material.uniforms.time.value = performance.now() * 0.001;
      rtPass.material.uniforms.projectionMatrix.value.copy(camera.projectionMatrix);
      rtPass.material.uniforms.projectionMatrixInv.value.copy(camera.projectionMatrixInverse);
      rtPass.material.uniforms.resolution.value.set(passW, passH);
      rtPass.material.uniforms.cameraNear.value = camera.near;
      rtPass.material.uniforms.cameraFar.value = camera.far;

      // 3) Bind textúr
      rtPass.material.uniforms.tDiffuse.value = mainColorTarget.texture;
      rtPass.material.uniforms.tDepth.value = mainDepthTexture; // depth texture z hlavného renderu
      rtPass.material.uniforms.tNormal.value = gbuf.normal;
      rtPass.material.uniforms.tMetalRough.value = gbuf.metalRough;

      // 4) Render RT pass
      renderer.setRenderTarget(rtPass.renderTarget);
      renderer.render(rtPass.scene, rtPass.camera);
      renderer.setRenderTarget(null);

      return rtPass.renderTarget.texture;
    },

    // bloom.js posiela plné rozlíšenie composera, ale RT beží na polovici —
    // použijeme ten istý výpočet ako ensureRT, inak sa po resize rozchádzala
    // veľkosť targetu s uniformom `resolution`.
    resize() {
      const pr = renderer.getPixelRatio ? renderer.getPixelRatio() : 1;
      const w = Math.max(2, Math.round(innerWidth * pr * 0.5));
      const h = Math.max(2, Math.round(innerHeight * pr * 0.5));
      if (rtPass) {
        rtPass.renderTarget.setSize(w, h);
        rtPass.material.uniforms.resolution.value.set(w, h);
      }
      if (gBufferNormalTarget) {
        gBufferNormalTarget.setSize(w, h);
        gBufferMetalRoughTarget.setSize(w, h);
      }
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
      gbufMat.dispose();
      whitePixel.dispose();
    },
  };
}

// Quality preset labels
export const RT_QUALITY_NAMES = ['LITE', 'STANDARD', 'ULTRA'];