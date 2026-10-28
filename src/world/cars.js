// src/world/cars.js — meše auta hráča (src/ai/traffic.js instancuje civilistov).
// (buildTrafficMesh/buildPoliceMesh/flashBars odstránené: nikto ich nevolal;
//  civilisti idú cez InstancedMesh v traffic.js, polícia je mŕtva.)
// B29: druhé auto — RX-7 FD. buildPlayerMesh(color, carId) si vyberie detail
// podľa katalógu CARS (src/core/config.js); kolízny obdĺžnik zostáva zdieľaný
// (CAR_HW/CAR_HL vo vehicle.js) — obidve autá sú kompaktnej rovnakej stopy.
import * as THREE from 'three';

// Octavia I je skladaná z jednoduchých dielov. Pravidlo usadenia: ozdobný diel je
// vždy 1–3 cm zapustený do nosného (drží bez medzery) a 2–4 cm trčí von (je vidieť).
// Žiadne dve líce nesmú byť koplanárne (z-fighting) a dutiny (vidieť skrz auto).
const lowerBodyGeo = new THREE.BoxGeometry(1.8, 0.42, 4.16);
const hoodGeo = new THREE.BoxGeometry(1.72, 0.19, 1.16);
const hatchGeo = new THREE.BoxGeometry(1.72, 0.22, 0.94);
const roofGeo = new THREE.BoxGeometry(1.62, 0.13, 1.5);
const sideGlassGeo = new THREE.BoxGeometry(0.035, 0.63, 1.42);
const screenGeo = new THREE.BoxGeometry(1.5, 0.055, 0.7);
const rearScreenGeo = new THREE.BoxGeometry(1.45, 0.055, 0.8);
const cowlFGeo = new THREE.BoxGeometry(1.6, 0.08, 0.3);
const cowlRGeo = new THREE.BoxGeometry(1.5, 0.07, 0.44);
const bumperGeo = new THREE.BoxGeometry(1.84, 0.14, 0.12);
const grilleGeo = new THREE.BoxGeometry(0.5, 0.22, 0.08);
const trimGeo = new THREE.BoxGeometry(0.04, 0.055, 3.4);
const plateGeo = new THREE.BoxGeometry(0.48, 0.12, 0.025);
const badgeGeo = new THREE.BoxGeometry(0.12, 0.12, 0.035);
const tdiGeo = new THREE.BoxGeometry(0.34, 0.065, 0.025);
const mirrorStalkGeo = new THREE.BoxGeometry(0.12, 0.04, 0.1);
const mirrorHeadGeo = new THREE.BoxGeometry(0.07, 0.14, 0.16);
const handleGeo = new THREE.BoxGeometry(0.03, 0.035, 0.18);
const wheelGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.26, 24);
const rimGeo = new THREE.CylinderGeometry(0.19, 0.19, 0.24, 20);
const exhaustGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.16, 14);
const antennaGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.34, 8);
const headGeo = new THREE.BoxGeometry(0.34, 0.2, 0.12);
const tailGeo = new THREE.BoxGeometry(0.3, 0.16, 0.12);
// Emisívne svetlá: HDR jas (intensity > 1) → chytí ich prahový bloom. Predok = +z.
// Materiály sú SHARED cez obidve autá (dispose ich neprepaľuje — pozri disposeCarMesh).
const headMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffffff, emissiveIntensity: 3.2 });
headMat.userData.shared = true;
const tailMat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff1a1a, emissiveIntensity: 1.8 });
tailMat.userData.shared = true;

