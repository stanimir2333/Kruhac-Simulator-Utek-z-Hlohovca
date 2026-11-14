// src/world/sky.js — gradientová kupola + PMREM prostredie pre PBR (vlastný kód,
// paleta z monolitu S.SKY_*; legacy buildSky s RT/bloom väzbami sem nepatrí).
// Doplnené: skybox z textúr (assets/skybox/sky.jpg + thunder.jpg) s fallbackom
// na procedurálnu gradientovú kupolu, ak súbor chýba / je pokazený.
import * as THREE from 'three';
import { PERF } from '../core/config.js';
import { S } from './shared.js';

// ---------- DISTANCE CULLING CHUNKOV (budovy + vegetácia + mobiliár, 2 Hz) ----------
// S.CHUNKS bol plnený v buildings.js, nature.js aj props.js, ale nikto ho nečítal
// — komentáre sľubovali "distance culling (2 Hz)" a neexistoval. Chunk sa
// vypne, keď je hráč ďalej než (polomer + dosah); vracia počet prepnutých
// chunkov (0 = nič sa nemenilo), aby main vedel, či treba niečo hlásiť.
const CHUNK_REACH_M = S.LOW_END ? 350 : 700; // m nad polomer chunku: budovy aj stromy ostávajú vidieť (raspberry: polovica → menej viditeľných meshov aj draw callov)
const CHUNK_CULL_INTERVAL = 1 / PERF.cullHz;
const CULL_RECHECK_DISTANCE_M = 20;
const CULL_RECHECK_DISTANCE2 = CULL_RECHECK_DISTANCE_M * CULL_RECHECK_DISTANCE_M;
let cullAt = 0, cullX = Infinity, cullZ = Infinity;

export function cullChunks(x, z, now) {
  if (now < cullAt) return 0;
  const dx = x - cullX, dz = z - cullZ;
  if (dx * dx + dz * dz < CULL_RECHECK_DISTANCE2) return 0;
  cullAt = now + CHUNK_CULL_INTERVAL;
  cullX = x; cullZ = z;
  let n = 0;
  const list = S.CHUNKS;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    const ex = c.x - x, ez = c.z - z;
    const lim = c.r + CHUNK_REACH_M;
    const vis = (ex * ex + ez * ez) < lim * lim;
    if (c.vis === vis) continue;
    c.vis = vis;
    const ms = c.ms;
    for (let j = 0; j < ms.length; j++) ms[j].visible = vis;
    n++;
  }
  return n;
}

// ---------- SKYBOX ----------
// Kandidátske cesty — rovnaký vzor ako mapData.js / radio.js, aby hra nabehla
// z Vite dev, z dist/, z python http.server, z Pages aj z file://.
const SKY_BASES = ['/assets/', './assets/', 'assets/', '/public/assets/', './public/assets/', 'public/assets/'];
const SKY_FILES = { normal: 'skybox/sky.jpg', thunder: 'skybox/thunder.jpg' };

let domeRef = null;
let currentVariant = 'normal';
const skyTextures = { normal: null, thunder: null };
let envRendererRef = null, envSceneRef = null, envRTRef = null;

function candidateUrls(file) {
  return SKY_BASES.map((b) => b + file);
}

function loadSkyTexture(file) {
  return new Promise((resolve) => {
    const urls = candidateUrls(file);
    const loader = new THREE.TextureLoader();
    let i = 0;
    const tryNext = () => {
      if (i >= urls.length) { resolve(null); return; }
      const url = urls[i++];
      loader.load(
        url,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.generateMipmaps = true;
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          tex.magFilter = THREE.LinearFilter;
          resolve(tex);
        },
        undefined,
        () => tryNext(),
      );
    };
    tryNext();
  });
}

function applyVariant(v) {
  currentVariant = v;
  if (!domeRef) return;
  const tex = skyTextures[v];
  if (tex) {
    try { domeRef.material?.dispose?.(); } catch (_e) { /* noop */ }
    domeRef.material = new THREE.MeshBasicMaterial({
      map: tex, side: THREE.BackSide, depthWrite: false, fog: false,
    });
    bakeEnv();
  }
  // ak textúra ešte nie je načítaná, ostáva aktuálny materiál (gradient fallback)
}

