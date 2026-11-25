// src/world/decals.js — tire marks + crosswalks (GTA SA: opotrebovaný asfalt, crosstisky)
//
// Tire marks: inštancované biele krabice (road/tiremark.png) v križniciach, kde
// trasa prechádza cez cesty — miesta, kde sa doprava zastaví a buduje opotrebovanie.
// Crosswalks: inštancované biele štrajky (road/crosswalk.png) v rovnakých miestach —
// na najazdených komunálnych križniciach.
//
// Miestnik: používam len rutnú trasu (S.routeX/Z) — má dáta samotná; koryto (S.osm.water)
// a cesta sa v ňu nezapočítajú (crosstisky po asfaltu aj tam, kde ho vidiť).
import * as THREE from 'three';
import { S } from './shared.js';
import { getTerrainHeight } from './height.js';

// ---------- WAY GRID (mriežka bodov ciest — pre "cesta pri hotelskej ulice") ----------
// Vlastný grid celiest + nespevných ciest; cesta (hlavná trasa) sa NEzapočíta —
// križnice s ňou sú "iné cesty".
const WAY_CS = 10;
function wayGrid(){
  const m = new Map();
  const push = (x, z) => {
    const k = ((Math.floor(x/WAY_CS)+50000)*100000) + (Math.floor(z/WAY_CS)+50000);
    let a = m.get(k);
    if(!a){ a = []; m.set(k, a); }
    a.push(x, z);
  };
  const ways = S.osm.roads.concat(S.osm.dirt || []);
  for(const L of ways){
    const n = (L.length-1)/2;
    if(n < 2) continue;
    for(let i=0;i<n;i++){
      const ax=L[1+i*2], az=L[1+i*2+1], bx=L[1+(i+1)*2], bz=L[1+(i+1)*2+1];
      const seg = Math.hypot(bx-ax, bz-az) || 1;
      const steps = Math.max(1, Math.ceil(seg/4));
      for(let k=0;k<=steps;k++) push(ax+(bx-ax)*k/steps, az+(bz-az)*k/steps);
    }
  }
  return m;
}
function wayNear(map, x, z, r2){
  const gx = Math.floor(x/WAY_CS), gz = Math.floor(z/WAY_CS);
  for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++){
    const a = map.get(((gx+dx)+50000)*100000 + ((gz+dy)+50000));
    if(!a) continue;
    for(let i=0;i<a.length;i+=2){
      const dx2 = a[i]-x, dz2 = a[i+1]-z;
      if(dx2*dx2+dz2*dz2 < r2) return true;
    }
  }
  return false;
}

// Konvencia buildStrip(): h = atan2(dx, dz) — jednotkový krok cesty = (cos h, sin h).
function hDir(dx, dz){ return Math.atan2(dx, dz); }

// ---------- TIRE MARKS ----------
export function buildTireMarks(){
  const map = wayGrid();
  const busy = [];
  const push = (x, z, h) => {
    for(const p of busy) if((p.x-x)*(p.x-x) + (p.z-z)*(p.z-z) < 16) return; // min. 2 m od seba
    busy.push({ x, z, h });
  };
  // 1) križnice: miesta, kde trasa prechádza cez cesty
  for(let i=4;i<=S.ROUTE_N;i+=4){
    const x = S.routeX[i], z = S.routeZ[i];
    if(!wayNear(map, x, z, 100)) continue;
    const dx = i >= 8 ? S.routeX[i]-S.routeX[i-8] : 1;
    const dz = i >= 8 ? S.routeZ[i]-S.routeZ[i-8] : 1;
    push(x, z, hDir(dx, dz));
  }
  // 2) okolo kruháčov (GTA SA: štuka okolo najazdených kruháčov)
  const rbs = S.osm.roundabouts || [];
  for(const r of rbs){
    const R = r[2] || 8;
    for(let a=0;a<24;a++){
      const t = a/24*2*Math.PI;
      const x = r[0]+Math.cos(t)*(R+2.2), z = r[1]+Math.sin(t)*(R+2.2);
      push(x, z, t);
    }
  }
  if(!busy.length) return 0;
  // 3) inštancovaný mesh: PlaneGeometry(3.6 x 1.1), rotovaný po smere cesty
  const g = new THREE.PlaneGeometry(3.6, 1.1);
  g.rotateX(-Math.PI/2);
  const m = new THREE.InstancedMesh(g, S.MAT.tireMark, busy.length);
  m.castShadow = false; m.receiveShadow = false;
  const Q = new THREE.Quaternion(), E = new THREE.Euler(), P = new THREE.Vector3(), Sc = new THREE.Vector3(), M = new THREE.Matrix4();
  for(let i=0;i<busy.length;i++){
    const b = busy[i];
    E.set(0, -b.h, 0); Q.setFromEuler(E);
    P.set(b.x, getTerrainHeight(b.x, b.z) + 0.18, b.z);
    Sc.set(1, 1, 1);
    M.compose(P, Q, Sc);
    m.setMatrixAt(i, M);
  }
  m.instanceMatrix.needsUpdate = true;
  S.scene.add(m);
  console.log('tire marks: ' + busy.length);
  return busy.length;
}

// ---------- CROSSWALKS ----------
export function buildCrosswalks(){
  const map = wayGrid();
  const spots = [];
  const push = (x, z, h) => {
    for(const p of spots) if((p.x-x)*(p.x-x) + (p.z-z)*(p.z-z) < 25) return; // min. 5 m od seba
    spots.push({ x, z, h });
  };
  for(let i=4;i<=S.ROUTE_N;i+=4){
    const x = S.routeX[i], z = S.routeZ[i];
    if(!wayNear(map, x, z, 100)) continue;
    const dx = i >= 8 ? S.routeX[i]-S.routeX[i-8] : 1;
    const dz = i >= 8 ? S.routeZ[i]-S.routeZ[i-8] : 1;
    push(x, z, hDir(dx, dz));
  }
  const rbs = S.osm.roundabouts || [];
  for(const r of rbs){
    const R = r[2] || 8;
    for(let a=0;a<24;a+=3){
      const t = a/24*2*Math.PI;
      const x = r[0]+Math.cos(t)*(R+2.2), z = r[1]+Math.sin(t)*(R+2.2);
      push(x, z, t);
    }
  }
  if(!spots.length) return 0;
  // PlaneGeometry(8.5 x 6): dlhé po ceste, široké na ulice; rotované po smere cesty.
  const g = new THREE.PlaneGeometry(8.5, 6.0);
  g.rotateX(-Math.PI/2);
  const m = new THREE.InstancedMesh(g, S.MAT.crosswalk, spots.length);
  m.castShadow = false; m.receiveShadow = false;
  const Q = new THREE.Quaternion(), E = new THREE.Euler(), P = new THREE.Vector3(), Sc = new THREE.Vector3(), M = new THREE.Matrix4();
  for(let i=0;i<spots.length;i++){
    const b = spots[i];
    E.set(0, -b.h, 0); Q.setFromEuler(E);
    P.set(b.x, getTerrainHeight(b.x, b.z) + 0.22, b.z);
    Sc.set(1, 1, 1);
    M.compose(P, Q, Sc);
    m.setMatrixAt(i, M);
  }
  m.instanceMatrix.needsUpdate = true;
  S.scene.add(m);
  console.log('crosstisky: ' + spots.length);
  return spots.length;
}
