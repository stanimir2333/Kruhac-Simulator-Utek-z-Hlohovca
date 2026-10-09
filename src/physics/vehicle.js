// src/physics/vehicle.js — arkádová fyzika (6-stupňová prevodovka, 250 km/h limitér,
// OBB SAT kolízie, odpruženie) + kolízie s OSM budovami (exactBldAt, verbatim logika).
import { S } from '../world/shared.js';
import { gridQuery, GQ_MAX } from '../world/ground.js';

// ---------- FYZIKA HRÁČA: LADITEĽNÉ KONŠTANTY ----------
export const KMH_PER_MPS = 3.6;
const CAR_MAX_KMH = 250;
export const CAR_MAX_MPS = CAR_MAX_KMH / KMH_PER_MPS;
export const IDLE_RPM = 900;
export const RPM_RANGE = 7100;
const EMPTY_FUEL_MAX_KMH = 50;
const MIN_REVERSE_SPEED_MPS = -12;
const BRAKE_DECEL_MPS2 = 16;
const ROLLING_DRAG = 0.004;
const HANDBRAKE_DECEL = 3;
const GEAR_SHIFT_KMH = [30, 60, 95, 135, 185];
const RPM_CYCLE_KMH = 42;
const FUEL_IDLE_PER_SEC = 0.0002;
const FUEL_THROTTLE_PER_SEC = 0.0009;
const STEERING_RESPONSE = 8;
const HANDBRAKE_GRIP = 0.35;
const UNDERSTEER_SPEED_MPS = 22;
const MIN_TURN_SPEED_MPS = 0.3;
const YAW_STEER_GAIN = 1.55;
const YAW_RAMP_SPEED_MPS = 5;
const YAW_RAMP_FLOOR = 0.25;
const HIGH_SPEED_YAW_THRESHOLD_MPS = 41.7;
const HIGH_SPEED_YAW_DECAY_MPS = 28;
const HIGH_SPEED_YAW_BASE_RAD_S = 0.35;
const MIN_HIGH_SPEED_YAW_RAD_S = 0.12;
const HANDBRAKE_YAW_GAIN = 1.35;
const YAW_RATE_RESPONSE = 6;
const DRIFT_MIN_SPEED_MPS = 8;
const DRIFT_MIN_STEER = 0.4;
const STATIONARY_HEAT_PER_SEC = 0.03;
const CRUISING_COOL_PER_SEC = -0.012;
const ACCEL_HEAT_RATE = 0.0006;

const COLLISION_AXIS_EPSILON = 1e-9;
const COLLISION_PUSHOUT_SLOP_M = 0.02;
const COLLISION_SCAN_RADIUS_M = 60;
const COLLISION_SCAN_RADIUS2 = COLLISION_SCAN_RADIUS_M * COLLISION_SCAN_RADIUS_M;
const COLLISION_SOLVER_PASSES = 2;
const HARD_IMPACT_THRESHOLD = 1.2;
const SOFT_IMPACT_THRESHOLD = 0.15;
const HARD_IMPACT_REBOUND = -0.22;
const SOFT_IMPACT_SPEED_RETAIN = 0.82;

export function createVehicle(opts = {}) {
  return {
    x: opts.x ?? 0, y: opts.y ?? 0, z: opts.z ?? 0, h: 0,
    vx: 0, vz: 0, speed: 0, gear: 1, rpm: IDLE_RPM,
    steer: 0, yawRate: 0, temp: 0.2, stress: 0,
    fuel: 1, trip: 0, odo: 0, oilT: 0, // palivo 0–1, trip/odo v metroch, olejka-timer
    vmax: CAR_MAX_MPS, // m/s
  };
}

// (gearRatio odstránená: tabuľka pomerov sa nepoužívala — GEAR_VMAX/GEAR_ACC
//  v updateVehicle definujú strop a Ťah priamo pre 6 kvaltov.)

// Strop rýchlosti a záťah po kvaltoch (m/s, m/s²) — šestka dá plných 250 km/h.
const GEAR_VMAX = [0, 15, 25, 38, 52, 63, 72];
const GEAR_ACC = [0, 17, 13, 10, 8, 7, 7];
const GEAR_COUNT = GEAR_VMAX.length - 1;

