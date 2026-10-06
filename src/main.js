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
  buildRouteSub, getTerrainHeight, driveY, LANE_OFF,
} from './world/height.js';
import { computeBounds, buildGround, gridQuery } from './world/ground.js';
import {
  buildRoads, buildRoundabouts, buildRails, buildGreens, buildCemetery,
  buildRoute, routePose,
} from './world/roads.js';
import { buildRiver } from './world/water.js';
import { buildBuildings, photoPreload } from './world/buildings.js';
import { buildVegInstanced, buildLampsTrees, snapVegetationToTerrain } from './world/nature.js';
import { buildSkyDome } from './world/sky.js';
import { buildPlayerMesh, buildTrafficMesh, buildPoliceMesh, syncMesh, flashBars } from './world/cars.js';
import { createVehicle, updateVehicle, collideWorld } from './physics/vehicle.js';
import { createTraffic, placeTraffic, updateTraffic, nearestRoute } from './ai/traffic.js';
import { createPoliceSystem, HeatEvent } from './ai/police.js';
import { loadRadioManifest, createRadio } from './audio/radio.js';
import { createSfx } from './audio/sfx.js';
import { createBloom } from './fx/bloom.js';
import { setWaterQuality } from './world/water.js';
import { wireSettingsUI } from './ui/settings.js';
import { updateDrift, updateDriftHUD, buildParticles, updateParticles, emitDriftSmoke, emitSparks, loadDriftBest } from './game/drift.js';
import {
  buildCheckpoints, missionReset, updateMissions, updateMissionHUD,
  updateBoostHUD, updateTurbo, toggleTurbo, turboActive, VMAX_TURBO,
} from './game/missions.js';
import { enableTiles } from './ui/minimap.js';
import { createPreloader } from './ui/preloader.js';
import { createHUD } from './ui/hud.js';
import { createDashboard } from './ui/dashboard.js';
import { createMinimap } from './ui/minimap.js';
import { wireMenus } from './ui/menus.js';
// Štýly ťahá <link> v index.html (Vite ich zbalí; natívny ESM by import CSS odmietol).

