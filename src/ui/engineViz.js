// src/ui/engineViz.js — rez motora: 1 valec 1.9 TDI alebo 1-rotor wankel v reze.
// Simulácia sleduje otáčky motora, ale SLOW spomaľuje len jej čas, nikdy fyziku auta.

// ---------- ROZMERY ----------
const TDI_W = 200;
const TDI_H = 204;
// Wankel v reze potrebuje štvorec na epitrochoid + popisky (vzoru rotary.gif).
const WANK_W = 200;
const WANK_H = 168;
const SLOW_SCALE = 0.08;

// ---------- TDI REZ VALCOM ----------
// Kľuka (polomer = polovica zdvihu), ojnica, vývrt, strop komory, zdvih ventilu.
const T_OX = 100;
const T_OY = 164;
const T_CRANK_R = 13;
const T_ROD_L = 34;
const T_BORE_L = 80;
const T_BORE_R = 120;
const T_ROOF = 72;
const T_PIN_OFF = 20;
const T_LIFT = 6;
// Doby 4-taktu pre pásik (farba aktívneho zdvihu).
const STROKES = [
  ['INTAKE', '#3aa0ff'],
  ['COMPRESSION', '#ffc933'],
  ['POWER', '#ff3b1f'],
  ['EXHAUST', '#9aa2ab'],
];

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
      : 'Rez valca 1.9 TDI: piest, ventily a kľukový hriadeľ');
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

  // 1 valec 1.9 TDI v reze (vzoru piestový diagram): vačky, ventily s pružinami,
  // sviečka, piest s krúžkami, vodný plášť, ojnica, kľuka v skrini. Všetko beží
  // z uhla kľuky thc 0..4π (cyklus 720° = 2 otáčky, fáza 1 = celý 4-takt).
  function drawTdi() {
    const thc = phase * TAU * 2;
    const stroke = Math.min(3, Math.floor(thc / Math.PI)); // 0 san., 1 kom., 2 exp., 3 výf.
    const inLift = thc < Math.PI ? T_LIFT * Math.sin(thc) : 0;
    const exLift = thc > 3 * Math.PI ? T_LIFT * Math.sin(thc - 3 * Math.PI) : 0;
    // Zážih na začiatku expanzie (thc = 2π), doznievanie ~50° kľuky.
    const dFire = thc - 2 * Math.PI;
    const flash = dFire >= 0 ? Math.exp(-dFire / 0.9) : 0;

    // Kľukový mechanizmus: čap kľuky obieha, piest sa posúva vo vývrte.
    const pinX = T_OX + T_CRANK_R * Math.sin(thc);
    const pinY = T_OY - T_CRANK_R * Math.cos(thc);
    const wdx = pinX - T_OX;
    const wy = pinY - Math.sqrt(T_ROD_L * T_ROD_L - wdx * wdx);
    const pyT = wy - T_PIN_OFF; // čelo piesta (HÚ 97, DÚ 123)

    // ---------- KĽUKOVÁ SKRIŇA ----------
    ctx.save();
    rrect(62, 150, 76, 40, 12);
    ctx.fillStyle = '#14171b'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#2c3136'; ctx.stroke();
    ctx.restore();

    // ---------- BLOK + VODNÝ PLÁŠŤ + STENY VALCA ----------
    ctx.save();
    ctx.fillStyle = '#6b7076';
    ctx.fillRect(60, 72, 5, 86);
    ctx.fillRect(135, 72, 5, 86);
    // Chladiaca voda (modré kanály v bloku).
    ctx.fillStyle = '#2e7fd9';
    ctx.fillRect(66, 84, 7, 66);
    ctx.fillRect(127, 84, 7, 66);
    ctx.fillStyle = '#7db9f2';
    ctx.fillRect(68, 84, 2, 66);
    ctx.fillRect(129, 84, 2, 66);
    // Oceľové steny vývrtu.
    const wall = ctx.createLinearGradient(T_BORE_L, 0, T_BORE_L + 6, 0);
    wall.addColorStop(0, '#e2e6ea'); wall.addColorStop(1, '#8a9097');
    ctx.fillStyle = wall;
    ctx.fillRect(74, 72, 6, 86);
    const wall2 = ctx.createLinearGradient(T_BORE_R - 6, 0, T_BORE_R, 0);
    wall2.addColorStop(0, '#8a9097'); wall2.addColorStop(1, '#e2e6ea');
    ctx.fillStyle = wall2;
    ctx.fillRect(120, 72, 6, 86);
    ctx.fillStyle = '#2c3136';
    ctx.fillRect(79, 72, 1, 86);
    ctx.fillRect(120, 72, 1, 86);

    // ---------- HLAVA VALCA ----------
    const head = ctx.createLinearGradient(0, 56, 0, T_ROOF);
    head.addColorStop(0, '#c8ccd2'); head.addColorStop(1, '#7c828a');
    ctx.fillStyle = head;
    ctx.fillRect(58, 56, 84, T_ROOF - 56);
    ctx.fillStyle = '#2c3136';
    ctx.fillRect(58, T_ROOF - 1, 84, 2); // tesnenie pod hlavou
    // Sedlá ventilov.
    ctx.fillStyle = '#3a3f45';
    ctx.fillRect(77, 66, 14, 6);
    ctx.fillRect(109, 66, 14, 6);
    // Sací/výfukový kanál v hlave (tmavý priechod od nátrubku k sedlu).
    ctx.strokeStyle = '#22262b'; ctx.lineWidth = 9; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(56, 59); ctx.lineTo(82, 66); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(144, 59); ctx.lineTo(118, 66); ctx.stroke();
    ctx.restore();

    // Nátrubky: mixture in vľavo, výfuk vpravo.
    ctx.save();
    ctx.fillStyle = '#0a0b0c';
    ctx.strokeStyle = '#2c3136'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.rect(14, 53, 44, 12); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.rect(142, 53, 44, 12); ctx.fill(); ctx.stroke();
    ctx.restore();

    // ---------- NÁPLŇ KOMORY (odtieň podľa doby) ----------
    const washCol = [STROKES[stroke][1]];
    let washA = 0.16;
    if (stroke === 0) washA = 0.14 + 0.5 * (inLift / T_LIFT);
    if (stroke === 2) washA = Math.min(0.8, 0.3 + flash * 0.5);
    ctx.save();
    ctx.globalAlpha = washA;
    ctx.fillStyle = washCol[0];
    ctx.fillRect(T_BORE_L, T_ROOF, T_BORE_R - T_BORE_L, Math.max(1, pyT - T_ROOF));
    ctx.restore();

    // ---------- VENTILY + PRUŽINY + VAČKY ----------
    drawValve(84, inLift, thc / 2 + Math.PI / 4);
    drawValve(116, exLift, thc / 2 + 3 * Math.PI / 4);

    // ---------- SVIEČKA (u TDI žhavič/vstrek, kreslený ako vo vzore) ----------
    ctx.save();
    ctx.fillStyle = '#e8ebee'; // keramika
    ctx.strokeStyle = '#555b62'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.rect(94, 26, 12, 18); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#9aa2ab';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath(); ctx.moveTo(94, 30 + i * 5); ctx.lineTo(106, 30 + i * 5); ctx.stroke();
    }
    ctx.fillStyle = '#4a5057'; // kovové puzdro
    ctx.beginPath(); ctx.rect(95, 44, 10, 10); ctx.fill();
    ctx.strokeStyle = '#22262b';
    ctx.beginPath(); ctx.moveTo(95, 47); ctx.lineTo(105, 47); ctx.stroke();
    ctx.fillStyle = '#c9ced4'; // svorník + elektródy
    ctx.fillRect(98, 54, 4, 14);
    ctx.strokeStyle = '#2c3136'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(105, 62); ctx.lineTo(105, 68); ctx.lineTo(100, 68); ctx.stroke();
    if (flash > 0.3) { ctx.shadowColor = '#ffd23f'; ctx.shadowBlur = 10; }
    ctx.fillStyle = '#3a3f45';
    ctx.fillRect(94, 38, 12, 3);
    ctx.shadowBlur = 0;
    ctx.restore();
    // Iskra do komory.
    if (flash > 0.03) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, flash + 0.15);
      ctx.strokeStyle = '#ffd23f';
      ctx.shadowColor = '#ff5a00'; ctx.shadowBlur = 14 * flash + 4;
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(100, 74, 2 + 6 * flash, 0, TAU); ctx.stroke();
      for (let i = 0; i < 8; i++) {
        const a = i * TAU / 8 + flash * 2;
        ctx.beginPath();
        ctx.moveTo(100 + Math.cos(a) * (3 + 6 * flash), 74 + Math.sin(a) * (3 + 6 * flash));
        ctx.lineTo(100 + Math.cos(a) * (7 + 9 * flash), 74 + Math.sin(a) * (7 + 9 * flash));
        ctx.stroke();
      }
      ctx.restore();
    }

    // ---------- PIEST ----------
    ctx.save();
    const alu = ctx.createLinearGradient(T_BORE_L, 0, T_BORE_R, 0);
    alu.addColorStop(0, '#e2e6ea'); alu.addColorStop(0.5, '#c3c9cf'); alu.addColorStop(1, '#8f959c');
    ctx.fillStyle = alu;
    ctx.fillRect(T_BORE_L, pyT, T_BORE_R - T_BORE_L, 32);
    ctx.strokeStyle = '#2c3136'; ctx.lineWidth = 1.2;
    ctx.strokeRect(T_BORE_L, pyT, T_BORE_R - T_BORE_L, 32);
    ctx.fillStyle = '#f2f4f6'; // čelo piesta
    ctx.fillRect(T_BORE_L, pyT, T_BORE_R - T_BORE_L, 2);
    ctx.fillStyle = '#3a3f45'; // krúžky
    for (let i = 0; i < 3; i++) ctx.fillRect(T_BORE_L, pyT + 5 + i * 4, T_BORE_R - T_BORE_L, 2);
    ctx.restore();

    // ---------- OJNICA + KĽUKA ----------
    ctx.save();
    // Protiváha (sektor oproti čapu).
    const pinAng = Math.atan2(pinY - T_OY, pinX - T_OX);
    ctx.beginPath();
    ctx.moveTo(T_OX, T_OY);
    ctx.arc(T_OX, T_OY, 20, pinAng + Math.PI - 0.85, pinAng + Math.PI + 0.85);
    ctx.closePath();
    ctx.fillStyle = '#3a4046'; ctx.fill();
    ctx.lineWidth = 1.2; ctx.strokeStyle = '#22262b'; ctx.stroke();
    // Rameno kľuky.
    ctx.strokeStyle = '#565d64'; ctx.lineWidth = 7; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(T_OX, T_OY); ctx.lineTo(pinX, pinY); ctx.stroke();
    // Ojnica: zúžený profil čap piesta → čap kľuky.
    const rdx = pinX - T_OX, rdy = pinY - wy;
    const rl = Math.hypot(rdx, rdy) || 1;
    const nx = -rdy / rl, ny = rdx / rl;
    ctx.beginPath();
    ctx.moveTo(T_OX + nx * 3.5, wy + ny * 3.5);
    ctx.lineTo(pinX + nx * 5.5, pinY + ny * 5.5);
    ctx.lineTo(pinX - nx * 5.5, pinY - ny * 5.5);
    ctx.lineTo(T_OX - nx * 3.5, wy - ny * 3.5);
    ctx.closePath();
    ctx.fillStyle = '#9aa1a8'; ctx.fill();
    ctx.lineWidth = 1.2; ctx.strokeStyle = '#2c3136'; ctx.stroke();
    // Veľké oko na čape kľuky.
    ctx.beginPath(); ctx.arc(pinX, pinY, 8.5, 0, TAU);
    ctx.fillStyle = '#7d848c'; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(pinX, pinY, 4, 0, TAU);
    ctx.fillStyle = '#14171b'; ctx.fill();
    // Hlavný čap kľuky.
    ctx.beginPath(); ctx.arc(T_OX, T_OY, 6, 0, TAU);
    ctx.fillStyle = '#c9ced4'; ctx.fill();
    ctx.lineWidth = 1.2; ctx.strokeStyle = '#2c3136'; ctx.stroke();
    ctx.beginPath(); ctx.arc(T_OX, T_OY, 2, 0, TAU);
    ctx.fillStyle = '#2c3136'; ctx.fill();
    ctx.restore();

    // Piestny čap (cez piest).
    ctx.save();
    ctx.beginPath(); ctx.arc(T_OX, wy, 5, 0, TAU);
    ctx.fillStyle = '#3a4046'; ctx.fill();
    ctx.lineWidth = 1.2; ctx.strokeStyle = '#22262b'; ctx.stroke();
    ctx.beginPath(); ctx.arc(T_OX, wy, 2, 0, TAU);
    ctx.fillStyle = '#c9ced4'; ctx.fill();
    ctx.restore();

    // ---------- PRÚDENIE V NÁTRUBKOCH (viazané na zdvih ventilov) ----------
    ctx.save();
    for (let i = 0; i < 3; i++) {
      const s = (((phase * 4 + i / 3) % 1) + 1) % 1;
      ctx.globalAlpha = 0.15 + 0.75 * (inLift / T_LIFT);
      ctx.fillStyle = '#bcd9ff';
      ctx.fillRect(18 + s * 32, 57, 6, 4);
      ctx.globalAlpha = 0.15 + 0.75 * (exLift / T_LIFT);
      ctx.fillStyle = '#c9ced4';
      ctx.fillRect(146 + s * 32, 57, 6, 4);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // ---------- POPISKY S ODKAZMI (polohy ako vo vzore) ----------
    ctx.save();
    ctx.font = 'bold 7px "Courier New",monospace';
    ctx.textBaseline = 'middle';
    part('cam', 2, 24, 'left', 75, 26, 0);
    part('intake valve', 2, 86, 'left', 82, 64 + inLift, inLift / T_LIFT, '#3aa0ff');
    part('piston', 2, 112, 'left', T_BORE_L, pyT + 16, 0);
    part('crankshaft', 2, 172, 'left', 92, T_OY, 0);
    part('spark plug', 198, 24, 'right', 106, 34, flash, '#ffd23f');
    part('exhaust valve', 198, 86, 'right', 118, 64 + exLift, exLift / T_LIFT, '#c9ced4');
    part('cooling water', 198, 114, 'right', 134, 114, 0);
    part('crankcase', 198, 182, 'right', 138, 178, 0);
    ctx.restore();

    // ---------- PÁSIK DÔB 4-TAKTU ----------
    ctx.save();
    ctx.font = 'bold 8px "Courier New",monospace';
    ctx.textBaseline = 'middle';
    let total = 8 * (STROKES.length - 1);
    const widths = STROKES.map(([t]) => ctx.measureText(t).width);
    for (const w of widths) total += w;
    let sx = (W - total) / 2;
    for (let i = 0; i < STROKES.length; i++) {
      const [t, col] = STROKES[i];
      ctx.textAlign = 'left';
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#7e868e';
      ctx.fillText(t, sx, 197);
      if (i === stroke) {
        ctx.save();
        ctx.fillStyle = col;
        ctx.shadowColor = col; ctx.shadowBlur = 8;
        ctx.fillText(t, sx, 197);
        ctx.restore();
      }
      sx += widths[i] + 8;
    }
    ctx.restore();
  }

  // Zaoblený obdĺžnik (kľuková skriňa).
  function rrect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Ventil so stopkou, tanierom, pružinou a vačkou nad ním.
  // lift = zdvih dole (px), camA = uhol laloka vačky (plátno, y dole).
  function drawValve(sx, lift, camA) {
    const camX = sx, camY = 24;
    ctx.save();
    // Vačka: základný kruh + lalok, točí sa polovičnými otáčkami kľuky.
    ctx.fillStyle = '#9aa1a8';
    ctx.strokeStyle = '#2c3136'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(camX, camY, 7, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.arc(camX + Math.cos(camA) * 7.5, camY + Math.sin(camA) * 7.5, 3, 0, TAU);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#2c3136';
    ctx.beginPath(); ctx.arc(camX, camY, 1.8, 0, TAU); ctx.fill();
    // Pružina: cikcak medzi pevnou hlavou a pohyblivou miskou.
    const top = 36, bot = 52 + lift;
    ctx.strokeStyle = '#d7dce1'; ctx.lineWidth = 1.4;
    ctx.beginPath();
    const coils = 5;
    ctx.moveTo(sx, top);
    for (let i = 1; i <= coils * 2; i++) {
      ctx.lineTo(sx + (i % 2 ? 5 : -5), top + (bot - top) * i / (coils * 2));
    }
    ctx.lineTo(sx, bot);
    ctx.stroke();
    ctx.fillStyle = '#6b7076'; // misky pružiny
    ctx.fillRect(sx - 7, top - 2, 14, 2);
    ctx.fillRect(sx - 7, bot, 14, 2);
    // Stopka + tanier.
    ctx.fillStyle = '#c9ced4';
    ctx.fillRect(sx - 2, 40, 4, 28 + lift);
    ctx.strokeStyle = '#2c3136'; ctx.lineWidth = 1;
    ctx.strokeRect(sx - 2, 40, 4, 28 + lift);
    ctx.beginPath();
    ctx.moveTo(sx - 4, 64 + lift);
    ctx.lineTo(sx + 4, 64 + lift);
    ctx.lineTo(sx + 7, T_ROOF + lift);
    ctx.lineTo(sx - 7, T_ROOF + lift);
    ctx.closePath();
    ctx.fillStyle = '#aab0b7'; ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  // Popisok s odkazovou čiarou na súčiastku; voliteľne žeravý prekryv.
  function part(text, x, y, align, lx, ly, glow, hot) {
    const w = ctx.measureText(text).width;
    const tx = align === 'left' ? x + w + 3 : x - w - 3;
    ctx.strokeStyle = '#6d737b'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(tx, y); ctx.lineTo(lx, ly); ctx.stroke();
    ctx.textAlign = align;
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#9aa2ab';
    ctx.fillText(text, x, y);
    if (glow > 0.05) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, 0.25 + 0.75 * glow);
      ctx.fillStyle = hot || '#fff';
      ctx.shadowColor = hot || '#fff'; ctx.shadowBlur = 8;
      ctx.fillText(text, x, y);
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