// Telemetria pre HUD/misie. Modulový scratch, NIE nový objekt: updateVehicle
// beží každý snímok a `return {…}` by hodil na smetisko ~6 objektov/s (pri 150 FPS
// FPS-capu). Prepisuje sa, volatelia NESMIU si výsledok podržať cez snímok —
// jediný caller je main.js, ktorý ho hneď spotrebuje.
const TEL = { kmh: 0, drifting: false, accel: 0 };

/** Krok fyziky — volá sa z main loopu s pevným dt (clamp 0.1). Vracia telemetriu pre HUD/police. */
export function updateVehicle(v, input, dt, terrainY) {
  const th = input.throttle(), br = input.brake(), steer = input.axis();
  const hand = input.handbrake();
  // Ťah na kolesách s prevodovým stropom: každý kvalt má vlastné vmax,
  // sila lineárne vädne k nemu (plný plyn na šestke = 250 km/h limiter).
  const g = Math.max(1, Math.min(GEAR_COUNT, v.gear | 0));
  const vg = GEAR_VMAX[g];
  const drive = th * GEAR_ACC[g] * Math.max(0, 1 - Math.max(0, v.speed) / vg);
  const accel = drive - br * BRAKE_DECEL_MPS2 - v.speed * ROLLING_DRAG;
  // prázdna nádrž = núdzový režim do 50 km/h (palivo dotankuje R / FIXCAR)
  const vmaxEff = v.fuel <= 0 ? EMPTY_FUEL_MAX_KMH / KMH_PER_MPS : v.vmax;
  v.speed = Math.max(MIN_REVERSE_SPEED_MPS, Math.min(vmaxEff, v.speed + accel * dt));
  if (hand) v.speed *= 1 - Math.min(1, HANDBRAKE_DECEL * dt);
  // radenie 1–6
  const kmh = Math.abs(v.speed) * KMH_PER_MPS;
  v.gear = kmh < GEAR_SHIFT_KMH[0] ? 1 : kmh < GEAR_SHIFT_KMH[1] ? 2 :
    kmh < GEAR_SHIFT_KMH[2] ? 3 : kmh < GEAR_SHIFT_KMH[3] ? 4 :
    kmh < GEAR_SHIFT_KMH[4] ? 5 : GEAR_COUNT;
  v.rpm = IDLE_RPM + (kmh % RPM_CYCLE_KMH) / RPM_CYCLE_KMH * RPM_RANGE;
  // palivo + počítadlá: plná nádrž ≈ 30 min zmiešanej jazdy
  v.fuel = Math.max(0, v.fuel - (FUEL_IDLE_PER_SEC + th * FUEL_THROTTLE_PER_SEC) * dt);
  const dist = Math.abs(v.speed) * dt;
  v.trip += dist;
  v.odo += dist;
  v.oilT = Math.max(0, (v.oilT || 0) - dt);
  // riadenie (verbatim cit z monolitu): nedotáčavosť s rýchlosťou + cap nad 150 km/h,
  // nech auto pri 200+ nie je myklavé; yawRate sa vyhladzuje
  v.steer += (steer - v.steer) * Math.min(1, STEERING_RESPONSE * dt);
  const grip = hand ? HANDBRAKE_GRIP : 1;
  const aspd = Math.abs(v.speed);
  const under = 1 / (1 + (aspd / UNDERSTEER_SPEED_MPS) * (aspd / UNDERSTEER_SPEED_MPS));
  let yawT = 0;
  if (steer !== 0 && aspd > MIN_TURN_SPEED_MPS) {
    const dir = v.speed >= 0 ? 1 : -1;
    yawT = steer * YAW_STEER_GAIN * dir * Math.min(1, aspd / YAW_RAMP_SPEED_MPS + YAW_RAMP_FLOOR) * under;
    if (aspd > HIGH_SPEED_YAW_THRESHOLD_MPS) { // speed-sensitive cap: nad 150 km/h max ~0.35 rad/s
      const cap = HIGH_SPEED_YAW_BASE_RAD_S + (YAW_STEER_GAIN * under - HIGH_SPEED_YAW_BASE_RAD_S) *
        Math.max(0, 1 - (aspd - HIGH_SPEED_YAW_THRESHOLD_MPS) / HIGH_SPEED_YAW_DECAY_MPS);
      const lim = cap > 0 ? cap : MIN_HIGH_SPEED_YAW_RAD_S;
      if (yawT > lim) yawT = lim; else if (yawT < -lim) yawT = -lim;
    }
    if (hand) yawT *= HANDBRAKE_YAW_GAIN;
  }
  v.yawRate += (yawT - v.yawRate) * Math.min(1, dt * YAW_RATE_RESPONSE);
  v.h += v.yawRate * dt * grip;
  v.x += Math.sin(v.h) * v.speed * dt;
  v.z += Math.cos(v.h) * v.speed * dt;
  v.y = terrainY;
  // drift skóre vstup: |steer| × speed pri ručnej
  const drifting = hand && Math.abs(v.speed) > DRIFT_MIN_SPEED_MPS && Math.abs(v.steer) > DRIFT_MIN_STEER;
  // teplota: státie varí, plynulá jazda chladí (z monolitu)
  v.temp += ((Math.abs(v.speed) < 1 ? STATIONARY_HEAT_PER_SEC : CRUISING_COOL_PER_SEC) +
    Math.abs(accel) * ACCEL_HEAT_RATE) * dt;
  v.temp = Math.max(0, Math.min(1, v.temp));
  TEL.kmh = kmh; TEL.drifting = drifting; TEL.accel = accel;
  return TEL;
}

