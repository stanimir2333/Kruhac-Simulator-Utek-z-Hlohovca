// src/ui/dashboard.js — združené budíky (rýchlostník 0–250 + otáčkomer 0–8000), canvas 2D.
export function createDashboard() {
  const spd = document.getElementById('g-spd'), rpm = document.getElementById('g-rpm');
  const spdNum = document.getElementById('g-spd-num'), rpmNum = document.getElementById('g-rpm-num');
  const gear = document.getElementById('g-gear');
  const sctx = spd?.getContext('2d'), rctx = rpm?.getContext('2d');
  function dial(ctx, frac, label, redFrom = 0.85) {
    if (!ctx) return;
    const W = 150, C = W / 2;
    ctx.clearRect(0, 0, W, W);
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#3a2c00';
    ctx.beginPath(); ctx.arc(C, C, C - 12, Math.PI * 0.75, Math.PI * 2.25); ctx.stroke();
    ctx.strokeStyle = frac > redFrom ? '#ff2b2b' : '#ffb000';
    ctx.beginPath(); ctx.arc(C, C, C - 12, Math.PI * 0.75, Math.PI * (0.75 + 1.5 * frac)); ctx.stroke();
    ctx.fillStyle = '#ffb000'; ctx.font = '11px monospace'; ctx.textAlign = 'center';
    ctx.fillText(label, C, C + 22);
  }
  return {
    update(player) {
      const kmh = Math.abs(player.speed) * 3.6;
      dial(sctx, kmh / 250, 'km/h');
      dial(rctx, (player.rpm - 900) / 7100, 'ot/min');
      if (spdNum) spdNum.textContent = kmh | 0;
      if (rpmNum) rpmNum.textContent = player.rpm | 0;
      if (gear) gear.textContent = player.speed < -0.5 ? 'R' : 'N123456'[player.gear] ?? 'N';
    },
  };
}
