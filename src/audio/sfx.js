// src/audio/sfx.js — WebAudio: motor, trúbenie, nárazy + CENTROVANÝ master reťazec.
// Všetko (vrátane rádia) ide cez master gain → StereoPanner(pan=0) → výstup,
// takže náš mix je matematicky v strede; prípadnú asymetriu systému/slúchadiel
// dorovná slider Vyváženie v nastaveniach (setBalance).
export function createSfx() {
  let ctx = null, engineOsc = null, engineGain = null;
  let master = null, panner = null, radioSrc = null;
  let balance = 0, muted = false;
  function ensure() {
    if (ctx) return true;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.9;
      if (ctx.createStereoPanner) {
        panner = ctx.createStereoPanner();
        panner.pan.value = balance;
        master.connect(panner);
        panner.connect(ctx.destination);
      } else {
        master.connect(ctx.destination);
      }
      engineOsc = ctx.createOscillator(); engineOsc.type = 'sawtooth'; engineOsc.frequency.value = 60;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
      engineGain = ctx.createGain(); engineGain.gain.value = 0;
      engineOsc.connect(lp);
      lp.connect(engineGain);
      engineGain.connect(master);
      engineOsc.start();
      return true;
    } catch { return false; }
  }
  return {
    unlock() { if (ensure() && ctx.resume) ctx.resume(); },
    engine(rpm01, throttle) {
      if (!ctx) return;
      engineOsc.frequency.value = 50 + rpm01 * 160;
      engineGain.gain.value = 0.02 + throttle * 0.05;
    },
    honk() {
      if (!ensure()) return;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'square'; o.frequency.value = 370;
      g.gain.setValueAtTime(0.08, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      o.connect(g); g.connect(master); o.start(); o.stop(ctx.currentTime + 0.5);
    },
    crash(v = 1) {
      if (!ensure()) return;
      const len = ctx.sampleRate * 0.2, buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) * v;
      const s = ctx.createBufferSource(); s.buffer = buf; s.connect(master); s.start();
    },
    // Policajný warning PING (heat stúpol): dvoj-tón 880 → 1175 Hz, ~0.6 s.
    ping() {
      if (!ensure()) return;
      const t0 = ctx.currentTime;
      for (const [dt, f] of [[0, 880], [0.22, 1175]]) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t0 + dt);
        g.gain.exponentialRampToValueAtTime(0.22, t0 + dt + 0.03);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + dt + 0.2);
        o.connect(g); g.connect(master);
        o.start(t0 + dt); o.stop(t0 + dt + 0.25);
      }
    },
    // Víťazná zvučka (verbatim melódia z monolitu: 523 → 659 → 784).
    win() {
      if (!ensure()) return;
      const t0 = ctx.currentTime;
      [[523, 0, 0.15], [659, 0.15, 0.15], [784, 0.3, 0.3]].forEach(([f, dt, dur]) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'triangle'; o.frequency.value = f;
        g.gain.setValueAtTime(0.12, t0 + dt);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + dt + dur);
        o.connect(g); g.connect(master);
        o.start(t0 + dt); o.stop(t0 + dt + dur + 0.02);
      });
    },
    // Rádio (<audio>) cez ten istý master → rovnaká hlasitosť, mute aj balance.
    // Volaj raz po vytvorení sfx; pri zlyhaní hrá element priamo (bez grafu).
    attachRadio(el) {
      if (!el || radioSrc || !ensure()) return false;
      try {
        radioSrc = ctx.createMediaElementSource(el);
        const rg = ctx.createGain(); rg.gain.value = 1;
        radioSrc.connect(rg); rg.connect(master);
        return true;
      } catch { radioSrc = null; return false; }
    },
    // -1 = plne vľavo, 0 = stred, +1 = plne vpravo.
    setBalance(v) {
      balance = Math.max(-1, Math.min(1, Number(v) || 0));
      if (panner) panner.pan.value = balance;
    },
    getBalance() { return balance; },
    setMuted(m) { muted = !!m; if (master) master.gain.value = muted ? 0 : 0.9; },
  };
}
