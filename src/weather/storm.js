// src/weather/storm.js — procedurálna búrka: blesky, dážď, hromy, mokré cesty.
// Nulové externé súbory (žiadne mp3/png): zvuk čisto z Web Audio API,
// blesky aj dážď čisto z THREE primitív.
//
// VÝKON (prečo to nežerie FPS):
// - blesk NIKDY nehýbe smerovým svetlom ani neprepína tiene (to by v otvorenom
//   svete prekreslilo celú shadow mapu). Len sa na pár snímok zdvihne intenzita
//   AmbientLight + HemisphereLight (čistá zmena uniformy) + biely DOM prekryv.
// - dážď = JEDEN THREE.Points (1 draw call), škatuľa 70×45×70 m pripnutá na auto.
// - blesk = JEDEN THREE.LineSegments, žije 50–100 ms a sám sa dispose-ne.
// - hrom = 2 oscilátory + 1 burst šumu, len v momente úderu (nie trvalé nody).
//
// KONVENCIA repa: factory + dependency injection, žiadne triedy. `createStormManager`
// vracia kontrolér { init, start, stop, toggle, update, resize, dispose, setMuted,
// isActive } — to je ten "StormManager" zo zadania, len bez `class`.
import * as THREE from 'three';
import { S } from '../world/shared.js';

// ---------- KONFIG ----------
const RAIN_W = 70;          // šírka dažďovej škatule (m)
const RAIN_H = 45;          // výška dažďovej škatule (m)
const RAIN_D = 70;          // hĺbka dažďovej škatule (m)
const RAIN_FALL = 30;       // pádová rýchlosť (m/s)
const RAIN_WIND = 4;        // bočný vietor (m/s)
const FLASH_DECAY = 9;      // ako rýchlo zhasne záblesk (1/s)
const BOLT_MIN_LIFE = 0.05; // životnosť blesku (s)
const BOLT_MAX_LIFE = 0.1;  // životnosť blesku (s)
const STRIKE_MIN_GAP = 2.5; // min. pauza medzi údermi (s)
const STRIKE_MAX_GAP = 8;   // max. pauza medzi údermi (s)
const WET_ROUGH = 0.18;     // cieľová drsnosť mokrej vozovky
const WET_ROUGH_SIDE = 0.35;// chodníky / cyklopruhy ostávajú matnejšie
// Ktoré zdieľané materiály zmoknú (všetky cesty idú cez ne — stačí prepnúť raz).
const WET_MATS = [
  ['asphalt', WET_ROUGH], ['routeAsphalt', WET_ROUGH], ['bridge', 0.22],
  ['sidewalk', WET_ROUGH_SIDE], ['cycle', WET_ROUGH_SIDE],
];

// Hlasný hrom: špičky držia ~1.0, kompresor to zlepí bez clippingu.
const THUNDER_MASTER = 0.9;
const THUNDER_CRACK_PEAK = 1.0;
const THUNDER_SUB_PEAK = 1.0;

