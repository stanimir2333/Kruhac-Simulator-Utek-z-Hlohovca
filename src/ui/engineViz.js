// src/ui/engineViz.js — minimalistický pôdorys štvorvalca 1.9 TDI.
// Simulácia sleduje otáčky motora, ale SLOW spomaľuje len jej čas, nikdy fyziku auta.

const W = 200;
const H = 84;
const SLOW_SCALE = 0.08;
// Pracovné zdvihy sú v poradí 1–3–4–2, každý posunutý o 180° kľuky.
const CYL_OFFSETS = [0.5, 0.25, 0.75, 0];

export function createEngineViz() {
  const canvas = document.getElementById('engine-canvas');
  const mode = document.getElementById('engine-slow');
  const ctx = canvas?.getContext('2d');
  let phase = 0;
  let slow = false;

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

  mode?.addEventListener('click', toggle);
  syncMode();

  function draw() {
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#080a0c'; ctx.fillRect(0, 0, W, H);

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

  return {
    toggle,
    update(rpm = 900, dt = 0.0167) {
      // Jeden kompletný štvortaktný cyklus je 720°, teda dve otočky kľuky.
      phase = (phase + Math.max(0, rpm || 0) / 120 * dt * (slow ? SLOW_SCALE : 1)) % 1;
      draw();
    },
  };
}
