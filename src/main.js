// src/main.js — boot: preloader → mapa (async) → svet (legacy poradie) → slučka.
// Ťažká práca až v krokoch init(), medzi krokmi yield → loading bar žije.
import * as THREE from 'three';
import { VERSION } from './core/config.js';
import { createState } from './core/state.js';
import { createEngine } from './core/engine.js';
import { createInput } from './core/input.js';
import { nextFrame } from './core/loader.js';
import { loadMapData, assertMapShape } from './world/mapData.js';
import { S } from './world/shared.js';
import { buildTextures, buildShared } from './world/textures.js';
import {
  buildWaterSamples, buildElevModel, buildRoadProfiles, buildRoundHeights,
  buildRouteSub, driveY, LANE_OFF,
} from './world/height.js';
import { computeBounds, buildGround } from './world/ground.js';
import {
  buildRoads, buildRoundabouts, buildRails, buildGreens, buildCemetery,
  buildRoute, routePose,
} from './world/roads.js';
import { buildRiver, initWater, updateWater, waterResize, setWaterQuality } from './world/water.js';
import { buildBuildings, photoPreload } from './world/buildings.js';
import { buildVegInstanced, buildLampsTrees, snapVegetationToTerrain } from './world/nature.js';
import { buildSkyDome } from './world/sky.js';
import { buildPlayerMesh, syncMesh } from './world/cars.js';
import { createVehicle, updateVehicle, collideWorld } from './physics/vehicle.js';
import { createTraffic, placeTraffic, updateTraffic, nearestRoute, buildCarMeshes, drawCars, setHorn, setMuted } from './ai/traffic.js';
// Polícia odstránená na želanie (bola len otravná): žiadne hliadky, heat ani ping.
import { loadRadioManifest, createRadio } from './audio/radio.js';
import { createSfx } from './audio/sfx.js';
import { createBloom } from './fx/bloom.js';
import { updateSunShadow } from './fx/sunshadow.js';
import { settings, shadowTierR, setShadowDiag } from './ui/settings.js';
import { cheatKey, cheatCancel, cheatLocked, cheatTyping, isNoclip, updateNoclip } from './game/cheats.js';
import { wireSettingsUI } from './ui/settings.js';
import { updateDrift, updateDriftHUD, buildParticles, updateParticles, emitDriftSmoke, emitSparks, loadDriftBest, resetDrift } from './game/drift.js';
import {
  buildCheckpoints, missionReset, updateMissions, updateMissionHUD,
  updateBoostHUD, updateTurbo, toggleTurbo, turboActive, VMAX_TURBO,
} from './game/missions.js';
import { createPreloader } from './ui/preloader.js';
import { createHUD } from './ui/hud.js';
import { createDashboard } from './ui/dashboard.js';
import { createMinimap, enableTiles } from './ui/minimap.js';
import { wireMenus } from './ui/menus.js';
// Štýly ťahá <link> v index.html (Vite ich zbalí; natívny ESM by import CSS odmietol).

const pre = createPreloader();
const state = createState();
const _v3 = new THREE.Vector3();
const _hWrap = { v: 0 };

