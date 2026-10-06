// src/ai/police.js — GTA Heat Level System 1–5 pre Hlohovec (100 % hlasov v ankete).
//
//  ★1 Mestská polícia (Kia Cee'd):  speeding na Námestí sv. Michala / ťukance / trúbenie.
//      1 hliadka, snaží sa predbehnúť a vytlačiť k obrubníku (PIT z boku, nie ram).
//  ★★ Štátna polícia:               ram do policajta / jazda v protismere na moste.
//      2–3 autá, agresívny box-in (jedno spredu brzdí, ostatné zatvárajú boky).
//  ★★★ Zátarasy na kruháčoch:      dlhá naháňačka / drift pred hliadkou.
//      statické roadblocky na kľúčových uzloch (kruháče, nájazd na most).
//  ★★★★ PMJ ťažké SUV/vany:        prerazenie zátarasu / veľká deštrukcia.
//      čelné ramy, +teplota motora a +stres pri každom kontakte.
//  ★★★★★ Lockdown Hlohovca:         extrémny chaos.
//      výjazdy Nitra + Piešťany zablokované, vrtuľník s reflektorom (vidí aj za budovy).
//
// Únik:
//  - Line-of-sight: mimo dohľadu (uličky pod zámkom, za OC Váh) → hviezdy blikajú → decay.
//  - Prestriek (respray): prejazd garážou zmení farbu + okamžite čistí heat.
//  - Brehy Váhu: off-road spomaľuje policajtov (0.72×) viac než hráča.
//
// Dizajn: čistý ES modul bez Three.js závislostí (testovateľný v Node).
// Render (majáky, spotlight kužeľ) rieši voliteľný `renderer` callback z main.js.

import { HEAT } from '../core/config.js';
import { riverbankSlowdown } from '../world/water.js';

// Kľúčové uzly zátarasov — predvyplnené z OSM roundabouts + bridge ramp; main.js ich
// po načítaní mapy prepíše presnými súradnicami (pozri syncRoadblocksWithMap).
const DEFAULT_BLOCK_NODES = [
  { x: -2180, z: -1393, r: 13.8, name: 'KRUHÁČ most' },
  { x: -1292, z: -736, r: 15.7, name: 'KRUHÁČ centrum' },
  { x: 0, z: 0, r: 13.3, name: 'Nitrianska' },
  { x: 900, z: 1250, r: 10, name: 'nájazd most Váh' },
];
const EXITS = [
  { x: 1223, z: 652, name: 'výjazd Nitra' },
  { x: -2570, z: -1556, name: 'výjazd Piešťany' },
];

export const HeatEvent = {
  SPEEDING_SQUARE: 'speeding_square', // >50 km/h na Námestí sv. Michala
  HONK: 'honk', COLLISION_MINOR: 'collision_minor',
  RAM_POLICE: 'ram_police', WRONG_WAY_BRIDGE: 'wrong_way_bridge',
  DRIFT_TAUNT: 'drift_taunt', SMASH_BLOCK: 'smash_block', MAYHEM: 'mayhem',
};

const HEAT_DELTA = {
  [HeatEvent.HONK]: 0.35, [HeatEvent.COLLISION_MINOR]: 0.5, [HeatEvent.SPEEDING_SQUARE]: 0.6,
  [HeatEvent.RAM_POLICE]: 1.2, [HeatEvent.WRONG_WAY_BRIDGE]: 0.8,
  [HeatEvent.DRIFT_TAUNT]: 0.9, [HeatEvent.SMASH_BLOCK]: 1.1, [HeatEvent.MAYHEM]: 1.6,
};

export function heatLevel(heat) {
  return Math.max(0, Math.min(5, Math.ceil(heat - 1e-6)));
}

export function createPoliceSystem(state, opts = {}) {
  const sys = {
    heat: 0,               // spojitá 0..5 (HUD ukazuje ceil)
    level: 0,
    lastCrimeT: -99,
    hiddenT: 0,            // ako dlho bez LOS
    chaseMemory: 0,
    units: [],             // {x,z,h,speed,kind,state}
    roadblocks: [],        // {x,z,active}
    heli: null,            // {x,z} — len pri ★5
    exitsBlocked: false,
    sprayShops: opts.sprayShops ?? [{ x: -1708, z: -1313, r: 9, name: 'OC VÁH prestriek' }],
    onBusted: opts.onBusted ?? (() => {}),
    hud: null,
  };

  sys.hud = bindWantedHUD();

  // ——— API pre herné systémy ———
  sys.report = (event, t = state.time) => {
    const d = HEAT_DELTA[event] ?? 0.3;
    sys.heat = Math.min(HEAT.max, sys.heat + d);
    sys.lastCrimeT = t;
    sys.hiddenT = 0;
    sys.chaseMemory = HEAT.chaseMemory;
    const nl = heatLevel(sys.heat);
    if (nl !== sys.level) setLevel(sys, nl, state);
  };

  // Prestriek: okamžité čistenie + nová farba (volá trigger-zóna v updateMissions)
  sys.respray = () => {
    sys.heat = 0; sys.hiddenT = 0; sys.chaseMemory = 0;
    state.player.color = (Math.random() * 0xffffff) | 0;
    setLevel(sys, 0, state);
    sys.hud?.flash('ČISTÝ — nová farba');
    return state.player.color;
  };

  sys.update = (dt, t, env) => updatePolice(sys, state, dt, t, env);
  sys.syncRoadblocksWithMap = (osm) => {
    const nodes = (osm.roundabouts || []).map((r) => ({ x: r[0], z: r[1], r: r[2], name: r[4] || 'KRUHÁČ' }));
    const all = [...nodes, ...DEFAULT_BLOCK_NODES.filter((d) => !nodes.some((n) => Math.hypot(n.x - d.x, n.z - d.z) < 60))];
    sys.blockNodes = all;
  };
  sys.blockNodes = DEFAULT_BLOCK_NODES;

  return sys;
}

