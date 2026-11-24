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
// B31 (kvalita): prvý RT je custom UnsignedByte; MSAA v kompozite vylúčené
//  — extension WEBGL_multisampled_render_to_texture nie je dostupná všetkým
//  driverom (na Edge/SwiftShader výsledok bol čierny). FXAA dohladí hrany.
// B33 (AA bez bloomu): keď bloom je VYP., scéna sa renderuje priamo cez
//  renderer.render() s canvasovým MSAA (4× na desktope, engine.js).
//  Na mobile/LOW_END (žiadne MSAA) ostáva čistý renderer.render() —
//  FXAA pre non-bloom cestu by vyžadoval vlastný composer RT, čo je
//  fillrate-náročné za minimálny zisk na vysoko-DPI displejoch.
// B34 (Ray Tracing): pridaný screen-space ray tracing pass (SSR, contact shadows, SSGI)
//    beží ako custom pass v composer pipeline PO RenderPass, PRED SSAO/Bloom.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { GradeShader } from './grade.js';
import { createRayTracer } from './raytrace.js';
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

export function createBloom(renderer, scene, camera, sunLight) {
  let composer = null, bloomPass = null, ssaoPass = null, fxaaPass = null, gradePass = null, mode = 1;
  let rayTracer = null;
  let rtEnabled = true;
  let rtQuality = 1; // STANDARD
  // Jeden full-screen quad pre blity namiesto alokácie Scene/Mesh/Material/
  // Geometry dvakrát za snímok (bola to najväčšia GC záťaž v composer-e).
  let blitScene = null, blitCam = null, blitMat = null, blitQuad = null;

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
    if (gradePass) { gradePass.material.uniforms.uResolution.value.x = w; gradePass.material.uniforms.uResolution.value.y = h; }
  }

  function ensure() {
    if (composer) return true;
    try {
      // B31: vlastný custom RT (UnsignedByteType) — MSAA v kompozite
      // vylúčené (detailný dôvod v headeri: extension
      // WEBGL_multisampled_render_to_texture nie je dostupná všetkým
      // driverom — FXAA sa o hrany stará).
      const pr = composerPixelRatio();
      const w = Math.max(2, Math.round(innerWidth * pr)), h = Math.max(2, Math.round(innerHeight * pr));
      // Ray tracing potrebuje SKUTOČNÚ DepthTexture — `depthTexture: true`
      // zapisovalo do render targetu boolean, takže tDepth bol v shadery
      // neplatný a SSR/contact shadows čítali odpad.
      const depthTex = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
      depthTex.format = THREE.DepthFormat;
      depthTex.minFilter = THREE.NearestFilter;
      depthTex.magFilter = THREE.NearestFilter;
      const rt = new THREE.WebGLRenderTarget(w, h, {
        type: THREE.UnsignedByteType,
        samples: 0,
        depthBuffer: true,
        depthTexture: depthTex,
      });
      composer = new EffectComposer(renderer, rt);
      composer.setPixelRatio(composerPixelRatio());

      // 1. RenderPass - hlavná scéna
      const renderPass = new RenderPass(scene, camera);
      composer.addPass(renderPass);

      blitScene = new THREE.Scene();
      blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      blitMat = new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false });
      blitQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blitMat);
      blitQuad.frustumCulled = false;
      blitScene.add(blitQuad);
      const blit = (srcTexture) => {
        if (blitMat.map !== srcTexture) {
          const hadMap = !!blitMat.map;
          blitMat.map = srcTexture;
          // Prvé priradenie textúry mení USE_MAP define → treba nový program.
          if (!hadMap) blitMat.needsUpdate = true;
        }
        renderer.render(blitScene, blitCam);
      };

      // 2. Ray Tracing Pass (custom) - SSR, Contact Shadows, SSGI
      rayTracer = createRayTracer(renderer, scene, camera);
      rayTracer.setQuality(rtQuality);
      rayTracer.setEnabled(rtEnabled);
      // Custom pass pre composer
      const rtPass = {
        enabled: true,
        renderToScreen: false,
        needsSwap: true,
        setSize: (w, h) => rayTracer.resize(w, h),
        render: (renderer, writeBuffer, readBuffer) => {
          if (!rtEnabled || S.LOW_END) {
            // Preskočíme RT, len skopírujeme readBuffer do writeBuffer
            if (readBuffer !== writeBuffer) {
              renderer.setRenderTarget(writeBuffer);
              renderer.clear();
              blit(readBuffer.texture);
              renderer.setRenderTarget(null);
            }
            return;
          }
          // Ray tracing potrebuje depth texture z readBuffer (výstup RenderPass)
          // readBuffer je WebGLRenderTarget s depthTexture
          const rtResult = rayTracer.render(renderer, scene, camera, sunLight, readBuffer, readBuffer.depthTexture);
          // Výsledok do writeBuffer
          renderer.setRenderTarget(writeBuffer);
          renderer.clear();
          blit(rtResult);
          renderer.setRenderTarget(null);
        },
      };
      composer.addPass(rtPass);

      // 3. SSAO (ak nie LOW_END)
      if (!S.LOW_END) {
        const ssaoW = Math.max(64, Math.round(innerWidth * composerPixelRatio() * 0.5));
        const ssaoH = Math.max(64, Math.round(innerHeight * composerPixelRatio() * 0.5));
        ssaoPass = new SSAOPass(scene, camera, ssaoW, ssaoH, 16);
        ssaoPass.kernelRadius = 14;
        ssaoPass.minDistance = 0.005;
        ssaoPass.maxDistance = 0.20;
        ssaoPass.output = SSAOPass.OUTPUT.Default;
        composer.addPass(ssaoPass);
      }

      // 4. Bloom
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

      // 5. OutputPass: tone mapping + sRGB. Až POTOM grade (display priestor),
      // potom FXAA (hrany sa hľadajú vo finálnom obraze).
      composer.addPass(new OutputPass());
      gradePass = new ShaderPass(GradeShader);
      composer.addPass(gradePass);
      fxaaPass = new ShaderPass(FXAAShader);
      composer.addPass(fxaaPass);

      resize();
      return true;
    } catch (e) {
      console.warn('[bloom] composer nedostupný:', e?.message);
      composer = null;
      ssaoPass = null;
      fxaaPass = null;
      gradePass = null;
      rayTracer = null;
      return false;
    }
  }

  function apply() {
    if (S.LOW_END) {
      // mobile/raspberry: composer len pri bloom > 0 (žiadny zbytočný náklad)
      if (mode > 0 && ensure()) {
        bloomPass.enabled = true;
        bloomPass.strength = MODES[mode].strength;
        bloomPass.radius = MODES[mode].radius;
        bloomPass.threshold = MODES[mode].threshold;
      }
      return;
    }
    if (!ensure()) return;
    if (mode > 0) {
      bloomPass.enabled = true;
      bloomPass.strength = MODES[mode].strength;
      bloomPass.radius = MODES[mode].radius;
      bloomPass.threshold = MODES[mode].threshold;
    } else {
      bloomPass.enabled = false; // grade ostáva aktívny aj bez bloomu
    }
  }

  function resize() {
    if (!composer) return;
    composer.setPixelRatio?.(composerPixelRatio());
    composer.setSize(innerWidth, innerHeight);
    if (ssaoPass) {
      const pr = composerPixelRatio();
      const w = Math.max(64, Math.round(innerWidth * pr * 0.5));
      const h = Math.max(64, Math.round(innerHeight * pr * 0.5));
      ssaoPass.setSize(w, h);
    }
    if (rayTracer) {
      const pr = composerPixelRatio();
      const w = Math.max(2, Math.round(innerWidth * pr));
      const h = Math.max(2, Math.round(innerHeight * pr));
      rayTracer.resize(w, h);
    }
    syncFxaa();
  }

  return {
    setMode(m) {
      mode = m > 0 ? (m > 1 ? 2 : 1) : 0;
      apply();
    },
    getMode() { return mode; },
    // Ray tracing ovládanie
    setRTEnabled(v) {
      rtEnabled = v;
      if (rayTracer) rayTracer.setEnabled(v);
    },
    getRTEnabled() { return rtEnabled; },
    setRTQuality(q) {
      rtQuality = Math.max(0, Math.min(2, q | 0));
      if (rayTracer) rayTracer.setQuality(rtQuality);
    },
    getRTQuality() { return rtQuality; },
    render() {
      if (S.LOW_END && mode === 0) {
        // Raspberry/mobil: žiadny composer — priamy render, MSAA nie je.
        // RT sa na LOW_END aj tak preskakuje, takže `!rtEnabled` tu bola
        // zbytočná a nútila composer aj pri bloom VYP.
        renderer.render(scene, camera);
        return;
      }
      if (ensure()) {
        composer.render();
      } else {
        renderer.render(scene, camera);
      }
    },
    resize,
    dispose() {
      if (rayTracer) rayTracer.dispose();
      if (composer) composer.dispose();
      blitQuad?.geometry.dispose();
      blitMat?.dispose();
    },
  };
}