// ---------- RX-7 FD: šírka 1,85 m, dĺžka 4,30 m, výška 1,23 m ----------
const rxBodGeo = new THREE.BoxGeometry(1.84, 0.40, 4.02);
const rxHoodGeo = new THREE.BoxGeometry(1.72, 0.16, 1.60);
const rxNoseGeo = new THREE.BoxGeometry(1.80, 0.14, 0.34);
const rxRoofGeo = new THREE.BoxGeometry(1.42, 0.09, 1.05);
const rxGlassGeo = new THREE.BoxGeometry(1.40, 0.05, 0.78);
const rxHatchGlassGeo = new THREE.BoxGeometry(1.36, 0.05, 0.85);
const rxSideGlassGeo = new THREE.BoxGeometry(0.035, 0.36, 1.05);
const rxDeckGeo = new THREE.BoxGeometry(1.70, 0.18, 0.55);
const rxFenderGeo = new THREE.BoxGeometry(0.14, 0.14, 1.10);
const rxRearPanelGeo = new THREE.BoxGeometry(1.80, 0.20, 0.16);
const rxWingGeo = new THREE.BoxGeometry(1.58, 0.05, 0.34);
const rxStalkGeo = new THREE.BoxGeometry(0.06, 0.18, 0.10);
const rxPopGeo = new THREE.BoxGeometry(0.40, 0.06, 0.26);
const rxHeadGeo = new THREE.BoxGeometry(0.24, 0.05, 0.18);
const rxTailGeo = new THREE.BoxGeometry(0.40, 0.14, 0.08);
const rxExhaustGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.14, 14);
const rxMirrorStGeo = new THREE.BoxGeometry(0.10, 0.035, 0.08);
const rxMirrorHGeo = new THREE.BoxGeometry(0.065, 0.10, 0.13);

function lights(parent, y, frontZ) {
  for (const sx of [-1, 1]) {
    // Svetlo je chrbtom v karosérii (2,05 < 2,08) a čelom 3 cm pred nárazníkom (2,18).
    const h = new THREE.Mesh(headGeo, headMat);
    h.position.set(sx * 0.71, y, frontZ);
    parent.add(h);
    const t = new THREE.Mesh(tailGeo, tailMat);
    t.position.set(sx * 0.71, y + 0.02, -frontZ);
    parent.add(t);
  }
}

function std(color, rough = 0.55, metal = 0.3) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}

function wheels(parent, zf = 1.35, zr = -1.35, rimColor = 0xc9cdcb) {
  const list = [];
  const mat = std(0x141414, 0.9, 0.1);
  const rimMat = std(rimColor, 0.38, 0.45);
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const z = sz > 0 ? zf : zr;
    const w = new THREE.Mesh(wheelGeo, mat);
    w.rotation.z = Math.PI / 2;
    w.position.set(sx * 0.82, 0.33, z);
    w.castShadow = true;
    parent.add(w);
    // Ráfik je užší než pneu (0,24 < 0,26) — netrčí do boku z bočnice.
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.z = Math.PI / 2;
    rim.position.set(sx * 0.825, 0.33, z);
    parent.add(rim);
    list.push(w);
    list.push(rim);
  }
  return list;
}

function box(parent, geo, mat, x, y, z, shadow = false) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = shadow;
  parent.add(mesh);
  return mesh;
}

