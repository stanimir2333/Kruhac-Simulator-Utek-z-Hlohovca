// src/fx/bloom.js — jednoduchý threshold bloom cez three/addons (EffectComposer).
// (Legacy malo vlastný 300-riadkový composer s vrstvami; toto je lacná náhrada:
// prah 0.8+ → žiaria len slnko, lampy, majáky a svetlomety. HUD je DOM, nedotkne sa.)
//
// B30 (výkon + kvalita):
//  · Bloom reťaz (bright pass + 5 mipov + kompozícia) beží na POLOVIČNOM
//    rozlíšení renderu. Žiarenie je z princípu rozostrené, takže polovičné
//    rozlíšenie nie je na obraze vidieť, ale šetrí ~75 % pixelovej práce —
//    pri pixelRatio 2 to je 4x menej fragmentov v každom mip-e.
//  · Za OutputPass pribudlo FXAA. Composer kreslí do vlastného render targetu
//    bez MSAA, takže zapnutý bloom zároveň ZRUŠIL antialiasing celej scény
//    (canvasové MSAA sa na RT nevzťahuje) — hrany budov a stromov boli zubaté.
//    FXAA stojí jeden full-screen priesvit a vráti hladké hrany.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

const MODES = [
  null, // 0 = VYP.
  { strength: 0.25, radius: 0.4, threshold: 0.85 }, // 1 = SLABÝ
  { strength: 0.55, radius: 0.5, threshold: 0.8 },  // 2 = JASNÝ
];
// Interné rozlíšenie bloom reťaze (1 = plné). 0.5 = štvornásobná úspora.
const BLOOM_SCALE = 0.5;

export function createBloom(renderer, scene, camera) {
  let composer = null, bloomPass = null, fxaaPass = null, mode = 1;

  function syncFxaa() {
    if (!fxaaPass) return;
    const pr = renderer.getPixelRatio ? renderer.getPixelRatio() : 1;
    const w = Math.max(2, innerWidth * pr), h = Math.max(2, innerHeight * pr);
    fxaaPass.material.uniforms.resolution.value.set(1 / w, 1 / h);
  }

  function ensure() {
    if (composer) return true;
    try {
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      bloomPass = new UnrealBloomPass(
        new THREE.Vector2(innerWidth, innerHeight), MODES[mode].strength, MODES[mode].radius, MODES[mode].threshold);
      // Composer volá pass.setSize(plné rozlíšenie); bloom si ho preškáluje.
      const rawSetSize = bloomPass.setSize.bind(bloomPass);
      bloomPass.setSize = (w, h) => rawSetSize(
        Math.max(8, Math.round(w * BLOOM_SCALE)), Math.max(8, Math.round(h * BLOOM_SCALE)));
      composer.addPass(bloomPass);
      // OutputPass: tone mapping + sRGB. Až POTOM FXAA (hrany sa hľadajú
      // v zobrazovacom priestore, nie v lineárnom HDR).
      composer.addPass(new OutputPass());
      fxaaPass = new ShaderPass(FXAAShader);
      composer.addPass(fxaaPass);
      resize();
      return true;
    } catch (e) {
      console.warn('[bloom] composer nedostupný:', e?.message);
      composer = null;
      fxaaPass = null;
      return false;
    }
  }
  function apply() {
    if (mode > 0 && ensure()) {
      bloomPass.strength = MODES[mode].strength;
      bloomPass.radius = MODES[mode].radius;
      bloomPass.threshold = MODES[mode].threshold;
    }
  }
  function resize() {
    if (!composer) return;
    composer.setPixelRatio?.(renderer.getPixelRatio());
    composer.setSize(innerWidth, innerHeight);
    syncFxaa();
  }
  return {
    setMode(m) {
      mode = m > 0 ? (m > 1 ? 2 : 1) : 0;
      apply();
    },
    getMode() { return mode; },
    render() {
      if (mode > 0 && (composer || ensure())) composer.render();
      else renderer.render(scene, camera);
    },
    resize,
  };
}
