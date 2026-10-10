// src/audio/sfx.js — WebAudio: motor, trúbenie, nárazy + CENTROVANÝ master reťazec.
// Všetko (vrátane rádia) ide cez master gain → StereoPanner(pan=0) → výstup,
// takže náš mix je matematicky v strede; prípadnú asymetriu systému/slúchadiel
// dorovná slider Vyváženie v nastaveniach (setBalance).
export function createSfx() {
  // Stav motora: zapaľovacia frekvencia 4-valca (2 zážihy / otáčka),
  // kľukový polovičný tón (lope na voľnobehu), sub-bas a šumový štrk výfuku.
  // Straight pipe = ostré skreslenie + jasný filter podľa plynu + praskot pri ubratí.
  let ctx = null;
  let eng = null;
  let master = null, panner = null, radioSrc = null;
  let balance = 0, muted = false;
  // Zdieľaný šumový buffer pre štrk + praskot (2 s bieleho šumu, vytvorí sa raz).
  let noiseBuf = null;
  function driveCurve(k) {
    const n = 256, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(k * x) / Math.tanh(k);
    }
    return curve;
  }
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
      // --- MOTOR: straight pipe 4-valec ---
      // Základ: pílka na zapaľovacej frekvencii (ostré harmonické = rezavý výfuk),
      // štvorec na polovičnej (kľuková nerovnomernosť, chop na voľnobehu),
      // sínusový sub na tej istej polovičnej (telo/úder do hrude).
      const oscFire = ctx.createOscillator(); oscFire.type = 'sawtooth'; oscFire.frequency.value = 30;
      const oscCrank = ctx.createOscillator(); oscCrank.type = 'square'; oscCrank.frequency.value = 15;
      const oscSub = ctx.createOscillator(); oscSub.type = 'sine'; oscSub.frequency.value = 15;
      const gFire = ctx.createGain(); gFire.gain.value = 0.5;
      const gCrank = ctx.createGain(); gCrank.gain.value = 0.32;
      const gSub = ctx.createGain(); gSub.gain.value = 0.55;
      // Štrk výfuku: slučkovaný šum cez pásmo (syčanie straight pipe pod plynom).
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const nd = noiseBuf.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      const noiseSrc = ctx.createBufferSource(); noiseSrc.buffer = noiseBuf; noiseSrc.loop = true;
      const noiseBp = ctx.createBiquadFilter(); noiseBp.type = 'bandpass'; noiseBp.frequency.value = 1600; noiseBp.Q.value = 0.7;
      const noiseG = ctx.createGain(); noiseG.gain.value = 0.03;
      noiseSrc.connect(noiseBp); noiseBp.connect(noiseG);
      // Skreslenie = odrezaný tlmič: ostrá tanh saturácia s prevahou.
      const shaper = ctx.createWaveShaper(); shaper.curve = driveCurve(7); shaper.oversample = '2x';
      // Jas podľa plynu: priľahnutý plyn otvorí klapku až k ~6 kHz (krik),
      // voľnobeh ostane tmavší a bublavý. Highpass len režie DC/subsoniku.
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1200; lp.Q.value = 1.1;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 45;
      const engineGain = ctx.createGain(); engineGain.gain.value = 0;
      oscFire.connect(gFire); gFire.connect(shaper);
      oscCrank.connect(gCrank); gCrank.connect(shaper);
      noiseG.connect(shaper);
      shaper.connect(lp); lp.connect(hp); hp.connect(engineGain);
      // Sub ide čisto mimo skreslenia, nech tlačí a nebabre.
      oscSub.connect(gSub); gSub.connect(engineGain);
      engineGain.connect(master);
      oscFire.start(); oscCrank.start(); oscSub.start(); noiseSrc.start();
      eng = { oscFire, oscCrank, oscSub, noiseBp, noiseG, lp, engineGain };
      return true;
    } catch { return false; }
  }
  // Krátky výstrel do výfuku (praskot pri ubratí plynu vo vysokých otáčkach).
  // Volá sa len náhodne párkrát za sekundu, takže pár alokácií nevadí.
  function pop(intensity) {
    if (!ctx || !eng || !noiseBuf) return;
    const t0 = ctx.currentTime;
    const dur = 0.03 + Math.random() * 0.05;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    src.playbackRate.value = 0.7 + Math.random() * 0.8;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.value = 400 + Math.random() * 2200; bp.Q.value = 1.2;
    const g = ctx.createGain();
    const peak = (0.15 + Math.random() * 0.25) * intensity;
    g.gain.setValueAtTime(peak, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(t0, Math.random() * 1.5, dur + 0.02);
    src.stop(t0 + dur + 0.03);
  }
  return {
    unlock() { if (ensure() && ctx.resume) ctx.resume(); },
    engine(rpm01, throttle) {
      if (!ctx || !eng) return;
      const r = Math.max(0, Math.min(1, Number(rpm01) || 0));
      const th = Math.max(0, Math.min(1, Number(throttle) || 0));
      // Skutočné otáčky → zapaľovacia frekvencia 4-taktu: ot/s × 2 zážihy.
      // Voľnobeh 900 ≈ 30 Hz bublanie, obmedzovač 8000 ≈ 267 Hz rev.
      const rpm = 900 + r * 7100;
      const fire = (rpm / 60) * 2;
      const crank = fire / 2;
      eng.oscFire.frequency.value = fire;
      // Mierne rozladenie kľuky proti zážihu = drsný, živý chod bez LFO.
      eng.oscCrank.frequency.value = crank * 1.007;
      eng.oscSub.frequency.value = crank;
      // Klapka: plyn + otáčky otvárajú filter (straight pipe krik), Q pridá nos.
      eng.lp.frequency.value = 1000 + th * 4200 + r * 1200;
      // Štrk: pod plynom syčí pásmo 1–3,5 kHz, na voľnobeh len šepká.
      eng.noiseBp.frequency.value = 1200 + th * 2000 + r * 400;
      eng.noiseG.gain.value = 0.012 + th * 0.11 + r * 0.025;
      // Hlasitosť: straight pipe je nahlas — voľnobeh počuť, plný plyn reve.
      eng.engineGain.gain.value = 0.075 + th * 0.19 + r * 0.035;
      // Praskot výfuku: ubratý plyn vo vysokých otáčkach strieľa.
      if (th < 0.08 && r > 0.3 && Math.random() < r * 0.14) pop(0.5 + r * 0.5);
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
    // Jediný potenciálny volaj je mŕtvy src/ai/police.js — ponechané podľa
    // AGENTS.md ("sfx.ping() exists only for it").
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
    setMuted(m) { muted = !!m; if (master) master.gain.value = muted ? 0 : 0.9; },
  };
}
