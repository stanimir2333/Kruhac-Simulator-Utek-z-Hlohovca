// src/ui/engineViz.js — pôdorys motora: štvorvalec 1.9 TDI alebo 1-rotor wankel v reze.
// Simulácia sleduje otáčky motora, ale SLOW spomaľuje len jej čas, nikdy fyziku auta.

// ---------- ROZMERY ----------
const TDI_W = 200;
const TDI_H = 84;
// Wankel v reze potrebuje štvorec na epitrochoid + popisky (vzoru rotary.gif).
const WANK_W = 200;
const WANK_H = 168;
const SLOW_SCALE = 0.08;
// Pracovné zdvihy sú v poradí 1–3–4–2, každý posunutý o 180° kľuky.
const CYL_OFFSETS = [0.5, 0.25, 0.75, 0];

// ---------- WANKEL GEOMETRIA ----------
// Komora je epitrochoida: H(t) = R∠t + e∠3t. Vrcholy rotora ležia presne na nej,
// stred rotora obieha po kruhu s polomerom e a rotor sa točí tretinovou
// rýchlosťou výstredníka (planetový prevod 3:1, vnútorné ozubenie 18:12).
const W_E = 0.15;
const W_CX = 100;
const W_CY = 90;
const W_S = 44;
// Uhlové stredy pracovných zón (plátno, y dole: 0° = vpravo, -90° = hore).
const ZONE = {
  intake: -155 * Math.PI / 180, // sací kanál vľavo hore
  compression: -90 * Math.PI / 180, // kompresia hore
  ignition: 10 * Math.PI / 180, // sviečky vpravo
  exhaust: 155 * Math.PI / 180, // výfuk vľavo dole
};
// Čelo sviečok (parameter t komory) — zážih, keď vrchol pretne túto polohu.
const PLUG_T = 10 * Math.PI / 180;
const FIRE_FRAC = 3 * PLUG_T / (Math.PI * 2);
const TAU = Math.PI * 2;

