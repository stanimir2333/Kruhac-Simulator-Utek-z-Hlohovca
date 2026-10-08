// src/world/cars.js — jednoduché meš hráča (src/ai/traffic.js instancuje civilistov).
// (buildTrafficMesh/buildPoliceMesh/flashBars odstránené: nikto ich nevolal;
//  civilisti idú cez InstancedMesh v traffic.js, polícia je mŕtva.)
import * as THREE from 'three';

const bodyGeo = new THREE.BoxGeometry(1.8, 0.62, 4.1);
const cabinGeo = new THREE.BoxGeometry(1.55, 0.55, 2.0);
const wheelGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.26, 10);
const headGeo = new THREE.BoxGeometry(0.34, 0.2, 0.1);
const tailGeo = new THREE.BoxGeometry(0.3, 0.16, 0.1);
// Emisívne svetlá: HDR jas (intensity > 1) → chytí ich prahový bloom. Predok = +z.
const headMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffffff, emissiveIntensity: 3.2 });
const tailMat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff1a1a, emissiveIntensity: 1.8 });

function lights(parent, y, frontZ) {
  for (const sx of [-1, 1]) {
    const h = new THREE.Mesh(headGeo, headMat);
    h.position.set(sx * 0.55, y, frontZ);
    parent.add(h);
    const t = new THREE.Mesh(tailGeo, tailMat);
    t.position.set(sx * 0.55, y + 0.04, -frontZ);
    parent.add(t);
  }
}

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
  lights(g, 0.62, 2.06);
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
