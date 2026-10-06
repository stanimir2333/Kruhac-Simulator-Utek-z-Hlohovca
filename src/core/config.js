// src/core/config.js — jediný zdroj pravdy pre konštanty hry (1:1 metre z OSM).
export const VERSION = 'B26-modular';
export const WORLD = {
  unitsPerMeter: 1,          // 1 unit = 1 meter, ako monolit
  routeLength: 4530.5,       // OSM_DATA.length
  bridge: [982.8, 1344.6, 361.8],
  mapUrls: ['/data/mapData.json', './data/mapData.json', 'data/mapData.json',
            '/public/data/mapData.json', './public/data/mapData.json', 'public/data/mapData.json'],
  audioManifestUrl: '/audio/manifest.json',
  textureBase: '/textures/',
};
export const HEAT = {
  max: 5,
  decayDelay: 4.0,           // s bez priestupku pred decay
  decayPerSec: 0.25,         // hviezdy/s pri schovaní
  chaseMemory: 8.0,          // ako dlho si ťa pamätajú po strate LOS
};
export const PERF = {
  hudHz: 5,
  aiNear2: 22500,            // 150 m
  aiMid2: 122500,            // 350 m
  aiMaxFull: 32,
};
