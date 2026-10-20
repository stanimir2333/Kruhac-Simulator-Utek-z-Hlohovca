import * as THREE from 'three';
import { S } from '../world/shared.js';
import { nearestRoute, ALL_CARS } from '../ai/traffic.js';
import { wheelGroundY } from '../world/height.js';
import { gridQuery, GQ_MAX } from '../world/ground.js';
import { createPedestrianSystem } from '../ai/pedestrians.js';
import { createWeapons } from './weapons.js';

const ENTER_RADIUS = 3.8;
const FOOT_RADIUS = 0.34;
const WALK_SPEED = 4.5;
const RUN_SPEED = 7.4;
const BACK_SPEED = 2.9;
const JUMP_SPEED = 5.2;
const GRAVITY = 18;
const EYE_H = 1.62;        // výška očí nad zemou (kamera = prvá osoba)
// Citlivosť pohľadu: rad/px. S unadjustedMovement sú delty RAW counts, takže
// pocit závisí od DPI myši (800/1600/3200/6400 DPI). História 0.0032 → … →
// 0.00018 bola vždy "stále hnalá" — pri 3200–6400 DPI myši je CS-pocit až
// ~0.00009. Rozsah slidera 2–400 % pokrýva DPI od 800 po 12800.
const LOOK_SENS = 0.00009;
// Mäkký strop rýchlosti pohľadu: rozpočet dopĺňa REÁLNY ČAS (px/ms), takže
// je nezávislý od FPS aj od počtu mousemove eventov (125 Hz aj 1000 Hz myš
// otáča rovnako rýchlo). Normálny pohyb (≤ ~20 px/ms pri 1600 DPI) ide 1:1;
// strop chytí len obrieventy z akcelerácie OS v fallback režime.
const LOOK_RATE = 30;   // dopĺňané px za ms
const LOOK_BUDGET = 60; // max delta použitá na jeden event (px)
// Pitch: fyzický clamp ±60° (kamera je v hlave — nižšie by hlodal do trupu).
// Mäkká zóna nad ~46° tlmením nechá pohľad plynule dopadnúť namiesto trhnutia
// na doraz ("zamknuté na oblohu/zemi").
const PITCH_MAX = 1.05;
const PITCH_SOFT = 0.8;
const TOUCH_SENS = 0.0022; // rad/px (dotyk — prst ide po pixeloch, nie po palcoch)
const FOOT_GQ = new Int32Array(GQ_MAX);

function insideBox(x, z, cx, cz, rot, hw, hl, margin) {
  const dx = x - cx, dz = z - cz;
  const s = Math.sin(rot), c = Math.cos(rot);
  const lf = dx * s + dz * c;
  const lr = -dx * c + dz * s;
  return Math.abs(lf) < hl + margin && Math.abs(lr) < hw + margin;
}

function pushRect(p, cx, cz, rot, hw, hl, radius) {
  const dx = p.x - cx, dz = p.z - cz;
  const s = Math.sin(rot), c = Math.cos(rot);
  const lf = dx * s + dz * c;
  const lr = -dx * c + dz * s;
  const hf = hl + radius, hr = hw + radius;
  const af = Math.abs(lf), ar = Math.abs(lr);
  if (af >= hf || ar >= hr) return false;
  let of = 0, or = 0;
  if (hf - af < hr - ar) of = (lf < 0 ? -hf : hf) - lf;
  else or = (lr < 0 ? -hr : hr) - lr;
  p.x += s * of - c * or;
  p.z += c * of + s * or;
  return true;
}