export function createEngineViz() {
  const canvas = document.getElementById('engine-canvas');
  const mode = document.getElementById('engine-slow');
  const ctx = canvas?.getContext('2d');
  let W = TDI_W;
  let H = TDI_H;
  let phase = 0;
  let slow = false;
  let wankel = false;

  function syncMode() {
    if (!mode) return;
    mode.classList.toggle('on', slow);
    mode.textContent = slow ? 'SLOW ×0,08 [V]' : 'SLOW [V]';
    mode.setAttribute('aria-pressed', String(slow));
  }

  function toggle() {
    slow = !slow;
    syncMode();
    return slow;
  }

  // Prepnutie motora z main.js ('tdi' | 'wankel'); prekreslí sa najbližším update().
  // Wankel si zväčší plátno na štvorec, TDI ho vráti na pásik.
  function setEngine(id) {
    wankel = id === 'wankel';
    W = wankel ? WANK_W : TDI_W;
    H = wankel ? WANK_H : TDI_H;
    if (canvas && (canvas.width !== W || canvas.height !== H)) {
      canvas.width = W;
      canvas.height = H;
    }
    canvas?.setAttribute('aria-label', wankel
      ? 'Rotačný motor v reze: epitrochoidná komora, rotor a fázy'
      : 'Animované valce motora 1.9 TDI');
  }

  mode?.addEventListener('click', toggle);
  syncMode();

  function draw() {
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#080a0c'; ctx.fillRect(0, 0, W, H);
    if (wankel) { drawWankel(); return; }
    drawTdi();
  }

  function drawTdi() {
    for (let i = 0; i < 4; i++) {
      const local = (phase - CYL_OFFSETS[i] + 1) % 1;
      const power = local >= 0.5 && local < 0.75;
      const x = 27 + i * 49;
      // Čistý kruh: pevný polomer, žiadna elipsa ani pulzovanie tvaru.
      const radius = 17;

      ctx.save();
      ctx.fillStyle = power ? '#ff0000' : '#1f252a';
      ctx.strokeStyle = power ? '#ff0000' : '#69737a';
      ctx.lineWidth = power ? 2.4 : 1.4;
      // Žiara len čisto červená, žiadne oranžové/žlté efekty.
      if (power) { ctx.shadowColor = '#ff0000'; ctx.shadowBlur = 18; }
      ctx.beginPath(); ctx.arc(x, H / 2, radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }

  // Bod komory v pixloch pre parameter t.
  function housingPt(t) {
    return [
      W_CX + W_S * (Math.cos(t) + W_E * Math.cos(3 * t)),
      W_CY + W_S * (Math.sin(t) + W_E * Math.sin(3 * t)),
    ];
  }

  // Ozubené koleso (lichobežníkové zuby), plné — cesta sa len vykreslí.
  function gearPath(x, y, r, teeth, toothH, rot) {
    ctx.beginPath();
    let started = false;
    const step = TAU / teeth;
    const hw = step * 0.22;
    for (let i = 0; i < teeth; i++) {
      const a = rot + i * step;
      const corners = [
        [a - hw * 1.6, r], [a - hw, r + toothH],
        [a + hw, r + toothH], [a + hw * 1.6, r],
      ];
      for (const [ang, rad] of corners) {
        const px = x + Math.cos(ang) * rad, py = y + Math.sin(ang) * rad;
        if (!started) { ctx.moveTo(px, py); started = true; }
        else ctx.lineTo(px, py);
      }
      // Oblúk medzi zubami po základnej kružnici.
      ctx.arc(x, y, r, a + hw * 1.6, a + step - hw * 1.6);
    }
    ctx.closePath();
  }

  // Váha zóny pre uhol komory psi: 1 v strede zóny, 0 mimo.
  function zoneW(psi, center) {
    let d = psi - center;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    const c = Math.cos(d);
    return c <= 0 ? 0 : c * c;
  }

  // 1-rotor v reze podľa rotary.gif: epitrochoidná komora, oranžový trojboký
  // rotor s vnútorným ozubením, kanály INTAKE/EXHAUST, dve sviečky a popisky
  // štyroch fáz. Odtiene komôr aj jas popiskov bežia z polohy rotora.
  function drawWankel() {
    const shaft = phase * TAU; // uhol výstredníka
    const rot = shaft / 3; // uhol rotora (prevod 3:1)
    const rcx = W_CX + W_S * W_E * Math.cos(shaft);
    const rcy = W_CY + W_S * W_E * Math.sin(shaft);

    // Vrcholy rotora = body komory pre t_k (tesnia presne, bez medzery).
    const apex = [0, 1, 2].map((k) => housingPt(rot + k * TAU / 3));

    // Komory: oblúk komory t0→t1 + bok rotora späť. Odtieň podľa dominantnej zóny.
    const acts = { intake: 0, compression: 0, ignition: 0, exhaust: 0 };
    const fills = [];
    const TINT = {
      intake: '#3aa0ff', compression: '#ffc933', ignition: '#ff3b1f', exhaust: '#9aa2ab',
    };
    for (let k = 0; k < 3; k++) {
      const t0 = rot + k * TAU / 3;
      const midT = t0 + TAU / 6;
      const midA = rot + (k + 0.5) * TAU / 3;
      const [hx, hy] = housingPt(midT);
      const fx = rcx + Math.cos(midA) * W_S * 0.62;
      const fy = rcy + Math.sin(midA) * W_S * 0.62;
      const psi = Math.atan2((hy + fy) / 2 - W_CY, (hx + fx) / 2 - W_CX);
      const w = {
        intake: zoneW(psi, ZONE.intake),
        compression: zoneW(psi, ZONE.compression),
        ignition: zoneW(psi, ZONE.ignition),
        exhaust: zoneW(psi, ZONE.exhaust),
      };
      for (const key of Object.keys(acts)) acts[key] = Math.max(acts[key], w[key]);
      let dom = 'exhaust';
      for (const key of Object.keys(w)) if (w[key] > w[dom]) dom = key;
      fills.push({ t0, midA, dom, w: w[dom] });
    }

    // Zážih: doznievanie po pretne vrcholu cez sviečku (1× za otáčku výstredníka).
    const frac = ((phase % 1) + 1) % 1;
    const sinceFire = (frac - FIRE_FRAC + 1) % 1;
    const flash = Math.exp(-sinceFire / 0.09);

    // ---------- KOMORA ----------
    ctx.save();
    const grad = ctx.createLinearGradient(0, W_CY - 55, 0, W_CY + 55);
    grad.addColorStop(0, '#dfe3e7');
    grad.addColorStop(0.55, '#a8aeb5');
    grad.addColorStop(1, '#7c828a');
    ctx.beginPath();
    for (let i = 0; i <= 140; i++) {
      const [x, y] = housingPt(i / 140 * TAU);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();

    // Odtiene pracovných fáz (priesvitné cez šedý podklad komory).
    for (let k = 0; k < 3; k++) {
      const f = fills[k];
      ctx.beginPath();
      for (let i = 0; i <= 14; i++) {
        const [x, y] = housingPt(f.t0 + i / 14 * TAU / 3);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      const a = apex[k];
      const ccx = rcx + Math.cos(f.midA) * W_S * 0.74;
      const ccy = rcy + Math.sin(f.midA) * W_S * 0.74;
      ctx.quadraticCurveTo(ccx, ccy, a[0], a[1]);
      ctx.closePath();
      let alpha = 0.18 + 0.4 * f.w;
      let col = TINT[f.dom];
      if (f.dom === 'ignition') { alpha = Math.min(0.85, alpha + flash * 0.5); col = '#ff3b1f'; }
      ctx.globalAlpha = alpha;
      ctx.fillStyle = col; ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Silná čierna kontúra komory ako vo vzore.
    ctx.beginPath();
    for (let i = 0; i <= 140; i++) {
      const [x, y] = housingPt(i / 140 * TAU);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.lineWidth = 7; ctx.strokeStyle = '#101113'; ctx.stroke();
    ctx.restore();

    // ---------- KANÁLY: INTAKE (hore) / EXHAUST (dole) vľavo ----------
    drawPort(70, true, acts.intake);
    drawPort(110, false, acts.exhaust);

    // ---------- ROTOR ----------
    ctx.save();
    // Trojboký rotor: vrcholy tesnia na komore, boky mierne vypuklé.
    ctx.beginPath();
    ctx.moveTo(apex[0][0], apex[0][1]);
    for (let k = 0; k < 3; k++) {
      const midA = rot + (k + 0.5) * TAU / 3;
      ctx.quadraticCurveTo(
        rcx + Math.cos(midA) * W_S * 0.74, rcy + Math.sin(midA) * W_S * 0.74,
        apex[(k + 1) % 3][0], apex[(k + 1) % 3][1]);
    }
    ctx.closePath();
    ctx.fillStyle = '#e8641b'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#7a2e08'; ctx.stroke();
    // Tesniace lišty vrcholov.
    ctx.fillStyle = '#2b1a10';
    for (const [ax, ay] of apex) {
      ctx.beginPath(); ctx.arc(ax, ay, 2.2, 0, TAU); ctx.fill();
    }
    ctx.restore();

    // ---------- VÝSTREDNÍK + OZUBENIE ----------
    // Kľukové rameno O→C (točí sa otáčkami výstredníka).
    ctx.save();
    ctx.strokeStyle = '#3a3f45'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(W_CX, W_CY); ctx.lineTo(rcx, rcy); ctx.stroke();
    // Vnútorné ozubenie rotora: 18 zubov, obieha aj rotuje s rotorom.
    gearPath(rcx, rcy, 13, 18, 2.2, rot);
    ctx.fillStyle = '#d3d8dd'; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = '#6d737b'; ctx.stroke();
    ctx.beginPath(); ctx.arc(rcx, rcy, 6.5, 0, TAU);
    ctx.fillStyle = '#e8641b'; ctx.fill();
    // Pevný pastorok: 12 zubov, netočí sa (pomer 12:18 dáva rotoru 1/3 otáčok).
    gearPath(W_CX, W_CY, 6.5, 12, 2, 0);
    ctx.fillStyle = '#23262b'; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = '#0b0c0d'; ctx.stroke();
    ctx.beginPath(); ctx.arc(W_CX, W_CY, 2.8, 0, TAU);
    ctx.fillStyle = '#cfd4d9'; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = '#555b62'; ctx.stroke();
    ctx.restore();

    // ---------- SVIEČKY + ZÁŽIH ----------
    drawPlug(W_CY - 10, flash);
    drawPlug(W_CY + 12, flash * 0.8);
    if (flash > 0.03) {
      const [px] = housingPt(PLUG_T);
      ctx.save();
      ctx.globalAlpha = Math.min(1, flash + 0.15);
      ctx.strokeStyle = '#ffd23f'; ctx.fillStyle = '#fff3c4';
      ctx.shadowColor = '#ff5a00'; ctx.shadowBlur = 16 * flash + 4;
      ctx.lineWidth = 1.6;
      const fx = px - 8, fy = W_CY + 1;
      ctx.beginPath(); ctx.arc(fx, fy, 3 + 7 * flash, 0, TAU); ctx.stroke();
      for (let i = 0; i < 8; i++) {
        const a = i * TAU / 8 + flash * 2;
        ctx.beginPath();
        ctx.moveTo(fx + Math.cos(a) * (4 + 7 * flash), fy + Math.sin(a) * (4 + 7 * flash));
        ctx.lineTo(fx + Math.cos(a) * (9 + 10 * flash), fy + Math.sin(a) * (9 + 10 * flash));
        ctx.stroke();
      }
      ctx.restore();
    }

    // ---------- POPISKY FÁZ (polohy ako vo vzore) ----------
    ctx.save();
    ctx.font = 'bold 10px "Courier New",monospace';
    ctx.textBaseline = 'middle';
    label('COMPRESSION', W_CX, 12, 'center', acts.compression, '#ffc933');
    ctx.textAlign = 'left';
    label('INTAKE', 4, 28, 'left', acts.intake, '#3aa0ff');
    label('EXHAUST', 4, 158, 'left', acts.exhaust, '#cfd4d9');
    ctx.textAlign = 'right';
    const ignAct = Math.max(acts.ignition, flash);
    label('IGNITION', WANK_W - 4, 158, 'right', ignAct, '#ff3b1f');
    ctx.restore();
  }

  function label(text, x, y, align, act, hot) {
    ctx.textAlign = align;
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#7e868e';
    ctx.fillText(text, x, y);
    if (act > 0.04) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, 0.25 + 0.75 * act);
      ctx.fillStyle = hot;
      ctx.shadowColor = hot; ctx.shadowBlur = 8;
      ctx.fillText(text, x, y);
      ctx.restore();
    }
  }

  // Sací/výfukový kanál vľavo: tmavý nátrubok + prúdiace čiastočky (viazané na fázu).
  function drawPort(y, isIntake, open) {
    const x0 = 8, x1 = 52;
    ctx.save();
    ctx.fillStyle = '#0a0b0c';
    ctx.strokeStyle = '#2c3136'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.rect(x0, y - 6, x1 - x0, 12); ctx.fill(); ctx.stroke();
    // Prúd: 3 čiarky, poloha z fázy výstredníka (synchronizované s rotorom).
    const dir = isIntake ? 1 : -1;
    for (let i = 0; i < 3; i++) {
      const t = (((phase + i / 3) % 1) + 1) % 1;
      const x = dir === 1 ? x0 + 4 + t * (x1 - x0 - 10) : x1 - 4 - t * (x1 - x0 - 10);
      ctx.globalAlpha = 0.2 + 0.7 * open;
      ctx.fillStyle = isIntake ? '#bcd9ff' : '#c9ced4';
      ctx.fillRect(x - 3, y - 2, 6, 4);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // Sviečka vpravo: biele teleso + elektróda do komory.
  function drawPlug(y, heat) {
    const x0 = 150, x1 = 170;
    ctx.save();
    ctx.fillStyle = heat > 0.3 ? '#ffffff' : '#d7dce1';
    ctx.strokeStyle = '#555b62'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.rect(x0, y - 3.5, x1 - x0, 7); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#2c3136';
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 - 5, y); ctx.stroke();
    if (heat > 0.3) { ctx.shadowColor = '#ffd23f'; ctx.shadowBlur = 10; }
    ctx.fillStyle = '#3a3f45';
    ctx.fillRect(x1 - 2, y - 3.5, 2, 7);
    ctx.restore();
  }

  return {
    toggle,
    setEngine,
    update(rpm = 900, dt = 0.0167) {
      // TDI: kompletný štvortaktný cyklus je 720°, teda dve otočky kľuky.
      // Wankel: fáza sú otáčky výstredníka (každý rotor pálí raz za otáčku).
      const rev = wankel ? 60 : 120;
      phase = (phase + Math.max(0, rpm || 0) / rev * dt * (slow ? SLOW_SCALE : 1)) % 1;
      draw();
    },
  };
}