const pre = createPreloader();
const state = createState();
const _v3 = new THREE.Vector3();
const _hWrap = { v: 0 };

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

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
  await step(0.90, 'obloha…');        buildSkyDome(scene, renderer);

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

  const traffic = createTraffic(16);
  placeTraffic(traffic, playerS, S.routeLen);
  const trafficMeshes = traffic.cars.map(() => {
    const m = buildTrafficMesh();
    scene.add(m.group);
    return m;
  });

  const police = createPoliceSystem(state, {
    onBusted: (lvl) => {
      state.started = false;
      document.getElementById('end-title').textContent = `CHYTENÝ · ★${lvl}`;
      document.getElementById('end-sub').textContent = 'Mestská polícia Hlohovec ďakuje za spoluprácu.';
      document.getElementById('ov-end')?.classList.remove('hidden');
    },
  });
  police.syncRoadblocksWithMap(osm);
  state.police = police;
  const minimap = createMinimap(state, { traffic, police });
  const policeMeshes = [];
  for (let i = 0; i < 6; i++) {
    const m = buildPoliceMesh(i < 1 ? 'mestska' : i < 3 ? 'statna' : 'pmj');
    m.group.visible = false;
    scene.add(m.group);
    policeMeshes.push(m);
  }
  // Prestriek garáž (OC VÁH): viditeľný marker
  const spray = police.sprayShops[0];
  const sprayMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(spray.r, spray.r, 6, 20, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x39ff6a, transparent: true, opacity: 0.18, side: THREE.DoubleSide }),
  );
  sprayMesh.position.set(spray.x, getTerrainHeight(spray.x, spray.z) + 3, spray.z);
  scene.add(sprayMesh);

  // 4) AUDIO (len manifest; mp3 až po geste)
  await step(0.95, 'rádio…');
  const radio = createRadio(document.getElementById('bgm'));
  loadRadioManifest().then(({ list, base }) => radio.setList(list, base));
  const unlock = () => { sfx.unlock(); };
  addEventListener('pointerdown', unlock, { once: true });
  addEventListener('keydown', unlock, { once: true });

  // klávesové skratky mimo input.js
  const cd = {}; // cooldowny heat-eventov
  const cool = (k, s) => (cd[k] ?? -99) + s <= state.time;
  const mark = (k) => { cd[k] = state.time; };
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyH' && state.started) {
      sfx.honk();
      if (cool('honk', 4)) { police.report(HeatEvent.HONK, state.time); mark('honk'); }
    }
    if (e.code === 'KeyQ') radio.prev();
    if (e.code === 'KeyE') radio.next();
    if (e.code === 'KeyT' && state.started) toggleTurbo((m) => hud.toast(m));
    if (e.code === 'KeyX') {
      const m = !state.muted; state.muted = m; sfx.setMuted(m);
      const b = document.getElementById('snd-btn');
      if (b) b.textContent = m ? 'ZVUK: OFF [X]' : 'ZVUK: ON [X]';
    }
    if (e.code === 'KeyR' && state.started) {
      routePose(8, _v3, _hWrap, LANE_OFF);
      Object.assign(car, { x: _v3.x, z: _v3.z, h: _hWrap.v, speed: 0, temp: 0.2, stress: 0 });
      playerS = 8;
      hud.toast('Reštart na štarte kolóny.');
    }
  });
  document.getElementById('btn-start')?.addEventListener('click', () => radio.play(0), { once: true });

  // 5) SLUČKA
  await step(0.97, 'hotovo ✔');
  await nextFrame();
  let hudAcc = 1, slowAcc = 0, occAcc = 0, fpsAcc = 0, fpsN = 0;
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

    // — hráč (turbo dvíha limiter na 300 km/h) —
    car.vmax = turboActive() ? VMAX_TURBO : 250 / 3.6;
    updateTurbo(dt, (m) => hud.toast(m));
    const gy = driveY(car.x, car.z, playerS, 0);
    const tel = updateVehicle(car, input, dt, gy);
    const cars = [...traffic.cars, ...police.units];
    const impact = collideWorld(car, cars);
    car.stress = Math.max(0, Math.min(1, car.stress + impact * 0.03 - dt * 0.02));
    if (impact > 0.15) {
      sfx.crash(Math.min(1, impact / 6));
      if (impact > 1.2) emitSparks(car.x, car.y + 0.6, car.z, Math.min(24, (impact * 2) | 0));
      if (cool('hit', 2)) {
        police.report(impact > 8 ? HeatEvent.MAYHEM : HeatEvent.COLLISION_MINOR, t);
        mark('hit');
      }
    }
    // — drift + častice —
    updateDrift(dt, car, input);
    if (tel.drifting) emitDriftSmoke(car);
    updateParticles(dt);
    Object.assign(state.player, {
      x: car.x, y: car.y, z: car.z, h: car.h, speed: car.speed,
      temp: car.temp, stress: car.stress, rpm: car.rpm, gear: car.gear,
    });

    // — projekcia na trasu (10 Hz) + triggery —
    slowAcc += dt;
    if (slowAcc > 0.1) {
      slowAcc = 0;
      const nr = nearestRoute(car.x, car.z);
      playerS = nr.s;
      const kmh = Math.abs(car.speed) * 3.6;
      // speeding na Námestí sv. Michala (úsek z OSM streets)
      for (const [a, b, name] of osm.streets || []) {
        if (name.includes('Michala') && playerS >= a && playerS < b && kmh > 50 && cool('sq', 3)) {
          police.report(HeatEvent.SPEEDING_SQUARE, t); mark('sq');
          hud.toast('SPEEDING na Námestí sv. Michala! ★');
        }
      }
      // protismer na moste
      if (playerS > S.bridgeS0 && playerS < S.bridgeS1 && Math.abs(wrapAngle(car.h - nr.h)) > 1.8 && cool('ww', 4)) {
        police.report(HeatEvent.WRONG_WAY_BRIDGE, t); mark('ww');
        hud.toast('PROTISMER na moste ponad Váh! ★★');
      }
      // drift pred hliadkou
      if (tel.drifting && police.level >= 1) {
        let near = 1e9;
        for (const u of police.units) near = Math.min(near, (u.x - car.x) ** 2 + (u.z - car.z) ** 2);
        if (near < 3600 && cool('drift', 4)) { police.report(HeatEvent.DRIFT_TAUNT, t); mark('drift'); }
      }
      // prerazenie zátarasu
      for (const blk of police.roadblocks) {
        if ((blk.x - car.x) ** 2 + (blk.z - car.z) ** 2 < 64 && Math.abs(car.speed) > 10 && cool('smash', 4)) {
          police.report(HeatEvent.SMASH_BLOCK, t); mark('smash');
          hud.toast('PRERAZIL si zátaras! ★★★★');
        }
      }
      // ram do policajta
      if (impact > 1.2) {
        for (const u of police.units) {
          if ((u.x - car.x) ** 2 + (u.z - car.z) ** 2 < 36 && cool('ram', 3)) {
            police.report(HeatEvent.RAM_POLICE, t); mark('ram');
            hud.toast('NARAZIL si do hliadky! ★★');
            break;
          }
        }
      }
      // ciel misie: koniec trasy
      if (playerS > S.routeLen - 25 && !state.finished) {
        state.finished = true; state.started = false;
        document.getElementById('end-title').textContent = 'UŠIEL SI!';
        document.getElementById('end-sub').textContent = 'Hlohovec ostal v spätnom zrkadle.';
        document.getElementById('ov-end')?.classList.remove('hidden');
      }
    }

    // — doprava + polícia + misie —
    updateTraffic(traffic, dt, state.player, playerS, S.routeLen);
    updateMissions(dt, {
      car, playerS, routeLen: S.routeLen,
      toast: (m) => hud.toast(m),
      onWin: (m) => hud.toast(m || 'MISIA SPLNENÁ ✔'),
      onFail: (m) => hud.toast(m || 'Misia zlyhala'),
    });
    occAcc += dt;
    if (occAcc > 0.3) { // lacná oklúzia: budova medzi hráčom a najbližšou hliadkou?
      occAcc = 0;
      let occluded = false;
      if (police.units.length) {
        let bi = 0, bd = 1e18;
        police.units.forEach((u, i) => {
          const d = (u.x - car.x) ** 2 + (u.z - car.z) ** 2;
          if (d < bd) { bd = d; bi = i; }
        });
        if (bd > 1600) {
          const u = police.units[bi];
          const mx = (u.x + car.x) / 2, mz = (u.z + car.z) / 2;
          occluded = gridQuery(S.BGRID, mx, mz, 0) > 0;
        }
      }
      police._occluded = occluded;
    }
    police.update(dt, t, {});
    sfx.engine((car.rpm - 900) / 7100, input.throttle());

    // — meshe —
    if (playerMesh.bodyMat.color.getHex() !== state.player.color) {
      playerMesh.bodyMat.color.setHex(state.player.color);
    }
    syncMesh(playerMesh, car.x, car.y, car.z, car.h, car.speed, dt);
    traffic.cars.forEach((c, i) => {
      const m = trafficMeshes[i];
      if (m && c.d2 < 160000) { m.group.visible = true; syncMesh(m, c.x, c.y, c.z, c.h, c.speed, dt); }
      else if (m) m.group.visible = false;
    });
    police.units.forEach((u, i) => {
      const m = policeMeshes[i];
      if (!m) return;
      m.group.visible = true;
      u.y = getTerrainHeight(u.x, u.z) + 0.15;
      syncMesh(m, u.x, u.y, u.z, u.h, u.speed, dt);
    });
    for (let i = police.units.length; i < policeMeshes.length; i++) policeMeshes[i].group.visible = false;
    if (police.units.length) flashBars(policeMeshes.slice(0, police.units.length), t);

    // slnko vezie tieňový frustum s hráčom (ľahká verzia legacy updateSun)
    sun.position.set(car.x + S.SUN_OFF.x, S.SUN_OFF.y, car.z + S.SUN_OFF.z);
    sun.target.position.set(car.x, 0, car.z);
    sun.target.updateMatrixWorld();

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
