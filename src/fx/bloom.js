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
// B31 (kvalita): composer kreslí do MULTI-SAMPLED RT (samples 4, desktop) v
//  HalfFloat HDR — hladké hrany rovno v kompozite (FXAA ostáva len ako záložný
//  filter) a prahový bloom má skutočný HDR rozsah namiesto rezu pri jase 1.0.
//  Na mobile sú samples 0 (MSAA v kompozite je tam najdrahšie) — ostáva FXAA.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { S } from '../world/shared.js';

const MODES = [
  null, // 0 = VYP.
  { strength: 0.25, radius: 0.4, threshold: 0.85 }, // 1 = SLABÝ
  { strength: 0.55, radius: 0.5, threshold: 0.8 },  // 2 = JASNÝ
];
// Interné rozlíšenie bloom reťaze (1 = plné). 0.4 = ~6x úspora v mipo-vrstvách
// (bloom je z princípu rozostrený, takže nižšie rozlíšenie nie je vidieť).
const BLOOM_SCALE = 0.4;
// Renderovacia škála celého bloom priechodu (scéna + bloom + FXAA). Composer
// inak kreslí pri plnom devicePixelRatio (na desktope až 2x → 4x pixely), čo
// je na RTX 3050 najväčší jednotlivý náklad bloom cesty. 0.75 = 56 % pixelov
// oproti plnému DPR, rozdiel v ostrosti je pri bloom móde zanedbateľný
// (bloom mipy sú aj tak rozostrené a FXAA hrany dohladí).
const BLOOM_RENDER_SCALE = 0.75;

export function createBloom(renderer, scene, camera) {
  let composer = null, bloomPass = null, fxaaPass = null, mode = 1;

  // Efektívne pixel ratio bloom cesty (cap na BLOOM_RENDER_SCALE oproti DPR).
  // Používa sa pre RT, composer aj FXAA uniformu, aby boli všetky tri zosúladené.
  function composerPixelRatio() {
    const pr = renderer.getPixelRatio ? renderer.getPixelRatio() : 1;
    return Math.max(0.5, pr * BLOOM_RENDER_SCALE);
  }
  function syncFxaa() {
    if (!fxaaPass) return;
    const pr = composerPixelRatio();
    const w = Math.max(2, innerWidth * pr), h = Math.max(2, innerHeight * pr);
    fxaaPass.material.uniforms.resolution.value.set(1 / w, 1 / h);
  }

  function ensure() {
    if (composer) return true;
    try {
      // B31: vlastný render target composera — MULTI-SAMPLED + HalfFloat.
      // Default composer RT je LDR (UnsignedByte) a bez MSAA: prahový bloom tak
      // nemá HDR rozsah (svetlomety sa režú na jase 1.0) a hrany budov sú
      // zubaté, lebo canvasové MSAA sa na composer RT nevzťahuje. samples = 4
      // (desktop) dá hladké hrany rovno v kompozite a HalfFloat drží HDR pre
      // threshold aj mipy. Na mobile sa ostáva bez MSAA (nákladné) — FXAA
      // nižšie sa o aliasing postará ako doteraz.
      // B32: samples 2 namiesto 4 (MSAA resolve je na RTX 3050 najväčší
      // jednotlivý náklad bloom priechodu; 2x stále odstráni najhoršie
      // zubaté hrany a FXAA nižšie dohladí zvyšok). Renderovacia škála 0.75.
      const pr = composerPixelRatio();
      const w = Math.max(2, Math.round(innerWidth * pr)), h = Math.max(2, Math.round(innerHeight * pr));
      const rt = new THREE.WebGLRenderTarget(w, h, {
        type: THREE.HalfFloatType,
        samples: S.IS_MOBILE ? 0 : 2,
      });
      composer = new EffectComposer(renderer, rt);
      composer.setPixelRatio(composerPixelRatio());
      composer.addPass(new RenderPass(scene, camera));
      bloomPass = new UnrealBloomPass(
        new THREE.Vector2(innerWidth, innerHeight), MODES[mode].strength, MODES[mode].radius, MODES[mode].threshold);
      // 4 mipy namiesto 5 — menej blur passov, na bloom (už rozostrenom) bez
      // viditeľnej straty, ale jeden full-screen pass menej.
      bloomPass.nMips = 4;
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
    composer.setPixelRatio?.(composerPixelRatio());
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
