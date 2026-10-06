// src/ui/dashboard.js — prístrojovka v štýle Škoda Octavia (canvas 2D).
// Vľavo otáčkomer 0–70 (×100 ot/min), vpravo rýchlostník 0–260 km/h,
// stred MFA: hodiny + auto + km/trip + mini palivo/teplota.
// Kontrolky: EPC + CHECK ENGINE (teplota), FUEL (nádrž), OIL (náraz), BATTERY (test/prázdno).
const ODO_KEY = 'kruhac-odo';

export function createDashboard() {
  const tacho = document.getElementById('g-rpm');
  const speedo = document.getElementById('g-spd');
  const mfa = document.getElementById('g-mfa');
  const spdNum = document.getElementById('g-spd-num'), rpmNum = document.getElementById('g-rpm-num');
  const gear = document.getElementById('g-gear');
  const tctx = tacho?.getContext('2d'), sctx = speedo?.getContext('2d'), mctx = mfa?.getContext('2d');
  const W = 150, C = W / 2, R = C - 10;
  const A0 = Math.PI * 0.75, SWEEP = Math.PI * 1.5; // 270° ciferník
  const ang = (f) => A0 + SWEEP * Math.max(0, Math.min(1, f));
  const born = performance.now();
  let testUntil = born + 2500; // self-test kontroliek ako v reálnom aute
  let dKmh = 0, dRpm = 900, lastSave = 0;
  let odo0 = 0;
  try { odo0 = parseFloat(localStorage.getItem(ODO_KEY)) || 0; } catch { odo0 = 0; }

  function face(ctx) {
    ctx.clearRect(0, 0, W, W);
    const g = ctx.createRadialGradient(C, C, 10, C, C, R + 8);
    g.addColorStop(0, '#14161a'); g.addColorStop(1, '#08090b');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(C, C, R + 6, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = '#2c2f36';
    ctx.beginPath(); ctx.arc(C, C, R + 6, 0, Math.PI * 2); ctx.stroke();
  }
  function ticks(ctx, count, majorEvery, fmt, redFrom) {
    for (let i = 0; i <= count; i++) {
      const a = ang(i / count), major = i % majorEvery === 0;
      const r1 = R - (major ? 12 : 7), r2 = R - 1;
      ctx.lineWidth = major ? 2.5 : 1;
      ctx.strokeStyle = (redFrom !== undefined && i / count >= redFrom) ? '#e0342b' : '#c8ccd2';
      ctx.beginPath();
      ctx.moveTo(C + Math.cos(a) * r1, C + Math.sin(a) * r1);
      ctx.lineTo(C + Math.cos(a) * r2, C + Math.sin(a) * r2);
      ctx.stroke();
      if (major && fmt) {
        ctx.fillStyle = '#e8eaee'; ctx.font = '8px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(fmt(i), C + Math.cos(a) * (R - 22), C + Math.sin(a) * (R - 22));
      }
    }
    if (redFrom !== undefined) { // červená zóna
      ctx.lineWidth = 4; ctx.strokeStyle = '#e0342b';
      ctx.beginPath(); ctx.arc(C, C, R - 4, ang(redFrom), ang(1)); ctx.stroke();
    }
  }
  function needle(ctx, frac, color = '#f2f3f5') {
    const a = ang(frac);
    ctx.lineWidth = 3; ctx.strokeStyle = color; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(C - Math.cos(a) * 10, C - Math.sin(a) * 10);
    ctx.lineTo(C + Math.cos(a) * (R - 16), C + Math.sin(a) * (R - 16));
    ctx.stroke();
    ctx.fillStyle = '#2c2f36';
    ctx.beginPath(); ctx.arc(C, C, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#c8ccd2';
    ctx.beginPath(); ctx.arc(C, C, 3, 0, Math.PI * 2); ctx.fill();
  }
  // --- kontrolky ---
  function lampBase(ctx, x, y, w, h, on, color) {
    ctx.fillStyle = on ? color : '#241f0e';
    ctx.strokeStyle = on ? '#fff2b0' : '#4a3f16';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x - w / 2, y - h / 2, w, h, 2); else ctx.rect(x - w / 2, y - h / 2, w, h);
    ctx.fill(); ctx.stroke();
  }
  function lampText(ctx, x, y, txt, on, color = '#ffb000') {
    lampBase(ctx, x, y, 26, 13, on, on ? color : '#241f0e');
    ctx.fillStyle = on ? '#1a1200' : '#6b5a20';
    ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(txt, x, y + 0.5);
  }
  function lampEngine(ctx, x, y, on) { // CHECK ENGINE: blok motora
    lampBase(ctx, x, y, 24, 15, on, on ? '#ffb000' : '#241f0e');
    ctx.strokeStyle = on ? '#1a1200' : '#6b5a20'; ctx.lineWidth = 1.2;
    ctx.strokeRect(x - 7, y - 3, 12, 7);       // blok
    ctx.strokeRect(x - 4, y - 6, 6, 3);        // hlava
    ctx.beginPath(); ctx.moveTo(x + 5, y + 4); ctx.lineTo(x + 8, y + 1); ctx.stroke(); // výfuk
  }
  function lampBattery(ctx, x, y, on) {
    lampBase(ctx, x, y, 24, 15, on, on ? '#ff2b2b' : '#2a0e0e');
    ctx.strokeStyle = on ? '#fff' : '#7a3030'; ctx.lineWidth = 1.2;
    ctx.strokeRect(x - 6, y - 3, 12, 7);
    ctx.beginPath();
    ctx.moveTo(x - 4, y - 6); ctx.lineTo(x - 4, y - 3);
    ctx.moveTo(x + 4, y - 6); ctx.lineTo(x + 4, y - 3);
    ctx.moveTo(x - 1, y + 1); ctx.lineTo(x + 3, y + 1); // −
    ctx.moveTo(x - 5, y); ctx.lineTo(x - 5, y + 2); ctx.moveTo(x - 6, y + 1); ctx.lineTo(x - 4, y + 1); // +
    ctx.stroke();
  }
  function lampOil(ctx, x, y, on) {
    lampBase(ctx, x, y, 24, 15, on, on ? '#ff2b2b' : '#2a0e0e');
    ctx.strokeStyle = on ? '#fff' : '#7a3030'; ctx.lineWidth = 1.2;
    ctx.strokeRect(x - 6, y - 1, 10, 5);       // kanva
    ctx.beginPath(); ctx.moveTo(x + 4, y - 1); ctx.lineTo(x + 7, y - 5); ctx.stroke(); // hubica
  }
  function lampFuel(ctx, x, y, on) {
    lampBase(ctx, x, y, 24, 15, on, on ? '#ffb000' : '#241f0e');
    ctx.strokeStyle = on ? '#1a1200' : '#6b5a20'; ctx.lineWidth = 1.2;
    ctx.strokeRect(x - 5, y - 4, 7, 10);       // stojan
    ctx.strokeRect(x - 3.5, y - 2, 4, 3);      // displej
    ctx.beginPath(); ctx.moveTo(x + 2, y - 3); ctx.quadraticCurveTo(x + 7, y - 1, x + 6, y + 4); ctx.stroke(); // hadica
  }
  // --- mini budíky MFA ---
  function miniGauge(ctx, cx, cy, r, frac, labels, redSide) {
    ctx.lineWidth = 2; ctx.strokeStyle = '#2c2f36';
    ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, 0); ctx.stroke();
    if (redSide) {
      ctx.strokeStyle = '#e0342b'; ctx.lineWidth = 3;
      const a0 = redSide < 0 ? Math.PI : -0.35, a1 = redSide < 0 ? Math.PI + 0.35 : 0;
      ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.stroke();
    }
    ctx.fillStyle = '#e8eaee'; ctx.font = '8px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(labels[0], cx - r - 2, cy + 2);
    ctx.fillText(labels[1], cx + r + 2, cy + 2);
    const a = Math.PI - Math.PI * Math.max(0, Math.min(1, frac));
    ctx.strokeStyle = '#ffb000'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * (r - 3), cy + Math.sin(a) * (r - 3)); ctx.stroke();
  }
  function carIcon(ctx, cx, cy, s) {
    ctx.strokeStyle = '#ffb000'; ctx.lineWidth = 1.6;
    ctx.strokeRect(cx - 9 * s, cy - 16 * s, 18 * s, 32 * s); // karoséria zhora
    ctx.strokeRect(cx - 6 * s, cy - 9 * s, 12 * s, 8 * s);  // kabína
    ctx.fillStyle = '#ffb000';
    for (const [wx, wy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      ctx.fillRect(cx + wx * 10 * s - 1.5 * s, cy + wy * 12 * s - 3 * s, 3 * s, 6 * s);
    }
  }

  return {
    getOdo() { return odo0; },
    selfTest() { testUntil = performance.now() + 2500; },
    update(player) {
      const now = performance.now();
      const kmh = Math.abs(player.speed) * 3.6;
      dKmh += (kmh - dKmh) * 0.5;
      dRpm += ((player.rpm || 900) - dRpm) * 0.5;
      const test = now < testUntil;
      const epc = test || (player.temp || 0) > 0.7;
      const check = test || (player.temp || 0) >= 0.9;
      const fuel = player.fuel ?? 1;
      const fuelLow = test || fuel < 0.15;
      const fuelBlink = fuel < 0.05 && !test ? (now / 300 | 0) % 2 === 0 : true;
      const oil = test || (player.oilT || 0) > 0;
      const batt = test || fuel <= 0;
      // otáčkomer 0–70 (×100) — čísla po 5 ako na Octavii
      if (tctx) {
        face(tctx);
        ticks(tctx, 70, 5, (i) => String(i), 60 / 70);
        needle(tctx, dRpm / 8000);
        tctx.fillStyle = '#8b9097'; tctx.font = '8px monospace'; tctx.textAlign = 'center';
        tctx.fillText('1/min × 100', C, C + 34);
        lampText(tctx, C - 18, C + 48, 'EPC', epc);
        lampEngine(tctx, C + 18, C + 48, check);
      }
      // rýchlostník 0–260
      if (sctx) {
        face(sctx);
        ticks(sctx, 26, 2, (i) => String(i * 10), 22 / 26);
        needle(sctx, dKmh / 260);
        sctx.fillStyle = '#8b9097'; sctx.font = '8px monospace'; sctx.textAlign = 'center';
        sctx.fillText('km/h', C, C + 34);
        lampBattery(sctx, C - 30, C + 48, batt);
        lampOil(sctx, C, C + 48, oil);
        lampFuel(sctx, C + 30, C + 48, fuelLow && fuelBlink);
      }
      // MFA stred: priehľadné pozadie (leží CEZ ciferníky), len displej + mini budíky
      if (mctx) {
        mctx.clearRect(0, 0, W, W);
        miniGauge(mctx, 38, 30, 20, fuel, ['E', 'F'], -1);
        const coolant = 70 + (player.temp || 0) * 65;
        miniGauge(mctx, 112, 30, 20, (coolant - 50) / 80, ['C', 'H'], 1);
        // displej
        mctx.fillStyle = '#050607';
        mctx.strokeStyle = '#3a3e46'; mctx.lineWidth = 1.5;
        mctx.beginPath();
        if (mctx.roundRect) mctx.roundRect(14, 56, 122, 88, 5); else mctx.rect(14, 56, 122, 88);
        mctx.fill(); mctx.stroke();
        mctx.strokeStyle = '#2c2f36'; mctx.lineWidth = 1;
        const d = new Date();
        mctx.fillStyle = '#ffb000'; mctx.font = 'bold 15px monospace'; mctx.textAlign = 'center';
        mctx.fillText(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, C, 74);
        mctx.beginPath(); mctx.moveTo(22, 82); mctx.lineTo(128, 82); mctx.stroke();
        carIcon(mctx, C, 102, 0.8);
        const odoKm = ((player.odo || 0) + odo0) / 1000;
        const tripKm = (player.trip || 0) / 1000;
        mctx.font = '8px monospace'; mctx.fillStyle = '#8b9097';
        mctx.textAlign = 'left'; mctx.fillText('km', 22, 126);
        mctx.textAlign = 'right'; mctx.fillText('trip', 128, 126);
        mctx.fillStyle = '#ffb000'; mctx.font = 'bold 11px monospace';
        mctx.textAlign = 'left'; mctx.fillText(odoKm.toFixed(1), 22, 138);
        mctx.textAlign = 'right'; mctx.fillText(tripKm.toFixed(1), 128, 138);
        if (now - lastSave > 10000) {
          lastSave = now;
          try { localStorage.setItem(ODO_KEY, String((player.odo || 0) + odo0)); } catch { /* ignore */ }
        }
      }
      if (spdNum) spdNum.textContent = kmh | 0;
      if (rpmNum) rpmNum.textContent = player.rpm | 0;
      if (gear) gear.textContent = player.speed < -0.5 ? 'R' : 'N123456'[player.gear] ?? 'N';
    },
  };
}
