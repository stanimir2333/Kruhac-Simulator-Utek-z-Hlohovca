// src/world/bridgelights.js — dúhové svetlá mosta Váh + Caramelldansen.
// Na zábradliah mosta (s ∈ [bridgeS0−10, bridgeS1+10], lat ±4.6 m) svieti rad
// farebných guličiek (JEDEN InstancedMesh = 1 draw call). V kľude sa dúha pomaly
// točí; keď sa hráč priblíži k mostu (alebo vlezie naň), spustí sa
// caramelldansen.mp3 a svetlá BLIKAJÚ presne do rytmu pesničky — úder detekuje
// AnalyserNode z basov (fallback: fixné 165 BPM pesničky, ak WebAudio zlyhá).
// Bez súboru (file://) hra hru normálne — len pesnička nehraje a svetlá sa
// točia v kľude, nič nepadá.
import * as THREE from 'three';
import { S } from './shared.js';
import { routePose } from './roads.js';
import { driveY } from './height.js';
import { dayness } from './daynight.js';

// ---------- KONFIG ----------
const STEP_M = 6;          // rozostup svetiel pozdĺž zábradlia
const LAT = 4.6;           // priečna pozícia pri zábradlí (stena 4.35, top +1.0)
const LIGHT_Y = 1.18;      // výška nad mostovkou (tesne nad zábradlím)
const NEAR2 = 110 * 110;   // "pri moste" — spustenie pesničky
const NEAR_HYS2 = 128 * 128; // hysterezia pre vypnutie (nezapína/vypína pri chodení po okraji)
const BULB_R = 0.34;
// Rytmus Caramelldansen ≈ 165 BPM — fallback, keď analyzátor nedetekuje basy.
const FALLBACK_BPM = 165;
const FLASH_DECAY = 3.2;   // dozvuk záblesku po údere (1/s)
const HUE_PER_BEAT = 1 / 7; // dúha sa posunie o 1/7 s každým úderom (~celá za 2,5 s)

// Cesty k pesničke — rovnaký 6-kandidátový vzor ako radio.js / thunder súbory
// (Vite dev / dist / python http.server / Pages / file://).
const SONG_CANDS = [
  '/audio/', './audio/', 'audio/',
  '/public/audio/', './public/audio/', 'public/audio/',
];

// ---------- STAV ----------
let mesh = null, count = 0, positions = null;
let built = false;
let hueBase = 0, flash = 0, lastBeatAt = 0;
let playing = false, wantPlay = false, audioPending = false, lastSongTry = -10;
let midX = 0, midZ = 0; // stred mosta pre test priblíženia

// Zvuk: element + analyzátor vzniknú lenivé pri prvom spustení (po geste —
// hra začína klikom na mapu, takže AudioContext aj play() sú povolené).
let audioEl = null, actx = null, ana = null, anaBins = null, bassLo = 1, bassHi = 8;
let energyAvg = 0.1;

// ---------- BÚDVBA ----------
export function buildBridgeLights(scene) {
  if (built || S.bridgeS1 <= S.bridgeS0) return null; // mapa bez mosta (drahovce?) → nič
  const s0 = Math.max(0, S.bridgeS0 - 10), s1 = S.bridgeS1 + 10;
  const n = Math.max(2, Math.round((s1 - s0) / STEP_M));
  count = n * 2;
  positions = new Float32Array(count * 3);
  let i = 0;
  for (let k = 0; k < n; k++) {
    const s = s0 + (s1 - s0) * (k / (n - 1));
    for (let side = 0; side < 2; side++) {
      const lat = side === 0 ? LAT : -LAT;
      routePose(s, S._v1, S._hWrap, lat);
      const x = S._v1.x, z = S._v1.z;
      const y = driveY(x, z, s, lat) + LIGHT_Y;
      positions[i * 3] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z;
      i++;
    }
  }
  routePose((S.bridgeS0 + S.bridgeS1) / 2, S._v1, S._hWrap, 0);
  midX = S._v1.x;
  midZ = S._v1.z;  const geo = new THREE.SphereGeometry(BULB_R, 14, 10);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff, toneMapped: false, fog: false,
  });
  mesh = new THREE.InstancedMesh(geo, mat, count);
  const m4 = new THREE.Matrix4();
  for (let j = 0; j < count; j++) {
    m4.makeTranslation(positions[j * 3], positions[j * 3 + 1], positions[j * 3 + 2]);
    mesh.setMatrixAt(j, m4);
  }
  // instanceColor: farby sa menia každý snímok (HDR hodnoty >1 → bloom žiarenie)
  const white = new THREE.Color(1, 1, 1);
  for (let j = 0; j < count; j++) mesh.setColorAt(j, white);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false; // žiarenie je viditeľné z ďaleka (súčasť noci)
  mesh.renderOrder = 1;
  scene.add(mesh);
  built = true;
  console.info('[most] dúhové svetlá: ' + count + ' · rozpätie s=' + (s0 | 0) + '..' + (s1 | 0));
  return mesh;
}

