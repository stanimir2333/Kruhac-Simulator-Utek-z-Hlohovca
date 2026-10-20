import * as THREE from 'three';
import { S } from '../world/shared.js';
import { getTerrainHeight } from '../world/height.js';
import { gridQuery, GQ_MAX } from '../world/ground.js';

const PED_COUNT = S.IS_MOBILE ? 20 : 46;
const RELOCATE_D2 = 280 * 280;
const FLEE_RADIUS = 68;
const PED_GQ = new Int32Array(GQ_MAX);

const SHIRTS = [0x2b4c7e, 0x7e2b2b, 0x3f6b3a, 0x6b5b3a, 0x444444, 0x8a6d3b, 0x294f52, 0x6d3f72, 0xb0b0aa];
const PANTS = [0x25324a, 0x1f1f22, 0x3b3328, 0x2f3a2f, 0x4a3a2a, 0x333842];
const SKINS = [0xe6b98f, 0xd6a06f, 0xbd8359, 0x8f5f3f, 0xf1c7a5];
const HAIRS = [0x1b1511, 0x2b1c12, 0x4a3020, 0x6b4b2a, 0x191919];

let seed = 73129;
function rnd() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

function pointOnRoad(R, t, out) {
  if (!R || R.n < 2) return false;
  let s = out.seg | 0;
  if (s < 0) s = 0; else if (s > R.n - 2) s = R.n - 2;
  while (s < R.n - 2 && t > R.cum[s + 1]) s++;
  while (s > 0 && t < R.cum[s]) s--;
  const x0 = R.pts[s * 2], z0 = R.pts[s * 2 + 1];
  const x1 = R.pts[s * 2 + 2], z1 = R.pts[s * 2 + 3];
  let dx = x1 - x0, dz = z1 - z0;
  const len = Math.sqrt(dx * dx + dz * dz) || 1;
  dx /= len; dz /= len;
  const f = Math.max(0, Math.min(1, (t - R.cum[s]) / len));
  out.seg = s;
  out.cx = x0 + dx * len * f;
  out.cz = z0 + dz * len * f;
  out.dx = dx;
  out.dz = dz;
  out.h = Math.atan2(dx, dz);
  return true;
}

function insideBuilding(x, z) {
  const n = gridQuery(S.BGRID, x, z, 1, PED_GQ);
  for (let i = 0; i < n; i++) {
    const b = PED_GQ[i];
    const dx = x - S.BX.x[b], dz = z - S.BX.z[b];
    const c = Math.cos(S.BX.rot[b]), s = Math.sin(S.BX.rot[b]);
    const lf = dx * s + dz * c;
    const lr = -dx * c + dz * s;
    if (Math.abs(lf) < S.BX.hl[b] + 0.35 && Math.abs(lr) < S.BX.hw[b] + 0.35) return true;
  }
  return false;
}

