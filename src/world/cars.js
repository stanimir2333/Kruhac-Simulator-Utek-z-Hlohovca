// src/world/cars.js — vlastné jednoduché meshe áut (hráč, civilisti, polícia).
// (Legacy instancovanie ALL_CARS/IM je sim-vrstva a neportuje sa; toto stačí na 30 áut.)
import * as THREE from 'three';

const bodyGeo = new THREE.BoxGeometry(1.8, 0.62, 4.1);
const cabinGeo = new THREE.BoxGeometry(1.55, 0.55, 2.0);
const wheelGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.26, 10);
const barGeo = new THREE.BoxGeometry(1.1, 0.16, 0.4);

function std(color, rough = 0.55, metal = 0.3) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}

function wheels(parent) {
  const list = [];
  const mat = std(0x141414, 0.9, 0.1);
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const w = new THREE.Mesh(wheelGeo, mat);
    w.rotation.z = Math.PI / 2;
    w.position.set(sx * 0.82, 0.33, sz * 1.35);
    w.castShadow = true;
    parent.add(w);
    list.push(w);
  }
  return list;
}

export function buildPlayerMesh(color = 0xffb000) {
  const g = new THREE.Group();
  const bodyMat = std(color);
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.66;
  body.castShadow = true;
  const cabin = new THREE.Mesh(cabinGeo, std(0x1a2530, 0.25, 0.6));
  cabin.position.set(0, 1.18, -0.25);
  cabin.castShadow = true;
  g.add(body, cabin);
  const wh = wheels(g);
  return { group: g, bodyMat, wheels: wh, spin: 0 };
}

const CIV_COLORS = [0xc0c4c8, 0x8a8f96, 0x5a6b7a, 0x7a2a22, 0x2a4a7a, 0x3a3f45, 0xb8a888];

export function buildTrafficMesh(color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(bodyGeo, std(color ?? CIV_COLORS[(Math.random() * CIV_COLORS.length) | 0]));
  body.position.y = 0.66;
  body.castShadow = true;
  const cabin = new THREE.Mesh(cabinGeo, std(0x1a2530, 0.25, 0.6));
  cabin.position.set(0, 1.18, -0.25);
  g.add(body, cabin);
  const wh = wheels(g);
  return { group: g, wheels: wh, spin: Math.random() * 6 };
}

export function buildPoliceMesh(kind = 'mestska') {
  const g = new THREE.Group();
  const base = kind === 'pmj' ? 0x1c2f5e : kind === 'statna' ? 0x14335c : 0xe8e8ec;
  const body = new THREE.Mesh(kind === 'pmj' ? new THREE.BoxGeometry(2.0, 1.1, 4.6) : bodyGeo, std(base, 0.5, 0.3));
  body.position.y = kind === 'pmj' ? 0.85 : 0.66;
  body.castShadow = true;
  const cabin = new THREE.Mesh(cabinGeo, std(0x101820, 0.25, 0.6));
  cabin.position.set(0, kind === 'pmj' ? 1.6 : 1.18, -0.25);
  const barMat = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff0000, emissiveIntensity: 2 });
  const bar = new THREE.Mesh(barGeo, barMat);
  bar.position.set(0, kind === 'pmj' ? 1.95 : 1.5, -0.25);
  g.add(body, cabin, bar);
  const wh = wheels(g);
  return { group: g, wheels: wh, barMat, spin: 0, phase: Math.random() * 2 };
}

/** Spoločný sync: poloha + natočenie + točenie kolies. */
export function syncMesh(m, x, y, z, h, speed, dt) {
  m.group.position.set(x, y, z);
  m.group.rotation.y = h;
  m.spin += speed * dt * 2.2;
  for (const w of m.wheels) w.rotation.x = m.spin;
}

/** Majáky: striedavá červená/modrá (lacné — len emissive farba). */
export function flashBars(meshes, t) {
  const phase = (t * 3.5) | 0;
  for (let i = 0; i < meshes.length; i++) {
    const on = (phase + i) % 2 === 0;
    meshes[i].barMat.emissive.setHex(on ? 0xff2020 : 0x2040ff);
  }
}
