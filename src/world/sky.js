// src/world/sky.js — gradientová kupola + PMREM prostredie pre PBR (vlastný kód,
// paleta z monolitu S.SKY_*; legacy buildSky s RT/bloom väzbami sem nepatrí).
import * as THREE from 'three';
import { PERF } from '../core/config.js';
import { S } from './shared.js';

// ---------- DISTANCE CULLING CHUNKOV (budovy + vegetácia, 2 Hz) ----------
// S.CHUNKS bol plnený v buildings.js aj nature.js, ale nikto ho nečítal —
// komentáre sľubovali "distance culling (2 Hz)" a neexistoval. Chunk sa vypne,
// keď je hráč ďalej než (polomer + dosah); vracia počet prepnutých chunkov
// (0 = nič sa nemenilo), aby main vedel, či treba niečo hlásiť.
const CHUNK_REACH_M = 700; // m nad polomer chunku: budovy aj stromy ostávajú vidieť
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

export function buildSkyDome(scene, renderer) {
  const geo = new THREE.SphereGeometry(3200, 24, 12);
  const top = new THREE.Color(S.SKY_ZENITH);
  const hor = new THREE.Color(S.SKY_HORIZON);
  const sunC = new THREE.Color(S.SKY_SUN);
  const sunDir = new THREE.Vector3(S.SUN_OFF.x, S.SUN_OFF.y, S.SUN_OFF.z).normalize();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      cTop: { value: top }, cHor: { value: hor },
      cSun: { value: sunC }, dSun: { value: sunDir },
    },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: [
      'varying vec3 vD; uniform vec3 cTop,cHor,cSun,dSun;',
      'void main(){',
      '  float h = clamp(vD.y, -0.08, 1.0);',
      '  vec3 c = mix(cHor, cTop, pow(max(h,0.0), 0.62));',
      '  float s = max(dot(normalize(vD), normalize(dSun)), 0.0);',
      '  c += cSun * (pow(s, 900.0)*1.4 + pow(s, 18.0)*0.16);',
      '  gl_FragColor = vec4(c, 1.0);',
      '}',
    ].join('\n'),
  });
  const dome = new THREE.Mesh(geo, mat);
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  scene.add(dome);
  // IBL pre PBR materiály: jednorazový PMREM z kupoly (žiadna závislosť na addons)
  try {
    const pm = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(geo.clone(), mat));
    const envRT = pm.fromScene(envScene, 0.04);
    scene.environment = envRT.texture;
    pm.dispose();
  } catch (e) { console.warn('[sky] PMREM env skipped:', e?.message); }
  return dome;
}