function octaviaDetails(parent, bodyMat) {
  const dark = std(0x11161a, 0.72, 0.12);
  const glass = std(0x182b35, 0.2, 0.55);
  const bumper = std(0x252a2a, 0.7, 0.15);
  const plate = std(0xe9e8dc, 0.55, 0.05);

  // Dlhá kapota, kompaktná kabína a zrezaná zadná časť: Octavia I liftback.
  box(parent, lowerBodyGeo, bodyMat, 0, 0.66, 0, true);
  box(parent, hoodGeo, bodyMat, 0, 0.9, 1.24, true);
  box(parent, hatchGeo, bodyMat, 0, 0.91, -1.48, true);
  box(parent, roofGeo, bodyMat, 0, 1.53, -0.22, true);

  // Bočné sklo siaha až 1 cm do karosérie (0,86 < 0,87) — žiadna diera pod oknami.
  // Vrch je schovaný v streche (strecha je širšia než sklá: 1,62 > 2×0,8045).
  for (const sx of [-1, 1]) {
    box(parent, sideGlassGeo, glass, sx * 0.787, 1.175, -0.22);
    // Lišta sedí na boku karosérie (0,885–0,925 vs líce 0,90), nie v nej.
    box(parent, trimGeo, dark, sx * 0.905, 0.83, -0.04);
    // Späťák: stopka siaha do skla, hlava na jej koniec. Kľučky pod lištou.
    box(parent, mirrorStalkGeo, dark, sx * 0.85, 1.12, 0.42);
    box(parent, mirrorHeadGeo, dark, sx * 0.93, 1.14, 0.42);
    box(parent, handleGeo, dark, sx * 0.91, 0.72, 0.45);
    box(parent, handleGeo, dark, sx * 0.91, 0.72, -0.55);
  }
  // Sklá sa zdvíhajú k streche (nie od nej): horná hrana je pod strechou,
  // spodná v kryte. Pôvodne bol sklon prevrátený a zadné sklo plávalo vo vzduchu.
  const frontScreen = box(parent, screenGeo, glass, 0, 1.25, 0.7);
  frontScreen.rotation.x = 0.72;
  const rearScreen = box(parent, rearScreenGeo, glass, 0, 1.24, -1.225);
  rearScreen.rotation.x = -0.6;
  // Kryty pod sklami: čelný leží na kapote, zadný na kufri.
  box(parent, cowlFGeo, bodyMat, 0, 1.02, 0.85, true);
  box(parent, cowlRGeo, bodyMat, 0, 1.0, -1.36, true);

  // Predok: nárazník trčí 6 cm z karosérie (čelo 2,14 vs 2,08). Maska je chrbtom
  // v karosérii a čelom 0,5 cm pred nárazníkom; svetlá 3 cm. ŠPZ na nárazníku.
  box(parent, bumperGeo, bumper, 0, 0.51, 2.08);
  box(parent, bumperGeo, bumper, 0, 0.51, -2.08);
  box(parent, grilleGeo, dark, -0.28, 0.71, 2.105);
  box(parent, grilleGeo, dark, 0.28, 0.71, 2.105);
  box(parent, badgeGeo, std(0x8cb9a3, 0.3, 0.4), 0, 0.94, 2.09);
  box(parent, plateGeo, plate, 0, 0.51, 2.15);
  box(parent, plateGeo, plate, 0, 0.51, -2.15);

  // Štítok TDI sedí na čele kufra (líce −2,08), mimo zadných svetiel.
  box(parent, tdiGeo, dark, 0.3, 0.8, -2.09);

  // Výfuk pod nárazníkom, anténa na streche (päta 1 cm v streche).
  const exhaust = new THREE.Mesh(exhaustGeo, dark);
  exhaust.rotation.x = Math.PI / 2;
  exhaust.position.set(0.55, 0.32, -2.1);
  parent.add(exhaust);
  box(parent, antennaGeo, dark, 0.45, 1.755, -0.75);
}

export function buildPlayerMesh(color = 0xffb000, carId = 'octavia') {
  const g = new THREE.Group();
  const bodyMat = std(color);
  if (carId === 'rx7') {
    rx7Details(g, bodyMat);
    rx7Lights(g);
    const wh = wheels(g, 1.38, -1.38, 0x6a6f74); // tmavé športové ráfika
    return { group: g, bodyMat, wheels: wh, spin: 0 };
  }
  octaviaDetails(g, bodyMat);
  lights(g, 0.76, 2.11);
  const wh = wheels(g);
  return { group: g, bodyMat, wheels: wh, spin: 0 };
}

