import * as THREE from 'three';
import { getTerrainHeight } from '../world/height.js';
import { ALL_CARS } from '../ai/traffic.js';
import { emitSparks, psEmit } from './drift.js';

export const WEAPONS = [
  { id: '9mm', name: '9MM', mag: 17, reserve: 136, rpm: 330, auto: false,
    damage: 26, range: 95, spread: 0.006, recoil: 0.022, reload: 1.25, muzzleZ: 0.36, color: 0xffd27a },
  { id: 'mp5', name: 'MP5', mag: 30, reserve: 240, rpm: 800, auto: true,
    damage: 18, range: 130, spread: 0.014, recoil: 0.007, reload: 1.75, muzzleZ: 0.53, color: 0xffd27a },
  { id: 'bmg', name: '50 BMG', mag: 10, reserve: 30, rpm: 55, auto: false,
    damage: 170, range: 520, spread: 0.0016, recoil: 0.075, reload: 2.9, muzzleZ: 0.78, color: 0xffe9b0 },
  { id: 'tec9', name: 'TEC-9', mag: 32, reserve: 256, rpm: 900, auto: true,
    damage: 16, range: 90, spread: 0.03, recoil: 0.008, reload: 1.5, muzzleZ: 0.5, color: 0xffc46a },
  { id: 'ak47', name: 'AK-47', mag: 30, reserve: 240, rpm: 600, auto: true,
    damage: 36, range: 300, spread: 0.012, recoil: 0.019, reload: 2.1, muzzleZ: 0.64, color: 0xffd27a },
];
const TRACERS = 40;
const _muzzle = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();

function steel(c, rough = 0.45, metal = 0.22) {
  return new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal });
}