async function boot() {
  pre.step(0.04, 'inicializujem renderer…');
  await nextFrame();

  const engine = createEngine(document.getElementById('game'));
  const { renderer, scene, camera, sun } = engine;
  S.scene = scene;
  // Vernosť legacy vzhľadu: ACES + sRGB + tiene + hmla
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  S.TEX_ANISO = Math.max(1, Math.min(16, renderer.capabilities.getMaxAnisotropy()));
  scene.background = new THREE.Color(S.SKY_HORIZON);
  scene.fog = new THREE.FogExp2(S.SKY_FOG, 0.0008);
  camera.fov = 68; camera.near = 0.5; camera.far = 5000; camera.updateProjectionMatrix();
  sun.color.setHex(0xfff1d8); sun.intensity = 2.4;
  sun.position.set(S.SUN_OFF.x, S.SUN_OFF.y, S.SUN_OFF.z);
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -130, right: 130, top: 130, bottom: -130, near: 20, far: 600 });
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun.target);

  const input = createInput();
  const hud = createHUD(state);
  const dash = createDashboard();
  const sfx = createSfx();
  wireMenus(state, engine, hud);
  // bloom composer + nastavenia (ešte pred svetom — pixelRatio ovplyvňuje build textúr)
  const bloom = createBloom(renderer, scene, camera);
  engine.setRenderOverride(() => bloom.render());
  engine.onResizeExtra(() => bloom.resize());
  const settingsCtx = {
    renderer, scene, camera, sun, engine,
    bloom: { setMode: (m) => bloom.setMode(m) },
    water: { setQuality: (q) => setWaterQuality(q) },
    audio: { setBalance: (v) => sfx.setBalance(v) },
  };
  wireSettingsUI(settingsCtx, (m) => hud.toast(m));

  // 1) MAPA (async fetch s progresom)
  pre.step(0.08, 'sťahujem mapu Hlohovca…');
  const { data: osm, fallback } = await loadMapData((p, msg) =>
    pre.step(0.08 + p * 0.22, msg ?? `mapa ${(p * 100) | 0} %`));
  assertMapShape(osm);
  S.osm = osm;
  state.map = osm;
  if (fallback) hud.toast('OFFLINE mapa — spusti `npm run dev` pre plné mesto');

  // 2) SVET v legacy poradí (každý krok yieldne → bar žije)
  const step = async (p, msg) => { pre.step(p, msg); await nextFrame(); };
  await step(0.32, 'textúry…');       buildTextures();
  await step(0.40, 'materiály…');     buildShared();
  await step(0.44, 'trasa…');         buildRoute();
  await step(0.47, 'koryto Váhu…');   buildWaterSamples();
  await step(0.50, 'výškový model…'); buildRouteSub(); buildElevModel();
  await step(0.55, 'profily ciest…'); buildRoadProfiles(); buildRoundHeights();
  await step(0.60, 'terén…');         computeBounds(); buildGround();
  await step(0.68, 'cesty…');         buildRoads();
  await step(0.71, 'kruháče…');       buildRoundabouts();
  await step(0.73, 'Váh…');           buildRiver();
  await step(0.75, 'koľaje + zeleň…'); buildRails(); buildGreens(); buildCemetery();
  await step(0.80, 'budovy…');        await photoPreload(); buildBuildings();
  await step(0.86, 'stromy + lampy…'); buildLampsTrees(); buildVegInstanced(); snapVegetationToTerrain();
  await step(0.88, 'efekty + misie…');
  buildParticles(scene);
  buildCheckpoints();
  missionReset();
  loadDriftBest();
  enableTiles();
  await step(0.90, 'obloha…');        const skyDome = buildSkyDome(scene, renderer);
  engine.onResizeExtra(() => waterResize());

  // 3) AUTÁ
  await step(0.92, 'autá…');
  routePose(8, _v3, _hWrap, LANE_OFF);
  const car = createVehicle({ x: _v3.x, z: _v3.z });
  car.h = _hWrap.v;
  car.y = driveY(car.x, car.z, 8, LANE_OFF);
  let playerS = 8;
  state.player.x = car.x; state.player.z = car.z; state.player.h = car.h;
  const playerMesh = buildPlayerMesh(state.player.color);
  scene.add(playerMesh.group);

  const traffic = createTraffic(26);
  placeTraffic(traffic, playerS, S.routeLen);
  buildCarMeshes(); // instancie civilistov (farby z ALL_CARS, potrebuje buildShared)
  setHorn(() => sfx.honk());
  setMuted(state.muted);

  state.police = null;
  const minimap = createMinimap(state, { traffic });

  // Odraz Váhu až PO autách (mirror vrstva musí vidieť aj meshe áut, ako v monolitu).
  // + zosynchronizuj materiál s uloženou kvalitou (boot inak nechá shader aj pri VYP).
  await step(0.93, 'odraz Váhu…');
  initWater(renderer, scene, camera, skyDome, settings.water);
  setWaterQuality(settings.water);

  // 4) AUDIO (len manifest; mp3 až po geste)
  await step(0.95, 'rádio…');
  const radio = createRadio(document.getElementById('bgm'));
  sfx.attachRadio(document.getElementById('bgm'));
  loadRadioManifest().then(({ list, base }) => radio.setList(list, base));
  const unlock = () => { sfx.unlock(); };
  addEventListener('pointerdown', unlock, { once: true });
  addEventListener('keydown', unlock, { once: true });

  // klávesové skratky mimo input.js + cheat-kódy (GTA štýl: písanie hocikde)
  const cheatApi = {
    car, toast: (m) => hud.toast(m),
    playing: () => state.started && !state.paused,
    onWarp: () => { playerS = nearestRoute(car.x, car.z).s; },
  };
  addEventListener('keydown', (e) => {
    // cheat buffer: písmená a–z (WASD šliapu ďalej, pohyb sa nikdy nefiltruje)
    if (!e.repeat && e.key && e.key.length === 1 && /[a-zA-Z]/.test(e.key)) {
      cheatKey(e.key.toLowerCase(), cheatApi);
    } else if (!e.repeat && cheatTyping()) {
      cheatCancel(); // iná klávesa zruší písanie kódu
    }
    const typing = cheatLocked();
    if (e.code === 'KeyH' && state.started && !typing) sfx.honk();
    if (e.code === 'KeyQ' && !typing) radio.prev();
    if (e.code === 'KeyE' && !typing && !isNoclip()) radio.next();
    if (e.code === 'KeyT' && state.started && !typing) toggleTurbo((m) => hud.toast(m));
    if (e.code === 'KeyX' && !typing) {
      const m = !state.muted; state.muted = m; sfx.setMuted(m); setMuted(m);
      const b = document.getElementById('snd-btn');
      if (b) b.textContent = m ? 'ZVUK: OFF [X]' : 'ZVUK: ON [X]';
    }
    if (e.code === 'KeyR' && state.started && !typing) {
      routePose(8, _v3, _hWrap, LANE_OFF);
      Object.assign(car, { x: _v3.x, z: _v3.z, h: _hWrap.v, speed: 0, temp: 0.2, stress: 0 });
      playerS = 8;
      resetDrift();
      missionReset();
      hud.toast('Reštart na štarte kolóny.');
    }
    if (e.code === 'F3') {
      e.preventDefault();
      bloom.setMode((bloom.getMode() + 1) % 3);
      hud.toast('Bloom: ' + ['VYP.', 'SLABÝ', 'JASNÝ'][bloom.getMode()]);
    }
  });
  document.getElementById('btn-start')?.addEventListener('click', () => radio.play(0), { once: true });
  // skrytý tab = pauza (motor stíchne, svet nespadne do chaosu)
  document.addEventListener('visibilitychange', () => {
    if (!state.started) return;
    if (document.hidden && !state.paused) {
      state.paused = true;
      hud.toast('PAUZA — vráť sa do tabu.');
    } else if (!document.hidden && state.paused) {
      state.paused = false;
    }
  });

  // 5) SLUČKA
  await step(0.97, 'hotovo ✔');
  await nextFrame();
  let hudAcc = 1, slowAcc = 0, fpsAcc = 0, fpsN = 0;
  let playerLat = 0; // priečna odchýlka od osi trasy (pre mostovku)
  const camPos = new THREE.Vector3(_v3.x - Math.sin(car.h) * 9, car.y + 3.5, _v3.z - Math.cos(car.h) * 9);
  camera.position.copy(camPos);

  engine.onTick((dt, t) => {
    state.time = t;
    if (!state.started || state.paused) {
      // menu orbitka okolo štartu
      const a = t * 0.12;
      camera.position.set(car.x + Math.sin(a) * 26, car.y + 10, car.z + Math.cos(a) * 26);
      camera.lookAt(car.x, car.y + 2, car.z);
      syncMesh(playerMesh, car.x, car.y, car.z, car.h, 0, 0);
      return;
    }

    // — hráč (turbo dvíha limiter na 300 km/h; noclip lieta bez fyziky) —
    car.vmax = turboActive() ? VMAX_TURBO : 250 / 3.6;
    updateTurbo(dt, (m) => hud.toast(m));
    let tel = { kmh: Math.abs(car.speed) * 3.6, drifting: false, accel: 0 };
    let impact = 0;
    if (isNoclip()) {
      updateNoclip(dt, car, input);
    } else {
      // Skutočná priečna odchýlka od trasy: mostovka platí len ±7 m od osi
      // (s lat=0 by deckBlend dvíhal auto do nekonečna do strán).
      const gy = driveY(car.x, car.z, playerS, playerLat);
      tel = updateVehicle(car, input, dt, gy);
      impact = collideWorld(car, traffic.cars);
    }
    car.stress = Math.max(0, Math.min(1, car.stress + impact * 0.03 - dt * 0.02));
    if (impact > 0.15) {
      sfx.crash(Math.min(1, impact / 6));
      if (impact > 1.2) emitSparks(car.x, car.y + 0.6, car.z, Math.min(24, (impact * 2) | 0));
    }
    // — drift + častice —
    updateDrift(dt, car, input);
    if (tel.drifting) emitDriftSmoke(car);
    updateParticles(dt);
    Object.assign(state.player, {
      x: car.x, y: car.y, z: car.z, h: car.h, speed: car.speed,
      temp: car.temp, stress: car.stress, rpm: car.rpm, gear: car.gear,
    });

    // — projekcia na trasu (10 Hz): s + priečna odchýlka pre mostovku —
    slowAcc += dt;
    if (slowAcc > 0.1) {
      slowAcc = 0;
      const nr = nearestRoute(car.x, car.z);
      playerS = nr.s;
      // lat = priemet do pravého smeru trasy (routePose: posun = (-cos h, +sin h) * L)
      playerLat = -(car.x - nr.x) * Math.cos(nr.h) + (car.z - nr.z) * Math.sin(nr.h);
      // ciel misie: koniec trasy
      if (playerS > S.routeLen - 25 && !state.finished) {
        state.finished = true; state.started = false;
        sfx.win();
        document.getElementById('end-title').textContent = 'UŠIEL SI!';
        document.getElementById('end-sub').textContent = 'Hlohovec ostal v spätnom zrkadle.';
        document.getElementById('ov-end')?.classList.remove('hidden');
      }
    }

    // — doprava + misie —
    updateTraffic(traffic, dt, state.player, playerS, S.routeLen);
    updateMissions(dt, {
      car, playerS, routeLen: S.routeLen,
      toast: (m) => hud.toast(m),
      onWin: (m) => hud.toast(m || 'MISIA SPLNENÁ ✔'),
      onFail: (m) => hud.toast(m || 'Misia zlyhala'),
    });
    sfx.engine((car.rpm - 900) / 7100, input.throttle());

    // — meshe —
    if (playerMesh.bodyMat.color.getHex() !== state.player.color) {
      playerMesh.bodyMat.color.setHex(state.player.color);
    }
    syncMesh(playerMesh, car.x, car.y, car.z, car.h, car.speed, dt);
    drawCars(); // všetky AI autá naraz (instancie + brzdové svetlá)

    // voda: vlny + fade odrazu + throttlovaný plánový odraz (pred renderom)
    updateWater(dt, settings.dist);

    // dynamické tiene: frustum cestuje s hráčom (RT toggle v nastaveniach)
    if (settings.rt) {
      const diag = updateSunShadow(sun, car.x, car.y, car.z, settings.dist, shadowTierR());
      if (diag) setShadowDiag(diag.texel, diag.depth);
    }

    // — kamera (naháňačka s vyhladením) —
    const fx = Math.sin(car.h), fz = Math.cos(car.h);
    const k = Math.min(1, 4.5 * dt);
    camPos.x += (car.x - fx * 9 - camPos.x) * k;
    camPos.y += (car.y + 3.6 - camPos.y) * k;
    camPos.z += (car.z - fz * 9 - camPos.z) * k;
    camera.position.copy(camPos);
    camera.lookAt(car.x + fx * 7, car.y + 1.6, car.z + fz * 7);

    // — HUD (5 Hz) —
    hudAcc += dt;
    if (hudAcc > 0.2) {
      hudAcc = 0;
      hud.update(dt, t, playerS, S.routeLen, osm);
      dash.update(state.player);
      updateDriftHUD();
      updateMissionHUD(car);
      updateBoostHUD();
    }
    minimap.update();
    fpsAcc += dt; fpsN++;
    if (fpsAcc > 0.5) {
      const el = document.getElementById('fps');
      if (el) el.textContent = `${Math.round(fpsN / fpsAcc)} FPS`;
      fpsAcc = 0; fpsN = 0;
    }
  });
  engine.setFpsCap(state.settings.fps);
  engine.start();

  pre.finish();
  console.info(`[boot] ${VERSION} · route ${S.routeLen | 0} m · blds ${(osm.blds || []).length} · roads ${(osm.roads || []).length}`);
}

boot().catch((e) => {
  console.error(e);
  pre.step(1, 'CHYBA: ' + e.message + '\nSkús `npm run dev` a pozri konzolu.');
});
