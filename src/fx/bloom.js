// src/fx/bloom.js — jednoduchý threshold bloom cez three/addons (EffectComposer).
// (Legacy malo vlastný 300-riadkový composer s vrstvami; toto je lacná náhrada:
// prah 0.8+ → žiaria len slnko, lampy, majáky a svetlomety. HUD je DOM, nedotkne sa.)
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const MODES = [
  null, // 0 = VYP.
  { strength: 0.25, radius: 0.4, threshold: 0.85 }, // 1 = SLABÝ
  { strength: 0.55, radius: 0.5, threshold: 0.8 },  // 2 = JASNÝ
];

export function createBloom(renderer, scene, camera) {
  let composer = null, bloomPass = null, mode = 1;
  function ensure() {
    if (composer) return true;
    try {
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      bloomPass = new UnrealBloomPass(
        new THREE.Vector2(innerWidth, innerHeight), MODES[mode].strength, MODES[mode].radius, MODES[mode].threshold);
      composer.addPass(bloomPass);
      composer.addPass(new OutputPass());
      resize();
      return true;
    } catch (e) {
      console.warn('[bloom] composer nedostupný:', e?.message);
      composer = null;
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
    composer?.setPixelRatio?.(renderer.getPixelRatio());
    composer?.setSize(innerWidth, innerHeight);
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