/** Prístup k telemetrickému scratchu pre hráča bez fyziky (noclip) — bez alokácie. */
export function vehicleTelemetry() { return TEL; }

export const CAR_HW = 0.85, CAR_HL = 2.05;

// Exaktný test budovy: rohy/stred auta v polygone alebo hrana-hrana (verbatim
// logika z monolitu; BF = S.BF footprinty). Odhalí falošné zásahy v dvoroch.
export function exactBldAt(bi, px, pz, ph){
  const BF = S.BF;
  const fx = Math.sin(ph), fz = Math.cos(ph);
  const rx = -fz, rz = fx;
  const o = BF.o[bi], nn = BF.n[bi];
  for(let c=0;c<5;c++){
    let ox, oz;
    if(c === 4){ ox = 0; oz = 0; }
    else { ox = (c===0||c===3) ? CAR_HW : -CAR_HW; oz = (c<2) ? CAR_HL : -CAR_HL; }
    const qx = px + ox*rx + oz*fx, qz = pz + ox*rz + oz*fz;
    let ins = false;
    for(let e=0,j=nn-1;e<nn;j=e++){
      const xi = BF.p[o+e*2], zi = BF.p[o+e*2+1];
      const xj = BF.p[o+j*2], zj = BF.p[o+j*2+1];
      if(((zi > qz) !== (zj > qz)) && (qx < (xj-xi)*(qz-zi)/(zj-zi)+xi)) ins = !ins;
    }
    if(ins) return true;
  }
  for(let a2=0;a2<4;a2++){
    const b2 = (a2+1)%4;
    const aox = (a2===0||a2===3) ? CAR_HW : -CAR_HW;
    const aoz = (a2<2) ? CAR_HL : -CAR_HL;
    const box = (b2===0||b2===3) ? CAR_HW : -CAR_HW;
    const boz = (b2<2) ? CAR_HL : -CAR_HL;
    const p1x = px + aox*rx + aoz*fx, p1z = pz + aox*rz + aoz*fz;
    const p2x = px + box*rx + boz*fx, p2z = pz + box*rz + boz*fz;
    const exx = p2x-p1x, ezz = p2z-p1z;
    for(let e=0;e<nn;e++){
      const ne = (e+1)%nn;
      const q1x = BF.p[o+e*2], q1z = BF.p[o+e*2+1];
      const q2x = BF.p[o+ne*2], q2z = BF.p[o+ne*2+1];
      const fxx = q2x-q1x, fzz = q2z-q1z;
      const dd = exx*fzz - ezz*fxx;
      if(dd > -COLLISION_AXIS_EPSILON && dd < COLLISION_AXIS_EPSILON) continue;
      const tt = ((q1x-p1x)*fzz - (q1z-p1z)*fxx)/dd;
      const uu = ((q1x-p1x)*ezz - (q1z-p1z)*exx)/dd;
      if(tt > 0 && tt < 1 && uu > 0 && uu < 1) return true;
    }
  }
  return false;
}