function buildBody() {
  const root = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xd7a06e, roughness: 0.85, metalness: 0.02 });
  const jacket = new THREE.MeshStandardMaterial({ color: 0x1b2632, roughness: 0.72, metalness: 0.08 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x242a31, roughness: 0.86, metalness: 0.02 });
  const boot = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.9, metalness: 0.05 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xffb000, roughness: 0.5, metalness: 0.2 });
  const hair = new THREE.MeshStandardMaterial({ color: 0x20150f, roughness: 0.92, metalness: 0 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.62, 0.25), jacket);
  torso.position.y = 1.2;
  torso.castShadow = true;
  root.add(torso);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.47, 0.065, 0.255), accent);
  stripe.position.y = 1.31;
  root.add(stripe);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.29, 0.25), skin);
  head.position.y = 1.68;
  head.castShadow = true;
  root.add(head);
  const hairMesh = new THREE.Mesh(new THREE.BoxGeometry(0.29, 0.09, 0.265), hair);
  hairMesh.position.y = 1.86;
  root.add(hairMesh);

  const legs = [];
  const arms = [];
  const legGeo = new THREE.BoxGeometry(0.17, 0.8, 0.19);
  legGeo.translate(0, -0.4, 0);
  const armGeo = new THREE.BoxGeometry(0.14, 0.62, 0.15);
  armGeo.translate(0, -0.31, 0);
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1;
    const hip = new THREE.Group();
    hip.position.set(side * 0.11, 0.89, 0);
    const leg = new THREE.Mesh(legGeo, pants);
    leg.castShadow = true;
    hip.add(leg);
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.28), boot);
    shoe.position.set(0, -0.77, 0.05);
    hip.add(shoe);
    root.add(hip);
    legs.push(hip);
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.285, 1.41, 0);
    const arm = new THREE.Mesh(armGeo, jacket);
    arm.castShadow = true;
    shoulder.add(arm);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.13), skin);
    hand.position.y = -0.58;
    shoulder.add(hand);
    root.add(shoulder);
    arms.push(shoulder);
  }
  // Zbraň NIE JE dieťaom tela: v prvej osobe je to "viewmodel" — drží sa
  // v priestore kamery (pozri weapons.js → placeHolder).
  root.visible = false;
  return { root, legs, arms, torso, head, hair: hairMesh, phase: 0 };
}

