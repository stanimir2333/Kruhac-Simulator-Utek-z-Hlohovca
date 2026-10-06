// src/world/roads.js — stavba vozoviek z OSM vektorov (prevzorkovanie po 10 m + vyhladenie).
import * as THREE from 'three';

export function buildRoads(scene, osm, materials) {
  // TODO(migrácia): presuň sem `buildRoads + buildTownRoads + buildRoute + buildRoundabouts`
  // z index.monolith.legacy.html. API ostáva rovnaké, len `OSM_DATA` → parameter `osm`.
  const group = new THREE.Group();
  group.name = 'roads';
  // Stub: vytiahni aspoň hlavnú trasu 513, aby auto malo kde stáť
  const route = osm.route || [];
  if (route.length >= 4) {
    const pts = [];
    for (let i = 0; i < route.length; i += 2) pts.push(new THREE.Vector3(route[i], 0, route[i + 1]));
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    group.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffb000 })));
  }
  scene.add(group);
  return { group, townRoads: [], routeLen: osm.length || 4530.5 };
}

export function streetAt(osm, s) {
  for (const [a, b, name] of osm.streets || []) if (s >= a && s < b) return name;
  return 'CESTA 513';
}