/** RX-7 FD: dlhá nízka kapota, fastback zadok + krídlo — boxový štýl ako Octavia. */
function rx7Details(parent, bodyMat) {
  const dark = std(0x11161a, 0.72, 0.12);
  const glass = std(0x182b35, 0.2, 0.55);
  const bumper = std(0x232527, 0.68, 0.2);
  const plate = std(0xe9e8dc, 0.55, 0.05);

  // Nosný turb = 1,84 × 0,40 × 4,02 (rovnaká stopy ako Octavia, len nižšie).
  box(parent, rxBodGeo, bodyMat, 0, 0.60, 0, true);
  box(parent, rxHoodGeo, bodyMat, 0, 0.84, 1.20, true);
  box(parent, rxNoseGeo, bodyMat, 0, 0.70, 1.96, true);
  box(parent, rxRoofGeo, bodyMat, 0, 1.26, -0.12, true);
  box(parent, rxDeckGeo, bodyMat, 0, 0.78, -1.80, true);
  box(parent, rxRearPanelGeo, bodyMat, 0, 0.62, -2.02, true);

  // Štyri fender nadstavby nad kolesami — športová rovná línia (FD vzhľad).
  box(parent, rxFenderGeo, bodyMat, -0.88, 0.60, 1.38, true);
  box(parent, rxFenderGeo, bodyMat, 0.88, 0.60, 1.38, true);
  box(parent, rxFenderGeo, bodyMat, -0.88, 0.60, -1.38, true);
  box(parent, rxFenderGeo, bodyMat, 0.88, 0.60, -1.38, true);

  // Sklá: čelné veľmi šikmé (0,82 rad), zadný fastback sa klope k chvostu.
  for (const sx of [-1, 1]) {
    box(parent, rxSideGlassGeo, glass, sx * 0.72, 1.04, -0.12);
    // Spätné zrkadlá nižšie a kompaktnejšie ako na Octavii (nízka kabína).
    box(parent, rxMirrorStGeo, dark, sx * 0.90, 1.00, 0.42);
    box(parent, rxMirrorHGeo, dark, sx * 0.97, 1.03, 0.42);
  }
  const screen = box(parent, rxGlassGeo, glass, 0, 1.02, 0.62);
  screen.rotation.x = 0.82;
  const hatch = box(parent, rxHatchGlassGeo, glass, 0, 1.06, -0.86);
  hatch.rotation.x = -1.0;

  // Pop-upky ZDVIHNUTÉ: kryt stojí na kapote (päta 1 cm v nej), šošovka čelom
  // pred ním — svetlá dokresľujú rx7Lights() (emisívne).
  for (const sx of [-1, 1]) {
    box(parent, rxPopGeo, dark, sx * 0.46, 0.96, 1.88);
  }

  // Nárazníky zdieľajú geometriu s Octaviou (bumperGeo), ŠPZ na oboch koncoch,
  // plaketa RE na čele kufra (líca −2,075).
  box(parent, bumperGeo, bumper, 0, 0.48, 2.10);
  box(parent, bumperGeo, bumper, 0, 0.48, -2.10);
  box(parent, plateGeo, plate, 0, 0.50, 2.18);
  box(parent, plateGeo, plate, 0, 0.60, -2.12);
  box(parent, badgeGeo, std(0x8cb9a3, 0.3, 0.4), 0, 0.80, -2.09);

  // Krídlo FD na stonkách nad kufrom (stemky 1 cm vsadou v kufri).
  box(parent, rxStalkGeo, dark, -0.62, 0.97, -1.82);
  box(parent, rxStalkGeo, dark, 0.62, 0.97, -1.82);
  box(parent, rxWingGeo, dark, 0, 1.09, -1.88, true);

  // Dvojvýfuk: dva kruhové tipy pod chvostom, ~7 cm trčia z nárazníka.
  for (const sx of [-1, 1]) {
    const ex = new THREE.Mesh(rxExhaustGeo, dark);
    ex.rotation.x = Math.PI / 2;
    ex.position.set(sx * 0.34, 0.36, -2.16);
    parent.add(ex);
  }
}

/** Svietidlá RX-7: šošovky zdvihnutých pop-upiek + nízke zadné lišty (emisívne). */
function rx7Lights(parent) {
  for (const sx of [-1, 1]) {
    const h = new THREE.Mesh(rxHeadGeo, headMat);
    h.position.set(sx * 0.46, 0.925, 1.98);
    parent.add(h);
    const t = new THREE.Mesh(rxTailGeo, tailMat);
    t.position.set(sx * 0.62, 0.70, -2.09);
    parent.add(t);
  }
}

/** Recycle pri výmene auta v garáži: len materiály (geometrie sú zdieľané). */
export function disposeCarMesh(m) {
  m?.group?.traverse?.((o) => {
    const mat = o.material;
    if (mat && !mat.userData.shared) mat.dispose?.();
  });
}

/** Spoločný sync: poloha + natočenie + točenie kolies. */
export function syncMesh(m, x, y, z, h, speed, dt) {
  m.group.position.set(x, y, z);
  m.group.rotation.y = h;
  m.spin += speed * dt * 2.2;
  for (const w of m.wheels) w.rotation.x = m.spin;
}