// SAT vytlačenie z OBB (cx,cz,ch,hw,hl); mutuje p aj výstupný buffer.
// Bez odovzdaného bufferu vráti vlastný {hit, nx, nz, impact} objekt.
export function pushOutOBB(p, cx, cz, ch, hw, hl, result = { hit: false, nx: 0, nz: 0, impact: 0 }) {
  const ph = p.h;
  const f1x = Math.sin(ph), f1z = Math.cos(ph);
  const r1x = -f1z, r1z = f1x;
  const f2x = Math.sin(ch), f2z = Math.cos(ch);
  const r2x = -f2z, r2z = f2x;
  const dx = p.x - cx, dz = p.z - cz;
  let best = Infinity, bnx = 0, bnz = 0;
  for (let a = 0; a < 4; a++) {
    let ax, az;
    if (a === 0) { ax = f1x; az = f1z; }
    else if (a === 1) { ax = r1x; az = r1z; }
    else if (a === 2) { ax = f2x; az = f2z; }
    else { ax = r2x; az = r2z; }
    const t = dx * ax + dz * az;
    const at = t >= 0 ? t : -t;
    const r1 = CAR_HW * Math.abs(r1x * ax + r1z * az) + CAR_HL * Math.abs(f1x * ax + f1z * az);
    const r2 = hw * Math.abs(r2x * ax + r2z * az) + hl * Math.abs(f2x * ax + f2z * az);
    const o = (r1 + r2) - at;
    if (o <= 0) {
      result.hit = false; result.nx = 0; result.nz = 0; result.impact = 0;
      return result;
    }
    if (o < best) { best = o; const s = t >= 0 ? 1 : -1; bnx = ax * s; bnz = az * s; }
  }
  const depth = best + COLLISION_PUSHOUT_SLOP_M;
  p.x += bnx * depth;
  p.z += bnz * depth;
  result.hit = true; result.nx = bnx; result.nz = bnz;
  result.impact = -(f1x * p.speed * bnx + f1z * p.speed * bnz);
  return result;
}

// Výstupný buffer pre dotaz na budovy. Vlastný (pozri gridQuery v ground.js):
// vnorený dotaz by inak prepísal výsledok, ktorý tu ešte čítame.
const BLD_GQ = new Int32Array(GQ_MAX);
const COLLISION_RESULT = { hit: false, nx: 0, nz: 0, impact: 0 };

/** Kolízie hráča: budovy (BGRID + exact verify) + autá (pooly). Vracia max impact. */
export function collideWorld(p, cars = []) {
  let impact = 0;
  const nc = cars.length;
  for (let pass = 0; pass < COLLISION_SOLVER_PASSES; pass++) {
    // indexová slučka namiesto for..of: `cars` je ALL_CARS (60+) a for..of
    // alokuje iterátor pri každom z oboch priechodov (teda 2×/snímok)
    for (let ci = 0; ci < nc; ci++) {
      const c = cars[ci];
      const dx = c.x - p.x, dz = c.z - p.z;
      if (dx * dx + dz * dz > COLLISION_SCAN_RADIUS2) continue;
      const r = pushOutOBB(p, c.x, c.z, c.h, CAR_HW, CAR_HL, COLLISION_RESULT);
      if (r.hit && r.impact > impact) impact = r.impact;
    }
    const bn = gridQuery(S.BGRID, p.x, p.z, 1, BLD_GQ);
    for (let i = 0; i < bn; i++) {
      const b = BLD_GQ[i];
      const dx = S.BX.x[b] - p.x, dz = S.BX.z[b] - p.z;
      if (dx * dx + dz * dz > COLLISION_SCAN_RADIUS2) continue;
      const svx = p.x, svz = p.z;
      const r = pushOutOBB(p, S.BX.x[b], S.BX.z[b], S.BX.rot[b], S.BX.hw[b], S.BX.hl[b], COLLISION_RESULT);
      if (r.hit) {
        if (!exactBldAt(b, svx, svz, p.h)) { p.x = svx; p.z = svz; }
        else if (r.impact > impact) impact = r.impact;
      }
    }
  }
  if (impact > HARD_IMPACT_THRESHOLD) p.speed *= HARD_IMPACT_REBOUND;      // tvrdý náraz
  else if (impact > SOFT_IMPACT_THRESHOLD) p.speed *= SOFT_IMPACT_SPEED_RETAIN; // ošúchanie
  return impact;
}
