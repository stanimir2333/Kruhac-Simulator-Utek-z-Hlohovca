// src/main.js — boot orchestrácia: preloader → mapa (async) → svet → slučka.
// Nemá žiadnu ťažkú prácu v module-scope — všetko až v init() krokoch,
// aby sa <script type="module"> sparsoval v ms a preloader stihol prvý paint.
import { VERSION } from './core/config.js';
import { createState } from './core/state.js';
import { createEngine } from './core/engine.js';
import { createInput } from './core/input.js';
import { nextFrame } from './core/loader.js';
import { loadMapData, assertMapShape } from './world/mapData.js';
import { buildElevModel } from './world/terrain.js';
import { buildRoads } from './world/roads.js';
import { buildBuildings } from './world/buildings.js';
import { buildRiver } from './world/water.js';
import { buildVegetation, buildSky } from './world/nature.js';
import { createVehicle, updateVehicle } from './physics/vehicle.js';
import { createTraffic, updateTraffic } from './ai/traffic.js';
import { createPoliceSystem } from './ai/police.js';
import { loadRadioManifest, createRadio } from './audio/radio.js';
import { createSfx } from './audio/sfx.js';
import { createPreloader } from './ui/preloader.js';
import { createHUD } from './ui/hud.js';
import { createDashboard } from './ui/dashboard.js';
import { createMinimap } from './ui/minimap.js';
import { wireMenus } from './ui/menus.js';
// Pozn.: štýly ťahá <link rel="stylesheet" href="./src/styles.css"> v index.html
// (Vite ich zbalí do singlefile; natívny ESM cez `python -m http.server` by
// `import './styles.css'` odmietol — preto tu NIE JE statický CSS import).

const pre = createPreloader();
const state = createState();

async function boot() {
  pre.step(0.05, 'inicializujem renderer…');
  await nextFrame();

  const engine = createEngine(document.getElementById('game'));
  const input = createInput();
  const hud = createHUD(state);
  const dash = createDashboard();
  const minimap = createMinimap(state);
  const sfx = createSfx();
  wireMenus(state, engine, hud);

  // 1) MAPA — jediný ťažký fetch (0.5 MB), s progresom; parser neblokuje UI
  pre.step(0.1, 'sťahujem mapu Hlohovca…');
  const { data: osm, fallback } = await loadMapData((p, msg) =>
    pre.step(0.1 + p * 0.35, msg ?? `mapa ${(p * 100) | 0} %`),
  );
  assertMapShape(osm);
  state.map = osm;
  if (fallback) hud.toast('OFFLINE mapa — spusti `npm run dev` pre plné mesto');

  // 2) SVET — stavba po chunkoch, každý krok yieldne (loading bar žije)
  pre.step(0.5, 'terén…'); await nextFrame();
  const elev = buildElevModel(osm);
  pre.step(0.58, 'cesty…'); await nextFrame();
  const { routeLen } = buildRoads(engine.scene, osm);
  pre.step(0.66, 'budovy…'); await nextFrame();
  buildBuildings(engine.scene, osm);
  pre.step(0.74, 'Váh…'); await nextFrame();
  buildRiver(engine.scene, osm);
  buildVegetation(engine.scene, osm);
  buildSky(engine.scene, engine);

  // 3) HRÁČ + AI + POLÍCIA
  pre.step(0.82, 'autá…'); await nextFrame();
  const car = createVehicle({ x: osm.route[0] ?? 0, z: osm.route[1] ?? -1550 });
  state.player.x = car.x; state.player.z = car.z;
  const traffic = createTraffic(24);
  const police = createPoliceSystem(state, { onBusted: (lvl) => hud.toast(`CHYTENÝ na ★${lvl} — R = reštart`) });
  police.syncRoadblocksWithMap(osm);
  state.police = police;

  // 4) AUDIO — len manifest (1 kB); mp3 až po prvom kliku (autoplay policy + 23 MB)
  pre.step(0.9, 'rádio…'); await nextFrame();
  const radio = createRadio(document.getElementById('bgm'));
  loadRadioManifest().then(({ list, base }) => radio.setList(list, base));
  const unlock = () => { sfx.unlock(); document.getElementById('btn-start')?.addEventListener('click', () => radio.play(0), { once: true }); };
  addEventListener('pointerdown', unlock, { once: true });
  addEventListener('keydown', unlock, { once: true });

  // 5) SLUČKA
  pre.step(0.96, 'hotovo ✔'); await nextFrame();
  let playerS = 0, hudAcc = 1;
  engine.onTick((dt, t) => {
    state.time = t;
    if (!state.started || state.paused) return;
    const tel = updateVehicle(car, input, dt, elev.at(car.x, car.z));
    Object.assign(state.player, { x: car.x, y: car.y, z: car.z, h: car.h, speed: car.speed, temp: car.temp, rpm: car.rpm, gear: car.gear });
    playerS += Math.abs(car.speed) * dt;
    updateTraffic(traffic, dt, t, state.player);
    // heat senzory (plné prahy + Námestie zóna prídu migráciou; teraz: rýchlosť + drift)
    police.update(dt, t, { drifting: tel.drifting && police.level >= 2 });
    sfx.engine((car.rpm - 900) / 7100, input.throttle());
    hudAcc += dt;
    if (hudAcc > 0.2) { hudAcc = 0; hud.update(dt, t, playerS, routeLen, osm); dash.update(state.player); }
    minimap.update();
  });
  engine.setFpsCap(state.settings.fps);
  engine.start();

  pre.finish();
  console.info(`[boot] ${VERSION} · route ${routeLen} m · blds ${(osm.blds || []).length} · roads ${(osm.roads || []).length}`);
}

boot().catch((e) => {
  console.error(e);
  pre.step(1, 'CHYBA: ' + e.message + '\nSkús `npm run dev` a pozri konzolu.');
});
