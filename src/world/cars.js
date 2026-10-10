// src/world/cars.js — jednoduché meš hráča (src/ai/traffic.js instancuje civilistov).
// (buildTrafficMesh/buildPoliceMesh/flashBars odstránené: nikto ich nevolal;
//  civilisti idú cez InstancedMesh v traffic.js, polícia je mŕtva.)
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
const headMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffffff, emissiveIntensity: 3.2 });
const tailMat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff1a1a, emissiveIntensity: 1.8 });

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

function wheels(parent) {
  const list = [];
  const mat = std(0x141414, 0.9, 0.1);
  const rimMat = std(0xc9cdcb, 0.38, 0.45);
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const w = new THREE.Mesh(wheelGeo, mat);
    w.rotation.z = Math.PI / 2;
    w.position.set(sx * 0.82, 0.33, sz * 1.35);
    w.castShadow = true;
    parent.add(w);
    // Ráfik je užší než pneu (0,24 < 0,26) — netrčí do boku z bočnice.
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.z = Math.PI / 2;
    rim.position.set(sx * 0.825, 0.33, sz * 1.35);
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

export function buildPlayerMesh(color = 0xffb000) {
  const g = new THREE.Group();
  const bodyMat = std(color);
  octaviaDetails(g, bodyMat);
  lights(g, 0.76, 2.11);
  const wh = wheels(g);
  return { group: g, bodyMat, wheels: wh, spin: 0 };
}

/** Spoločný sync: poloha + natočenie + točenie kolies. */
export function syncMesh(m, x, y, z, h, speed, dt) {
  m.group.position.set(x, y, z);
  m.group.rotation.y = h;
  m.spin += speed * dt * 2.2;
  for (const w of m.wheels) w.rotation.x = m.spin;
}
