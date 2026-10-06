// src/audio/sfx.js — procedurálny fallback (WebAudio), keď súbory chýbajú.
// Motor = píla + lowpass podľa RPM; trúbenie = 2 detuned square; crash = noise burst.
export function createSfx() {
  let ctx = null, engineOsc = null, engineGain = null, muted = false;
  function ensure() {
    if (ctx) return true;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      engineOsc = ctx.createOscillator(); engineOsc.type = 'sawtooth'; engineOsc.frequency.value = 60;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
      engineGain = ctx.createGain(); engineGain.gain.value = 0;
      engineOsc.connect(lp).connect(engineGain).connect(ctx.destination);
      engineOsc.start();
      return true;
    } catch { return false; }
  }
  return {
    unlock() { if (ensure()) ctx.resume?.(); },
    engine(rpm01, throttle) {
      if (!ctx || muted) return;
      engineOsc.frequency.value = 50 + rpm01 * 160;
      engineGain.gain.value = 0.02 + throttle * 0.05;
    },
    honk() {
      if (!ensure() || muted) return;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'square'; o.frequency.value = 370;
      g.gain.setValueAtTime(0.08, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.5);
    },
    crash(v = 1) {
      if (!ensure() || muted) return;
      const len = ctx.sampleRate * 0.2, buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) * v;
      const s = ctx.createBufferSource(); s.buffer = buf; s.connect(ctx.destination); s.start();
    },
    setMuted(m) { muted = m; if (engineGain) engineGain.gain.value = 0; },
  };
}
