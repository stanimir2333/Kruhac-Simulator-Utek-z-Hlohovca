// src/core/config.js — konštanty hry (1:1 metre z OSM).
// POZNÁMKA: WORLD a HEAT boli odstránené ako mŕtve — WORLD.mapUrls /
// textureBase / audioManifestUrl nikto nečítal (mapData.js a radio.js si držia
// vlastné 6-kandidátové zoznamy, textures.js vlastný ASSET_ROOT) a HEAT patril
// odstránenému heat/polícia systému. PERF je zatiaľ nepoužitý, ale odráža
// skutočné konštanty z traffic.js — nech je to jedno miesto na overenie.
export const VERSION = 'B26-modular';
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
  hudHz: 5,                 // src/main.js: HUD/dash 5 Hz
  miniHz: 20,               // src/ui/minimap.js: minimapa
  shadowHz: 2,              // src/fx/sunshadow.js: tieňový frustum
  cullHz: 2,                // src/world/sky.js: chunky + štítky
  aiNear2: 22500,           // 150 m
  aiMid2: 122500,           // 350 m
  aiMaxFull: 32,
};
