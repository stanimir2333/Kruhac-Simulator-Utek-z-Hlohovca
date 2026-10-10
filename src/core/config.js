// src/core/config.js — konštanty hry (1:1 metre z OSM).
// POZNÁMKA: WORLD a HEAT boli odstránené ako mŕtve — WORLD.mapUrls /
// textureBase / audioManifestUrl nikto nečítal (mapData.js a radio.js si držia
// vlastné 6-kandidátové zoznamy, textures.js vlastný ASSET_ROOT) a HEAT patril
// odstránenému heat/polícia systému. PERF drží aktívne frekvencie aktualizácií
// a limity vzdialenosti AI; cesty k dátam a textúram zostávajú v ich moduloch.
export const VERSION = 'B27-modular'; // B27 = vypínač hudby [C]
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
  aiMaxFull: 32,
};