// Znovu napečie IBL z aktuálneho materiála kupoly. far = 5000 je nutné:
// default 100 by celú guľu r=4000 vystrihol a env by ošiel čierny (žiadne
// odlesky na PBR materiáloch — veľmi tmavá obloha).
function bakeEnv(){
  if(!domeRef || !envSceneRef || !envRendererRef) return;
  try {
    const pm = new THREE.PMREMGenerator(envRendererRef);
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(domeRef.geometry.clone(), domeRef.material));
    const rt = pm.fromScene(envScene, 0.04, 0.1, 5000);
    if(envRTRef){ try{ envRTRef.dispose(); }catch(_e){ /* noop */ } }
    envRTRef = rt;
    envSceneRef.environment = rt.texture;
    pm.dispose();
  } catch (e) { console.warn('[sky] PMREM refresh skipped:', e?.message); }
}

export function setSkyVariant(v) {
  const key = (v === 'thunder') ? 'thunder' : 'normal';
  // ak textúra ešte nie je načítaná, spusti lazy load a aplikuj po dobehnutí
  if (!skyTextures[key]) {
    loadSkyTexture(SKY_FILES[key]).then((tex) => {
      if (!tex) return;
      skyTextures[key] = tex;
      if (currentVariant === key) applyVariant(key);
    });
  }
  applyVariant(key);
}

export function buildSkyDome(scene, renderer) {
  // B32: kupola je teraz POLOVIČNÁ guľa (horná hemisféra). Pôvodne bola
  // plná guľa r=3200 a textúra skyboxu (portrét 335×597) sa na ňu namapovala
  // cez celú guľu — spodná polovica fotky (zvyčajne krajina/zem) sa tak
  // obtáčala okolo horizontu a vytvárala viditeľnú "kopulu" na obzore, ktorá
  // rušila vlastný skybox. Hemisféra použije len hornú polovicu textúry
  // (obloha) a spodok ostáva otvorený, takže terén a hmla pokračujú
  // prirodzene. Polomer 4000 m → zakrivenie horizontu je pod rozlíšením oka.
  const geo = new THREE.SphereGeometry(4000, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2);
  const top = new THREE.Color(S.SKY_ZENITH);
  const hor = new THREE.Color(S.SKY_HORIZON);
  const sunC = new THREE.Color(S.SKY_SUN);
  const sunDir = new THREE.Vector3(S.SUN_OFF.x, S.SUN_OFF.y, S.SUN_OFF.z).normalize();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      cTop: { value: top }, cHor: { value: hor },
      cSun: { value: sunC }, dSun: { value: sunDir }, tex: { value: null }
    },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: [
      'varying vec3 vD; uniform vec3 cTop,cHor,cSun,dSun; uniform sampler2D tex;',
      'void main(){',
      '  gl_FragColor = texture(tex, vec2(vD.x * 0.5 + 0.5, vD.y * 0.5 + 0.5));',
      '}',
    ].join('\n')
  });
  const dome = new THREE.Mesh(geo, mat);
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  scene.add(dome);
  domeRef = dome;
  // IBL pre PBR materiály: prvý bake z gradientnej kupoly (bez závislosti na
  // addons); po dobehnutí skybox textúry ho bakeEnv() napečie nanovo.
  envRendererRef = renderer;
  envSceneRef = scene;
  bakeEnv();
  // Lazy load skybox textúr (neblokuje boot); po dobehnutí sa aplikuje, ak je
  // variant aktívny — applyVariant potom obnoví aj IBL (bakeEnv).
  loadSkyTexture(SKY_FILES.normal).then((tex) => {
    if (!tex) return;
    skyTextures.normal = tex;
    if (currentVariant === 'normal') applyVariant('normal');
  });
  loadSkyTexture(SKY_FILES.thunder).then((tex) => {
    if (!tex) return;
    skyTextures.thunder = tex;
    if (currentVariant === 'thunder') applyVariant('thunder');
  });
  return dome;
}
