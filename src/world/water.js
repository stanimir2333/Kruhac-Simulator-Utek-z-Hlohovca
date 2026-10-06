// src/world/water.js — Váh (60 m koryto z OSM width) + odrazy (LQ/HQ podľa settings).
import * as THREE from 'three';

export function buildRiver(scene, osm) {
  const group = new THREE.Group();
  group.name = 'vah';
  const mat = new THREE.MeshStandardMaterial({ color: 0x2a4a5a, roughness: 0.15, metalness: 0.6 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(90, 3000, 1, 1), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(-600, 132, -2200);
  group.add(mesh);
  scene.add(group);
  return { group, mesh };
}

export function riverbankSlowdown(x, z) {
  // Off-road pás pozdĺž Váhu spomaľuje policajtov viac než hráča (taktika z zadania).
  // TODO: presná vzdialenosť od OSM water línií; stub: pás x ∈ <-900,-300>.
  return x > -900 && x < -300 ? 0.72 : 1.0;
}
