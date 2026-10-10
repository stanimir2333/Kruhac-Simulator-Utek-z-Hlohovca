// src/ui/engineViz.js — pôdorys motora: štvorvalec 1.9 TDI alebo 4-rotor wankel.
// Simulácia sleduje otáčky motora, ale SLOW spomaľuje len jej čas, nikdy fyziku auta.

const W = 200;
const H = 84;
const SLOW_SCALE = 0.08;
// Pracovné zdvihy sú v poradí 1–3–4–2, každý posunutý o 180° kľuky.
const CYL_OFFSETS = [0.5, 0.25, 0.75, 0];
// Wankel: 4 rotory fázované po 90° výstredníka, každý pálí raz za otáčku.
const ROTOR_OFFSETS = [0, 0.25, 0.5, 0.75];

export function createEngineViz() {
  const canvas = document.getElementById('engine-canvas');
  const mode = document.getElementById('engine-slow');
  const ctx = canvas?.getContext('2d');
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
  function setEngine(id) {
    wankel = id === 'wankel';
    canvas?.setAttribute('aria-label', wankel ? 'Animované rotory 4-rotor wanklu' : 'Animované valce motora 1.9 TDI');
  }

  mode?.addEventListener('click', toggle);
  syncMode();

  function draw() {
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#080a0c'; ctx.fillRect(0, 0, W, H);

    if (wankel) { drawRotors(); return; }
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

  // 4-rotor: komora + točiaci sa trojuholník rotora, zážih ako červený záblesk.
  // Rotor sa točí tretinovou rýchlosťou výstredníka (planetový prevod 3:1).
  function drawRotors() {
    const shaft = phase * Math.PI * 2;
    for (let i = 0; i < 4; i++) {
      const local = (phase - ROTOR_OFFSETS[i] + 1) % 1;
      const power = local < 0.12;
      const x = 27 + i * 49;
      const radius = 17;
      ctx.save();
      // komora
      ctx.fillStyle = power ? '#3a0a0a' : '#1f252a';
      ctx.strokeStyle = power ? '#ff0000' : '#69737a';
      ctx.lineWidth = power ? 2.4 : 1.4;
      if (power) { ctx.shadowColor = '#ff0000'; ctx.shadowBlur = 18; }
      ctx.beginPath(); ctx.arc(x, H / 2, radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
      // rotor: trojuholník, vrcholy na tretinách kruhu výstredníka
      const rot = shaft / 3 + i * Math.PI / 2;
      ctx.fillStyle = power ? '#ff2a1a' : '#3d454d';
      ctx.strokeStyle = power ? '#ff6a5a' : '#8a939c';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        const a = rot + k * Math.PI * 2 / 3;
        const vx = x + Math.cos(a) * 10.5, vy = H / 2 + Math.sin(a) * 10.5;
        if (k === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
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
