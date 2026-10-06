// src/physics/vehicle.js — arkádová fyzika (6-stupňová prevodovka, 250 km/h limitér,
// OBB SAT kolízie, odpruženie). Port z monolitu, API nezmenené.
export function createVehicle(opts = {}) {
  return {
    x: opts.x ?? 0, y: opts.y ?? 0, z: opts.z ?? 0, h: 0,
    vx: 0, vz: 0, speed: 0, gear: 1, rpm: 900,
    steer: 0, temp: 0.2, stress: 0,
    vmax: 250 / 3.6, // m/s
  };
}

export function gearRatio(gear) {
  return [0, 3.4, 2.4, 1.8, 1.35, 1.05, 0.85][gear] ?? 1;
}

/** Krok fyziky — volá sa z main loopu s pevným dt (clamp 0.1). Vracia telemetriu pre HUD/police. */
export function updateVehicle(v, input, dt, terrainY) {
  const th = input.throttle(), br = input.brake(), steer = input.axis();
  const hand = input.handbrake();
  // pozdĺžna dynamika (zjednodušený krútiak × prevod, odpor + limitér)
  const accel = th * 9.5 * gearRatio(v.gear) * 0.55 - br * 14 - v.speed * 0.28;
  v.speed = Math.max(-12, Math.min(v.vmax, v.speed + accel * dt));
  if (hand) v.speed *= 1 - Math.min(1, 3 * dt);
  // radenie 1–6
  const kmh = Math.abs(v.speed) * 3.6;
  v.gear = kmh < 30 ? 1 : kmh < 60 ? 2 : kmh < 95 ? 3 : kmh < 135 ? 4 : kmh < 185 ? 5 : 6;
  v.rpm = 900 + (kmh % 42) / 42 * 7100;
  // riadenie (rýchlostne tlmené) + drift pre police-heat (triggers)
  v.steer += (steer - v.steer) * Math.min(1, 8 * dt);
  const grip = hand ? 0.35 : 1;
  v.h += v.steer * Math.min(1, Math.abs(v.speed) / 12) * 2.4 * dt * grip;
  v.x += Math.sin(v.h) * v.speed * dt;
  v.z += Math.cos(v.h) * v.speed * dt;
  v.y = terrainY;
  // drift skóre vstup: |steer| × speed pri ručnej
  const drifting = hand && Math.abs(v.speed) > 8 && Math.abs(v.steer) > 0.4;
  // teplota: státie varí, plynulá jazda chladí (z monolitu)
  v.temp += ((Math.abs(v.speed) < 1 ? 0.03 : -0.012) + Math.abs(accel) * 0.0012) * dt;
  v.temp = Math.max(0, Math.min(1, v.temp));
  return { kmh, drifting, accel };
}

/** Lacný 2D OBB test (SAT) hráč vs. auto — bez alokácií. */
export function overlapOBB(ax, az, ah, aw, al, bx, bz, bh, bw, bl) {
  // TODO(migrácia): skopíruj exact `overlapPlayerCar` z monolitu (overené, nulové alokácie)
  const dx = bx - ax, dz = bz - az;
  return dx * dx + dz * dz < (aw + bw) * (aw + bw);
}