export function createPedestrianSystem(opts = {}) {
  const scene = opts.scene || S.scene;
  const count = opts.count ?? PED_COUNT;
  const peds = [];
  let meshes = null;
  const dummy = new THREE.Object3D();
  dummy.rotation.order = 'YXZ';
  const _col = new THREE.Color();
  const _pt = { seg: 0, cx: 0, cz: 0, dx: 0, dz: 0, h: 0 };
  const _ray = { hit: false, index: -1, dist: 0, x: 0, y: 0, z: 0 };

  const torsoGeo = new THREE.BoxGeometry(0.42, 0.62, 0.24);
  const headGeo = new THREE.BoxGeometry(0.26, 0.28, 0.24);
  const hairGeo = new THREE.BoxGeometry(0.29, 0.09, 0.27);
  const legGeo = new THREE.BoxGeometry(0.16, 0.8, 0.18);
  const armGeo = new THREE.BoxGeometry(0.13, 0.62, 0.14);
  legGeo.translate(0, -0.4, 0);
  armGeo.translate(0, -0.31, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0.02 });

  function buildMeshes() {
    if (!scene) return;
    const torso = new THREE.InstancedMesh(torsoGeo, mat, count);
    const head = new THREE.InstancedMesh(headGeo, mat, count);
    const hair = new THREE.InstancedMesh(hairGeo, mat, count);
    const legs = new THREE.InstancedMesh(legGeo, mat, count * 2);
    const arms = new THREE.InstancedMesh(armGeo, mat, count * 2);
    meshes = { torso, head, hair, legs, arms };
    for (const key in meshes) {
      const m = meshes[key];
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      if (key === 'torso' || key === 'head') m.castShadow = true;
      scene.add(m);
      for (let i = 0; i < m.count; i++) {
        dummy.position.set(0, -999, 0);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(0, 0, 0);
        dummy.updateMatrix();
        m.setMatrixAt(i, dummy.matrix);
      }
      m.instanceMatrix.needsUpdate = true;
    }
  }

  function setColors(i, p) {
    if (!meshes) return;
    _col.setHex(SHIRTS[p.shirt % SHIRTS.length]);
    meshes.torso.setColorAt(i, _col);
    meshes.arms.setColorAt(i * 2, _col);
    meshes.arms.setColorAt(i * 2 + 1, _col);
    _col.setHex(PANTS[p.pants % PANTS.length]);
    meshes.legs.setColorAt(i * 2, _col);
    meshes.legs.setColorAt(i * 2 + 1, _col);
    _col.setHex(SKINS[p.skin % SKINS.length]);
    meshes.head.setColorAt(i, _col);
    _col.setHex(HAIRS[p.hair % HAIRS.length]);
    meshes.hair.setColorAt(i, _col);
  }

  function newPed(i, px, pz) {
    const p = {
      i, x: 0, y: 0, z: 0, h: 0, fx: 0, fz: 1,
      road: -1, t: 0, seg: 0, dir: 1, side: 1, off: 1,
      speed: 0, baseSpeed: 1.05 + rnd() * 0.65,
      gait: rnd() * 6.28, waitT: rnd() * 2.5,
      mode: 'walk', fleeT: 0, hp: 100, downT: 0, hidden: true,
      shirt: (rnd() * 100) | 0, pants: (rnd() * 100) | 0,
      skin: (rnd() * 100) | 0, hair: (rnd() * 100) | 0,
    };
    peds.push(p);
    spawn(p, px, pz, true);
    setColors(i, p);
    return p;
  }

  function spawn(p, px, pz, first) {
    const roads = S.townRoads;
    if (!roads.length) { p.hidden = true; return false; }
    let chosen = -1, tg = 0, sg = 1;
    let best = 1e18, bestRoad = -1, bestT = 0, bestSide = 1;
    const tries = first ? 28 : 18;
    for (let k = 0; k < tries; k++) {
      const ri = (rnd() * roads.length) | 0;
      const R = roads[ri];
      if (!R || R.n < 2 || R.len < 6) continue;
      sg = rnd() < 0.5 ? -1 : 1;
      tg = 0.5 + rnd() * (R.len - 1);
      _pt.seg = 0;
      if (!pointOnRoad(R, tg, _pt)) continue;
      const off = R.hw + 1.0 + rnd() * 1.2;
      const h = _pt.h;
      const x = _pt.cx + (-Math.cos(h)) * off * sg;
      const z = _pt.cz + Math.sin(h) * off * sg;
      const dx = x - px, dz = z - pz;
      const d2 = dx * dx + dz * dz;
      if (first ? d2 > 180 * 180 : d2 > 240 * 240) continue;
      if (insideBuilding(x, z)) continue;
      chosen = ri; p.t = tg; p.dir = rnd() < 0.5 ? -1 : 1;
      break;
    }
    if (chosen < 0) {
      for (let k = 0; k < roads.length; k++) {
        const R = roads[(p.i * 17 + k * 13) % roads.length];
        if (!R || R.n < 2 || R.len < 6) continue;
        const ri = (p.i * 17 + k * 13) % roads.length;
        const t = 0.5 + rnd() * (R.len - 1);
        _pt.seg = 0;
        if (!pointOnRoad(R, t, _pt)) continue;
        const off = R.hw + 1.0 + rnd() * 1.2;
        const h = _pt.h;
        const x = _pt.cx + (-Math.cos(h)) * off * sg;
        const z = _pt.cz + Math.sin(h) * off * sg;
        const dx = x - px, dz = z - pz;
        const d2 = dx * dx + dz * dz;
        if (d2 < best) {
          best = d2; bestRoad = ri; bestT = t; bestSide = sg;
        }
      }
      if (bestRoad < 0) { p.hidden = true; return false; }
      chosen = bestRoad; p.t = bestT; sg = bestSide;
    }
    p.road = chosen;
    p.side = sg;
    p.seg = 0;
    p.mode = 'walk';
    p.fleeT = 0;
    p.hp = 100;
    p.downT = 0;
    p.hidden = false;
    p.off = S.townRoads[chosen].hw + 1.0 + rnd() * 1.2;
    return placePed(p);
  }

  function placePed(p) {
    const R = S.townRoads[p.road];
    if (!R) return false;
    _pt.seg = p.seg;
    if (!pointOnRoad(R, p.t, _pt)) return false;
    p.seg = _pt.seg;
    p.fx = _pt.dx; p.fz = _pt.dz;
    const h = Math.atan2(_pt.dx * p.dir, _pt.dz * p.dir);
    p.h = h;
    p.x = _pt.cx + (-Math.cos(h)) * p.off * p.side;
    p.z = _pt.cz + Math.sin(h) * p.off * p.side;
    p.y = getTerrainHeight(p.x, p.z) + 0.03;
    return true;
  }

  function alert(sx, sz, radius = FLEE_RADIUS) {
    const r2 = radius * radius;
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (p.hidden || p.mode === 'down' || p.mode === 'flee') continue;
      const dx = p.x - sx, dz = p.z - sz;
      if (dx * dx + dz * dz > r2) continue;
      p.mode = 'flee';
      p.fleeT = 4.0 + rnd() * 3.5;
      p.dir = (p.fx * dx + p.fz * dz) >= 0 ? 1 : -1;
    }
  }

  function damage(index, dmg, sx, sz) {
    const p = peds[index];
    if (!p || p.hidden || p.mode === 'down') return false;
    p.hp -= dmg;
    alert(sx ?? p.x, sz ?? p.z, 80);
    if (p.hp <= 0) {
      p.mode = 'down';
      p.fleeT = 0;
      p.downT = 8 + rnd() * 5;
      p.speed = 0;
      return true;
    }
    p.mode = 'flee';
    p.fleeT = Math.max(p.fleeT, 3.5);
    return false;
  }

  function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
    const lx = ox - cx, ly = oy - cy, lz = oz - cz;
    const b = lx * dx + ly * dy + lz * dz;
    const c = lx * lx + ly * ly + lz * lz - r * r;
    const disc = b * b - c;
    if (disc < 0) return -1;
    const sq = Math.sqrt(disc);
    let t = -b - sq;
    if (t < 0) t = -b + sq;
    return t >= 0 ? t : -1;
  }

  function raycast(ox, oy, oz, dx, dy, dz, maxDist, out = _ray) {
    let best = maxDist, bi = -1;
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (p.hidden || p.mode === 'down') continue;
      const t1 = raySphere(ox, oy, oz, dx, dy, dz, p.x, p.y + 0.55, p.z, 0.34);
      if (t1 >= 0 && t1 < best) { best = t1; bi = i; }
      const t2 = raySphere(ox, oy, oz, dx, dy, dz, p.x, p.y + 1.48, p.z, 0.3);
      if (t2 >= 0 && t2 < best) { best = t2; bi = i; }
    }
    out.hit = bi >= 0;
    out.index = bi;
    out.dist = best;
    out.x = ox + dx * best;
    out.y = oy + dy * best;
    out.z = oz + dz * best;
    return out;
  }

  function drawPed(p) {
    if (!meshes) return;
    const i = p.i;
    const down = p.mode === 'down';
    if (p.hidden) { setHidden(i); return; }
    const bob = down ? 0 : Math.abs(Math.sin(p.gait * 2)) * 0.025;
    const bx = p.x, by = p.y + bob, bz = p.z;
    const h = p.h;
    const fx = Math.sin(h), fz = Math.cos(h);
    const rx = Math.cos(h), rz = -Math.sin(h);
    dummy.scale.set(1, 1, 1);
    if (down) {
      dummy.position.set(bx, p.y + 0.2, bz);
      dummy.rotation.set(Math.PI / 2, h, 0);
      dummy.updateMatrix();
      meshes.torso.setMatrixAt(i, dummy.matrix);
      dummy.position.set(bx + fx * 0.52, p.y + 0.21, bz + fz * 0.52);
      dummy.updateMatrix();
      meshes.head.setMatrixAt(i, dummy.matrix);
      dummy.scale.set(0, 0, 0);
      dummy.updateMatrix();
      meshes.hair.setMatrixAt(i, dummy.matrix);
      meshes.legs.setMatrixAt(i * 2, dummy.matrix);
      meshes.legs.setMatrixAt(i * 2 + 1, dummy.matrix);
      meshes.arms.setMatrixAt(i * 2, dummy.matrix);
      meshes.arms.setMatrixAt(i * 2 + 1, dummy.matrix);
      return;
    }
    dummy.position.set(bx, by + 1.18, bz);
    dummy.rotation.set(0, h, 0);
    dummy.updateMatrix();
    meshes.torso.setMatrixAt(i, dummy.matrix);
    dummy.position.set(bx, by + 1.66, bz);
    dummy.updateMatrix();
    meshes.head.setMatrixAt(i, dummy.matrix);
    dummy.position.set(bx, by + 1.845, bz);
    dummy.updateMatrix();
    meshes.hair.setMatrixAt(i, dummy.matrix);
    const swing = Math.sin(p.gait) * (p.mode === 'flee' ? 0.8 : 0.55);
    for (let k = 0; k < 2; k++) {
      const s = k === 0 ? -1 : 1;
      const legSwing = k === 0 ? swing : -swing;
      dummy.position.set(bx + rx * s * 0.105, by + 0.88, bz + rz * s * 0.105);
      dummy.rotation.set(legSwing, h, 0);
      dummy.updateMatrix();
      meshes.legs.setMatrixAt(i * 2 + k, dummy.matrix);
      dummy.position.set(bx + rx * s * 0.275, by + 1.4, bz + rz * s * 0.275);
      dummy.rotation.set(-legSwing * 0.7, h, 0);
      dummy.updateMatrix();
      meshes.arms.setMatrixAt(i * 2 + k, dummy.matrix);
    }
  }

  function setHidden(i) {
    dummy.position.set(0, -999, 0);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(0, 0, 0);
    dummy.updateMatrix();
    meshes.torso.setMatrixAt(i, dummy.matrix);
    meshes.head.setMatrixAt(i, dummy.matrix);
    meshes.hair.setMatrixAt(i, dummy.matrix);
    meshes.legs.setMatrixAt(i * 2, dummy.matrix);
    meshes.legs.setMatrixAt(i * 2 + 1, dummy.matrix);
    meshes.arms.setMatrixAt(i * 2, dummy.matrix);
    meshes.arms.setMatrixAt(i * 2 + 1, dummy.matrix);
  }

  function update(dt, px, pz) {
    if (!meshes) return;
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      const ddx = p.x - px, ddz = p.z - pz;
      const d2 = ddx * ddx + ddz * ddz;
      if (p.mode === 'down') {
        p.downT -= dt;
        if (p.downT <= 0) spawn(p, px, pz, false);
        drawPed(p);
        continue;
      }
      if (p.hidden || d2 > RELOCATE_D2) {
        spawn(p, px, pz, false);
        drawPed(p);
        continue;
      }
      p.waitT -= dt;
      if (p.mode === 'flee') {
        p.fleeT -= dt;
        p.speed = 4.4;
        if (p.fleeT <= 0) p.mode = 'walk';
      } else {
        p.speed = p.waitT > 0 ? 0 : p.baseSpeed;
        if (p.waitT <= 0 && rnd() < dt * 0.018) p.waitT = 1.2 + rnd() * 2.4;
      }
      if (p.speed > 0) {
        p.t += p.dir * p.speed * dt;
        const R = S.townRoads[p.road];
        if (p.t < 0.5) { p.t = 0.5; p.dir = 1; }
        else if (p.t > R.len - 0.5) { p.t = R.len - 0.5; p.dir = -1; }
        p.gait += p.speed * dt * (p.mode === 'flee' ? 3.1 : 2.7);
        placePed(p);
      }
      drawPed(p);
    }
    meshes.torso.instanceMatrix.needsUpdate = true;
    meshes.head.instanceMatrix.needsUpdate = true;
    meshes.hair.instanceMatrix.needsUpdate = true;
    meshes.legs.instanceMatrix.needsUpdate = true;
    meshes.arms.instanceMatrix.needsUpdate = true;
  }

  buildMeshes();
  const sx = Number.isFinite(opts.startX) ? opts.startX : 0;
  const sz = Number.isFinite(opts.startZ) ? opts.startZ : 0;
  for (let i = 0; i < count; i++) newPed(i, sx, sz);
  if (meshes) {
    meshes.torso.instanceColor.needsUpdate = true;
    meshes.head.instanceColor.needsUpdate = true;
    meshes.hair.instanceColor.needsUpdate = true;
    meshes.legs.instanceColor.needsUpdate = true;
    meshes.arms.instanceColor.needsUpdate = true;
  }
  update(0.016, sx, sz);

  return { update, raycast, alert, damage, peds, count };
}
