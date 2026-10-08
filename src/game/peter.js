// src/game/peter.js — Peter, zadávateľ misií pri štarte kolóny.
// Stojí pri krajnici na začiatku trasy (s=8), máva, dáva inštrukcie
// a klávesou [F] zadáva misie (strieda MISIA 1 / MISIA 2).
// Architektúra ako missions.js: žiadne globály, stav drží modul.
import * as THREE from 'three';
import { S } from '../world/shared.js';
import { routePose } from '../world/roads.js';
import { driveY, getTerrainHeight, LANE_OFF } from '../world/height.js';
import { makeLabel } from '../world/textures.js';
import { ZPN, startMission } from './missions.js';

export const PETER = {
  x: 0, z: 0, y: 0,
  group: null, armR: null, ring: null, label: null,
  built: false,
  greeted: false,      // prvý pozdrav pri priblížení (60 m)
  talkCd: 0,           // cooldown automatických hlášok
  lineIdx: 0,          // rotácia idle hlášok
  nextMission: 0,      // ktorú misiu Peter zadá najbližšie (0/1)
  dialogT: 0,          // ako dlho drží panel
  near: false,         // je hráč v dosahu rozhovoru
};

export const PETER_TALK_RADIUS = 16;   // [F] funguje do 16 m
export const PETER_GREET_RADIUS = 70;  // prvý pozdrav do 70 m

const IDLE_LINES = [
  'PETER: Čau! Ja som Peter. Stojím tu od rána v kolóne.',
  'PETER: [F] = pokec · zadám ti misiu. Nemusíš vystupovať.',
  'PETER: Urbánek downhill? Ručná = SPACE, drift = body.',
  'PETER: Most ponad Váh? Celý čas cez 180, neškrtni zábradlie.',
  'PETER: Keď sa stratíš, napíš WARPPETER a som tu.',
  'PETER: Státie varí motor. Plíž sa plynulo, ako ja na obed.',
];

const BRIEF = [
  {
    name: 'MISIA 1 · URBÁNEK DOWNHILL DRIFT',
    brief: 'PETER: Choď na Urbánek a nadriftuj 2 500 bodov. Ručná = SPACE. Drž sa v zóne!',
  },
  {
    name: 'MISIA 2 · VÁH BRIDGE DASH',
    brief: 'PETER: Preleť most ponad Váh celý cez 180 km/h. Zábradlia sa ani nedotkni!',
  },
];

function _els() {
  return {
    box: document.getElementById('peter'),
    text: document.getElementById('peter-text'),
  };
}

export function showPeterDialog(msg, ms = 6000) {
  const { box, text } = _els();
  if (!box || !text) return;
  text.textContent = msg;
  box.classList.add('on');
  PETER.dialogT = ms / 1000;
}

export function hidePeterDialog() {
  document.getElementById('peter')?.classList.remove('on');
  PETER.dialogT = 0;
}

