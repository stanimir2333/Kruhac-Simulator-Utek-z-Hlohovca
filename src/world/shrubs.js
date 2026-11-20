// src/world/shrubs.js — zelená vedľa ciest (GTA SA: malé zahradky v meste)
//
// Záhonky (alfa karta veg/shrubs.png — trstiny + kvetináče, štýl GTA SA):
//   a) vedľa hlavnej trasy (S.routeX/Z): každých ~35 m po oboch stranách cesty
//   b) vedľa mestských ciest (S.osm.roads + S.osm.dirt): samostatne po základe cesty,
//      posadila po chodníku (offset po hraničnom páse cesty; poháňania konvenciu
//      buildStrip: nx = -cos(h), nz = sin(h)).
// Celý svet: jeden InstancedMesh — jeden draw call; rôzne odtiene zelenej — trstiny a kvetináče.
import * as THREE from 'three';
import { S } from './shared.js';
import { getTerrainHeight } from './height.js';
import { roadDist2 } from './roads.js';
import { vegInBld, vegWet } from './nature.js';

let mesh = null;
let n = 0;
const GREEN = [0x5da24a, 0x4a8f3f, 0x3f7a3f, 0x2d5022, 0x5a8c3a, 0x3a6832];
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();

// kontrola miesta: povolené, keď nie je v budove, nie je na brehu koryta/vody,
// nie je v kruháči a nie je vo vode
function ok(x, z){
  if (vegInBld(x, z)) return false;
  if (vegWet(x, z, 4)) return false;
  if (getTerrainHeight(x, z) < 0.2) return false;
  const rbs = S.osm.rounds;
  for (let i = 0; i < rbs.length; i++){
    const dx = x - rbs[i][0], dz = z - rbs[i][1], lim = rbs[i][2] + 3;
    if (dx*dx + dz*dz < lim*lim) return false;
  }
  return true;
}

export function buildShrubs(){
  if (mesh) return n;
  const g = new THREE.PlaneGeometry(0.85, 0.85);
  g.translate(0, -0.42, 0);   // päta záhonku sedí na teréne (sprite je centrový)
  const mat = S.MAT.shrubs;

  const inst = [];
  const push = (x, z, h, ry, sc) => {
    for (let i = 0; i < inst.length; i++){
      const p = inst[i];
      if ((p[0]-x)*(p[0]-x) + (p[2]-z)*(p[2]-z) < 3.24) return;   // min. 1.8 m od seba
    }
    inst.push([x, z, h, ry, sc]);
  };

  // 1) vedľa hlavnej trasy — každých ~35 m, po stranách cesty
  for (let i = 4; i <= S.ROUTE_N; i += 8){
    const x = S.routeX[i], z = S.routeZ[i];
    if (!ok(x, z)) continue;
    if (roadDist2(x, z) > 100) continue;       // len na krajnici trasy
    const dx = i >= 8 ? S.routeX[i]-S.routeX[i-8] : 0;
    const dz = i >= 8 ? S.routeZ[i]-S.routeZ[i-8] : 0;
    const h = Math.atan2(dx, dz);
    const nx = -Math.cos(h), nz = Math.sin(h);
    for (let k = 0; k < 6; k++){
      const xw = x + nx*(5.5 + Math.random()*1.5);
      const zw = z + nz*(5.5 + Math.random()*1.5);
      if (!ok(xw, zw)) continue;
      push(xw, zw, h, Math.random()*6.2832, 0.85 + Math.random()*0.5);
    }
  }

  // 2) vedľa mestských ciest — samostatne, posadil po chodníku
  for (const L of S.osm.roads.concat(S.osm.dirt || [])){
    const npts = (L.length-1)/2;
    if (npts < 2) continue;
    for (let i = 0; i < npts; i++){
      const ax = L[1+i*2], az = L[1+i*2+1], bx = L[1+(i+1)*2], bz = L[1+(i+1)*2+1];
      const seg = Math.hypot(bx-ax, bz-az);
      const steps = Math.max(1, Math.ceil(seg/6));
      for (let k = 0; k <= steps; k++){
        const t = k/steps;
        const x = ax+(bx-ax)*t, z = az+(bz-az)*t;
        if (roadDist2(x, z) > 64) continue;    // len na okraji cesty (chodník)
        const h = Math.atan2(bx-ax, bz-az);
        const nx = -Math.cos(h), nz = Math.sin(h);
        const off = L[0] + 2.4 + Math.random()*0.6;
        const xw = x + nx*off, zw = z + nz*off;
        if (!ok(xw, zw)) continue;
        push(xw, zw, h, Math.random()*6.2832, 0.85 + Math.random()*0.5);
      }
    }
  }

  if (!inst.length) return 0;
  n = inst.length;
  mesh = new THREE.InstancedMesh(g, mat, n);
  mesh.castShadow = true;      // aj záhonky strienia (spoločné s vegetáciou)
  mesh.receiveShadow = true;
  for (let i = 0; i < n; i++){
    const b = inst[i];
    _e.set(0, b[3], 0); _q.setFromEuler(_e);
    _p.set(b[0], getTerrainHeight(b[0], b[2])+0.05, b[2]);
    _s.set(b[4], b[4], b[4]);
    _m.compose(_p, _q, _s);
    mesh.setMatrixAt(i, _m);
    _c.setHex(GREEN[i % GREEN.length]); mesh.setColorAt(i, _c);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  S.scene.add(mesh);
  console.log('zahradky: ' + n + ' záhonok');
  return n;
}
