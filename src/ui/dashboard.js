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

  // Podklad ciferníkov (tieň + obruč + stupnica + čísla + popisky) sa NEMENÍ —
  // kreslí sa RAZ do offscreen canvasu a každý snímok sa len blitne. Predtým sa
  // zakaždým snímkom vytváral radial gradient + ~124 stroke() + ~29 fillText()
  // na ciferník, teda ~700 canvas operácií/s zbytočne.
  function bakeFace(paint) {
    const c = document.createElement('canvas');
    c.width = W; c.height = W;
    paint(c.getContext('2d'));
    return c;
  }

  function face(ctx) {
    ctx.clearRect(0, 0, W, W);
    // hlboká čierna plocha ako na Octavii II
    const g = ctx.createRadialGradient(C, C, 8, C, C, R + 8);
    g.addColorStop(0, '#101214'); g.addColorStop(0.75, '#060708'); g.addColorStop(1, '#000000');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(C, C, R + 6, 0, Math.PI * 2); ctx.fill();
    // strieborná obruba + tenký vnútorný krúžok stupnice
    ctx.lineWidth = 3; ctx.strokeStyle = '#d5d8dc';
    ctx.beginPath(); ctx.arc(C, C, R + 6, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1; ctx.strokeStyle = '#23262c';
    ctx.beginPath(); ctx.arc(C, C, R + 6, 0, Math.PI * 2); ctx.stroke();
  }
  // oktávkový tick-prstenec: biele dieliky, čísla biele, v červenom pásme dieliky červené
  function ticksTacho(ctx) {
    const max = 70, redFrom = 60;
    for (let i = 0; i <= max; i++) {
      const f = i / max, a = ang(f), major = i % 5 === 0;
      const isRed = i >= redFrom;
      const r1 = R - (major ? 13 : 7), r2 = R - 1;
      ctx.lineWidth = major ? 2.4 : 1;
      ctx.strokeStyle = isRed ? '#e0342b' : '#e8eaee';
      ctx.beginPath();
      ctx.moveTo(C + Math.cos(a) * r1, C + Math.sin(a) * r1);
      ctx.lineTo(C + Math.cos(a) * r2, C + Math.sin(a) * r2);
      ctx.stroke();
      if (major) {
        ctx.fillStyle = '#f0f1f3'; ctx.font = 'bold 9px Arial, monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(i), C + Math.cos(a) * (R - 23), C + Math.sin(a) * (R - 23));
      }
    }
    // hrubý červený oblúk 60–70 na vonkajšom okraji ako na fotke
    ctx.lineWidth = 4.5; ctx.strokeStyle = '#e0342b'; ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.arc(C, C, R - 4, ang(redFrom / max), ang(1)); ctx.stroke();
  }
  function ticksSpeedo(ctx) {
    // 0–260 po 5 km/h = 52 dielikov, popísané každých 20 ako na Octavii
    const minor = 52;
    for (let i = 0; i <= minor; i++) {
      const kmh = i * 5, f = i / minor, a = ang(f), major = i % 4 === 0;
      const r1 = R - (major ? 13 : 7), r2 = R - 1;
      ctx.lineWidth = major ? 2.4 : 1;
      ctx.strokeStyle = '#e8eaee';
      ctx.beginPath();
      ctx.moveTo(C + Math.cos(a) * r1, C + Math.sin(a) * r1);
      ctx.lineTo(C + Math.cos(a) * r2, C + Math.sin(a) * r2);
      ctx.stroke();
      if (major) {
        ctx.fillStyle = '#f0f1f3'; ctx.font = 'bold 9px Arial, monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(kmh), C + Math.cos(a) * (R - 23), C + Math.sin(a) * (R - 23));
      }
    }
  }
  function needle(ctx, frac, color = '#f4f5f6') {
    const a = ang(frac);
    ctx.save();
    ctx.lineCap = 'butt';
    // tieň ihly
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.65)';
    ctx.beginPath();
    ctx.moveTo(C - Math.cos(a) * 10, C - Math.sin(a) * 10 + 1);
    ctx.lineTo(C + Math.cos(a) * (R - 15), C + Math.sin(a) * (R - 15) + 1);
    ctx.stroke();
    // biela ihla ako na fotke
    ctx.lineWidth = 2.8; ctx.strokeStyle = color; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(C - Math.cos(a) * 10, C - Math.sin(a) * 10);
    ctx.lineTo(C + Math.cos(a) * (R - 15), C + Math.sin(a) * (R - 15));
    ctx.stroke();
    ctx.restore();
    // stred: tmavý + strieborný krúžok
    ctx.fillStyle = '#101214';
    ctx.beginPath(); ctx.arc(C, C, 8, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#c8ccd2';
    ctx.beginPath(); ctx.arc(C, C, 8, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#e8eaee';
    ctx.beginPath(); ctx.arc(C, C, 2.5, 0, Math.PI * 2); ctx.fill();
  }
  // Predkreslené podklady. build() beží raz pri vytvorení dashboardu.
  let tachoBg = null, speedoBg = null;
  function build() {
    tachoBg = bakeFace((g) => { face(g); ticksTacho(g); textOf(g, '1/min × 100'); });
    speedoBg = bakeFace((g) => { face(g); ticksSpeedo(g); textOf(g, 'km/h'); });
  }
  function textOf(g, s) {
    g.save(); g.shadowBlur = 0;
    g.fillStyle = '#9aa0a8'; g.font = '8px Arial, monospace'; g.textAlign = 'center';
    g.fillText(s, C, C + 33);
    g.restore();
  }
  // Podklad + ihla + svietiace kontrolky. (predkreslené, žiadne stroke() za snímok
  // okrem samotnej ihly a kontroliek, ktoré menia stav)
  function gauge(ctx, bg) {
    ctx.clearRect(0, 0, W, W);
    ctx.drawImage(bg, 0, 0);
  }
  // --- kontrolky ako na Octavii: bez krabičiek, len svietiaci symbol na čiernej ---
  // CHECK ENGINE trigger ponechaný: self-test alebo teplota >= 0.9
  function glow(ctx, on, color) {
    if (on) { ctx.shadowColor = color; ctx.shadowBlur = 7; }
    else ctx.shadowBlur = 0;
  }
  function lampEPC(ctx, x, y, on) {
    ctx.save();
    glow(ctx, on, '#ffb000');
    ctx.fillStyle = on ? '#ffb000' : '#3a2f10';
    ctx.font = 'bold 11px Arial, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('EPC', x, y);
    ctx.restore();
  }
  function lampEngine(ctx, x, y, on) { // CHECK ENGINE: motor z fotky, oranžový
    ctx.save();
    glow(ctx, on, '#ffb000');
    ctx.strokeStyle = on ? '#ffb000' : '#3a2f10'; ctx.lineWidth = 1.5;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // blok motora
    ctx.strokeRect(x - 7, y - 2.5, 12, 7);
    // hlava valcov
    ctx.strokeRect(x - 4, y - 5.5, 6, 3);
    // sacie výstupky hore
    ctx.beginPath();
    ctx.moveTo(x - 2, y - 5.5); ctx.lineTo(x - 2, y - 7.5);
    ctx.moveTo(x + 1, y - 5.5); ctx.lineTo(x + 1, y - 7.5);
    ctx.stroke();
    // výfuk vpravo dole
    ctx.beginPath(); ctx.moveTo(x + 5, y + 4.5); ctx.lineTo(x + 8, y + 1.5); ctx.stroke();
    // ventilátor / remenica vľavo
    ctx.beginPath(); ctx.moveTo(x - 7, y); ctx.lineTo(x - 9, y); ctx.stroke();
    ctx.restore();
  }
  function lampBattery(ctx, x, y, on) { // červená, ako vpravo dole na fotke
    ctx.save();
    glow(ctx, on, '#ff2b2b');
    ctx.strokeStyle = on ? '#ff2b2b' : '#4a1515'; ctx.lineWidth = 1.4;
    ctx.strokeRect(x - 6, y - 3, 12, 7);
    ctx.beginPath();
    ctx.moveTo(x - 4, y - 6); ctx.lineTo(x - 4, y - 3);
    ctx.moveTo(x + 4, y - 6); ctx.lineTo(x + 4, y - 3);
    ctx.moveTo(x - 1, y + 1); ctx.lineTo(x + 3, y + 1);
    ctx.moveTo(x - 5, y); ctx.lineTo(x - 5, y + 2);
    ctx.moveTo(x - 6, y + 1); ctx.lineTo(x - 4, y + 1);
    ctx.stroke();
    ctx.restore();
  }
  function lampOil(ctx, x, y, on) { // červená olejnička
    ctx.save();
    glow(ctx, on, '#ff2b2b');
    ctx.strokeStyle = on ? '#ff2b2b' : '#4a1515'; ctx.lineWidth = 1.4;
    ctx.strokeRect(x - 6, y - 1, 10, 5);
    ctx.beginPath(); ctx.moveTo(x + 4, y - 1); ctx.lineTo(x + 7, y - 5); ctx.stroke();
    ctx.beginPath(); // kvapka
    ctx.moveTo(x - 1, y + 1); ctx.lineTo(x, y + 3); ctx.lineTo(x + 1, y + 1);
    ctx.stroke();
    ctx.restore();
  }
  function lampFuel(ctx, x, y, on) { // oranžový stojan
    ctx.save();
    glow(ctx, on, '#ffb000');
    ctx.strokeStyle = on ? '#ffb000' : '#3a2f10'; ctx.lineWidth = 1.4;
    ctx.strokeRect(x - 5, y - 4, 7, 10);
    ctx.strokeRect(x - 3.5, y - 2, 4, 3);
    ctx.beginPath(); ctx.moveTo(x + 2, y - 3); ctx.quadraticCurveTo(x + 7, y - 1, x + 6, y + 4); ctx.stroke();
    ctx.restore();
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

  build(); // predkresli podklady ciferníkov raz

  return {
    getOdo() { return odo0; },
    selfTest() { testUntil = performance.now() + 2500; },
    update(player, dt = 0.0167) {
      const now = performance.now();
      const kmh = Math.abs(player.speed) * 3.6;
      // vyhladenie ihiel frame-rate NEZÁVISLÉ (predtým pevné 0.5 → iný pri 30 FPS)
      const kSm = 1 - Math.exp(-12 * dt);
      dKmh += (kmh - dKmh) * kSm;
      dRpm += ((player.rpm || 900) - dRpm) * kSm;
      const test = now < testUntil;
      const epc = test || (player.temp || 0) > 0.7;
      const check = test || (player.temp || 0) >= 0.9;
      const fuel = player.fuel ?? 1;
      const fuelLow = test || fuel < 0.15;
      const fuelBlink = fuel < 0.05 && !test ? (now / 300 | 0) % 2 === 0 : true;
      const oil = test || (player.oilT || 0) > 0;
      const batt = test || fuel <= 0;
      // otáčkomer 0–70 (×100) — čísla po 5 ako na Octavii II z fotky
      if (tctx) {
        gauge(tctx, tachoBg);
        needle(tctx, dRpm / 7000);
        lampEPC(tctx, C - 19, C + 49, epc);
        lampEngine(tctx, C + 19, C + 49, check); // CHECK ENGINE ponechaný
      }
      // rýchlostník 0–260 — popisy po 20 ako na fotke
      if (sctx) {
        gauge(sctx, speedoBg);
        needle(sctx, dKmh / 260);
        lampBattery(sctx, C - 30, C + 49, batt);
        lampOil(sctx, C, C + 49, oil);
        lampFuel(sctx, C + 30, C + 49, fuelLow && fuelBlink);
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