export function buildPeter() {
  if (PETER.built) return PETER;
  // Pozícia: štart kolóny (s=8) + 7 m vpravo od osi, mimo vozovky.
  const v = new THREE.Vector3();
  const hWrap = { v: 0 };
  routePose(8, v, hWrap, LANE_OFF + 7);
  PETER.x = v.x;
  PETER.z = v.z;
  try {
    PETER.y = getTerrainHeight(PETER.x, PETER.z);
  } catch { PETER.y = driveY(PETER.x, PETER.z, 8, 0); }

  const g = new THREE.Group();
  const mat = (c, e = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, metalness: 0.05, emissive: e ? c : 0x000000, emissiveIntensity: e ? 0.35 : 0 });
  const skin = mat(0xe8b98a), jeans = mat(0x2a3a5e), vest = mat(0xff7a00), capM = mat(0xffb000);

  for (const sx of [-0.14, 0.14]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.78, 0.24), jeans);
    leg.position.set(sx, 0.39, 0);
    leg.castShadow = true;
    g.add(leg);
  }
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.78, 0.34), vest);
  torso.position.y = 1.17;
  torso.castShadow = true;
  g.add(torso);
  // reflexný pás na veste (chytne bloom, vidno z diaľky)
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.1, 0.36),
    new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff6c8, emissiveIntensity: 1.6 })
  );
  stripe.position.y = 1.22;
  g.add(stripe);

  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.66, 0.16), vest);
  armL.position.set(-0.38, 1.15, 0);
  armL.castShadow = true;
  g.add(armL);
  // pravá ruka = mávajúca (pivot v ramene)
  const pivot = new THREE.Group();
  pivot.position.set(0.38, 1.48, 0);
  const armR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.66, 0.16), skin);
  armR.position.y = -0.3;
  armR.castShadow = true;
  pivot.add(armR);
  g.add(pivot);
  PETER.armR = pivot;

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.36, 0.32), skin);
  head.position.y = 1.78;
  head.castShadow = true;
  g.add(head);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.12, 0.36), capM);
  cap.position.y = 2.0;
  g.add(cap);
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.04, 0.22), capM);
  brim.position.set(0, 1.96, 0.27);
  g.add(brim);

  g.position.set(PETER.x, PETER.y, PETER.z);
  S.scene.add(g);
  PETER.group = g;

  // pulzujúci fialový kruh = "tu sa berú misie" (rovnaký jazyk ako zóny misií)
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(2.2, 3.0, 28),
    new THREE.MeshBasicMaterial({ color: 0xc26bff, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(PETER.x, PETER.y + 0.12, PETER.z);
  ring.renderOrder = 2;
  S.scene.add(ring);
  PETER.ring = ring;

  const lbl = makeLabel('PETER · MISIE', 1.0);
  lbl.position.set(PETER.x, PETER.y + 3.1, PETER.z);
  S.scene.add(lbl);
  PETER.label = lbl;

  PETER.built = true;
  return PETER;
}

export function peterReset() {
  PETER.greeted = false;
  PETER.talkCd = 0;
  PETER.lineIdx = 0;
  PETER.nextMission = 0;
  hidePeterDialog();
}

/** Vzdialenosť hráča od Petra (m, 2D). */
export function peterDist(cx, cz) {
  const dx = cx - PETER.x, dz = cz - PETER.z;
  return Math.sqrt(dx * dx + dz * dz);
}

export function isNearPeter(car) {
  if (!PETER.built || !car) return false;
  return peterDist(car.x, car.z) < PETER_TALK_RADIUS;
}

// [F] pri Petrovi: zadá ďalšiu misiu, inak poradí podľa stavu.
// Vracia true, ak hlášku spracoval Peter (volajúci preskočí iný význam klávesy).
export function peterTalk(api = {}) {
  if (!PETER.built) return false;
  const car = api.car ?? {};
  if (peterDist(car.x ?? 0, car.z ?? 0) > PETER_TALK_RADIUS) return false;
  const toast = typeof api.toast === 'function' ? api.toast : null;

  // Rozbehnutá misia → Peter hlási progres, misiu neruší.
  if (ZPN.active >= 0 && ZPN.res === 0) {
    const m = ZPN.M?.[ZPN.active];
    const left = m ? Math.max(0, m.limit - ZPN.t) : 0;
    const msg = `PETER: Makaj! ${m ? m.name : ''} · ostáva ${Math.round(left)} s.`;
    showPeterDialog(msg);
    toast?.(msg, 2.6);
    return true;
  }
  // Po vyhodnotení ešte drží banner → Peter zablahoželá / povzbudí.
  if (ZPN.res !== 0) {
    const msg = ZPN.res === 1
      ? 'PETER: Paráda! PASSED! Dám ti ďalšiu, keď budeš chcieť [F].'
      : `PETER: Nevadí, stane sa (${ZPN.why}). Vydýchni a skús znova [F].`;
    showPeterDialog(msg);
    toast?.(msg, 2.6);
    return true;
  }
  // Zadanie ďalšej misie (strieda 0 → 1 → 0 …).
  const i = PETER.nextMission % 2;
  PETER.nextMission++;
  startMission(i, toast);
  showPeterDialog(BRIEF[i].brief, 7000);
  return true;
}

export function updatePeter(dt, t, car, api = {}) {
  if (!PETER.built || !PETER.group) return;
  const toast = typeof api.toast === 'function' ? api.toast : null;

  // idle: podupávanie + mávanie + pulz kruhu; otoč sa za hráčom
  const dx = (car?.x ?? PETER.x) - PETER.x;
  const dz = (car?.z ?? PETER.z) - PETER.z;
  PETER.group.rotation.y = Math.atan2(dx, dz);
  PETER.group.position.y = PETER.y + Math.abs(Math.sin(t * 2.2)) * 0.06;
  if (PETER.armR) PETER.armR.rotation.z = -2.4 + Math.sin(t * 6) * 0.45;
  if (PETER.ring) {
    PETER.ring.material.opacity = 0.42 + 0.25 * (0.5 + 0.5 * Math.sin(t * 2.4));
    const s = 1 + 0.06 * Math.sin(t * 2.4);
    PETER.ring.scale.set(s, s, 1);
  }

  // panel odpočítava sám (hráč môže odísť)
  if (PETER.dialogT > 0) {
    PETER.dialogT -= dt;
    if (PETER.dialogT <= 0) hidePeterDialog();
  }
  if (PETER.talkCd > 0) PETER.talkCd -= dt;

  const d = Math.sqrt(dx * dx + dz * dz);
  PETER.near = d < PETER_TALK_RADIUS;

  // 1) prvý pozdrav z diaľky — hráč vie, že pri štarte niekto je
  if (!PETER.greeted && d < PETER_GREET_RADIUS && (api.started ?? true)) {
    PETER.greeted = true;
    PETER.talkCd = 5;
    const msg = 'PETER máva pri krajnici: „Zastav pri mne a stlač [F] — mám pre teba misie!“';
    showPeterDialog(msg);
    toast?.(msg, 3.2);
    return;
  }
  // 2) automatické kecy, len keď hráč stojí/plinie pri Petrovi (nie v 200 km/h)
  if (PETER.greeted && PETER.near && PETER.talkCd <= 0) {
    const spd = Math.abs(car?.speed ?? 0) * 3.6;
    if (spd < 25) {
      const msg = IDLE_LINES[PETER.lineIdx % IDLE_LINES.length];
      PETER.lineIdx++;
      PETER.talkCd = 9;
      showPeterDialog(msg + '\n[F] = zadaj misiu', 6000);
    } else {
      // prefrčal okolo — len krátky výkrik, nie plný panel
      PETER.talkCd = 9;
      toast?.('PETER: Hej! Pribrzdi pri mne [F]!', 2.0);
    }
  }
}