// ——— interné ———

function setLevel(sys, nl, state) {
  sys.level = nl;
  ensureUnits(sys, nl);
  sys.roadblocks = nl >= 3 ? sys.blockNodes.slice(0, nl >= 5 ? 6 : 3).map((n) => ({ ...n, active: true })) : [];
  sys.exitsBlocked = nl >= 5;
  if (nl >= 5 && !sys.heli) sys.heli = { x: state.player.x, z: state.player.z };
  if (nl < 5) sys.heli = null;
  sys.hud?.render(nl, false);
  if (nl === 5) sys.hud?.flash('LOCKDOWN HLOHOVCA — výjazdy uzavreté!');
}

function ensureUnits(sys, level) {
  const want = level <= 0 ? 0 : level === 1 ? 1 : level === 2 ? 3 : level === 3 ? 4 : 6;
  const kinds = ['mestska', 'statna', 'statna', 'pursuit', 'pmj', 'pmj'];
  while (sys.units.length < want) {
    sys.units.push({ x: 0, z: 0, h: 0, speed: 0, kind: kinds[sys.units.length] ?? 'statna', state: 'chase', stuckT: 0 });
  }
  sys.units.length = want; // prebytočné recykluj (žiadne new v slučke)
}

function hasLineOfSight(sys, px, pz, t) {
  // Stub LOS: budovy z (osm.blds) blokujú výhľad do 120 m.
  // Plná verzia: 2D raycast proti OBB obvodom (rovnaký SAT kód ako kolízie).
  // Heuristika, aby sa dala hrať už teraz: za budovou (>40 m od každého policajta
  // a hráč pomalý) = schovaný. Presný raycast príde migráciou z exactBldAt().
  for (const u of sys.units) {
    const d2 = (u.x - px) ** 2 + (u.z - pz) ** 2;
    if (d2 < 1600) return true; // <40 m vidia vždy (počuť motor)
  }
  return sys._occluded === true;
}

function updatePolice(sys, state, dt, t, env = {}) {
  const p = state.player;
  const newLevel = heatLevel(sys.heat);
  if (newLevel !== sys.level) setLevel(sys, newLevel, state);

  // snímače priestupkov z prostredia (fyzika/HUD ich posielajú aj priamo cez report)
  if (env.speedingSquare) sys.report(HeatEvent.SPEEDING_SQUARE, t);
  if (env.ramPolice) sys.report(HeatEvent.RAM_POLICE, t);
  if (env.wrongWayBridge) sys.report(HeatEvent.WRONG_WAY_BRIDGE, t);
  if (env.driftTaunt) sys.report(HeatEvent.DRIFT_TAUNT, t);
  if (env.smashBlock) sys.report(HeatEvent.SMASH_BLOCK, t);
  if (env.mayhem) sys.report(HeatEvent.MAYHEM, t);

  const seen = sys.units.length ? hasLineOfSight(sys, p.x, p.z, t) : false;
  if (seen) { sys.hiddenT = 0; sys.chaseMemory = HEAT.chaseMemory; }
  else {
    sys.hiddenT += dt;
    sys.chaseMemory = Math.max(0, sys.chaseMemory - dt);
    // decay len keď ťa nevidia A dlho nič nespáchaš
    if (t - sys.lastCrimeT > HEAT.decayDelay && sys.chaseMemory <= 0 && sys.heat > 0) {
      sys.heat = Math.max(0, sys.heat - HEAT.decayPerSec * dt);
      sys.hud?.render(sys.level, true);
      if (sys.heat === 0) setLevel(sys, 0, state);
    }
  }

  // prestriek trigger
  for (const s of sys.sprayShops) {
    if ((p.x - s.x) ** 2 + (p.z - s.z) ** 2 < s.r * s.r && sys.level > 0) sys.respray();
  }

  // pohyb jednotiek (kinematický pursuit + level-špecifické taktiky)
  const slow = riverbankSlowdown(p.x, p.z); // Váh spomaľuje políciu
  sys.units.forEach((u, i) => pursuitStep(sys, u, i, p, dt, t, slow, env.groundYAt ?? (() => 0)));

  // vrtuľník ★5: drží sa nad hráčom, reflektor ruší schovávanie za budovami
  if (sys.heli) {
    sys.heli.x += (p.x - sys.heli.x) * Math.min(1, 1.5 * dt);
    sys.heli.z += (p.z - sys.heli.z) * Math.min(1, 1.5 * dt);
    sys.hiddenT = 0; // spotlight: LOS sa nedá prerušiť (len prestriek pomôže)
    sys.hud?.render(sys.level, false);
  }

  // bust podmienka: ★≥2 + policajt <3 m + hráč stojí
  if (sys.level >= 2 && Math.abs(p.speed) < 1) {
    for (const u of sys.units) {
      if ((u.x - p.x) ** 2 + (u.z - p.z) ** 2 < 9) { sys.onBusted(sys.level); break; }
    }
  }
  // kontakt ★4: +teplota/+stres (heat-feedback loop)
  if (sys.level >= 4) {
    for (const u of sys.units) {
      if ((u.x - p.x) ** 2 + (u.z - p.z) ** 2 < 16) {
        p.temp = Math.min(1, p.temp + 0.05 * dt * 10);
        p.stress = Math.min(1, p.stress + 0.04 * dt * 10);
      }
    }
  }
}