export function createStormManager() {
  // ---------- STAV (všetko v closure, žiadne globály) ----------
  let scene = null, camera = null, sun = null;
  let hemi = null, amb = null;
  let hemiBase = 0.7, sunBase = 2.4;
  let bgBase = null, fogBase = null, fogDensityBase = 0.0008;
  let active = false, ready = false, muted = false;
  let flash = 0, restrikeT = -1;   // obálka záblesku + dvojitý blik
  let strikeT = 3;                 // odpočet do ďalšieho úderu
  let gloom = 0;                   // 0 = jasno, 1 = búrkové prítmie (plynulý nábeh)
  let rainFade = 0;                // nábeh/vyhasnutie dažďa
  let gen = 0;                     // generácia: staré setTimeout hromy po stop() mlčia
  let carRef = null;

  // Dážď (predalokované, v slučke žiadne `new`).
  let rainPts = null, rainPos = null, rainSpd = null, rainMat = null, rainN = 0;

  // Blesky (vzácne — alokácia pri údere je v poriadku, do 100 ms sa dispose-nú).
  const bolts = [];

  // Biely prekryv (DOM, nie postprocessing — nulový GPU náklad navyše).
  let flashEl = null;

  // Zvuk (vlastný kontext, lenivé — vznikne až pri prvom start() po geste).
  let actx = null, stormMaster = null, rainGain = null, noiseBuf = null;
  let echoBus = null;
  const pendingTimers = [];

  // Pôvodné drsnosti ciest na obnovu po stop().
  const wetOrig = new Map();

  // ---------- POMOCNÉ ----------
  function later(fn, ms) {
    const id = setTimeout(() => {
      const i = pendingTimers.indexOf(id);
      if (i >= 0) pendingTimers.splice(i, 1);
      fn();
    }, ms);
    pendingTimers.push(id);
    return id;
  }
  function clearTimers() {
    for (const id of pendingTimers) clearTimeout(id);
    pendingTimers.length = 0;
  }
  function rnd(a, b) { return a + Math.random() * (b - a); }

  // ---------- SVETLÁ + OBLOHA ----------
  function grabLights() {
    hemi = null;
    scene.traverse((o) => { if (!hemi && o && o.isHemisphereLight) hemi = o; });
    if (hemi) hemiBase = hemi.intensity;
    if (sun) sunBase = sun.intensity;
    if (!amb) {
      amb = new THREE.AmbientLight(0xcdd8ff, 0);
      scene.add(amb);
    }
    if (!bgBase && scene.background && scene.background.isColor) bgBase = scene.background.clone();
    if (scene.fog && scene.fog.isFogExp2) {
      if (!fogBase) fogBase = scene.fog.color.clone();
      fogDensityBase = scene.fog.density;
    } else if (scene.fog && scene.fog.isFog) {
      if (!fogBase) fogBase = scene.fog.color.clone();
    }
  }

  // ---------- DÁŽĎ ----------
  function buildRain() {
    rainN = S.IS_MOBILE ? 900 : 1800;
    rainPos = new Float32Array(rainN * 3);
    rainSpd = new Float32Array(rainN);
    for (let i = 0; i < rainN; i++) {
      rainPos[i * 3] = rnd(-RAIN_W / 2, RAIN_W / 2);
      rainPos[i * 3 + 1] = rnd(-RAIN_H / 2, RAIN_H / 2);
      rainPos[i * 3 + 2] = rnd(-RAIN_D / 2, RAIN_D / 2);
      rainSpd[i] = rnd(0.75, 1.25);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(rainPos, 3).setUsage(THREE.DynamicDrawUsage));
    rainMat = new THREE.PointsMaterial({
      color: 0xa8c4d8, size: 0.22, transparent: true, opacity: 0,
      depthWrite: false, sizeAttenuation: true,
    });
    rainPts = new THREE.Points(g, rainMat);
    rainPts.frustumCulled = false;
    rainPts.visible = false;
    rainPts.renderOrder = 5;
    scene.add(rainPts);
  }

  function updateRain(dt) {
    if (!rainPts) return;
    // Nábeh/vyhasnutie dažďa (aj po stop() ešte chvíľu prší, kým fade nedobehne).
    const want = active ? 1 : 0;
    rainFade += Math.sign(want - rainFade) * Math.min(Math.abs(want - rainFade), dt * 0.8);
    rainPts.visible = rainFade > 0.01;
    if (!rainPts.visible) return;
    if (carRef) rainPts.position.set(carRef.x || 0, (carRef.y || 0) + RAIN_H * 0.35, carRef.z || 0);
    const hw = RAIN_W / 2, hh = RAIN_H / 2, hd = RAIN_D / 2;
    const p = rainPos;
    for (let i = 0; i < rainN; i++) {
      const j = i * 3;
      p[j + 1] -= RAIN_FALL * rainSpd[i] * dt;
      p[j] += RAIN_WIND * dt;
      if (p[j + 1] < -hh) {
        p[j + 1] += RAIN_H;
        p[j] = rnd(-hw, hw);
        p[j + 2] = rnd(-hd, hd);
      }
      if (p[j] > hw) p[j] -= RAIN_W;
    }
    rainPts.geometry.attributes.position.needsUpdate = true;
    rainMat.opacity = 0.55 * rainFade;
  }

  // ---------- BLESKY ----------
  function spawnBolt(big) {
    if (!carRef || !camera) return;
    const cx = (carRef.x || 0) + rnd(-160, 160);
    const cz = (carRef.z || 0) + rnd(-160, 160);
    const top = (carRef.y || 0) + rnd(120, 190);
    const bot = (carRef.y || 0) - 5;
    // Kľukatý hlavný kanál zhora nadol (náhodná prechádzka).
    const segs = big ? 16 : 11;
    const pts = [];
    let x = cx + rnd(-30, 30), z = cz + rnd(-30, 30);
    let px = x, py = top, pz = z;
    for (let i = 1; i <= segs; i++) {
      const t = i / segs;
      x += rnd(-14, 14) * (0.4 + t);
      z += rnd(-14, 14) * (0.4 + t);
      const y = top + (bot - top) * t;
      pts.push(px, py, pz, x, y, z);
      px = x; py = y; pz = z;
    }
    // 1–2 bočné vetvy z hornej polovice kanála.
    const branches = big ? 2 : 1;
    for (let b = 0; b < branches; b++) {
      const bi = 2 + ((Math.random() * (segs / 2)) | 0);
      let bx = pts[bi * 6 + 3], by = pts[bi * 6 + 4], bz = pts[bi * 6 + 5];
      const dir = Math.random() < 0.5 ? 1 : -1;
      for (let i = 0; i < 5; i++) {
        const nx = bx + rnd(4, 16) * dir, ny = by - rnd(6, 16), nz = bz + rnd(-12, 12);
        pts.push(bx, by, bz, nx, ny, nz);
        bx = nx; by = ny; bz = nz;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
    const m = new THREE.LineBasicMaterial({
      color: big ? 0xffffff : 0xd8e6ff, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    const line = new THREE.LineSegments(g, m);
    line.frustumCulled = false;
    scene.add(line);
    bolts.push({ mesh: line, life: rnd(BOLT_MIN_LIFE, BOLT_MAX_LIFE) });
  }

  function updateBolts(dt) {
    for (let i = bolts.length - 1; i >= 0; i--) {
      const b = bolts[i];
      b.life -= dt;
      if (b.life <= 0) {
        scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        b.mesh.material.dispose();
        bolts.splice(i, 1);
      } else {
        b.mesh.material.opacity = Math.min(1, b.life / BOLT_MIN_LIFE);
      }
    }
  }

  function strike() {
    const myGen = gen;
    const big = Math.random() < 0.45;
    spawnBolt(big);
    flash = big ? 1 : 0.75;
    // Dvojitý blik: o ~70 ms slabšia opakovačka (len obálka, bez novej geometrie).
    if (Math.random() < 0.6) restrikeT = 0.07;
    strikeT = rnd(STRIKE_MIN_GAP, STRIKE_MAX_GAP);
    // Hrom mešká za bleskom (blízky = hlasný, vzdialený = tichší) — HLASNÝ úder.
    const delay = rnd(0.25, 2.2);
    const loud = 1 - (delay / 2.2) * 0.5; // 1.0 zblízka … 0.5 zďaleka
    later(() => { if (myGen === gen && active) thunder(loud); }, delay * 1000);
  }

  // ---------- ZVUK (čisto procedurálny, nulové súbory) ----------
  function ensureAudio() {
    if (actx) {
      if (actx.resume) actx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      actx = new AC();
      // Kompresor: hrom je hlasný (~1.0), ale nesmie klipovať mix s motorom.
      const comp = actx.createDynamicsCompressor();
      comp.threshold.value = -12; comp.ratio.value = 6;
      comp.connect(actx.destination);
      stormMaster = actx.createGain();
      stormMaster.gain.value = muted ? 0 : THUNDER_MASTER;
      stormMaster.connect(comp);
      // Echo pre hrom: oneskorenie + spätná väzba = dunenie medzi panelákmi.
      const dly = actx.createDelay(1); dly.delayTime.value = 0.34;
      const fb = actx.createGain(); fb.gain.value = 0.5;
      const wet = actx.createGain(); wet.gain.value = 0.5;
      dly.connect(fb); fb.connect(dly); dly.connect(wet); wet.connect(stormMaster);
      echoBus = dly;
      // Zdieľaný 2 s biely šum (dážď aj praskot hromu).
      noiseBuf = actx.createBuffer(1, actx.sampleRate * 2, actx.sampleRate);
      const nd = noiseBuf.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      // Trvalý dážď: slučkovaný šum → dolná priepusť → zisk (beží len pri búrke).
      const src = actx.createBufferSource();
      src.buffer = noiseBuf; src.loop = true;
      const lp = actx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 1100; lp.Q.value = 0.4;
      rainGain = actx.createGain(); rainGain.gain.value = 0;
      src.connect(lp); lp.connect(rainGain); rainGain.connect(stormMaster);
      src.start();
      return true;
    } catch { actx = null; return false; }
  }

  function setRainLevel(v) {
    if (actx && rainGain) {
      rainGain.gain.setTargetAtTime(v, actx.currentTime, 0.6);
    }
  }

  // Hlasný hrom: praskot (šum zhora nadol) + dunivý sub-basový pokles s echom.
  function thunder(loud) {
    if (!ensureAudio() || !actx) return;
    const t0 = actx.currentTime + 0.01;
    const k = Math.max(0.3, Math.min(1, loud));
    // (a) PRASKOT — úder blízko práskne: šum 0,5 s cez padajúcu priepusť 4 kHz → 150 Hz.
    const burst = actx.createBufferSource(); burst.buffer = noiseBuf;
    burst.playbackRate.value = rnd(0.8, 1.2);
    const blp = actx.createBiquadFilter(); blp.type = 'lowpass'; blp.Q.value = 0.7;
    blp.frequency.setValueAtTime(4200, t0);
    blp.frequency.exponentialRampToValueAtTime(150, t0 + 0.5);
    const bg = actx.createGain();
    bg.gain.setValueAtTime(THUNDER_CRACK_PEAK * k, t0);
    bg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.6);
    burst.connect(blp); blp.connect(bg); bg.connect(stormMaster); bg.connect(echoBus);
    burst.start(t0, rnd(0, 1.2), 0.7);
    burst.stop(t0 + 0.75);
    // (b) SUB-BASOVÝ POKLES — dunenie: sínus 120 → 26 Hz, 2,2 s, plný zisk.
    const dur = 2.2;
    const osc = actx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(120, t0);
    osc.frequency.exponentialRampToValueAtTime(26, t0 + dur);
    const og = actx.createGain();
    og.gain.setValueAtTime(0.0001, t0);
    og.gain.exponentialRampToValueAtTime(THUNDER_SUB_PEAK * k, t0 + 0.04);
    og.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(og); og.connect(stormMaster); og.connect(echoBus);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
    // (c) Podtón o oktávu nižšie (trojuholník, polovičný zisk) = tlak do hrude.
    const sub2 = actx.createOscillator(); sub2.type = 'triangle';
    sub2.frequency.setValueAtTime(60, t0);
    sub2.frequency.exponentialRampToValueAtTime(24, t0 + dur);
    const g2 = actx.createGain();
    g2.gain.setValueAtTime(0.0001, t0);
    g2.gain.exponentialRampToValueAtTime(0.45 * k, t0 + 0.05);
    g2.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    sub2.connect(g2); g2.connect(stormMaster); g2.connect(echoBus);
    sub2.start(t0); sub2.stop(t0 + dur + 0.05);
  }

  // ---------- MOKRÉ CESTY ----------
  function setWet(on) {
    for (const [key, rough] of WET_MATS) {
      const m = S.MAT[key];
      if (!m) continue;
      if (on) {
        if (!wetOrig.has(key)) wetOrig.set(key, { r: m.roughness, e: m.envMapIntensity });
        m.roughness = rough;          // mokré = zrkadlí svetlá aj blesky
        m.envMapIntensity = 1.2;
      } else if (wetOrig.has(key)) {
        const o = wetOrig.get(key);
        m.roughness = o.r;
        m.envMapIntensity = o.e;
      }
    }
  }

  // ---------- VEREJNÉ API ----------
  function init(opts) {
    scene = opts?.scene || null;
    camera = opts?.camera || null;
    sun = opts?.sun || null;
    if (!scene) return false;
    grabLights();
    if (!rainPts) buildRain();
    if (!flashEl) {
      flashEl = document.createElement('div');
      flashEl.id = 'storm-flash';
      flashEl.style.cssText = 'position:fixed;inset:0;background:#fff;opacity:0;' +
        'pointer-events:none;z-index:5;';
      document.body.appendChild(flashEl);
    }
    // Odomknutie zvuku prvým gestom (rovnaký vzor ako sfx.unlock).
    const unlock = () => { if (actx && actx.resume) actx.resume(); };
    addEventListener('pointerdown', unlock);
    addEventListener('keydown', unlock);
    ready = true;
    return true;
  }

  function start() {
    if (!ready || active) return;
    active = true;
    gen++;
    ensureAudio();
    setRainLevel(0.16);
    setWet(true);
    strikeT = rnd(0.5, 1.5); // prvý blesk príde rýchlo (efekt hneď vidno)
  }

  function stop() {
    if (!active) return;
    active = false;
    gen++; // meškajúce hromy z minulej búrky mlčia
    clearTimers();
    setRainLevel(0);
    setWet(false);
  }

  function update(dt, car) {
    if (!ready || !scene) return;
    carRef = car || carRef;
    // Prítmie oblohy: plynulý nábeh pri štarte, ústup po stop().
    gloom += Math.sign((active ? 1 : 0) - gloom) * Math.min(Math.abs((active ? 1 : 0) - gloom), dt * 0.5);
    if (scene.background && scene.background.isColor && bgBase) {
      scene.background.copy(bgBase).multiplyScalar(1 - 0.55 * gloom);
    }
    if (scene.fog && fogBase) {
      scene.fog.color.copy(fogBase).multiplyScalar(1 - 0.35 * gloom);
      if (scene.fog.isFogExp2) scene.fog.density = fogDensityBase * (1 + 0.6 * gloom);
    }
    // Slnko len stlmíme (intenzita = uniforma, žiadny prepočet tieňov).
    // Pozícia ani tieňová mapa sa NIKDY nehýbu — to je celé kúzlo výkonu.
    if (sun) sun.intensity = sunBase * (1 - 0.45 * gloom);
    updateRain(dt);
    updateBolts(dt);
    if (!active) {
      // Dobeh: záblesk dohasne aj po stop(), svetlá sa vrátia.
      flash = Math.max(0, flash - FLASH_DECAY * dt);
      if (hemi) hemi.intensity = hemiBase + flash * 3;
      if (amb) amb.intensity = flash * 2.5;
      if (flashEl) flashEl.style.opacity = String(flash * 0.55);
      return;
    }
    // Plán úderov.
    strikeT -= dt;
    if (strikeT <= 0) strike();
    // Dvojitý blik.
    if (restrikeT >= 0) {
      restrikeT -= dt;
      if (restrikeT < 0) flash = Math.max(flash, 0.65);
    }
    // Obálka záblesku: svetlá + DOM prekryv.
    flash = Math.max(0, flash - FLASH_DECAY * dt);
    if (hemi) hemi.intensity = hemiBase + flash * 3;
    if (amb) amb.intensity = flash * 2.5;
    if (flashEl) flashEl.style.opacity = String(flash * 0.55);
  }

  function resize() {
    // Dážď žije vo svetových súradniciach a prekryv je CSS `inset:0` —
    // pri resize netreba nič prepočítavať; len poistka, že prekryv kryje okno.
    if (flashEl) flashEl.style.inset = '0';
  }

  function dispose() {
    stop();
    gen++;
    clearTimers();
    if (rainPts) {
      scene?.remove(rainPts);
      rainPts.geometry.dispose();
      rainMat?.dispose();
      rainPts = null; rainPos = null; rainSpd = null; rainMat = null;
    }
    for (const b of bolts) {
      scene?.remove(b.mesh);
      b.mesh.geometry.dispose();
      b.mesh.material.dispose();
    }
    bolts.length = 0;
    if (amb) { scene?.remove(amb); amb = null; }
    if (flashEl) { flashEl.remove(); flashEl = null; }
    if (hemi) hemi.intensity = hemiBase;
    if (sun) sun.intensity = sunBase;
    if (scene?.background?.isColor && bgBase) scene.background.copy(bgBase);
    if (scene?.fog && fogBase) {
      scene.fog.color.copy(fogBase);
      if (scene.fog.isFogExp2) scene.fog.density = fogDensityBase;
    }
    try { actx?.close?.(); } catch { /* noop */ }
    actx = null; stormMaster = null; rainGain = null; echoBus = null; noiseBuf = null;
    ready = false;
  }

  return {
    init, start, stop, update, resize, dispose,
    toggle() { if (active) stop(); else start(); },
    isActive() { return active; },
    setMuted(m) {
      muted = !!m;
      if (stormMaster && actx) stormMaster.gain.setTargetAtTime(muted ? 0 : THUNDER_MASTER, actx.currentTime, 0.1);
    },
  };
}
