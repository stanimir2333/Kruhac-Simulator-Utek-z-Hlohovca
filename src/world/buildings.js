// src/world/buildings.js — OSM obvody → InstancedMesh (1 draw-call na typ).
import * as THREE from 'three';

export function buildBuildings(scene, osm) {
  // TODO(migrácia): presuň sem `buildBuildings + flattenBuildings + buildChurchTower`
  // Vstupný formát blds: [x, z, w, name, kind, ...poly] — 2600 záznamov, 410 kB.
  const group = new THREE.Group();
  group.name = 'buildings';
  const n = (osm.blds || []).length;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshStandardMaterial({ color: 0xc9bfae, roughness: 0.9 });
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(n, 1));
  const m = new THREE.Matrix4();
  (osm.blds || []).slice(0, 5000).forEach((b, i) => {
    const [x, z, w] = b;
    m.makeScale(w || 8, 6, w || 8);
    m.setPosition(x, 3, z);
    mesh.setMatrixAt(i, m);
  });
  mesh.count = n;
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
  scene.add(group);
  return group;
}