function buildModels() {
  const holder = new THREE.Group();
  const all = [];
  const dark = steel(0x3c4249, 0.42, 0.3);
  dark.emissive = new THREE.Color(0x14181d); // kov bez envMapu by bol úplne čierny
  const polymer = steel(0x111214, 0.72, 0.12);
  const wood = steel(0x6d3f1e, 0.72, 0.05);
  const tan = steel(0x8a7a5a, 0.7, 0.08);
  const sight = new THREE.MeshBasicMaterial({ color: 0x8cffb0, toneMapped: false });

  const add = (g, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    g.add(m);
    return m;
  };
  const box = (g, w, h, d, mat, x, y, z, rx = 0, ry = 0, rz = 0) =>
    add(g, new THREE.BoxGeometry(w, h, d), mat, x, y, z, rx, ry, rz);
  const cyl = (g, r, len, mat, x, y, z) =>
    add(g, new THREE.CylinderGeometry(r, r, len, 12), mat, x, y, z, Math.PI / 2, 0, 0);

  function weaponGroup() {
    const g = new THREE.Group();
    g.visible = false;
    holder.add(g);
    all.push(g);
    return g;
  }

  let g = weaponGroup();
  box(g, 0.072, 0.085, 0.3, dark, 0, 0.06, 0.09);
  box(g, 0.062, 0.16, 0.085, polymer, 0, -0.035, -0.015, -0.2);
  box(g, 0.05, 0.03, 0.12, polymer, 0, -0.005, 0.08);
  cyl(g, 0.022, 0.13, dark, 0, 0.06, 0.27);
  box(g, 0.012, 0.022, 0.02, sight, 0, 0.112, 0.23);

  g = weaponGroup();
  box(g, 0.085, 0.115, 0.4, dark, 0, 0.04, 0.05);
  box(g, 0.06, 0.24, 0.09, polymer, 0, -0.13, 0.02, 0.12);
  box(g, 0.075, 0.075, 0.2, polymer, 0, 0.02, -0.27);
  box(g, 0.065, 0.15, 0.07, polymer, 0, -0.075, -0.08, -0.18);
  cyl(g, 0.021, 0.22, dark, 0, 0.06, 0.35);
  cyl(g, 0.034, 0.13, polymer, 0, 0.04, 0.26);
  box(g, 0.012, 0.03, 0.025, sight, 0, 0.11, 0.2);

  g = weaponGroup();
  box(g, 0.1, 0.12, 0.78, dark, 0, 0.02, 0.08);
  box(g, 0.085, 0.11, 0.35, tan, 0, 0.01, -0.42);
  box(g, 0.07, 0.21, 0.1, polymer, 0, -0.13, 0.02, 0.1);
  cyl(g, 0.027, 0.62, dark, 0, 0.045, 0.62);
  box(g, 0.085, 0.07, 0.13, dark, 0, 0.045, 0.91);
  cyl(g, 0.045, 0.22, polymer, 0, 0.145, 0.08);
  box(g, 0.075, 0.03, 0.08, sight, 0, 0.21, -0.03);
  box(g, 0.012, 0.12, 0.025, dark, -0.07, -0.08, 0.66, 0, 0, 0.24);
  box(g, 0.012, 0.12, 0.025, dark, 0.07, -0.08, 0.66, 0, 0, -0.24);

  g = weaponGroup();
  box(g, 0.075, 0.11, 0.34, dark, 0, 0.03, 0.03);
  box(g, 0.06, 0.22, 0.08, polymer, 0, -0.13, 0.11, 0.08);
  box(g, 0.055, 0.14, 0.065, polymer, 0, -0.065, -0.09, -0.14);
  cyl(g, 0.035, 0.24, polymer, 0, 0.045, 0.3);
  cyl(g, 0.018, 0.12, dark, 0, 0.045, 0.47);
  box(g, 0.012, 0.024, 0.02, sight, 0, 0.105, 0.18);

  g = weaponGroup();
  box(g, 0.082, 0.11, 0.42, dark, 0, 0.02, 0.05);
  box(g, 0.078, 0.075, 0.22, wood, 0, 0.025, 0.3);
  box(g, 0.07, 0.11, 0.31, wood, 0, -0.005, -0.35);
  box(g, 0.062, 0.19, 0.11, dark, 0, -0.14, 0.13, 0.28);
  box(g, 0.055, 0.15, 0.065, polymer, 0, -0.065, -0.1, -0.16);
  cyl(g, 0.018, 0.42, dark, 0, 0.055, 0.59);
  cyl(g, 0.01, 0.16, dark, 0, 0.105, 0.38);
  box(g, 0.012, 0.027, 0.018, sight, 0, 0.105, 0.5);
  box(g, 0.025, 0.06, 0.03, sight, 0, 0.115, 0.22);

  holder.rotation.order = 'YXZ';
  // Viewmodel sa zobrazuje 45 cm od očí — modely sú v "svetej" mierke
  // (pištoľ 30 cm, AK 1.3 m), takže ich zmenšujeme na reálnu veľkosť
  // a posúvame od očí, inak by zbraň vyplnila pol obrazovky.
  holder.scale.set(0.6, 0.6, 0.6);

  const flashCanvas = document.createElement('canvas');
  flashCanvas.width = 64;
  flashCanvas.height = 64;
  const fctx = flashCanvas.getContext('2d');
  const grad = fctx.createRadialGradient(32, 32, 2, 32, 32, 31);
  grad.addColorStop(0, 'rgba(255,255,235,1)');
  grad.addColorStop(0.28, 'rgba(255,220,110,0.95)');
  grad.addColorStop(0.7, 'rgba(255,130,20,0.45)');
  grad.addColorStop(1, 'rgba(255,80,0,0)');
  fctx.fillStyle = grad;
  fctx.fillRect(0, 0, 64, 64);
  const flashTex = new THREE.CanvasTexture(flashCanvas);
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({
    map: flashTex, color: 0xffffff, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
  }));
  flash.scale.set(0.42, 0.42, 1);
  flash.visible = false;
  holder.add(flash);
  return { holder, all, flash };
}

