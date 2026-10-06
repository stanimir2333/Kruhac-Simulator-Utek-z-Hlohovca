// src/world/vegetation.js + sky.js — zlúčené sem ako krátke stub-y, aby strom modulov ostal plochý.
// Pri migrácii ich rozdeľ do vegetation.js / sky.js.
import * as THREE from 'three';

export function buildVegetation(scene, osm) {
  const group = new THREE.Group();
  group.name = 'veg';
  scene.add(group);
  return group; // TODO: OSM scatter + InstancedMesh (len v init)
}

export function buildSky(scene, engine) {
  // TODO: teplý gradient + slnko na vode (bloom zdroj)
  scene.background = new THREE.Color(0x87a5c8);
}
