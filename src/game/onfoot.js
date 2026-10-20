import * as THREE from 'three';
import { S } from '../world/shared.js';
import { nearestRoute, ALL_CARS } from '../ai/traffic.js';
import { getTerrainHeight, wheelGroundY } from '../world/height.js';
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
const LOOK_SENS = 0.0022;
const FOOT_GQ = new Int32Array(GQ_MAX);
const CAM_PT = { x: 0, z: 0 };

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

function buildBody(weaponHolder) {
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
  root.add(weaponHolder);
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
  const body = buildBody(weapons.holder);
  const root = body.root;
  if (scene) scene.add(root);

  const foot = {
    active: false, x: startX, y: 0, z: startZ, h: 0, yaw: 0, pitch: -0.07,
    vy: 0, grounded: true, moveSpeed: 0, sprint: false, phase: 0, space: false,
  };
  let touchLook = -1;
  let touchX = 0, touchY = 0;
  let noLock = false;

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
    if (!canvas || !canvas.requestPointerLock) { noLock = true; return; }
    try {
      const p = canvas.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(() => { noLock = true; });
    } catch { noLock = true; }
  }

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
    car.speed = 0;
    car.steer = 0;
    root.visible = true;
    weapons.setActive(true);
    sfx?.setEngineActive?.(false);
    setModeUI(true);
    if (toast) toast('Vystúpil si z auta · ENTER = naspäť · 1–5 = zbraň · R = prebiť', 3200);
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
      const fx = Math.sin(foot.yaw), fz = Math.cos(foot.yaw);
      const rx = Math.cos(foot.yaw), rz = -Math.sin(foot.yaw);
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

    const cosP = Math.cos(foot.pitch);
    const dx = Math.sin(foot.yaw) * cosP;
    const dz = Math.cos(foot.yaw) * cosP;
    const dy = Math.sin(foot.pitch);
    if (camera) {
      const tx = foot.x, ty = foot.y + 1.48, tz = foot.z;
      let cx = tx - dx * 3.6;
      let cy = ty - dy * 3.6 + 0.18;
      let cz = tz - dz * 3.6;
      // Kamera nesmie skončiť v aute ani v budove — inak pri chôdzi pozdĺž
      // zaparkovaného auta vidíš zvnútra jeho kapotu (žlté "dosky" cez celú
      // obrazovku). Vytlačí sa kolmo von ako chodec, len s menším polomerom.
      CAM_PT.x = cx; CAM_PT.z = cz;
      for (let pass = 0; pass < 2; pass++) {
        let moved = false;
        const nb = gridQuery(S.BGRID, CAM_PT.x, CAM_PT.z, 1, FOOT_GQ);
        for (let i = 0; i < nb; i++) {
          const b = FOOT_GQ[i];
          if (pushRect(CAM_PT, S.BX.x[b], S.BX.z[b], S.BX.rot[b], S.BX.hw[b], S.BX.hl[b], 0.3)) moved = true;
        }
        for (let i = 0; i < ALL_CARS.length; i++) {
          const c = ALL_CARS[i];
          if (c.hidden) continue;
          const ddx = c.x - CAM_PT.x, ddz = c.z - CAM_PT.z;
          if (ddx * ddx + ddz * ddz > 36) continue;
          if (pushRect(CAM_PT, c.x, c.z, c.h, 0.95, 2.15, 0.35)) moved = true;
        }
        if (car && pushRect(CAM_PT, car.x, car.z, car.h, 0.95, 2.15, 0.35)) moved = true;
        if (!moved) break;
      }
      cx = CAM_PT.x; cz = CAM_PT.z;
      const minY = getTerrainHeight(cx, cz) + 0.35;
      if (cy < minY) cy = minY;
      camera.position.set(cx, cy, cz);
      camera.rotation.order = 'YXZ';
      camera.rotation.set(foot.pitch, foot.yaw + Math.PI, 0);
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
    // Neaktívne zbrane musia dobehnúť časovače (stopy striel, prebíjanie),
    // inak by posledné tracery ostali visieť v scéne naveky.
    weapons.update(dt, null);
    peds.update(dt, x, z);
  }

  if (canvas) {
    canvas.addEventListener('contextmenu', (e) => { if (foot.active) e.preventDefault(); });
    canvas.addEventListener('mousedown', (e) => {
      if (!foot.active || e.button !== 0) return;
      if (document.pointerLockElement !== canvas && !noLock) {
        requestLock();
        return;
      }
      weapons.pressTrigger();
    });
    addEventListener('mouseup', (e) => {
      if (foot.active && e.button === 0) weapons.releaseTrigger();
    });
    addEventListener('mousemove', (e) => {
      if (!foot.active || document.pointerLockElement !== canvas) return;
      foot.yaw += e.movementX * LOOK_SENS;
      foot.pitch = Math.max(-1.05, Math.min(1.05, foot.pitch - e.movementY * LOOK_SENS));
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
      foot.yaw += dx * 0.006;
      foot.pitch = Math.max(-1.05, Math.min(1.05, foot.pitch - dy * 0.005));
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
