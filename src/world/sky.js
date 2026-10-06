// src/world/sky.js — gradientová kupola + PMREM prostredie pre PBR (vlastný kód,
// paleta z monolitu S.SKY_*; legacy buildSky s RT/bloom väzbami sem nepatrí).
import * as THREE from 'three';
import { S } from './shared.js';

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
