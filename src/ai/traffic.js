// src/ai/traffic.js — civilná doprava na trase 513 (kolóna + protismer).
// Umiestnenie cez portované routePose/driveY; nearestRoute = verbatim logika.
import { S } from '../world/shared.js';
import { routePose } from '../world/roads.js';
import { driveY, LANE_OFF, getTerrainHeight } from '../world/height.js';

const _nrp = { x: 0, z: 0, h: 0, d: 0 };

/** Najbližší bod trasy k pozícii (hrubé + jemné hľadanie, bez alokácií). */
export function nearestRoute(x, z) {
  let best = 0, bd = 1e18;
  const N = S.ROUTE_N;
  for (let i = 0; i <= N; i += 4) {
    const dx = S.routeX[i] - x, dz = S.routeZ[i] - z, d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  for (let i = Math.max(0, best - 4); i <= Math.min(N, best + 4); i++) {
    const dx = S.routeX[i] - x, dz = S.routeZ[i] - z, d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  _nrp.x = S.routeX[best]; _nrp.z = S.routeZ[best]; _nrp.h = S.routeH[best];
  _nrp.d = Math.sqrt(bd);
  _nrp.s = (best / N) * S.routeLen;
  return _nrp;
}

const _v = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
const _h = { v: 0 };

export function createTraffic(n = 26) {
  const cars = [];
  for (let i = 0; i < n; i++) {
    const oncoming = i >= Math.ceil(n * 0.6);
    cars.push({
      s: 0, lane: oncoming ? -LANE_OFF : LANE_OFF, dir: oncoming ? -1 : 1,
      speed: 0, vmax: 7 + Math.random() * 5,
      x: 0, y: 0, z: 0, h: 0, d2: 1e9,
    });
  }
  return { cars, placed: false };
}

/** Hustá kolóna od štartu: rovnaký smer tesne okolo hráča (−120…+450 m),
 *  protismer oproti. Pocit rannej špičky hneď od prvej sekundy. */
export function placeTraffic(t, playerS, routeLen) {
  let fwd = 0, back = 0;
  t.cars.forEach((c) => {
    if (c.dir > 0) {
      // 2 vpredu v tesnom rozostupe, 1 za hráčom (kolóna za chrbtom)
      if (fwd % 3 !== 2) { c.s = playerS + 25 + fwd * 22 + Math.random() * 8; fwd++; }
      else { c.s = playerS - 30 - back * 26 - Math.random() * 8; back++; fwd++; }
      c.s = ((c.s % (routeLen - 20)) + routeLen - 20) % (routeLen - 20);
    } else {
      c.s = ((playerS + 60 + back * 45 + Math.random() * 20) % routeLen + routeLen) % routeLen;
      back++;
    }
    c.speed = c.vmax * (0.3 + Math.random() * 0.4); // kolóna sa plíži, nie stojí
    stepCar(c, 0.016, routeLen);
  });
  // Zaparkované autá na vedľajších cestách blízko štartu (verbatim logika
  // ambientPlace z monolitu; suspenzia sa preskakuje — stoja).
  routePose(playerS, _v, _h, 0);
  const sx = _v.x, sz = _v.z;
  let parked = 0;
  for (let ri = 0; ri < S.townRoads.length && parked < 10; ri++) {
    const R = S.townRoads[ri];
    if (!R || !R.pts || !R.n) continue;
    const mx = (R.pts[0] + R.pts[R.n * 2 - 2]) / 2, mz = (R.pts[1] + R.pts[R.n * 2 - 1]) / 2;
    const dx = mx - sx, dz = mz - sz;
    if (dx * dx + dz * dz > 250000) continue; // len do 500 m od štartu
    const c = {
      parked: true, road: ri, t: R.len * (0.25 + 0.5 * Math.random()), seg: 0,
      dir: Math.random() < 0.5 ? 1 : -1, speed: 0, vmax: 0,
      x: 0, y: 0, z: 0, h: 0, d2: 1e9,
    };
    ambientPlace(c, ri, c.t);
    t.cars.push(c);
    parked++;
  }
  t.placed = true;
}

// Umiestnenie na vedľajšej ceste (verbatim monolit, bez updateSuspension).
export function ambientPlace(c, ri, t) {
  const R = S.townRoads[ri];
  if (!R) return;
  if (t < 0) t = 0; else if (t > R.len) t = R.len;
  let s = c.seg || 0;
  if (s < 0) s = 0; else if (s > R.n - 2) s = R.n - 2;
  while (s < R.n - 2 && t > R.cum[s + 1]) s++;
  while (s > 0 && t < R.cum[s]) s--;
  c.seg = s;
  const x0 = R.pts[s * 2], z0 = R.pts[s * 2 + 1];
  const x1 = R.pts[s * 2 + 2], z1 = R.pts[s * 2 + 3];
  let dx = x1 - x0, dz = z1 - z0;
  const L = Math.sqrt(dx * dx + dz * dz) || 1; dx /= L; dz /= L;
  const f = (t - R.cum[s]) / L;
  const h = Math.atan2(dx * c.dir, dz * c.dir);
  c.x = x0 + dx * f + (-Math.cos(h)) * LANE_OFF;
  c.z = z0 + dz * f + (Math.sin(h)) * LANE_OFF;
  c.h = h;
  c.t = t;
  c.y = getTerrainHeight(c.x, c.z);
}

function stepCar(c, dt, routeLen) {
  if (c.parked) return; // zaparkované: stojí, len sa meria d2 a kreslí
  c.speed += ((c.dir > 0 ? c.vmax : c.vmax * 0.9) - c.speed) * Math.min(1, 1.2 * dt);
  c.s += c.dir * c.speed * dt;
  if (c.s >= routeLen) c.s -= routeLen;
  if (c.s < 0) c.s += routeLen;
  routePose(c.s, _v, _h, c.lane * c.dir);
  c.x = _v.x; c.z = _v.z; c.h = _h.v + (c.dir < 0 ? Math.PI : 0);
  c.y = driveY(c.x, c.z, c.s, c.lane * c.dir);
}

export function updateTraffic(t, dt, player, playerS, routeLen) {
  let maxS = playerS;
  for (const c of t.cars) {
    if (c.dir > 0 && c.s > maxS && c.s - playerS < 500) maxS = c.s;
    const dx = c.x - player.x, dz = c.z - player.z;
    c.d2 = dx * dx + dz * dz;
    if (c.d2 > 160000) continue; // >400 m: zmrazené
    stepCar(c, dt, routeLen);
    // recyklácia: hlboko za hráčom → dopredu (bezpečne mimo dohľad)
    if (c.dir > 0 && c.s < playerS - 100) { c.s = maxS + 25 + Math.random() * 30; stepCar(c, 0.016, routeLen); maxS = c.s; }
    if (c.dir < 0 && (c.s > playerS + 350 || c.s < playerS - 350)) {
      c.s = playerS + 250 + Math.random() * 100; stepCar(c, 0.016, routeLen);
    }
  }
}
