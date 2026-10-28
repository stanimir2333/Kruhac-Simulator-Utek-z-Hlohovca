// src/core/config.js — konštanty hry (1:1 metre z OSM).
// POZNÁMKA: WORLD a HEAT boli odstránené ako mŕtve — WORLD.mapUrls /
// textureBase / audioManifestUrl nikto nečítal (mapData.js a radio.js si držia
// vlastné 6-kandidátové zoznamy, textures.js vlastný ASSET_ROOT) a HEAT patril
// odstránenému heat/polícia systému. PERF drží aktívne frekvencie aktualizácií
// a limity vzdialenosti AI; cesty k dátam a textúram zostávajú v ich moduloch.
export const VERSION = 'B29-garaz'; // B29 = garáž: výber auta, motor podľa typu auta
// HEAT + riverbankSlowdown zostávajú: src/ai/police.js je síka mŕtva (nikto ju
// neimportuje), ale podľa AGENTS.md sa zámerne NEDÁVA maz — bez nich by bol
// súbor s nevyriesenými importmi.
export const HEAT = {
  max: 5,
  decayDelay: 4.0,           // s bez priestupku pred decay
  decayPerSec: 0.25,         // hviezdy/s pri schovaní
  chaseMemory: 8.0,          // ako dlho si ťa pamätajú po strate LOS
};
export const PERF = {
  hudHz: 5,                 // src/main.js: HUD/dash
  fpsHz: 2,                 // src/main.js: výkonnostný readout
  miniHz: 20,               // src/ui/minimap.js: minimapa
  routeProjectionHz: 10,    // src/main.js: projekcia hráča na trasu
  cullHz: 2,                // src/world/sky.js + src/world/labels.js
  aiNear2: 22500,           // dosah 150 m, vzdialenosť²
  aiMid2: 122500,           // dosah 350 m, vzdialenosť²
  aiPool2: 160000,          // dosah 400 m, vzdialenosť²
  aiHornRadius2: 3600,      // klaksón do 60 m, vzdialenosť²
  aiMaxFull: 40,           // full-rate áut (kinematika je lacná; LOD-1 ide na 5 Hz)
};

// ---------- GARÁŽ: autá hráča (adaptácia B29) ----------
// Jeden id = jeden typ auta: meshe (world/cars.js) i motor (physics/vehicle.js
// ENGINES) si hľadajú svoje profilné hodnoty podľa engine-id. Výber motora je
// preto ODSTRÁNENÝ — motor patrí typu auta a volí sa v garáži [G].
// `stats` sú DISPLAY riadky garáže — zrkadlia ENGINES vo vehicle.js
// (tdi 250/300 km/h, wankel 325/360). Jediný zdroj pravdy je schválne len
// v fyzike; táto duplicita je rovnakého thezu ako ENGINE_NAME v settings.js.
export const CARS = {
  octavia: {
    id: 'octavia', name: 'ŠKODA OCTAVIA I', engine: 'tdi',
    sub: '1.9 TDI · diesel · 6 prevodov',
    stats: [
      ['VMAX', '250 km/h'],
      ['S TURBOM', '300 km/h'],
      ['OTÁČKY', '900 – 8000 ot/min'],
      ['0 – 100', '≈ 9,5 s'],
    ],
    desc: 'Najbežnejšie slovenské auto všetkých čias. Pomalý rozbeh, ale '
      + 'k 250 km/h sa plíži tvrdo a diesel udrží celú 513-ku.',
  },
  rx7: {
    id: 'rx7', name: 'MAZDA RX-7 FD', engine: 'wankel',
    sub: '4-ROTOR WANKEL · benzín · 6 prevodov',
    stats: [
      ['VMAX', '325 km/h'],
      ['S TURBOM', '360 km/h'],
      ['OTÁČKY', '1100 – 15000 ot/min'],
      ['0 – 100', '≈ 4,6 s'],
    ],
    desc: 'Rotačná bestia: brap-brap na voľnobehu, vreskot k 15000 ot '
      + 'a plamene z výfuku pri pustení plynu. Turbo [T] ženie k 360.',
  },
};