// ---------- ZVUK ----------
// Kandidáti sa skúšajú cez 'error' elementu (404 → ďalší), rovnako ako pri
// textúrach/staniciach. Kým niečo nabehne, pesnička nehraje a svetlá idú na
// fixný rytmus — hra tým nepadá ani na file://.
let songIdx = 0;
function attachSongSrc() {
  if (!audioEl || songIdx >= SONG_CANDS.length) return false;
  audioEl.src = SONG_CANDS[songIdx] + 'caramelldansen.mp3';
  songIdx++;
  return true;
}

function ensureAudio() {
  if (audioEl) return audioEl;
  audioEl = new Audio();
  audioEl.loop = true;
  audioEl.preload = 'auto';
  audioEl.volume = 0;
  attachSongSrc();
  audioEl.addEventListener('error', () => {
    // 404 kandidát → ďalšia cesta; keď zlyhajú všetky, ostáva tichý tanec svetiel.
    if (playing && !attachSongSrc()) { stopSong(); return; }
    if (playing) { try { audioEl.play().catch(() => {}); } catch (_e) { /* noop */ } }
  });
  // Analyzátor: basy 30–160 Hz určujú úder. Element sa do WebAudio dá len raz.
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    actx = new AC();
    const src = actx.createMediaElementSource(audioEl);
    ana = actx.createAnalyser();
    ana.fftSize = 256;
    ana.smoothingTimeConstant = 0.55;
    src.connect(ana);
    ana.connect(actx.destination);
    anaBins = new Uint8Array(ana.frequencyBinCount);
    // biny pre ~30–160 Hz: bin = Hz / (sampleRate / fftSize)
    const hzPerBin = actx.sampleRate / ana.fftSize;
    bassLo = Math.max(1, Math.floor(30 / hzPerBin));
    bassHi = Math.min(anaBins.length - 1, Math.ceil(160 / hzPerBin));
  } catch (_e) {
    actx = null; ana = null; // fallback fixného rytmu
  }
  return audioEl;
}

// Hlasitosť: element (nie hlasný zvon cez kompresor) — X ticho zhasne aj pesničku.
function setSongLevel(muted, level) {
  if (!audioEl) return;
  audioEl.volume = Math.max(0, Math.min(1, (muted ? 0 : 0.62) * level));
}

function startSong(muted) {
  const el = ensureAudio();
  if (actx && actx.resume) actx.resume();
  try {
    const p = el.play();
    if (p && p.catch) p.catch(() => { audioPending = true; }); // autoplay politika → skús v ďalších snímkoch
    audioPending = false;
  } catch (_e) { audioPending = true; }
  playing = true;
  setSongLevel(muted, 1);
}

function stopSong() {
  playing = false;
  if (!audioEl) return;
  try { audioEl.pause(); } catch (_e) { /* noop */ }
}

