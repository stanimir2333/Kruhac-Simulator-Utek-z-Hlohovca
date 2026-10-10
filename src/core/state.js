// src/core/state.js — zdieľaný mutabilný stav (žiadne new v slučke, žiadne import cykly).
// Každý systém sem píše/číta; main.js ho vytvára raz a injektuje do modulov.
export function createState() {
  return {
    time: 0,
    started: false,
    paused: false,      // bigmap / settings
    muted: false,       // všetko ticho [X]
    musicOn: true,      // len hudba (rádio) [C] — motor a zvuky hrajú ďalej
    // hráč (minimalistický kanonický tvar — detailná fyzika v src/physics/vehicle.js)
    player: {
      x: 0, y: 0, z: 0, h: 0, speed: 0, // m/s
      s: 0, lane: 0,                     // pozícia na trase 513
      temp: 0.2, stress: 0,              // 0..1 (HUD metre)
      honkT: 0, drift: 0,
      color: 0xffb000,
    },
    // mapa sa doplní async (src/world/mapData.js) — dovtedy null, hra čaká v preloaderi
    map: null,
    // traffic + police pooly (naplní init, v slučke len recyklácia)
    traffic: [],
    police: null,       // PoliceHeatSystem (src/ai/police.js)
    // POZNÁMKA: grafické nastavenia NIE sú tu — vlastní ich src/ui/settings.js
    // (uložený v localStorage 'kruhac-set', jediný zdroj pravdy). Duplicitný
    // `settings` v state prepisoval načítaný FPS limit natvrdom 60 pri každom starte.
  };
}