export function createOnFoot(opts = {}) {
  const scene = opts.scene || S.scene;
  const camera = opts.camera || null;
  const car = opts.car || null;
  const input = opts.input || null;
  const renderer = opts.renderer || null;
  const sfx = opts.sfx || null;
  const toast = typeof opts.toast === 'function' ? opts.toast : null;
  const canvas = renderer?.domElement || null;
  const startX = car ? car.x : 0;
  const startZ = car ? car.z : 0;

  const peds = createPedestrianSystem({ scene, startX, startZ });
  const cross = document.getElementById('crosshair');
  let hitTimer = 0;
  const weapons = createWeapons({
    scene, camera, peds, sfx, toast,
    onHit(killed) {
      if (!cross) return;
      cross.classList.add('hit');
      cross.classList.toggle('kill', !!killed);
      hitTimer = 0.13;
    },
  });
  const body = buildBody();
  const root = body.root;
  if (scene) scene.add(root);

  // PRVÁ OSOBA: kamera sedí v hlave chodca, takže hlava a ramená by boli
  // vo vnútri (alebo priamo pred) kamerou. Hlavu, vlasy a ramená skrývame;
  // trup a nohy ostávajú — pri pohľade dolu vidíš vlastné nohy.
  body.head.visible = false;
  body.hair.visible = false;
  body.arms[0].visible = false;
  body.arms[1].visible = false;

  // Tien chodca: elipsa pod nohami (rovnaký shader ako autá — S.MAT.blob).
  // Bez nej by hráč pri prvej osobe vyzeral ako by plával.
  const blob = new THREE.Mesh(S.GEO.blob, S.MAT.blob);
  blob.scale.set(0.4, 0.4, 1);
  blob.visible = false;
  if (scene) scene.add(blob);

  const foot = {
    active: false, x: startX, y: 0, z: startZ, h: 0, yaw: 0, pitch: -0.07,
    vy: 0, grounded: true, moveSpeed: 0, sprint: false, phase: 0, space: false,
  };
  let touchLook = -1;
  let touchX = 0, touchY = 0;
  // Časový rozpočet rýchlosti myši (pozri LOOK_RATE vyžšie). Čas posledného
  // mousemove a nenaplnený rozpočet px; používajú sa v handleri nižšie.
  let lastMoveT = 0, budgetPx = 0;
  // Pointer lock zablokovaný prehliadačom → myš otáča pohľad aj bez locku.
  let lockFailed = false;
  let lockFails = 0;
  // Nastavené (pending) čakanie na delayed retry bez options; časovače
  // retry-requestu a tichého fallback-verdiktu (používajú sa v requestLock nižšie).
  let retryPending = false, retryT = 0, fallbackT = 0;

  // Násobka citlivosti z nastavení (settings.sens). Bez locku myši je to
  // jediný spôsob, ako pohyb myši vplýva na pohľad.
  function sensFactor() {
    const raw = typeof opts.sens === 'function' ? opts.sens() : opts.sens;
    const v = Number(raw);
    return Number.isFinite(v) && v > 0.05 ? v : 1;
  }

  function groundAt(x, z) {
    const nr = nearestRoute(x, z);
    const lat = -(x - nr.x) * Math.cos(nr.h) + (z - nr.z) * Math.sin(nr.h);
    return wheelGroundY(x, z, nr.s, lat);
  }

  function pushOut() {
    for (let pass = 0; pass < 2; pass++) {
      let moved = false;
      const n = gridQuery(S.BGRID, foot.x, foot.z, 1, FOOT_GQ);
      for (let i = 0; i < n; i++) {
        const b = FOOT_GQ[i];
        if (pushRect(foot, S.BX.x[b], S.BX.z[b], S.BX.rot[b], S.BX.hw[b], S.BX.hl[b], FOOT_RADIUS)) moved = true;
      }
      for (let i = 0; i < ALL_CARS.length; i++) {
        const c = ALL_CARS[i];
        if (c.hidden) continue;
        const dx = c.x - foot.x, dz = c.z - foot.z;
        if (dx * dx + dz * dz > 64) continue;
        if (pushRect(foot, c.x, c.z, c.h, 0.92, 2.1, FOOT_RADIUS)) moved = true;
      }
      // Vlastné auto NIE je v ALL_CARS (hráč má vlastný mesh) — bez tohto by
      // sa dalo prejsť skrz kapotu a kamera by skončila vnútri karosérie.
      if (car && pushRect(foot, car.x, car.z, car.h, 0.92, 2.1, FOOT_RADIUS)) moved = true;
      if (!moved) break;
    }
    if (foot.x < S.GB.x0 + 2) foot.x = S.GB.x0 + 2;
    else if (foot.x > S.GB.x1 - 2) foot.x = S.GB.x1 - 2;
    if (foot.z < S.GB.z0 + 2) foot.z = S.GB.z0 + 2;
    else if (foot.z > S.GB.z1 - 2) foot.z = S.GB.z1 - 2;
  }

  function blockedAt(x, z) {
    const n = gridQuery(S.BGRID, x, z, 1, FOOT_GQ);
    for (let i = 0; i < n; i++) {
      const b = FOOT_GQ[i];
      if (insideBox(x, z, S.BX.x[b], S.BX.z[b], S.BX.rot[b], S.BX.hw[b], S.BX.hl[b], 0.45)) return true;
    }
    return false;
  }

  function bestExit() {
    if (!car) return { x: startX, z: startZ };
    const fx = Math.cos(car.h), fz = -Math.sin(car.h);
    for (const side of [1, -1]) {
      const x = car.x + fx * 1.6 * side;
      const z = car.z + fz * 1.6 * side;
      if (!blockedAt(x, z)) return { x, z };
    }
    return { x: car.x + fx * 1.6, z: car.z + fz * 1.6 };
  }

  function setModeUI(on) {
    document.body.classList.toggle('onfoot', on);
    const use = document.getElementById('t-use');
    if (use) use.textContent = on ? 'NASTÚPIŤ' : 'VYSTÚPIŤ';
    if (cross) cross.classList.toggle('on', on);
  }

  function requestLock() {
    if (!canvas || !canvas.requestPointerLock) { lockFailed = true; return; }
    try {
      // unadjustedMovement = RAW delty myši bez akcelerácie OS (Chrome 88+,
      // Firefox 133+). Bez tejto voľby prehliadač násobí movementX rýchlosťou
      // kurzora z OS ("Enhance pointer precision") a pohľad "zapráši".
      // Keď options nie je podporované alebo OS raw nedokáže (Wayland),
      // request padne → retry bez options existuje, ale MUSÍ ísť v NOVOM
      // tiku: Firefox posudzoval každý z dvojice osobitne a druhý zamietol
      // ("Request for pointer lock was denied because the document is not
      // focused") — jeden request na tik, retry až o ~300 ms.
      const p = canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          retryPending = true;
          clearTimeout(retryT);
          retryT = setTimeout(() => {
            try {
              const q = canvas.requestPointerLock();
              if (q && typeof q.catch === 'function') q.catch(() => { /* rieši pointerlockerror */ });
            } catch { /* rieši pointerlockerror */ }
            retryPending = false;
            armFallbackTimer();
          }, 300);
        });
      }
    } catch {
      // Starší prehliadač options vôbec neprijíma (throw) → normálny request
      // je prvý aj jediný tohto tiku.
      try {
        const q = canvas.requestPointerLock();
        if (q && typeof q.catch === 'function') q.catch(() => { /* rieši pointerlockerror */ });
      } catch { lockFailed = true; }
    }
    armFallbackTimer();
  }

  // Tiché zamietnutie (bez eventu): ak N ms po poslednom reálnom requeste
  // stále nie je locked ani error spracovaný, spadni do fallbacku.
  function armFallbackTimer() {
    clearTimeout(fallbackT);
    fallbackT = setTimeout(() => {
      if (foot.active && document.pointerLockElement !== canvas && !lockFailed) {
        lockFailed = true;
        console.warn('[onfoot] pointer lock nenastal bez odpovede — prehliadač request zamietol ticho (často file:// alebo keď okno práve stratilo fokus)');
        toast?.('Kurzor sa nepodarilo zamknúť — klikni na hernú plochu, skúsi to znova.', 3600);
      }
    }, 900);
  }
  document.addEventListener('pointerlockerror', () => {
    // Prvý (options) request môže padnúť, kým delayed retry bez options ešte
    // ide — kým je retry aktívny (retryPending), nesudčíme a nespustíme fallback.
    if (retryPending) { armFallbackTimer(); return; }
    lockFails++;
    console.warn('[onfoot] pointer lock odmietnutý (pokus', lockFails,
      ') — cooldown po ESC, nepovolené "Skryť kurzor" (Firefox: ikona v adresnom riadku), alebo okno práve stratilo fokus (prvý klik po alt-tabe)');
    if (foot.active && !lockFailed) {
      lockFailed = true;
      toast?.('Kurzor sa nepodarilo zamknúť — klikni na hernú plochu o chvíľu. Firefox: ak sa opakuje, povoľ „Skryť kurzor“ v ikone v adresnom riadku.', 6000);
    } else {
      lockFailed = true;
    }
  });
  // Úspešný lock vždy zruší fallback režim — prehliadače odmietajú re-lock
  // ~1-2 s po ESC a bez tohto by jeden zamietnutý request prilepil fallback naveky.
  document.addEventListener('pointerlockchange', () => {
    if (canvas && document.pointerLockElement === canvas) {
      lockFailed = false;
      retryPending = false;
      clearTimeout(fallbackT);
      clearTimeout(retryT);
    }
  });

  function exit() {
    if (foot.active || !car) return false;
    if (Math.abs(car.speed) > 2.5) {
      if (toast) toast('Najprv zastav — vystupovať sa dá len v stoji.');
      return false;
    }
    const spot = bestExit();
    foot.active = true;
    foot.x = spot.x;
    foot.z = spot.z;
    foot.y = groundAt(foot.x, foot.z);
    foot.yaw = car.h;
    foot.h = car.h;
    foot.pitch = -0.07;
    foot.vy = 0;
    foot.grounded = true;
    foot.phase = 0;
    foot.moveSpeed = 0;
    lastMoveT = 0;
    budgetPx = 0;
    car.speed = 0;
    car.steer = 0;
    root.visible = true;
    weapons.setActive(true);
    sfx?.setEngineActive?.(false);
    setModeUI(true);
    // Pointer lock hneď: v prvej osobe bez neho myš nekontroluje pohľad
    // (a klik by sa spotreboval na získanie locku namiesto výstrelu).
    requestLock();
    if (toast) toast('Vystúpil si z auta · myš = pohľad · LMB = strielať · 1–5 = zbraň · R = prebiť · ENTER = naspäť', 3600);
    return true;
  }

  function enter() {
    if (!foot.active || !car) return false;
    const dx = foot.x - car.x, dz = foot.z - car.z;
    if (dx * dx + dz * dz > ENTER_RADIUS * ENTER_RADIUS) {
      if (toast) toast('K autu sa musíš priblížiť (do 4 m).');
      return false;
    }
    foot.active = false;
    root.visible = false;
    if (blob) blob.visible = false;
    weapons.setActive(false);
    sfx?.setEngineActive?.(true);
    setModeUI(false);
    if (document.pointerLockElement === canvas) document.exitPointerLock?.();
    if (toast) toast('Nastúpil si do Octavie.');
    return true;
  }

  function toggleVehicle() {
    return foot.active ? enter() : exit();
  }

  function animate(dt) {
    root.position.set(foot.x, foot.y, foot.z);
    root.rotation.y = foot.h;
    if (foot.moveSpeed > 0.15) foot.phase += foot.moveSpeed * dt * 2.9;
    const walk = Math.min(1, foot.moveSpeed / WALK_SPEED);
    const swing = Math.sin(foot.phase) * 0.58 * walk;
    body.legs[0].rotation.x = swing;
    body.legs[1].rotation.x = -swing;
    const aim = -1.38 - foot.pitch * 0.45;
    body.arms[0].rotation.x = aim + Math.sin(foot.phase) * 0.025 * walk;
    body.arms[1].rotation.x = aim - Math.sin(foot.phase) * 0.025 * walk;
    body.arms[0].rotation.z = 0.1;
    body.arms[1].rotation.z = -0.06;
    body.torso.rotation.y = 0;
  }

  function updateActive(dt) {
    const k = input?.keys || {};
    const locked = document.pointerLockElement === canvas;
    const left = !!(k.KeyA || k.ArrowLeft || input?.touch?.left);
    const right = !!(k.KeyD || k.ArrowRight || input?.touch?.right);
    const fwd = (k.KeyW || k.ArrowUp || input?.touch?.gas ? 1 : 0) - (k.KeyS || k.ArrowDown || input?.touch?.brake ? 1 : 0);
    let strafe = 0;
    if (locked) strafe = (right ? 1 : 0) - (left ? 1 : 0);
    else foot.yaw += ((left ? 1 : 0) - (right ? 1 : 0)) * 2.3 * dt;

    foot.sprint = !!(k.ShiftLeft || k.ShiftRight);
    const speed = fwd < 0 ? BACK_SPEED : (foot.sprint ? RUN_SPEED : WALK_SPEED);
    let mx = 0, mz = 0;
    if (fwd !== 0 || strafe !== 0) {
      // Konvencia hry (rovnaká ako auto v physics/vehicle.js): dopredu =
      // (sin yaw, cos yaw), doprava = (−cos yaw, sin yaw). Pôvodný kód tu mal
      // (cos yaw, −sin yaw), čo je PRESNE opačné — D posúval chodca doľava.
      const fx = Math.sin(foot.yaw), fz = Math.cos(foot.yaw);
      const rx = -Math.cos(foot.yaw), rz = Math.sin(foot.yaw);
      mx = fx * fwd + rx * strafe;
      mz = fz * fwd + rz * strafe;
      const l = Math.sqrt(mx * mx + mz * mz) || 1;
      mx /= l; mz /= l;
      foot.x += mx * speed * dt;
      foot.z += mz * speed * dt;
      foot.moveSpeed += (speed - foot.moveSpeed) * Math.min(1, dt * 11);
    } else {
      foot.moveSpeed += (0 - foot.moveSpeed) * Math.min(1, dt * 13);
      if (foot.moveSpeed < 0.08) foot.moveSpeed = 0;
    }
    foot.h = foot.yaw;
    pushOut();
    const ground = groundAt(foot.x, foot.z);
    const jump = !!(k.Space || input?.touch?.hand);
    if (jump && !foot.space && foot.grounded) {
      foot.vy = JUMP_SPEED;
      foot.grounded = false;
    }
    foot.space = jump;
    if (!foot.grounded) {
      foot.vy -= GRAVITY * dt;
      foot.y += foot.vy * dt;
      if (foot.y <= ground) {
        foot.y = ground;
        foot.vy = 0;
        foot.grounded = true;
      }
    } else {
      foot.y = ground;
    }

    // PRVÁ OSOBA: kamera je v hlave chodca (nie 3.6 m za ním). Preto tu
    // už nie je potreba vytláčať kameru z budov a áut — hráčovo telo je
    // vytlačené z nich a kamera je v jeho strede.
    if (camera) {
      const walk = Math.min(1, foot.moveSpeed / WALK_SPEED);
      const bob = (Math.sin(foot.phase * 2) * 0.028 + Math.sin(foot.phase) * 0.012) * walk;
      camera.position.set(foot.x, foot.y + EYE_H + bob, foot.z);
      camera.rotation.order = 'YXZ';
      camera.rotation.set(foot.pitch, foot.yaw + Math.PI, 0);
    }
    if (blob) {
      blob.visible = true;
      blob.position.set(foot.x, ground + 0.03, foot.z);
    }
    animate(dt);
    root.updateMatrixWorld(true);
    weapons.update(dt, foot);
    peds.update(dt, foot.x, foot.z);
    if (hitTimer > 0) {
      hitTimer -= dt;
      if (hitTimer <= 0) cross?.classList.remove('hit', 'kill');
    }
  }

  function updateAmbient(dt, x, z) {
    if (root.visible) root.visible = false;
    if (blob && blob.visible) blob.visible = false;
    // Neaktívne zbrane musia dobehnúť časovače (stopy striel, prebíjanie),
    // inak by posledné tracery ostali visieť v scéne naveky.
    weapons.update(dt, null);
    peds.update(dt, x, z);
  }

  if (canvas) {
    canvas.addEventListener('contextmenu', (e) => { if (foot.active) e.preventDefault(); });
    canvas.addEventListener('mousedown', (e) => {
      if (!foot.active || e.button !== 0) return;
      // Klik zároveň žiada pointer lock, ale VÝSTREL sa nikdy nevytratí —
      // inak by sa v prehliadači bez locku nedalo vystreliť vôbec.
      if (document.pointerLockElement !== canvas) requestLock();
      weapons.pressTrigger();
    });
    addEventListener('mouseup', (e) => {
      if (foot.active && e.button === 0) weapons.releaseTrigger();
    });
    addEventListener('mousemove', (e) => {
      // Priemyselný čas: rozpočet sa dopĺňa od posledného eventu (px/ms),
      // takže strop je nezávislý od FPS aj od hustoty eventov.
      const ts = typeof e.timeStamp === 'number' && e.timeStamp > 0 ? e.timeStamp : performance.now();
      const gap = lastMoveT ? Math.max(0, ts - lastMoveT) : 16;
      lastMoveT = ts;
      // Pauza (nastavenia/veľká mapa/skrytý tab): pohľad NESMIE rotovať — inak
      // sa pohľad zmení pod prekrytím a po zavretí menu je posunutý.
      if (!foot.active || (opts.paused && opts.paused())) { budgetPx = 0; return; }
      const locked = document.pointerLockElement === canvas;
      // Bez pointer locku myš neotáča (A/D otáčajú), kým sa lock nepodarí.
      // Ak ho prehliadač zablokuje (lockFailed), funguje relatívny pohyb
      // myši ako fallback — hráč sa aspoň dá otočiť.
      if (!locked && !lockFailed) { budgetPx = 0; return; }
      // Aplikácia HNEĎ v handleri (žiadna latencia na ďalší snímok).
      budgetPx = Math.min(LOOK_BUDGET, budgetPx + gap * LOOK_RATE);
      const s = LOOK_SENS * sensFactor();
      const tx = Math.max(-budgetPx, Math.min(budgetPx, e.movementX || 0));
      const ty = Math.max(-budgetPx, Math.min(budgetPx, e.movementY || 0));
      budgetPx -= Math.abs(tx) + Math.abs(ty);
      // yaw rastie = otočka DOĽAVA (rovnaká konvencia ako auto: A = doľava),
      // takže myš vpravo musí yaw znížiť. Predtým bolo plus → myš bola
      // obrátená (pohyb vpravo otáčal pohľad doľava).
      foot.yaw -= tx * s;
      // Mäkká zóna pitchu: znamienko kroku zostáva, magnitude sa pri blížení
      // k clampu tlmení — žiadny trh už nenadosadí pitch natvrdo na ±PITCH_MAX.
      let np = foot.pitch - ty * s;
      const over = Math.abs(np) - PITCH_SOFT;
      if (over > 0) {
        const k = Math.max(0.12, 1 - (over / (PITCH_MAX - PITCH_SOFT)) * 0.88);
        np = foot.pitch + (np - foot.pitch) * k;
      }
      foot.pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, np));
    });
    addEventListener('wheel', (e) => {
      if (!foot.active) return;
      e.preventDefault();
      weapons.cycle(e.deltaY);
    }, { passive: false });
    canvas.addEventListener('pointerdown', (e) => {
      if (!foot.active || e.pointerType !== 'touch') return;
      touchLook = e.pointerId;
      touchX = e.clientX;
      touchY = e.clientY;
      canvas.setPointerCapture?.(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (touchLook !== e.pointerId) return;
      const dx = e.clientX - touchX, dy = e.clientY - touchY;
      touchX = e.clientX; touchY = e.clientY;
      const s = TOUCH_SENS * sensFactor();
      // Rovnaké znamienko ako myš: prst vpravo = pohľad vpravo.
      foot.yaw -= dx * s;
      let np = foot.pitch - dy * s;
      const over = Math.abs(np) - PITCH_SOFT;
      if (over > 0) {
        const k = Math.max(0.12, 1 - (over / (PITCH_MAX - PITCH_SOFT)) * 0.88);
        np = foot.pitch + (np - foot.pitch) * k;
      }
      foot.pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, np));
    });
    const endTouch = (e) => { if (touchLook === e.pointerId) touchLook = -1; };
    canvas.addEventListener('pointerup', endTouch);
    canvas.addEventListener('pointercancel', endTouch);
  }

  const fireBtn = document.getElementById('t-fire');
  if (fireBtn) {
    const down = (e) => { e.preventDefault(); if (foot.active) weapons.pressTrigger(); };
    const up = (e) => { e.preventDefault(); weapons.releaseTrigger(); };
    fireBtn.addEventListener('pointerdown', down);
    fireBtn.addEventListener('pointerup', up);
    fireBtn.addEventListener('pointercancel', up);
    fireBtn.addEventListener('pointerleave', up);
  }
  document.getElementById('t-use')?.addEventListener('click', (e) => {
    e.preventDefault();
    toggleVehicle();
  });
  document.getElementById('t-swap')?.addEventListener('click', (e) => {
    e.preventDefault();
    if (foot.active) weapons.cycle(1);
  });
  setModeUI(false);

  return {
    foot, peds, weapons,
    get active() { return foot.active; },
    exit, enter, toggleVehicle,
    handleKey(code) {
      if (code === 'Enter' || code === 'NumpadEnter') return toggleVehicle();
      if (!foot.active) return false;
      return weapons.handleKey(code);
    },
    updateActive, updateAmbient,
    cameraPosition() { return camera ? camera.position : null; },
  };
}