// ---------- ÚDER DO RYTMU ----------
function bassEnergy() {
  if (!ana) return -1;
  ana.getByteFrequencyData(anaBins);
  let sum = 0;
  for (let i = bassLo; i <= bassHi; i++) sum += anaBins[i];
  return sum / ((bassHi - bassLo + 1) * 255);
}

// Zvýši flash + posunie dúhu (zavolané pri detekovanom údere).
function onBeat(now) {
  if (now - lastBeatAt < 0.22) return; // dvojité zásahy z jedného basu
  lastBeatAt = now;
  flash = 1;
  hueBase = (hueBase + HUE_PER_BEAT) % 1;
}

// ---------- FARBY ----------
const _c = new THREE.Color();
let idleAcc = 0;

function writeColors(dt) {
  if (!mesh || !mesh.instanceColor) return;
  const night = 1 - dayness();          // v noci svietia silnejšie (bloom cez hmlu)
  const idle = 0.55 + 0.40 * night;     // kľudová žiara
  const bright = idle + flash * (2.2 + 0.9 * night);
  const n = count;
  for (let i = 0; i < n; i++) {
    // Pozdĺžny dúhový prechod + skok dúhy po každom údere pesničky.
    const hue = (hueBase + i * 0.013) % 1;
    _c.setHSL(hue, 1.0, 0.55).multiplyScalar(bright);
    mesh.setColorAt(i, _c);
  }
  mesh.instanceColor.needsUpdate = true;
  flash = Math.max(0, flash - FLASH_DECAY * dt);
}

// ---------- HLAVNÝ UPDATE ----------
// fx/fz = poloha hráča (auto alebo peší), playerS/lat = projekcia na trasu,
// muted = globálne ticho [X], toast = správa pri spustení pesničky.
export function updateBridgeLights(dt, t, fx, fz, playerS, playerLat, muted, toast) {
  if (!built) return;
  // Test priblíženia: blízko stredu mosta ALEBO priamo na mostovke (±35 m
  // od rozpätia, do ±9 m od osi — mostovka je 9 m + chodníky).
  const dx = fx - midX, dz = fz - midZ;
  const d2 = dx * dx + dz * dz;
  const onBridge = playerS > S.bridgeS0 - 35 && playerS < S.bridgeS1 + 35
    && Math.abs(playerLat) < 9;
  wantPlay = d2 < (wantPlay ? NEAR_HYS2 : NEAR2) || onBridge;

  // Pesnička: spustiť/zastaviť podľa prítomnosti hráča; hysterezia drží
  // pesničku pri prechádzaní po okraji dosahu.
  if (wantPlay && !playing) {
    lastSongTry = t;
    startSong(muted);
    toast?.('CARAMELLDANSEN NA MOSTE! 🌈 svetlá tancujú do rytmu');
  } else if (!wantPlay && playing) {
    stopSong();
  }
  if (audioPending && wantPlay && t - lastSongTry > 1.5) {
    lastSongTry = t;
    startSong(muted); // autoplay sa odblokoval príchodom ďalšieho gesta
    audioPending = false;
  }
  setSongLevel(muted, 1);

  // Úder: analyzátor číta basy; bez WebAudio fixné 165 BPM.
  if (playing) {
    const e = bassEnergy();
    if (e >= 0) {
      energyAvg += (e - energyAvg) * Math.min(1, dt * 6);
      if (e > energyAvg * 1.38 + 0.03 && e > 0.05) onBeat(t);
    } else {
      const beatLen = 60 / FALLBACK_BPM;
      if (t - lastBeatAt >= beatLen) onBeat(t);
    }
  }
  // Farby: plná rýchlosť počas zábleskov aj pesničky, v kľude 10 Hz.
  if (flash > 0.001 || playing) {
    writeColors(dt);
  } else {
    idleAcc += dt;
    if (idleAcc > 0.1) {
      idleAcc = 0;
      hueBase = (hueBase + dt * 0.05) % 1; // pomalé točenie dúhy v kľude
      writeColors(dt);
    }
  }
}

export function bridgeLightsBuilt() { return built; }