export function createWeapons(opts = {}) {
  const scene = opts.scene || null;
  const camera = opts.camera || null;
  const peds = opts.peds || null;
  const sfx = opts.sfx || null;
  const toast = typeof opts.toast === 'function' ? opts.toast : null;
  const onHit = typeof opts.onHit === 'function' ? opts.onHit : null;
  const models = buildModels();
  const holder = models.holder;
  const flash = models.flash;
  // Zbraň je "viewmodel" — žije v priestore kamery (prvá osoba), nie na tele
  // chodca. Preto je v scéne a každý snímok ju poskladáme podľa kamery.
  holder.visible = false;
  if (scene) scene.add(holder);
  const ammo = WEAPONS.map((w) => ({ mag: w.mag, reserve: w.reserve }));
  let current = 0;
  let cooldown = 0;
  let reloadT = 0;
  let kick = 0;
  let flashT = 0;
  let active = false;
  let triggerHeld = false;
  let triggerPressed = false;
  let hudDirty = true;

  const tracerGeo = new THREE.BufferGeometry();
  const tracerPos = new Float32Array(TRACERS * 6);
  const tracerCol = new Float32Array(TRACERS * 6);
  const tracerLife = new Float32Array(TRACERS);
  for (let i = 0; i < TRACERS; i++) {
    tracerPos[i * 6 + 1] = -999;
    tracerPos[i * 6 + 4] = -999;
  }
  tracerGeo.setAttribute('position', new THREE.BufferAttribute(tracerPos, 3).setUsage(THREE.DynamicDrawUsage));
  tracerGeo.setAttribute('color', new THREE.BufferAttribute(tracerCol, 3).setUsage(THREE.DynamicDrawUsage));
  const tracerMat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.92,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false,
  });
  const tracers = new THREE.LineSegments(tracerGeo, tracerMat);
  tracers.frustumCulled = false;
  if (scene) scene.add(tracers);
  let tracerIdx = 0;

  const elName = document.getElementById('w-name');
  const elMag = document.getElementById('w-mag');
  const elReserve = document.getElementById('w-reserve');
  const elAmmo = document.getElementById('w-ammo');
  const slots = Array.from(document.querySelectorAll('.wslot'));
  for (let i = 0; i < slots.length; i++) {
    slots[i].addEventListener('click', (e) => {
      e.preventDefault();
      select(i);
    });
  }

  function updateHUD() {
    const w = WEAPONS[current];
    const a = ammo[current];
    if (elName) elName.textContent = reloadT > 0 ? `${w.name} · PREBÍJAM` : w.name;
    if (elMag) elMag.textContent = String(a.mag);
    if (elReserve) elReserve.textContent = String(a.reserve);
    if (elAmmo) {
      elAmmo.classList.toggle('empty', a.mag <= 0);
      elAmmo.classList.toggle('low', a.mag > 0 && a.mag <= Math.ceil(w.mag * 0.25));
    }
    for (let i = 0; i < slots.length; i++) slots[i].classList.toggle('on', i === current);
    hudDirty = false;
  }

  function showCurrent() {
    for (let i = 0; i < models.all.length; i++) models.all[i].visible = i === current;
    const mz = WEAPONS[current].muzzleZ;
    flash.position.set(0, 0.045, mz);
  }

  function select(i) {
    if (i < 0 || i >= WEAPONS.length || i === current) return;
    current = i;
    reloadT = 0;
    triggerPressed = false;
    cooldown = Math.min(cooldown, 0.08);
    kick = 0;
    showCurrent();
    hudDirty = true;
    updateHUD();
  }

  function cycle(delta) {
    const n = WEAPONS.length;
    select((current + (delta > 0 ? 1 : n - 1)) % n);
  }

  function startReload() {
    const w = WEAPONS[current];
    const a = ammo[current];
    if (reloadT > 0 || a.mag >= w.mag || a.reserve <= 0) return false;
    reloadT = w.reload;
    triggerPressed = false;
    hudDirty = true;
    updateHUD();
    return true;
  }

  function finishReload() {
    const w = WEAPONS[current];
    const a = ammo[current];
    const need = w.mag - a.mag;
    const take = Math.min(need, a.reserve);
    a.mag += take;
    a.reserve -= take;
    reloadT = 0;
    hudDirty = true;
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

  function traceCar(ox, oy, oz, dx, dy, dz, maxDist) {
    let best = maxDist, bi = -1;
    for (let i = 0; i < ALL_CARS.length; i++) {
      const c = ALL_CARS[i];
      if (c.hidden) continue;
      const t = raySphere(ox, oy, oz, dx, dy, dz, c.x, c.y + 0.72, c.z, 1.38);
      if (t >= 0 && t < best) { best = t; bi = i; }
    }
    return bi >= 0 ? best : -1;
  }

  function traceGround(ox, oy, oz, dx, dy, dz, maxDist) {
    for (let t = 0.7; t <= maxDist; t += 1.25) {
      const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
      if (y <= getTerrainHeight(x, z) + 0.1) return t;
    }
    return -1;
  }

  function addTracer(sx, sy, sz, ex, ey, ez, color) {
    const i = tracerIdx;
    tracerIdx = (tracerIdx + 1) % TRACERS;
    const o = i * 6;
    tracerPos[o] = sx; tracerPos[o + 1] = sy; tracerPos[o + 2] = sz;
    tracerPos[o + 3] = ex; tracerPos[o + 4] = ey; tracerPos[o + 5] = ez;
    const c = new THREE.Color(color);
    tracerCol[o] = c.r; tracerCol[o + 1] = c.g; tracerCol[o + 2] = c.b;
    tracerCol[o + 3] = c.r; tracerCol[o + 4] = c.g; tracerCol[o + 5] = c.b;
    tracerLife[i] = 0.075;
    tracerGeo.attributes.position.needsUpdate = true;
    tracerGeo.attributes.color.needsUpdate = true;
  }

  function updateTracers(dt) {
    let dirty = false;
    for (let i = 0; i < TRACERS; i++) {
      if (tracerLife[i] <= 0) continue;
      tracerLife[i] -= dt;
      if (tracerLife[i] <= 0) {
        tracerPos[i * 6 + 1] = -999;
        tracerPos[i * 6 + 4] = -999;
        dirty = true;
      }
    }
    if (dirty) tracerGeo.attributes.position.needsUpdate = true;
  }

  function fire(foot) {
    const w = WEAPONS[current];
    const a = ammo[current];
    if (w === undefined || a.mag <= 0) {
      if (a.reserve > 0) startReload();
      else if (toast) toast('DOŠLA MUNÍCIA · ' + w.name);
      return;
    }
    a.mag--;
    cooldown = 60 / w.rpm;
    kick = 1;
    flashT = 0.055;
    if (foot) foot.pitch = Math.min(1.05, foot.pitch + w.recoil * 0.55);
    if (sfx?.gunshot) sfx.gunshot(w.id);
    hudDirty = true;

    if (!camera) return;
    camera.getWorldDirection(_dir);
    _right.set(-_dir.z, 0, _dir.x).normalize();
    _up.crossVectors(_right, _dir).normalize();
    const spread = w.spread * (foot && Math.abs(foot.moveSpeed || 0) > 4.8 ? 1.8 : 1);
    const ang = Math.random() * Math.PI * 2;
    const rad = Math.sqrt(Math.random()) * spread;
    _dir.x += _right.x * Math.cos(ang) * rad + _up.x * Math.sin(ang) * rad;
    _dir.y += _right.y * Math.cos(ang) * rad + _up.y * Math.sin(ang) * rad;
    _dir.z += _right.z * Math.cos(ang) * rad + _up.z * Math.sin(ang) * rad;
    _dir.normalize();

    const ox = camera.position.x, oy = camera.position.y, oz = camera.position.z;
    let best = w.range, kind = '', index = -1;
    let hitX = ox + _dir.x * best, hitY = oy + _dir.y * best, hitZ = oz + _dir.z * best;
    if (peds) {
      const ph = peds.raycast(ox, oy, oz, _dir.x, _dir.y, _dir.z, best);
      if (ph.hit && ph.dist < best) {
        best = ph.dist; kind = 'ped'; index = ph.index;
        hitX = ph.x; hitY = ph.y; hitZ = ph.z;
      }
    }
    const ct = traceCar(ox, oy, oz, _dir.x, _dir.y, _dir.z, best);
    if (ct >= 0 && ct < best) {
      best = ct; kind = 'car'; index = -1;
      hitX = ox + _dir.x * best; hitY = oy + _dir.y * best; hitZ = oz + _dir.z * best;
    }
    const gt = traceGround(ox, oy, oz, _dir.x, _dir.y, _dir.z, best);
    if (gt >= 0 && gt < best) {
      best = gt; kind = 'ground'; index = -1;
      hitX = ox + _dir.x * best; hitY = oy + _dir.y * best; hitZ = oz + _dir.z * best;
    }

    _muzzle.set(0, 0.045, w.muzzleZ);
    holder.updateWorldMatrix(true, false);
    holder.localToWorld(_muzzle);
    addTracer(_muzzle.x, _muzzle.y, _muzzle.z, hitX, hitY, hitZ, w.color);
    psEmit(_muzzle.x, _muzzle.y, _muzzle.z,
      (Math.random() - 0.5) * 0.7, 0.4 + Math.random() * 0.5, (Math.random() - 0.5) * 0.7,
      0.22, 0.55, 0.5, 0.42, 0);
    if (kind === 'ped' && peds) {
      const killed = peds.damage(index, w.damage, foot ? foot.x : hitX, foot ? foot.z : hitZ);
      if (onHit) onHit(killed, index);
    } else if (kind !== '') {
      emitSparks(hitX, hitY, hitZ, kind === 'car' ? 8 : 5);
    }
    if (peds) peds.alert(foot ? foot.x : ox, foot ? foot.z : oz, 72);
    if (hudDirty) updateHUD();
  }

  function pressTrigger() { triggerHeld = true; triggerPressed = true; }
  function releaseTrigger() { triggerHeld = false; }
  function setActive(on) {
    active = !!on;
    triggerHeld = false;
    triggerPressed = false;
    flash.visible = false;
    holder.visible = !!on;
    if (!active) {
      reloadT = 0;
      kick = 0;
    }
  }

  function handleKey(code) {
    if (!active) return false;
    if (code.startsWith('Digit')) {
      const n = Number(code.slice(5));
      if (n >= 1 && n <= WEAPONS.length) { select(n - 1); return true; }
    }
    if (code === 'KeyR') { startReload(); return true; }
    return false;
  }

  function update(dt, foot) {
    cooldown -= dt;
    if (reloadT > 0) {
      reloadT -= dt;
      hudDirty = true;
      if (reloadT <= 0) finishReload();
    }
    if (active) {
      if (triggerPressed) {
        triggerPressed = false;
        if (reloadT <= 0 && cooldown <= 0) fire(foot);
      } else if (triggerHeld && WEAPONS[current].auto && reloadT <= 0 && cooldown <= 0) {
        fire(foot);
      }
    } else {
      triggerPressed = false;
    }
    if (flashT > 0) {
      flashT -= dt;
      flash.visible = flashT > 0;
    }
    if (kick > 0) kick = Math.max(0, kick - dt * (WEAPONS[current].id === 'bmg' ? 7 : 12));
    placeHolder(foot);
    updateTracers(dt);
    if (hudDirty) updateHUD();
  }

  // VIEWMODEL: zbraň sa drží v zornom poli kamery (prvá osoba). Drží sa
  // napravo a dole od očí, takže zameriavač ostáva čistý; pri výstrele
  // vystrelí (kick) dozadu a nahor.
  function placeHolder(foot) {
    if (!foot || !camera) {
      if (holder.visible) holder.visible = false;
      return;
    }
    holder.visible = true;
    holder.position.copy(camera.position);
    holder.quaternion.copy(camera.quaternion);
    holder.translateX(0.22);
    holder.translateY(-0.19);
    holder.translateZ(-0.46);
    // Modely zbraní mieria na +Z, kamera pozerá na -Z → 180° okolo Y.
    holder.rotateY(Math.PI);
    holder.rotateX(-kick * 0.16);
  }

  showCurrent();
  updateHUD();
  return {
    holder, flash, select, cycle, pressTrigger, releaseTrigger, handleKey,
    setActive, update, reload: startReload, isReloading: () => reloadT > 0,
    current: () => WEAPONS[current], setWeaponHud: updateHUD,
  };
}
