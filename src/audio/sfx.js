// src/audio/sfx.js — WebAudio: motor, trúbenie, nárazy + CENTROVANÝ master reťazec.
// Všetko (vrátane rádia) ide cez master gain → StereoPanner(pan=0) → výstup,
// takže náš mix je matematicky v strede; prípadnú asymetriu systému/slúchadiel
// dorovná slider Vyváženie v nastaveniach (setBalance).
import { engineDef } from '../physics/vehicle.js';
// Zvukový profil motora: skreslenie, jas filtra, štrk a hlasitosť.
// TDI = dusný straight-pipe diesel; wankel = vreskot + ikonický brap na voľnobehu
// (namerané z RX-7: sekanie ~29 Hz do ~10 % amplitúdy, s otáčkami mizne).
const SND = {
  tdi: { drive: 7, lpBase: 1000, lpTh: 4200, lpR: 1200, nzBase: 0.012, nzTh: 0.11, nzR: 0.025, gBase: 0.075, gTh: 0.19, gR: 0.035, popCh: 0.14, popLo: 0.15, popHi: 0.25 },
  wankel: { drive: 10, lpBase: 1500, lpTh: 5000, lpR: 2000, nzBase: 0.02, nzTh: 0.14, nzR: 0.03, gBase: 0.085, gTh: 0.21, gR: 0.04, popCh: 0.2, popLo: 0.2, popHi: 0.3 },
};
export function createSfx() {
  // Stav motora: zapaľovacia frekvencia 4-valca (2 zážihy / otáčka),
  // kľukový polovičný tón (lope na voľnobehu), sub-bas a šumový štrk výfuku.
  // Straight pipe = ostré skreslenie + jasný filter podľa plynu + praskot pri ubratí.
  let ctx = null;
  let eng = null;
  let master = null, panner = null, radioSrc = null, radioGain = null;
  let balance = 0, muted = false, musicMuted = false;
  // Aktívny zvukový profil (prepína setEngine; krivky skreslenia predpečené obe).
  let sndId = 'tdi';
  let curves = null;
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
      // Krivky oboch motorov predpečené — prepnutie je len výmena poľa, bez chrupnutia.
      const shaper = ctx.createWaveShaper();
      if (!curves) curves = { tdi: driveCurve(SND.tdi.drive), wankel: driveCurve(SND.wankel.drive) };
      shaper.curve = curves[sndId] || curves.tdi;
      shaper.oversample = '2x';
      // Jas podľa plynu: priľahnutý plyn otvorí klapku až k ~6 kHz (krik),
      // voľnobeh ostane tmavší a bublavý. Highpass len režie DC/subsoniku.
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1200; lp.Q.value = 1.1;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 45;
      const engineGain = ctx.createGain(); engineGain.gain.value = 0;
      // Brap-LFO wanklu: sekanie ~29 Hz sa musí modulovať vzorkovo presne
      // (audio-rate), nie po snímkoch — 28 Hz pri 60 FPS dáva len ~2 vzorky
      // na periódu a namiesto brapu vzniká nepravidelné chrčanie. LFO beží
      // vždy, hĺbka 0 ho pre TDI úplne vypne.
      const brapOsc = ctx.createOscillator(); brapOsc.type = 'sine'; brapOsc.frequency.value = 28;
      const brapDepth = ctx.createGain(); brapDepth.gain.value = 0;
      brapOsc.connect(brapDepth); brapDepth.connect(engineGain.gain);
      oscFire.connect(gFire); gFire.connect(shaper);
      oscCrank.connect(gCrank); gCrank.connect(shaper);
      noiseG.connect(shaper);
      shaper.connect(lp); lp.connect(hp); hp.connect(engineGain);
      // Sub ide čisto mimo skreslenia, nech tlačí a nebabre.
      oscSub.connect(gSub); gSub.connect(engineGain);
      engineGain.connect(master);
      oscFire.start(); oscCrank.start(); oscSub.start(); noiseSrc.start(); brapOsc.start();
      eng = { oscFire, oscCrank, oscSub, noiseBp, noiseG, lp, engineGain, shaper, brapOsc, brapDepth };
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
    const P = SND[sndId] || SND.tdi;
    const peak = (P.popLo + Math.random() * P.popHi) * intensity;
    g.gain.setValueAtTime(peak, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(t0, Math.random() * 1.5, dur + 0.02);
    src.stop(t0 + dur + 0.03);
  }
  return {
    unlock() { if (ensure() && ctx.resume) ctx.resume(); },
    // Prepnutie zvukového profilu (volá main pri výbere motora).
    // Funguje aj pred unlockom — uplatní sa pri vytvorení grafu.
    setEngine(id) {
      if (SND[id]) sndId = id;
      if (eng && curves) eng.shaper.curve = curves[sndId];
    },
    engine(rpm01, throttle) {
      if (!ctx || !eng) return;
      const r = Math.max(0, Math.min(1, Number(rpm01) || 0));
      const th = Math.max(0, Math.min(1, Number(throttle) || 0));
      const E = engineDef();
      const P = SND[sndId] || SND.tdi;
      // Skutočné otáčky → zapaľovacia frekvencia: ot/s × zážihy na otáčku.
      // TDI voľnobeh 900 ≈ 30 Hz bublanie, limit 8000 ≈ 267 Hz rev;
      // wankel voľnobeh 1100 ≈ 73 Hz, 15000 ≈ 1000 Hz vreskot.
      const rpm = E.idle + r * E.range;
      const fire = (rpm / 60) * E.firePerRev;
      const crank = fire / 2;
      eng.oscFire.frequency.value = fire;
      // Mierne rozladenie kľuky proti zážihu = drsný, živý chod bez LFO.
      eng.oscCrank.frequency.value = crank * 1.007;
      eng.oscSub.frequency.value = crank;
      // Klapka: plyn + otáčky otvárajú filter (wankel kričí až k ~8,5 kHz).
      eng.lp.frequency.value = P.lpBase + th * P.lpTh + r * P.lpR;
      // Štrk: pod plynom syčí pásmo, na voľnobeh len šepká.
      eng.noiseBp.frequency.value = 1200 + th * 2000 + r * 400;
      eng.noiseG.gain.value = P.nzBase + th * P.nzTh + r * P.nzR;
      const g = P.gBase + th * P.gTh + r * P.gR;
      // Ikonický wankel-brap (namerané z RX-7: ~29 Hz sekanie, hĺbka ~90 %,
      // s otáčkami mizne). Celok kmitá g·(1−d) … g — pri voľnobehu takmer
      // úplné výpadky medzi pulzmi.
      if (sndId === 'wankel') {
        const depth = 0.9 * Math.max(0, 1 - r * 1.8);
        eng.brapOsc.frequency.value = 28 + r * 10;
        eng.brapDepth.gain.value = g * depth * 0.5;
        eng.engineGain.gain.value = g * (1 - depth * 0.5);
      } else {
        eng.brapDepth.gain.value = 0;
        eng.engineGain.gain.value = g;
      }
      // Praskot výfuku: ubratý plyn vo vysokých otáčkach strieľa (wankel viac).
      if (th < 0.08 && r > 0.3 && Math.random() < r * P.popCh) pop(0.5 + r * 0.5);
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
    // Má vlastný radioGain, takže hudba sa dá stíšiť bez motora/trúbenia/nárazov.
    // Volaj raz po vytvorení sfx; pri zlyhaní hrá element priamo (bez grafu).
    attachRadio(el) {
      if (!el || radioSrc || !ensure()) return false;
      try {
        radioSrc = ctx.createMediaElementSource(el);
        radioGain = ctx.createGain(); radioGain.gain.value = musicMuted ? 0 : 1;
        radioSrc.connect(radioGain); radioGain.connect(master);
        return true;
      } catch { radioSrc = null; radioGain = null; return false; }
    },
    // Len hudba (rádio) ticho — motor, trúbenie aj nárazy hrajú ďalej.
    // Funguje aj pred attachRadio (príznak sa uplatní pri vytvorení radioGain).
    setMusicMuted(m) {
      musicMuted = !!m;
      if (radioGain) radioGain.gain.value = musicMuted ? 0 : 1;
    },
    // -1 = plne vľavo, 0 = stred, +1 = plne vpravo.
    setBalance(v) {
      balance = Math.max(-1, Math.min(1, Number(v) || 0));
      if (panner) panner.pan.value = balance;
    },
    setMuted(m) { muted = !!m; if (master) master.gain.value = muted ? 0 : 0.9; },
  };
}