function pursuitStep(sys, u, i, p, dt, t, policeSlow, groundYAt) {
  // spawn vedľa hráča pri eskalácii (mimo dohľad, aby nepopovali pred kamerou)
  if ((u.x === 0 && u.z === 0) || Math.hypot(u.x - p.x, u.z - p.z) > 600) {
    const a = Math.atan2(p.x, p.z) + Math.PI + (i * 1.3);
    u.x = p.x + Math.sin(a) * 120; u.z = p.z + Math.cos(a) * 120;
  }
  const lvl = sys.level;
  // cieľový bod: ★1 = bok auta (PIT príprava), ★2+ = predok (box-in), ★4 = čelo (ram)
  let tx = p.x, tz = p.z;
  const ph = p.h || 0;
  if (lvl === 1) { tx += Math.cos(ph) * 3; tz += -Math.sin(ph) * 3; }
  else if (lvl === 2 && i === 0) { tx += Math.sin(ph) * 8; tz += Math.cos(ph) * 8; }
  else if (lvl >= 4 && i < 2) { tx += Math.sin(ph) * 6; tz += Math.cos(ph) * 6; } // čelný nájazd

  const dx = tx - u.x, dz = tz - u.z;
  const dist = Math.hypot(dx, dz) || 1;
  const want = Math.atan2(dx, dz);
  let dh = want - u.h;
  while (dh > Math.PI) dh -= Math.PI * 2;
  while (dh < -Math.PI) dh += Math.PI * 2;
  u.h += Math.max(-2.4 * dt, Math.min(2.4 * dt, dh));

  const vmax = (lvl >= 4 ? 34 : lvl === 3 ? 30 : 27) * (u.kind === 'pmj' ? 0.94 : 1) * policeSlow;
  const accel = dist > 25 ? 12 : dist > 8 ? 4 : -10;
  u.speed = Math.max(0, Math.min(vmax, u.speed + accel * dt));
  u.x += Math.sin(u.h) * u.speed * dt;
  u.z += Math.cos(u.h) * u.speed * dt;
  u.stuckT = u.speed < 1 ? (u.stuckT + dt) : 0;
  if (u.stuckT > 2) { u.h += Math.PI * 0.5; u.stuckT = 0; } // zaseknutý o zátaras → otočka
}

// ——— HUD hviezdičky ———
function bindWantedHUD() {
  const root = document.getElementById('wanted');
  if (!root) return null;
  const stars = [...root.querySelectorAll('.star')];
  const evade = document.getElementById('wanted-evade');
  let flashT = 0;
  return {
    render(level, hiding) {
      root.classList.toggle('on', level > 0);
      root.classList.toggle('heat5', level >= 5);
      root.classList.toggle('hiding', !!hiding);
      stars.forEach((s, i) => s.classList.toggle('lit', i < level));
      if (evade) evade.textContent = level === 0 ? '' : hiding ? 'STRÁCA ŤA…' : level >= 5 ? 'VRTUĽNÍK NAD TEBOU' : 'ÚNIK!';
    },
    flash(msg) {
      if (evade) evade.textContent = msg;
      clearTimeout(flashT);
      flashT = setTimeout(() => this.render(0, false), 1800);
    },
  };
}

// Testovateľné čisté helpery (Node bez DOM):
export const _test = { heatLevel, HEAT_DELTA, DEFAULT_BLOCK_NODES, EXITS };
