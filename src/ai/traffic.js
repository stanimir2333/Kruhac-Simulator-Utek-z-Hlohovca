// src/ai/traffic.js — civilná doprava na trase 513 (kolóna + protismer).
// Umiestnenie cez portované routePose/driveY; nearestRoute = verbatim logika.
import { S } from '../world/shared.js';
import { routePose } from '../world/roads.js';
import { driveY, LANE_OFF } from '../world/height.js';

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

export function createTraffic(n = 16) {
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

/** Rozostav premávku okolo štartu hráča (raz po buildRoute). */
export function placeTraffic(t, playerS, routeLen) {
  t.cars.forEach((c, i) => {
    c.s = ((playerS + 40 + i * 55) % (routeLen - 20) + routeLen) % (routeLen - 20);
    if (c.dir < 0) c.s = ((playerS - 40 - i * 40) % routeLen + routeLen) % routeLen;
    stepCar(c, 0.016, routeLen);
  });
  t.placed = true;
}

function stepCar(c, dt, routeLen) {
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
