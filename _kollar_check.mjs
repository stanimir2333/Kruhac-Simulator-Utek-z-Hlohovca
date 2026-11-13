
/* ==================================================================
   SLÁVY DCÉRA — cesta Jána Kollára z Nemecka na Slovensko
   three.js 0.160 · jediný súbor, bez build kroku
   ================================================================== */

// ---------- načítanie three (unpkg cez importmap, fallback na lokálnu kopiu) ----------
let THREE;
try {
  THREE = await import('./node_modules/three/build/three.module.js');
} catch {
  THREE = await import('./node_modules/three/build/three.module.js');
}

/* ==================================================================
   0. POMOCNÉ FUNKCIE
   ================================================================== */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const frame = () => new Promise(r => requestAnimationFrame(() => r()));
const $ = (id) => document.getElementById(id);

/* --- šum (value noise + fbm + hrebeňová varianta) --- */
function hash2(x, y) {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
function fbm(x, y, oct = 4) {
  let s = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { s += amp * vnoise(x * f, y * f); norm += amp; f *= 2.03; amp *= 0.5; }
  return s / norm;
}
function ridge(x, y, oct = 4) {
  let s = 0, amp = 0.55, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    let n = 1 - Math.abs(vnoise(x * f, y * f) * 2 - 1);
    n *= n; s += amp * n; norm += amp; f *= 2.07; amp *= 0.5;
  }
  return s / norm;
}

/* ==================================================================
   1. KONŠTANTY CESTY
   ================================================================== */
const JOURNEY_LEN = 1900;        // dĺžka trasy vo svvetelných jednotkách
const TERRAIN_W = 1250;          // šírka krajiny (kolmo na rieku)
const SEG_X = 560, SEG_Z = 220;  // rozlíšenie terénu
const RIVER_SEGS = 1100;         // segmentov rieky
const JOURNEY_SECONDS = 168;     // celá cesta pri rýchlosti 1×
const SEA = 0;                   // hladina vody

/* ==================================================================
   2. TEXTY — štruktúra podľa Slávy dcéra
   ================================================================== */
const CHAPTERS = [
  {
    u0: 0.00, u1: 0.125, num: 'P', mark: 'PREDSPEV', tit: 'ŽALOSPEV',
    txt: 'Stojíš na pôde, ktorá bola kedysi kolískou Slovanov a stala sa jej hrobom. ' +
         'Tu, kde schradili Lužických Srbov, ešte znie spev — ale spev, ktorý už nikto nechce počuť. ' +
         'Zo zemskej kôry sa zdvíha otázka, ktorá prežije celú báseň: čo znamená sloboda pre tých, ktorí ju nemajú.',
    q: {
      oq: '„Sám svobody kdo hoden, svobodu zná vážiti každou, ten, kdo do pout jímá otroky, sám je otrok."',
      tr: 'Kto hoden slobody, ten slobodu si váži; kto zotročí iných, sám je otrokom.'
    },
    caps: [
      'Stojím na pôde, ktorá bola kolískou Slovanov — a stala sa ich hrobom.',
      'Rieky Lužice a Žitavy ešte vedia, po čom sa volajú. Ľudia už nie.',
      'Kto hoden slobody, ten slobodu si váži — a kto zotročí iných, sám je otrokom.'
    ]
  },
  {
    u0: 0.125, u1: 0.335, num: 'I', mark: 'I. SPEV', tit: 'SÁLA',
    txt: 'Jena. Mesto teológie, mesto študentských rokov, mesto, kde si vypočulal slovo „slovanský" ' +
         'a po raz si sa ním cítil inak než predtým. Nad riekou Sála sa lúčiš s Mínou — ' +
         'nie s ženou z príhody, ale s ideou, ktorá dostala meno a plačie. Šála nesie studenú vodu tých rokov.',
    q: {
      oq: '„…až z lásky, od níž sa mládej srdce bolí, jediná lásť, čo kvitne bez nádeje…"',
      tr: 'Pieseň o lúčení: mladé srdce sa bolí, no lásť, ktorá nekvitne z nádeje, je predsa len jediná.'
    },
    caps: [
      'Jena — mesto teológie, mesto ticha, mesto prvého slova „slovanský".',
      'Mína nie je žena z príhody. Mína je idea, ktorá má meno a plačie.',
      'Šála nesie so sebou všetko, čo som tam vypočul — aj to, čo som tam stratil.'
    ]
  },
  {
    u0: 0.335, u1: 0.625, num: 'II', mark: 'II. SPEV', tit: 'LABE, RÉN, VLTAVA',
    txt: 'Cesta z Jeny smerom na severovýchod: Labe, obchvat západným smerom po Ríne, Vltava. ' +
         'Odchádzaš od milovanej ženy, no ešte väčšmi od mlčania. Na brehoch si spomínal na národy, ' +
         'ktoré si navzájom nerozumeli — na Slovanov, ktorí sa rozpadli, na Čechov, ktorí zostali, ' +
         'na tú vlastnú otázku, kde vlastne začínaš ty sám.',
    q: {
      oq: '„Plynú vody, plynú časy, plynú národy — len pieseň sa neopotrebuje."',
      tr: 'Vody plynnú, časy plynnú, národy plynnú — iba pieseň sa neopotrebuje.'
    },
    caps: [
      'Rieky nepoznajú hranice. Ja áno.',
      'Na Labe, na Ríne, na Vltave — každá odplýva do inej ríky, iným ľuďom, iným časom.',
      'Vltava je najkrajšia z nich — a najtrúchlivejšia: spieva ako ten, kto stratil všetko, čo mal.'
    ]
  },
  {
    u0: 0.625, u1: 0.885, num: 'III', mark: 'III. SPEV', tit: 'DUNAJ',
    txt: 'Dunaj. Podunajsko. Hlas sa ti vracia k mladosťi, k Tatrom a Tokaju, k rokom, keď bol ' +
         'svet ešte celý a slovanské meno nie bolo hanbou. Ale okolo teba je národ, ktorý sa ' +
         'nesmie — a práve v tom je nádej: pieseň môže zostať, aj keď všetko ostatné odpadne.',
    q: {
      oq: '„…od Tatier k Tokaju…"',
      tr: 'Spomienka na mladosť: od Tatier k Tokaju, od prvého vystúpenia po posledné slovo lásky.'
    },
    caps: [
      'Dunaj. Za ním domov.',
      'Spomínam si mladosť: od Tatier k Tokaju.',
      'Národ sa nesmrie, kým si sám seba nevyberie spievať.'
    ]
  },
  {
    u0: 0.885, u1: 1.001, num: 'IV · V', mark: 'IV. LÉTHÉ · V. ACHERON', tit: 'RIEKA ZAPOMÍNANIA',
    txt: 'Cesta už nevedie po zemi. Za hladinou sa otvára slovanské nebo, pod vodou čaká peklo: ' +
         'Léthé a Acheron. Riek, ktoré odplývajú všetko, čo zostalo na ceste — meno, tvár, ' +
         'aj hlas. A predsa pieseň ide ďalej. Aj mŕtvi spievajú.',
    q: {
      oq: '„…aj mŕtvi spievajú…"',
      tr: 'Aj mŕtvi spievajú — a preto cesta nekončí na brehoch pekla.'
    },
    caps: [
      'Tu sa už zem končí. Za riekou je slovanské nebo.',
      'Léthé: všetko, čo maľujem, má svojich rodín. Aj rieka má.',
      'Acheron: pod čiernou vodou spia všetci, ktorí si mysleli, že sú viac než národ.',
      'Ale pieseň ide ďalej. Aj mŕtvi spievajú.'
    ]
  }
];

/* rieky — menovky zobrazované pri prechode */
const RIVERS = [
  { u: 0.005, name: 'LUŽICA · zem Lužických Srbov' },
  { u: 0.135, name: 'SÁLA · Jena' },
  { u: 0.240, name: 'SÁLA · Mišeň' },
  { u: 0.345, name: 'LABE · Ústí nad Labem' },
  { u: 0.430, name: 'RÉN · západný obchvat' },
  { u: 0.505, name: 'VLTAVA · Praha' },
  { u: 0.610, name: 'VLTAVA · ústie do Labe' },
  { u: 0.655, name: 'DUNAJ · Passau' },
  { u: 0.730, name: 'DUNAJ · Viedeň' },
  { u: 0.800, name: 'DUNAJ · Bratislava' },
  { u: 0.865, name: 'PODUNAJSKO · spomienka na Tatry' },
  { u: 0.930, name: 'TOKAJ · vinohrady' }
];

/* biome krajiny pozdĺž trasy */
const BIOME_KEYS = [
  // u,    rough, mount, mountH, forest, field, valleyW, base,  deep, chan,  snow
  { u: 0.000, rough: 0.50, mount: 0.00, mountH:   0, forest: 0.30, field: 0.30, valleyW: 170, base: 2.2, deep: 3.6, chan: 22, snow: 9999 },
  { u: 0.080, rough: 0.70, mount: 0.05, mountH:  30, forest: 0.28, field: 0.38, valleyW: 150, base: 3.0, deep: 4.0, chan: 22, snow: 9999 },
  { u: 0.170, rough: 1.00, mount: 0.22, mountH:  55, forest: 0.80, field: 0.18, valleyW:  95, base: 5.0, deep: 5.0, chan: 20, snow:  130 },
  { u: 0.260, rough: 1.05, mount: 0.26, mountH:  60, forest: 0.90, field: 0.14, valleyW:  88, base: 5.6, deep: 5.0, chan: 20, snow:  130 },
  { u: 0.350, rough: 0.92, mount: 0.38, mountH:  85, forest: 0.58, field: 0.48, valleyW:  98, base: 5.0, deep: 5.6, chan: 23, snow:  115 },
  { u: 0.450, rough: 0.86, mount: 0.58, mountH: 120, forest: 0.52, field: 0.36, valleyW: 115, base: 4.6, deep: 6.0, chan: 25, snow:  100 },
  { u: 0.540, rough: 0.74, mount: 0.42, mountH:  95, forest: 0.44, field: 0.60, valleyW: 135, base: 4.0, deep: 6.0, chan: 26, snow:  105 },
  { u: 0.640, rough: 0.82, mount: 0.56, mountH: 135, forest: 0.58, field: 0.36, valleyW: 115, base: 5.0, deep: 6.4, chan: 27, snow:   95 },
  { u: 0.760, rough: 0.98, mount: 0.90, mountH: 215, forest: 0.66, field: 0.20, valleyW:  95, base: 6.0, deep: 6.8, chan: 25, snow:   72 },
  { u: 0.830, rough: 0.72, mount: 0.62, mountH: 150, forest: 0.46, field: 0.44, valleyW: 125, base: 4.6, deep: 6.4, chan: 29, snow:   85 },
  { u: 0.920, rough: 0.46, mount: 0.16, mountH:  45, forest: 0.30, field: 0.70, valleyW: 155, base: 3.0, deep: 5.0, chan: 31, snow: 9999 },
  { u: 1.000, rough: 0.42, mount: 0.06, mountH:  22, forest: 0.26, field: 0.80, valleyW: 165, base: 2.6, deep: 4.6, chan: 33, snow: 9999 }
];
const BIOME_FIELDS = ['rough', 'mount', 'mountH', 'forest', 'field', 'valleyW', 'base', 'deep', 'chan', 'snow'];
const _biome = {};
function biomeAt(u) {
  u = clamp(u, 0, 1);
  let i = 0;
  while (i < BIOME_KEYS.length - 2 && BIOME_KEYS[i + 1].u <= u) i++;
  const a = BIOME_KEYS[i], b = BIOME_KEYS[i + 1];
  const t = clamp((u - a.u) / (b.u - a.u), 0, 1);
  const s = t * t * (3 - 2 * t);
  for (const f of BIOME_FIELDS) _biome[f] = lerp(a[f], b[f], s);
  return _biome;
}

/* obloha, svetlo, voda — po úsekoch trasy */
const SKY_KEYS = [
  { u: 0.00, top: 0x33465f, mid: 0x9aa8a6, bot: 0xc3bda6, sun: 0xffd9a8, sunI: 0.85, fog: 0xaeb3a8, fogN: 22,  fogF: 430, elev: 0.09, azi: -0.9, ambI: 0.55, amb: 0x7d8a94, dirI: 0.85, deep: 0x1e2c33, shal: 0x35474a },
  { u: 0.11, top: 0x3c5f86, mid: 0xa9c0c6, bot: 0xd6d2b6, sun: 0xffe6b8, sunI: 1.05, fog: 0xc3ccc4, fogN: 55,  fogF: 720, elev: 0.24, azi: -0.6, ambI: 0.70, amb: 0x93a4ae, dirI: 1.10, deep: 0x1c333c, shal: 0x3a6a68 },
  { u: 0.22, top: 0x2f74bd, mid: 0xa8cbe4, bot: 0xe6e0c6, sun: 0xfff3d2, sunI: 1.30, fog: 0xd3e3ea, fogN: 110, fogF: 1200, elev: 0.55, azi: -0.2, ambI: 0.85, amb: 0xa8bcc8, dirI: 1.50, deep: 0x1d3a44, shal: 0x3f7a74 },
  { u: 0.37, top: 0x3273bd, mid: 0xb6d0e2, bot: 0xeae0c0, sun: 0xfff0c4, sunI: 1.30, fog: 0xd6e2e6, fogN: 110, fogF: 1200, elev: 0.46, azi: 0.10, ambI: 0.85, amb: 0xa9bcc6, dirI: 1.50, deep: 0x20383c, shal: 0x466f66 },
  { u: 0.50, top: 0x2e6bb4, mid: 0xd8cfae, bot: 0xf0dcb0, sun: 0xffd07a, sunI: 1.40, fog: 0xe6d3ae, fogN: 85,  fogF: 1000, elev: 0.30, azi: 0.40, ambI: 0.80, amb: 0xb6ae98, dirI: 1.60, deep: 0x2a3a3c, shal: 0x4e7a6a },
  { u: 0.62, top: 0x2760ac, mid: 0xf0c184, bot: 0xf7dfae, sun: 0xffb054, sunI: 1.50, fog: 0xf0cfa0, fogN: 78,  fogF: 900, elev: 0.20, azi: 0.70, ambI: 0.75, amb: 0xb9a88c, dirI: 1.70, deep: 0x2c3038, shal: 0x6a6a54 },
  { u: 0.74, top: 0x2350a0, mid: 0xe79a58, bot: 0xf3bd72, sun: 0xff8a34, sunI: 1.50, fog: 0xdd9f68, fogN: 68,  fogF: 850, elev: 0.12, azi: 1.00, ambI: 0.70, amb: 0xb08a6a, dirI: 1.70, deep: 0x35302c, shal: 0x7a5c3a },
  { u: 0.83, top: 0x1d3f83, mid: 0xd9783f, bot: 0xeaa05a, sun: 0xff6a22, sunI: 1.30, fog: 0xc07a4c, fogN: 58,  fogF: 780, elev: 0.06, azi: 1.25, ambI: 0.60, amb: 0x9c6d52, dirI: 1.40, deep: 0x2a2226, shal: 0x6a4230 },
  { u: 0.90, top: 0x0d1730, mid: 0x27355e, bot: 0x5a5a7a, sun: 0xc9dcff, sunI: 0.65, fog: 0x27304c, fogN: 28,  fogF: 520, elev: 0.45, azi: 1.60, ambI: 0.35, amb: 0x4a5878, dirI: 0.70, deep: 0x0e1428, shal: 0x2a3a60 },
  { u: 0.95, top: 0x120c1c, mid: 0x341a34, bot: 0x5c2330, sun: 0xff7a3a, sunI: 0.80, fog: 0x35162a, fogN: 24,  fogF: 460, elev: 0.20, azi: 1.90, ambI: 0.30, amb: 0x5a3048, dirI: 0.80, deep: 0x1a0608, shal: 0x4a1008 },
  { u: 1.00, top: 0x1a0708, mid: 0x4a1010, bot: 0x8a1c0c, sun: 0xff4a12, sunI: 1.00, fog: 0x3e1010, fogN: 20,  fogF: 430, elev: 0.05, azi: 2.20, ambI: 0.32, amb: 0x6b2a20, dirI: 1.00, deep: 0x1a0608, shal: 0x4a1008 }
];
const SKY_FIELDS = ['sunI', 'fogN', 'fogF', 'elev', 'azi', 'ambI', 'dirI'];
const _sky = {};
const _cTop = new THREE.Color(), _cMid = new THREE.Color(), _cBot = new THREE.Color();
const _cSun = new THREE.Color(), _cFog = new THREE.Color(), _cAmb = new THREE.Color();
const _cDeep = new THREE.Color(), _cShal = new THREE.Color();
const _cTmp = new THREE.Color();
function skyAt(u) {
  u = clamp(u, 0, 1);
  let i = 0;
  while (i < SKY_KEYS.length - 2 && SKY_KEYS[i + 1].u <= u) i++;
  const a = SKY_KEYS[i], b = SKY_KEYS[i + 1];
  const t = smoothstep(a.u, b.u, u);
  _cTop.setHex(a.top).lerp(_cTmp.setHex(b.top), t);
  _cMid.setHex(a.mid).lerp(_cTmp.setHex(b.mid), t);
  _cBot.setHex(a.bot).lerp(_cTmp.setHex(b.bot), t);
  _cSun.setHex(a.sun).lerp(_cTmp.setHex(b.sun), t);
  _cFog.setHex(a.fog).lerp(_cTmp.setHex(b.fog), t);
  _cAmb.setHex(a.amb).lerp(_cTmp.setHex(b.amb), t);
  _cDeep.setHex(a.deep).lerp(_cTmp.setHex(b.deep), t);
  _cShal.setHex(a.shal).lerp(_cTmp.setHex(b.shal), t);
  for (const f of SKY_FIELDS) _sky[f] = lerp(a[f], b[f], t);
  _sky.top = _cTop; _sky.mid = _cMid; _sky.bot = _cBot; _sky.sun = _cSun;
  _sky.fog = _cFog; _sky.amb = _cAmb; _sky.deep = _cDeep; _sky.shal = _cShal;
  return _sky;
}

/* mestečká a ich riečne brehy */
const TOWNS = [
  { u: 0.175, n: 70, tower: true, name: 'JENA' },
  { u: 0.395, n: 58, tower: false, name: 'ÚSTÍ NAD LABEM' },
  { u: 0.575, n: 95, tower: true, name: 'PRAHA' },
  { u: 0.665, n: 48, tower: false, name: 'PASSAU' },
  { u: 0.745, n: 110, tower: true, name: 'VIEDEŇ' },
  { u: 0.815, n: 80, tower: true, name: 'BRATISLAVA' },
  { u: 0.905, n: 38, tower: false, name: 'NOVÉ ZÁHRADY' }
];

/* ==================================================================
   3. RIEKA — krivka trasy a tabuľka pre terén
   ================================================================== */
function meander(u) {
  const wide = 44 * Math.sin(u * Math.PI * 3.7 + 0.6) + 25 * Math.sin(u * Math.PI * 8.3 + 2.1);
  const fine = 8.5 * Math.sin(u * Math.PI * 19.1 + 0.9) + 4.2 * Math.sin(u * Math.PI * 37.7 + 4.2);
  const b = biomeAt(u);
  const amp = 1 - 0.55 * clamp(b.mount, 0, 1);   // v horách rieka menej meandruje
  return (wide + fine) * amp;
}

const riverCurve = (() => {
  const pts = [];
  const N = 300;
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    pts.push(new THREE.Vector3((u - 0.5) * JOURNEY_LEN, 0, meander(u)));
  }
  return new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
})();

/* tabuľka x -> z (x je na krivke monotónne) */
const RX = new Float32Array(2400), RZ = new Float32Array(2400);
for (let i = 0; i < RX.length; i++) {
  const p = riverCurve.getPointAt(i / (RX.length - 1));
  RX[i] = p.x; RZ[i] = p.z;
}
function riverZAt(x) {
  if (x <= RX[0]) return RZ[0];
  const last = RX.length - 1;
  if (x >= RX[last]) return RZ[last];
  let lo = 0, hi = last;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (RX[m] <= x) lo = m; else hi = m; }
  const f = (x - RX[lo]) / Math.max(1e-6, RX[hi] - RX[lo]);
  return lerp(RZ[lo], RZ[hi], f);
}

/* ==================================================================
   4. TERÉN
   ================================================================== */
function terrainH(x, z) {
  const u = clamp((x + JOURNEY_LEN / 2) / JOURNEY_LEN, 0, 1);
  const b = biomeAt(u);
  const d = Math.abs(z - riverZAt(x));
  const vd = 1 - Math.exp(-d / b.valleyW);            // 0 pri rieke, 1 ďaleko
  let h = (fbm(x * 0.0021 + 11, z * 0.0021 - 7, 5) - 0.45) * b.rough * 30;
  if (b.mount > 0.01) h += b.mount * b.mountH * ridge(x * 0.0015, z * 0.0015, 4) * 1.25;
  h = h * (0.30 + 0.70 * vd) + b.base * vd;           // údolie
  // koryto — širšie než hladina, nech breh nevystupuje z vody
  const cw = b.chan * 1.3;
  h -= b.deep * Math.exp(-(d * d) / (cw * cw));
  h += 2.2 * (fbm(x * 0.013, z * 0.013, 3) - 0.5) * (0.35 + 0.65 * vd);
  return h;
}

const C_GRASS_DRY = new THREE.Color(0x6f7a45);
const C_GRASS_LUSH = new THREE.Color(0x3d5a2f);
const C_FOREST = new THREE.Color(0x2c4626);
const C_ROCK = new THREE.Color(0x6b6a64);
const C_SNOW = new THREE.Color(0xe9eef2);
const C_SAND = new THREE.Color(0xa5956f);
const FIELD_COLS = [0x7d8f43, 0xa39a4a, 0xb5a45c, 0x6f8a3d, 0x8f7f45, 0x5f7a3c, 0x9c8b52, 0x74883f]
  .map(h => new THREE.Color(h));

function terrainColor(x, z, h, slope, out) {
  const u = clamp((x + JOURNEY_LEN / 2) / JOURNEY_LEN, 0, 1);
  const b = biomeAt(u);
  out.copy(C_GRASS_DRY).lerp(C_GRASS_LUSH, clamp(b.forest * 0.85 + 0.12, 0, 1));
  if (b.field > 0.05) {
    const flat = 1 - smoothstep(0.14, 0.5, slope);
    const low = 1 - smoothstep(20, 60, h);
    const cx = Math.floor((x + 9000) / 48), cz = Math.floor((z + 9000) / 48);
    const r = hash2(cx, cz);
    const f = FIELD_COLS[Math.floor(r * FIELD_COLS.length) % FIELD_COLS.length];
    out.lerp(f, clamp(b.field * 0.9, 0, 1) * flat * low);
  }
  out.lerp(C_FOREST, clamp((b.forest - 0.5) * 0.7, 0, 1) * (1 - smoothstep(0.35, 0.7, slope)));
  const rockAmt = clamp(smoothstep(40, 100, h) * b.mount * 1.35 + smoothstep(0.55, 1.0, slope) * 0.45, 0, 1);
  out.lerp(C_ROCK, rockAmt);
  out.lerp(C_SNOW, smoothstep(b.snow, b.snow + 28, h));
  const d = Math.abs(z - riverZAt(x));
  out.lerp(C_SAND, smoothstep(b.chan * 3.2, b.chan * 1.35, d) * 0.85);
  out.multiplyScalar(0.86 + 0.26 * fbm(x * 0.06, z * 0.06, 2));
  return out;
}

/* ==================================================================
   5. SCÉNA
   ================================================================== */
const stage = $('stage');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.5, 14000);
camera.position.set(0, 20, 60);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
stage.appendChild(renderer.domElement);

scene.fog = new THREE.Fog(0xffffff, 60, 900);

const hemi = new THREE.HemisphereLight(0xbcd2e2, 0x4a4436, 0.8);
scene.add(hemi);
const sunLight = new THREE.DirectionalLight(0xfff0cc, 1.4);
sunLight.position.set(-300, 420, 260);
scene.add(sunLight);
const rim = new THREE.DirectionalLight(0x88a8d0, 0.35);
rim.position.set(260, 160, -320);
scene.add(rim);

/* ---------- obloha ---------- */
const skyUniforms = {
  uTop: { value: new THREE.Color(0x2f74bd) },
  uMid: { value: new THREE.Color(0xa8cbe4) },
  uBot: { value: new THREE.Color(0xe6e0c6) },
  uSunCol: { value: new THREE.Color(0xfff3d2) },
  uSunDir: { value: new THREE.Vector3(0.4, 0.3, 0.6) },
  uSunI: { value: 1.0 }
};
const skyMesh = new THREE.Mesh(
  new THREE.SphereGeometry(6000, 32, 20),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: skyUniforms,
    vertexShader: `
      varying vec3 vDir;
      void main(){
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
      }`,
    fragmentShader: `
      uniform vec3 uTop,uMid,uBot,uSunCol,uSunDir; uniform float uSunI;
      varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        float t = d.y*0.5+0.5;
        vec3 c = mix(uBot, uMid, smoothstep(0.42,0.52,t));
        c = mix(c, uTop, smoothstep(0.52,0.96,t));
        float sd = max(dot(d, normalize(uSunDir)), 0.0);
        c += uSunCol * pow(sd, 90.0) * 2.2 * uSunI;
        c += uSunCol * pow(sd, 6.0) * 0.20 * uSunI;
        c += uSunCol * pow(sd, 2.0) * 0.05 * uSunI;
        gl_FragColor = vec4(c, 1.0);
      }`
  })
);
skyMesh.renderOrder = -10;
scene.add(skyMesh);

/* ---------- slnko / mesiac ---------- */
function radialTexture(inner, outer, size = 128) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.35, outer);
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
  map: radialTexture('rgba(255,255,245,1)', 'rgba(255,224,170,0.85)'),
  blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false, transparent: true
}));
sunSprite.scale.setScalar(900);
scene.add(sunSprite);

/* ---------- hviezdy ---------- */
const starTex = radialTexture('rgba(255,255,255,1)', 'rgba(200,220,255,0.7)', 64);
const starCount = 1400;
const starPos = new Float32Array(starCount * 3);
for (let i = 0; i < starCount; i++) {
  const th = Math.random() * Math.PI * 2;
  const ph = Math.acos(1 - Math.random() * 1.02);
  const r = 4200;
  starPos[i * 3] = r * Math.sin(ph) * Math.cos(th);
  starPos[i * 3 + 1] = r * Math.cos(ph) * 0.85 + 200;
  starPos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
}
const starGeo = new THREE.BufferGeometry();
starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
const starMat = new THREE.PointsMaterial({
  size: 5, sizeAttenuation: false, map: starTex, transparent: true, opacity: 0,
  depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffffff
});
const stars = new THREE.Points(starGeo, starMat);
stars.renderOrder = -9;
scene.add(stars);

/* ---------- oblaky ---------- */
function cloudTexture() {
  const size = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, size, size);
  const blobs = 14;
  for (let i = 0; i < blobs; i++) {
    const x = size * (0.2 + Math.random() * 0.6);
    const y = size * (0.45 + Math.random() * 0.25);
    const r = size * (0.08 + Math.random() * 0.16);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.5)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const cloudTex = cloudTexture();
const clouds = [];
{
  for (let i = 0; i < 130; i++) {
    const m = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, depthWrite: false, fog: false, opacity: 0.6 });
    const s = new THREE.Sprite(m);
    const u = i / 130;
    s.position.set((u - 0.5) * JOURNEY_LEN + (Math.random() - 0.5) * 120, 140 + Math.random() * 260,
      (Math.random() - 0.5) * 1600);
    const sc = 220 + Math.random() * 420;
    s.scale.set(sc, sc * (0.34 + Math.random() * 0.2), 1);
    scene.add(s);
    clouds.push(s);
  }
}

/* ==================================================================
   6. VODA
   ================================================================== */
const waterUniforms = {
  uTime: { value: 0 },
  uDeep: { value: new THREE.Color(0x1d3a44) },
  uShal: { value: new THREE.Color(0x3f7a74) },
  uSky: { value: new THREE.Color(0xa8cbe4) },
  uSunCol: { value: new THREE.Color(0xfff3d2) },
  uSunDir: { value: new THREE.Vector3(0.4, 0.3, 0.6) },
  uFogColor: { value: new THREE.Color(0xd3e3ea) },
  uFogN: { value: 110 }, uFogF: { value: 1200 }
};
const waterMat = new THREE.ShaderMaterial({
  uniforms: waterUniforms,
  side: THREE.DoubleSide,
  vertexShader: `
    attribute vec2 aFlow;
    varying vec2 vUv; varying vec3 vWorld; varying float vFogD; varying vec2 vFlow;
    void main(){
      vUv = uv; vFlow = aFlow;
      vec4 wp = modelMatrix * vec4(position,1.0);
      vWorld = wp.xyz;
      vec4 mv = viewMatrix * wp;
      vFogD = -mv.z;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    uniform float uTime,uFogN,uFogF;
    uniform vec3 uDeep,uShal,uSky,uSunCol,uSunDir,uFogColor;
    varying vec2 vUv; varying vec3 vWorld; varying float vFogD; varying vec2 vFlow;

    float waveH(vec2 p, float t){
      float w = sin(p.x*0.33 + p.y*0.21 - t*1.9)*0.5;
      w += sin(p.x*0.12 - p.y*0.29 + t*1.2)*0.34;
      w += sin(p.x*0.74 + p.y*0.57 - t*3.2)*0.15;
      return w;
    }
    void main(){
      vec2 p = vWorld.xz;
      float e = 0.7;
      float h  = waveH(p, uTime);
      float hx = waveH(p+vec2(e,0.0), uTime);
      float hz = waveH(p+vec2(0.0,e), uTime);
      vec3 n = normalize(vec3(-(hx-h)/e*0.95, 1.0, -(hz-h)/e*0.95));
      vec3 V = normalize(cameraPosition - vWorld);
      float fres = pow(1.0 - max(dot(n,V),0.0), 3.0);
      vec3 base = mix(uDeep, uShal, clamp(h*0.45+0.5,0.0,1.0)*0.55);
      vec3 col = mix(base, uSky, fres*0.62);
      col += uSunCol * max(dot(n, uSunDir),0.0) * 0.16;
      vec3 H = normalize(uSunDir + V);
      col += uSunCol * pow(max(dot(n,H),0.0), 110.0) * 1.1;
      // prúdové pruhy pozdĺž toku
      float ph = dot(p, vFlow) * 0.16 - uTime * 1.6;
      float streak = smoothstep(0.72, 1.0, sin(ph)*0.5+0.5);
      col += uSky * streak * 0.07;
      // penové okraje
      float edge = smoothstep(0.20, 0.0, min(vUv.y, 1.0-vUv.y));
      float foam = edge * (0.35 + 0.65*(sin(ph*7.0)*0.5+0.5));
      col = mix(col, uSky*1.15 + vec3(0.12), clamp(foam,0.0,1.0)*0.5);
      float fogF = smoothstep(uFogN, uFogF, vFogD);
      col = mix(col, uFogColor, fogF);
      gl_FragColor = vec4(col, 1.0);
    }`
});
const waterMesh = buildWater();
scene.add(waterMesh);

function buildWater() {
  const N = RIVER_SEGS;
  const pos = new Float32Array((N + 1) * 2 * 3);
  const uv = new Float32Array((N + 1) * 2 * 2);
  const flow = new Float32Array((N + 1) * 2 * 2);
  const idx = new Uint32Array(N * 6);
  const p = new THREE.Vector3(), t = new THREE.Vector3();
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    riverCurve.getPointAt(u, p);
    riverCurve.getTangentAt(u, t);
    const nx = t.z, nz = -t.x;                       // kolmá v rovine XZ
    const b = biomeAt(u);
    const w = b.chan * 1.22;
    const lx = p.x + nx * w, lz = p.z + nz * w;
    const rx = p.x - nx * w, rz = p.z - nz * w;
    const o = i * 6;
    pos[o] = lx; pos[o + 1] = SEA; pos[o + 2] = lz;
    pos[o + 3] = rx; pos[o + 4] = SEA; pos[o + 5] = rz;
    const uo = i * 4;
    uv[uo] = u * 60; uv[uo + 1] = 0;
    uv[uo + 2] = u * 60; uv[uo + 3] = 1;
    const fl = Math.hypot(t.x, t.z) || 1;
    flow[uo] = t.x / fl; flow[uo + 1] = t.z / fl;
    flow[uo + 2] = t.x / fl; flow[uo + 3] = t.z / fl;
    if (i < N) {
      const a = i * 2, bq = a + 1, c = a + 2, d = a + 3, q = i * 6;
      idx[q] = a; idx[q + 1] = c; idx[q + 2] = bq;
      idx[q + 3] = bq; idx[q + 4] = c; idx[q + 5] = d;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aFlow', new THREE.BufferAttribute(flow, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, waterMat);
  m.renderOrder = 1;
  return m;
}

/* ==================================================================
   7. LOĎKA A BÁSNIK
   ================================================================== */
function buildBoat() {
  const grp = new THREE.Group();

  /* trup — príčne rezy od ostrého prowu po ostrú zadnú */
  const M = 18, HW = 3.6;
  const v = [], idx = [];
  for (let i = 0; i <= M; i++) {
    const t = i / M;
    const z = -HW + t * HW * 2;
    const w = 0.82 * Math.pow(Math.sin(t * Math.PI), 0.55) + 0.04;
    const keel = -0.34 - 0.10 * w;
    v.push(-w, 0.34, z, -w * 0.78, -0.10, z, 0, keel, z, w * 0.78, -0.10, z, w, 0.34, z);
  }
  for (let i = 0; i < M; i++) {
    const a = i * 5, b = a + 5;
    for (let k = 0; k < 4; k++) {
      idx.push(a + k, b + k, a + k + 1, a + k + 1, b + k, b + k + 1);
    }
  }
  const hullGeo = new THREE.BufferGeometry();
  hullGeo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  hullGeo.setIndex(idx);
  hullGeo.computeVertexNormals();
  const hull = new THREE.Mesh(hullGeo, new THREE.MeshStandardMaterial({
    color: 0x6b4a2c, roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide
  }));
  grp.add(hull);

  /* lavica + rovina */
  const bench = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 0.5), new THREE.MeshStandardMaterial({ color: 0x4d3620, roughness: 0.9 }));
  bench.position.set(0, 0.34, -0.4);
  grp.add(bench);
  const oar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 4.2, 6), new THREE.MeshStandardMaterial({ color: 0x8a6a44, roughness: 0.8 }));
  oar.rotation.set(0.1, 0, Math.PI / 2.35);
  oar.position.set(0.2, 0.45, 0.3);
  grp.add(oar);

  /* básnik: plášť, hlava, klobúk, kniha */
  const poet = new THREE.Group();
  const cloak = new THREE.Mesh(new THREE.ConeGeometry(0.52, 1.45, 9), new THREE.MeshStandardMaterial({ color: 0x2b2732, roughness: 0.95 }));
  cloak.position.y = 0.72;
  poet.add(cloak);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 10), new THREE.MeshStandardMaterial({ color: 0xd9b393, roughness: 0.8 }));
  head.position.y = 1.58;
  poet.add(head);
  const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 12), new THREE.MeshStandardMaterial({ color: 0x241f2a, roughness: 0.9 }));
  hat.position.y = 1.73;
  poet.add(hat);
  const hatTop = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, 0.24, 12), new THREE.MeshStandardMaterial({ color: 0x241f2a, roughness: 0.9 }));
  hatTop.position.y = 1.85;
  poet.add(hatTop);
  const book = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.36, 0.06), new THREE.MeshStandardMaterial({ color: 0x7d2f24, roughness: 0.85 }));
  book.position.set(0.3, 1.05, 0.24);
  book.rotation.set(0.2, 0.3, 0);
  poet.add(book);
  poet.position.set(-0.05, 0.2, 0.55);
  grp.add(poet);

  /* lampa */
  const lamp = new THREE.Group();
  const glass = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xffd79a }));
  lamp.add(glass);
  const frame = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.02, 6, 12), new THREE.MeshStandardMaterial({ color: 0x3a3229, roughness: 0.7, metalness: 0.4 }));
  frame.rotation.x = Math.PI / 2;
  lamp.add(frame);
  const pl = new THREE.PointLight(0xffc178, 2.4, 90, 2);
  lamp.add(pl);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: radialTexture('rgba(255,225,170,1)', 'rgba(255,170,80,0.6)'),
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
  }));
  glow.scale.setScalar(6);
  lamp.add(glow);
  lamp.position.set(0.42, 1.05, -0.55);
  grp.add(lamp);

  grp.userData.lamp = lamp;
  grp.userData.glass = glass;
  grp.userData.poet = poet;
  grp.userData.light = pl;
  return grp;
}
const boat = buildBoat();
scene.add(boat);

/* ==================================================================
   8. VETVIČKY, STROMY, MESTÁ, VINOHRADY
   ================================================================== */
function buildTrees() {
  const pineGeo = new THREE.ConeGeometry(1, 1, 7);
  pineGeo.translate(0, 0.5, 0);
  const leafGeo = new THREE.IcosahedronGeometry(1, 0);
  const trunkGeo = new THREE.CylinderGeometry(0.15, 0.22, 1, 5);
  trunkGeo.translate(0, 0.5, 0);

  const MAX = 5200;
  const pine = new THREE.InstancedMesh(pineGeo, new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }), MAX);
  const leaf = new THREE.InstancedMesh(leafGeo, new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }), MAX);
  const trunk = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 1 }), MAX);
  pine.castShadow = leaf.castShadow = false;

  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  let np = 0, nl = 0, nt = 0;

  for (let i = 0; i < MAX * 2 && (np < MAX || nl < MAX); i++) {
    const u = Math.random();
    const forest = biomeAt(u).forest;                 // _biome je zdieľaný objekt!
    if (Math.random() > forest * 0.95 + 0.04) continue;
    const x = (u - 0.5) * JOURNEY_LEN + (Math.random() - 0.5) * 40;
    const side = Math.random() < 0.5 ? -1 : 1;
    const ux = clamp((x + JOURNEY_LEN / 2) / JOURNEY_LEN, 0, 1);
    const bb = biomeAt(ux);
    const chan = bb.chan, mount = bb.mount, fdens = bb.forest;
    const z = riverZAt(x) + side * (chan * 1.5 + 6 + Math.pow(Math.random(), 1.7) * 300);
    const h = terrainH(x, z);                         // biomeAt si volá znova — hodnoty si už nesieme
    if (h < 0.6) continue;
    if (h > 110 + mount * 60) continue;
    const hl = terrainH(x - 4, z), hr = terrainH(x + 4, z), hd = terrainH(x, z - 4), hu = terrainH(x, z + 4);
    const slope = Math.hypot(hr - hl, hu - hd) / 8;
    if (slope > 0.75) continue;
    const conifer = mount > 0.25 || Math.random() < 0.62;
    const s = (conifer ? 2.2 + Math.random() * 3.6 : 2.0 + Math.random() * 2.8) * (0.7 + fdens * 0.5);
    dummy.position.set(x, h - 0.2, z);
    dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
    if (conifer) {
      if (np >= MAX) continue;
      dummy.scale.set(s * 0.45, s * 1.6, s * 0.45);
      dummy.updateMatrix();
      pine.setMatrixAt(np, dummy.matrix);
      col.setHSL(0.28 + Math.random() * 0.05, 0.32 + Math.random() * 0.18, 0.13 + Math.random() * 0.09);
      pine.setColorAt(np, col);
      np++;
    } else {
      if (nl >= MAX) continue;
      dummy.scale.set(s * 0.8, s * 0.95, s * 0.8);
      dummy.updateMatrix();
      leaf.setMatrixAt(nl, dummy.matrix);
      col.setHSL(0.22 + Math.random() * 0.08, 0.35 + Math.random() * 0.2, 0.16 + Math.random() * 0.12);
      leaf.setColorAt(nl, col);
      nl++;
    }
    if (nt < MAX) {
      dummy.position.set(x, h - 0.4, z);
      dummy.scale.set(s * 0.16, s * 0.5, s * 0.16);
      dummy.updateMatrix();
      trunk.setMatrixAt(nt, dummy.matrix);
      nt++;
    }
  }
  pine.count = np; leaf.count = nl; trunk.count = nt;
  pine.instanceMatrix.needsUpdate = true;
  leaf.instanceMatrix.needsUpdate = true;
  trunk.instanceMatrix.needsUpdate = true;
  if (pine.instanceColor) pine.instanceColor.needsUpdate = true;
  if (leaf.instanceColor) leaf.instanceColor.needsUpdate = true;
  scene.add(pine, leaf, trunk);
}

const houseBodies = [];
const windowPts = [];

function planTowns() {
  for (const t of TOWNS) {
    const x0 = (t.u - 0.5) * JOURNEY_LEN;
    for (let _i = 0; _i < t.n; _i++) {
      const x = x0 + (Math.random() - 0.5) * 320;
      const side = Math.random() < 0.5 ? -1 : 1;
      const chan = biomeAt(clamp((x + JOURNEY_LEN / 2) / JOURNEY_LEN, 0, 1)).chan;
      const z = riverZAt(x) + side * (chan * 1.8 + 10 + Math.pow(Math.random(), 1.4) * 140);
      const h = terrainH(x, z);
      if (h < 1.2) continue;
      const w = 7 + Math.random() * 8;
      const d = 7 + Math.random() * 8;
      const hh = 8 + Math.random() * 10;
      houseBodies.push({ x, z, h, w, d, hh, rot: Math.atan2(1, 0) + (Math.random() - 0.5) * 0.8 });
      if (Math.random() < 0.45) {
        windowPts.push({ x: x + (Math.random() - 0.5) * w * 0.4, y: h + hh * 0.55, z: z + side * (d / 2 + 0.3) });
      }
    }
    if (t.tower) {
      const x = x0 + (Math.random() - 0.5) * 90;
      const side = Math.random() < 0.5 ? -1 : 1;
      const b = biomeAt(clamp((x + JOURNEY_LEN / 2) / JOURNEY_LEN, 0, 1));
      const z = riverZAt(x) + side * (b.chan * 2.2 + 20);
      houseBodies.push({ x, z, h: terrainH(x, z), w: 11, d: 11, hh: 40, rot: 0, tower: true });
    }
  }
}

function buildTowns() {
  const bodyGeo = new THREE.BoxGeometry(1, 1, 1);
  const bodyMesh = new THREE.InstancedMesh(bodyGeo, new THREE.MeshStandardMaterial({ roughness: 0.9 }), houseBodies.length);
  const roofGeo = new THREE.ConeGeometry(1, 1, 4);
  const roofMesh = new THREE.InstancedMesh(roofGeo, new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), houseBodies.length);
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  const plaster = [0xe4dccb, 0xd9cdb4, 0xcfc3ad, 0xe8e2d2, 0xd2c7b6, 0xc9bda6, 0xe0d2b8];

  houseBodies.forEach((hb, i) => {
    dummy.position.set(hb.x, hb.h + hb.hh / 2, hb.z);
    dummy.rotation.set(0, hb.rot, 0);
    dummy.scale.set(hb.w, hb.hh, hb.d);
    dummy.updateMatrix();
    bodyMesh.setMatrixAt(i, dummy.matrix);
    col.setHex(plaster[i % plaster.length]);
    col.multiplyScalar(0.9 + Math.random() * 0.2);
    bodyMesh.setColorAt(i, col);

    dummy.position.set(hb.x, hb.h + hb.hh + (hb.tower ? 0 : hb.hh * 0.28), hb.z);
    dummy.rotation.set(0, hb.rot + Math.PI / 4, 0);
    if (hb.tower) {
      dummy.scale.set(hb.w * 0.75, hb.hh * 1.1, hb.d * 0.75);
    } else {
      dummy.scale.set(hb.w * 0.82, hb.hh * 0.6, hb.d * 0.82);
    }
    dummy.updateMatrix();
    roofMesh.setMatrixAt(i, dummy.matrix);
    col.setHex(i % 3 === 0 ? 0x6a3f36 : 0x4a3a34);
    col.multiplyScalar(0.85 + Math.random() * 0.3);
    roofMesh.setColorAt(i, col);
  });
  bodyMesh.instanceMatrix.needsUpdate = true;
  roofMesh.instanceMatrix.needsUpdate = true;
  if (bodyMesh.instanceColor) bodyMesh.instanceColor.needsUpdate = true;
  if (roofMesh.instanceColor) roofMesh.instanceColor.needsUpdate = true;
  scene.add(bodyMesh, roofMesh);

  /* svetlá v oknách */
  const wg = new THREE.BufferGeometry();
  const wp = new Float32Array(windowPts.length * 3);
  windowPts.forEach((w, i) => { wp[i * 3] = w.x; wp[i * 3 + 1] = w.y; wp[i * 3 + 2] = w.z; });
  wg.setAttribute('position', new THREE.BufferAttribute(wp, 3));
  const wm = new THREE.PointsMaterial({
    size: 5, sizeAttenuation: true, map: radialTexture('rgba(255,225,160,1)', 'rgba(255,160,60,0.75)', 64),
    transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending
  });
  const win = new THREE.Points(wg, wm);
  scene.add(win);
  return win;
}

function buildVineyards() {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const rows = [];
  for (let k = 0; k < 220; k++) {
    const u = 0.915 + Math.random() * 0.075;
    const x = (u - 0.5) * JOURNEY_LEN + (Math.random() - 0.5) * 40;
    const side = Math.random() < 0.5 ? -1 : 1;
    const chan = biomeAt(u).chan;
    const z = riverZAt(x) + side * (chan * 2 + 20 + Math.random() * 210);
    const h = terrainH(x, z);
    if (h < 1.5) continue;
    rows.push({ x, y: h + 1.1, z, s: 1.6 + Math.random() * 1.4 });
  }
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.95 }), rows.length);
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  rows.forEach((r, i) => {
    dummy.position.set(r.x, r.y, r.z);
    dummy.rotation.set(0, Math.random() * 0.4, 0);
    dummy.scale.set(r.s, r.s * 1.5, r.s);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    col.setHSL(0.24 + Math.random() * 0.06, 0.3 + Math.random() * 0.15, 0.2 + Math.random() * 0.1);
    mesh.setColorAt(i, col);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  scene.add(mesh);
}

/* ==================================================================
   9. SNEH, HMLA
   ================================================================== */
function buildSnow() {
  const N = 1400;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 260;
    pos[i * 3 + 1] = Math.random() * 120;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 260;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({
    size: 1.5, sizeAttenuation: true, map: radialTexture('rgba(255,255,255,1)', 'rgba(230,240,255,0.6)', 32),
    transparent: true, opacity: 0, depthWrite: false
  });
  const p = new THREE.Points(g, m);
  scene.add(p);
  return p;
}

/* ==================================================================
   10. HUD / OVLÁDANIE
   ================================================================== */
const hud = $('hud');
const card = $('card'), cNum = $('cNum'), cTit = $('cTit'), cTxt = $('cTxt');
const cQuote = $('cQuote'), cOq = $('cOq'), cTr = $('cTr');
const capEl = $('cap'), capText = $('capText'), capMark = $('capMark');
const rivName = $('rivName');
const fill = $('fill'), knob = $('knob'), ticks = $('ticks'), chlabels = $('chlabels');
const mU = $('mU'), mR = $('mR');
const miniDot = $('miniDot'), miniDotGlow = $('miniDotGlow'), miniPath = $('miniPath');
const miniNodes = $('miniNodes');

/* značky na mape */
const MAP_NODES = [
  { u: 0.175, n: 'JENA' }, { u: 0.395, n: 'ÚSTÍ' }, { u: 0.575, n: 'PRAHA' },
  { u: 0.745, n: 'VIEDEŇ' }, { u: 0.815, n: 'BRATISLAVA' }, { u: 0.870, n: 'TATRY' }, { u: 0.950, n: 'TOKAJ' }
];
let miniLen = 1;
function buildMini() {
  miniLen = miniPath.getTotalLength();
  const NS = 'http://www.w3.org/2000/svg';
  MAP_NODES.forEach(nd => {
    const pt = miniPath.getPointAtLength(nd.u * miniLen);
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', pt.x); c.setAttribute('cy', pt.y);
    c.setAttribute('r', 2.4);
    c.setAttribute('fill', '#e8dcc0');
    miniNodes.appendChild(c);
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('x', pt.x + 5); t.setAttribute('y', pt.y + 3.4);
    t.setAttribute('class', 'mlab');
    t.textContent = nd.n;
    miniNodes.appendChild(t);
  });
  // bočný obchvat po Ríne
  const rhen = $('miniRhen');
  const a = miniPath.getPointAtLength(0.40 * miniLen);
  const b = miniPath.getPointAtLength(0.47 * miniLen);
  rhen.setAttribute('d', `M${a.x},${a.y} C${a.x - 24},${a.y - 30} ${b.x - 26},${b.y - 34} ${b.x},${b.y}`);
}

/* značky kapitol na pruhu */
function buildTicks() {
  CHAPTERS.forEach(c => {
    const sp = document.createElement('span');
    sp.style.left = (c.u0 * 100) + '%';
    ticks.appendChild(sp);
    const lb = document.createElement('span');
    lb.style.left = (c.u0 * 100) + '%';
    lb.textContent = c.mark + (c.mark.length > 6 ? '' : ' · ' + c.tit.split(',')[0]);
    chlabels.appendChild(lb);
  });
}

/* ==================================================================
   11. STAV
   ================================================================== */
let u = 0;              // poloha na trase 0..1
let speed = 1;
let paused = false;
let started = false;
let worldTime = 0;
let chapterIdx = -1;
let capIdx = 0;
let capTimer = 0;
let camMode = 0;
const CAM_MODES = ['SLEDOVANIE', 'CINEMATICKÁ', 'VÝŠ', 'MAPA'];
let camTimer = 0;

const camPos = new THREE.Vector3(0, 30, 80);
const camTgt = new THREE.Vector3();
const _p = new THREE.Vector3(), _t = new THREE.Vector3(), _side = new THREE.Vector3();
const _desired = new THREE.Vector3(), _look = new THREE.Vector3();

function chapterAt(uu) {
  for (let i = 0; i < CHAPTERS.length; i++) if (uu < CHAPTERS[i].u1) return i;
  return CHAPTERS.length - 1;
}

function setChapter(i) {
  if (i === chapterIdx) return;
  chapterIdx = i;
  const c = CHAPTERS[i];
  cNum.textContent = c.num;
  cTit.textContent = c.tit;
  cTxt.textContent = c.txt;
  if (c.q) {
    cQuote.style.display = 'block';
    cOq.textContent = c.q.oq;
    cTr.textContent = c.q.tr;
  } else cQuote.style.display = 'none';
  card.classList.add('show');
  setTimeout(() => card.classList.remove('show'), 11000);
  capIdx = 0; capTimer = 3.2;
  // automatický režim kamery pri prechode kapitoly
  if (started) { camMode = 1; camTimer = 11; $('btnCam').textContent = CAM_MODES[camMode]; }
  // podnadpis v HUD
  [...chlabels.children].forEach((el, k) => el.classList.toggle('on', k === i));
}

function riverAt(uu) {
  let cur = RIVERS[0];
  for (const r of RIVERS) if (uu >= r.u) cur = r;
  return cur;
}

/* ==================================================================
   12. KAMERA
   ================================================================== */
function updateCamera(dt) {
  riverCurve.getPointAt(u, _p);
  riverCurve.getTangentAt(u, _t);
  _side.set(_t.z, 0, -_t.x).normalize();

  if (camMode === 0) {            // sledovanie — za loďkou
    _desired.copy(_p).addScaledVector(_t, -30).addScaledVector(_side, 4);
    _desired.y = 13 + Math.sin(worldTime * 0.6) * 0.6;
    _look.copy(_p).addScaledVector(_t, 26); _look.y = 3;
  } else if (camMode === 1) {     // cinematická — zboku, nízko
    const s = (camTimer > 0 && camTimer % 5 < 2.5) ? 1 : -1;
    _desired.copy(_p).addScaledVector(_side, 62 * s).addScaledVector(_t, -26);
    _desired.y = 9 + Math.sin(worldTime * 0.35) * 3.5;
    _look.copy(_p).addScaledVector(_t, 14); _look.y = 4.5;
  } else if (camMode === 2) {     // výš
    _desired.copy(_p).addScaledVector(_t, -46);
    _desired.y = 88;
    _look.copy(_p).addScaledVector(_t, 60); _look.y = 6;
  } else {                        // mapa — zhora
    _desired.set(_p.x, 330, _p.z + 90);
    _look.set(_p.x, 0, _p.z);
  }
  // nikdy pod terénom
  const groundY = terrainH(_desired.x, _desired.z) + 4.5;
  if (_desired.y < groundY) _desired.y = groundY;

  const k = 1 - Math.pow(0.0015, dt);
  camPos.lerp(_desired, k);
  camTgt.lerp(_look, k);
  camera.position.copy(camPos);
  camera.lookAt(camTgt);
}

/* ==================================================================
   13. HLAVNÝ LOOP
   ================================================================== */
const clock = new THREE.Clock();
let hudTick = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (started && !paused) {
    worldTime += dt * speed;
    u = Math.min(1, u + (dt * speed) / JOURNEY_SECONDS);
    if (camTimer > 0) { camTimer -= dt; if (camTimer <= 0 && camMode === 1) { camMode = 0; $('btnCam').textContent = CAM_MODES[camMode]; } }
    if (u >= 1 && $('end').classList.contains('hidden')) showEnd();
  }

  const sk = skyAt(u);

  /* --- svetlo --- */
  const sunDir = skyUniforms.uSunDir.value;
  const el = sk.elev, az = sk.azi;
  sunDir.set(Math.cos(az) * Math.cos(el * 1.4), Math.sin(el * 1.55) + 0.06, Math.sin(az) * Math.cos(el * 1.4)).normalize();
  sunLight.position.copy(camera.position).addScaledVector(sunDir, 600);
  sunLight.color.copy(sk.sun);
  sunLight.intensity = sk.dirI;
  hemi.color.copy(sk.mid); hemi.groundColor.copy(sk.amb); hemi.intensity = sk.ambI;
  rim.color.copy(sk.mid); rim.intensity = sk.ambI * 0.35;

  /* --- obloha --- */
  skyUniforms.uTop.value.copy(sk.top);
  skyUniforms.uMid.value.copy(sk.mid);
  skyUniforms.uBot.value.copy(sk.bot);
  skyUniforms.uSunCol.value.copy(sk.sun);
  skyUniforms.uSunI.value = sk.sunI;
  skyMesh.position.copy(camera.position);
  stars.position.copy(camera.position);
  sunSprite.position.copy(camera.position).addScaledVector(sunDir, 3200);
  sunSprite.material.color.copy(sk.sun);
  starMat.opacity = smoothstep(0.855, 0.94, u) * 0.95;

  /* --- hmla --- */
  scene.fog.color.copy(sk.fog);
  scene.fog.near = sk.fogN; scene.fog.far = sk.fogF;

  /* --- voda --- */
  waterUniforms.uTime.value = worldTime;
  waterUniforms.uDeep.value.copy(sk.deep);
  waterUniforms.uShal.value.copy(sk.shal);
  waterUniforms.uSky.value.copy(sk.mid);
  waterUniforms.uSunCol.value.copy(sk.sun);
  waterUniforms.uSunDir.value.copy(sunDir);
  waterUniforms.uFogColor.value.copy(sk.fog);
  waterUniforms.uFogN.value = sk.fogN;
  waterUniforms.uFogF.value = sk.fogF;

  /* --- loďka --- */
  riverCurve.getPointAt(u, _p);
  riverCurve.getTangentAt(u, _t);
  boat.position.set(_p.x, SEA + 0.22 + Math.sin(worldTime * 1.6) * 0.11, _p.z);
  boat.lookAt(_p.x + _t.x, SEA, _p.z + _t.z);
  boat.rotateZ(Math.sin(worldTime * 1.1) * 0.045);   // náklon po prúde
  boat.rotateX(Math.sin(worldTime * 1.7 + 1) * 0.025);
  const lampI = 2.0 + Math.sin(worldTime * 3.3) * 0.35;
  boat.userData.light.intensity = lampI * (1 - sk.dirI * 0.35);
  boat.userData.glass.material.color.setHex(sk.dirI > 1.2 ? 0xffe0b0 : 0xffd79a);

  /* --- oblaky sa držia v dialke, hviezdy svietia --- */
  clouds.forEach((c) => {
    c.material.color.copy(sk.mid).lerp(sk.sun, 0.25);
    c.material.opacity = 0.35 + 0.25 * clamp(sk.ambI, 0, 1);
  });

  /* --- sneh v Tatrách --- */
  const snowAmt = smoothstep(0.68, 0.76, u) * (1 - smoothstep(0.86, 0.92, u));
  snow.material.opacity = snowAmt * 0.85;
  if (snowAmt > 0.01) {
    const sp = snow.geometry.attributes.position;
    for (let i = 0; i < sp.count; i++) {
      let y = sp.getY(i) - dt * (6 + (i % 7));
      if (y < -10) y = 130;
      sp.setY(i, y);
      sp.setX(i, sp.getX(i) + Math.sin(worldTime * 0.6 + i) * dt * 1.4);
    }
    sp.needsUpdate = true;
    snow.position.set(camera.position.x, 0, camera.position.z);
  }

  /* --- okná svietia v noci --- */
  win.material.opacity = clamp(1 - sk.ambI * 1.05, 0, 1) * 0.95;

  /* --- kamera --- */
  updateCamera(dt);

  /* --- HUD --- */
  const ci = chapterAt(u);
  if (ci !== chapterIdx) setChapter(ci);

  hudTick += dt;
  if (hudTick > 0.1) {
    hudTick = 0;
    const pc = (u * 100).toFixed(0) + ' %';
    mU.textContent = pc;
    mR.textContent = riverAt(u).name;
    fill.style.width = (u * 100) + '%';
    knob.style.left = (u * 100) + '%';
    const pt = miniPath.getPointAtLength(u * miniLen);
    miniDot.setAttribute('cx', pt.x); miniDot.setAttribute('cy', pt.y);
    miniDotGlow.setAttribute('cx', pt.x); miniDotGlow.setAttribute('cy', pt.y);
    rivName.textContent = riverAt(u).name;
  }

  /* --- verše --- */
  if (started) {
    capTimer -= dt * speed;
    if (capTimer <= 0) {
      const c = CHAPTERS[chapterIdx];
      if (capIdx < c.caps.length) {
        capMark.textContent = c.mark;
        capText.textContent = c.caps[capIdx];
        capEl.classList.add('show');
        capIdx++;
        capTimer = 9.5;
        setTimeout(() => capEl.classList.remove('show'), 7000);
      } else {
        capTimer = 3;
      }
    }
  }

  renderer.render(scene, camera);
}

/* ==================================================================
   14. OVLÁDACIE PRVKY
   ================================================================== */
function setPaused(v) {
  paused = v;
  $('btnPlay').textContent = paused ? 'POKRAČOVAŤ' : 'POKAČ';
}
function setCam(i) {
  camMode = ((i % CAM_MODES.length) + CAM_MODES.length) % CAM_MODES.length;
  camTimer = 0;
  $('btnCam').textContent = CAM_MODES[camMode];
}
$('btnPlay').onclick = () => setPaused(!paused);
$('btnSpeed').onclick = () => {
  const steps = [0.5, 1, 2, 4];
  speed = steps[(steps.indexOf(speed) + 1) % steps.length];
  $('btnSpeed').textContent = speed + '×';
};
$('btnCam').onclick = () => setCam(camMode + 1);
$('btnReset').onclick = () => restart();
$('btnHud').onclick = () => hud.classList.toggle('hidden');
$('btnAgain').onclick = () => { $('end').classList.add('hidden'); restart(); };

function restart() {
  u = 0; worldTime = 0; chapterIdx = -1; capIdx = 0; capTimer = 2.5;
  setPaused(false);
  setCam(0);
  card.classList.remove('show');
  capEl.classList.remove('show');
}

addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (k === ' ' || e.code === 'Space') { e.preventDefault(); setPaused(!paused); }
  else if (k === 'arrowright') { e.preventDefault(); $('btnSpeed').click(); }
  else if (k === 'arrowleft') { e.preventDefault(); const steps = [0.5, 1, 2, 4]; speed = steps[(steps.indexOf(speed) - 1 + steps.length) % steps.length]; $('btnSpeed').textContent = speed + '×'; }
  else if (k === 'c') setCam(camMode + 1);
  else if (k === 'r') restart();
  else if (k === 'h') hud.classList.toggle('hidden');
});

/* klik na pruh = skok po trase */
(function () {
  const track = $('track');
  let dragging = false;
  const jump = (ev) => {
    const r = track.getBoundingClientRect();
    const cx = (ev.touches ? ev.touches[0].clientX : ev.clientX);
    u = clamp((cx - r.left) / r.width, 0, 1);
  };
  track.addEventListener('pointerdown', (e) => { dragging = true; track.setPointerCapture(e.pointerId); jump(e); });
  track.addEventListener('pointermove', (e) => { if (dragging) jump(e); });
  track.addEventListener('pointerup', () => { dragging = false; });
})();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

/* ==================================================================
   15. NAČÍTANIE A ŠTART
   ================================================================== */
function setLoad(p, txt) {
  $('loadfill').style.width = Math.round(p * 100) + '%';
  if (txt) $('loadtxt').textContent = txt;
}

async function buildWorld() {
  setLoad(0.04, 'kreslím rieku…');
  await frame();

  setLoad(0.10, 'zdvihám terén…');
  await frame();

  const geo = new THREE.PlaneGeometry(JOURNEY_LEN, TERRAIN_W, SEG_X, SEG_Z);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const rows = SEG_Z + 1, cols = SEG_X + 1;
  const heights = new Float32Array(rows * cols);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      heights[i] = terrainH(pos.getX(i), pos.getZ(i));
    }
    if (r % 16 === 0) { setLoad(0.10 + 0.45 * (r / rows)); await frame(); }
  }

  setLoad(0.56, 'farbím krajinu…');
  await frame();

  const colors = new Float32Array(rows * cols * 3);
  const tmp = new THREE.Color();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const x = pos.getX(i), z = pos.getZ(i), h = heights[i];
      const hl = heights[r * cols + Math.max(0, c - 1)];
      const hr = heights[r * cols + Math.min(cols - 1, c + 1)];
      const hd = heights[Math.max(0, r - 1) * cols + c];
      const hu = heights[Math.min(rows - 1, r + 1) * cols + c];
      const slope = Math.hypot(hr - hl, hu - hd) / 8;
      pos.setY(i, h);
      terrainColor(x, z, h, slope, tmp);
      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    }
    if (r % 16 === 0) { setLoad(0.56 + 0.24 * (r / rows)); await frame(); }
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const terr = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.97, metalness: 0.0
  }));
  terr.frustumCulled = false;
  scene.add(terr);
  setLoad(0.82, 'sadím lesy…');
  await frame();

  buildTrees();
  setLoad(0.88, 'staviam mestečká…');
  await frame();

  planTowns();
  win = buildTowns();
  buildVineyards();
  setLoad(0.94, 'dolievam vodu…');
  await frame();

  snow = buildSnow();
  buildMini();
  buildTicks();
  setLoad(1, 'hotovo');
  $('btnStart').disabled = false;
  $('loadtxt').textContent = 'terén hotový · 2 000 jednotiek krajiny';
}

let win, snow;

$('btnStart').onclick = () => {
  $('title').classList.add('hidden');
  hud.classList.remove('hidden');
  document.body.classList.add('playing');
  started = true;
  setPaused(false);
  setCam(0);
};

function showEnd() {
  $('endTxt').textContent =
    'Cesta sa skončila tam, kde sa spev obracia k nebu — a kde sa znova začína spievať. ' +
    'Od Jeny po Sále, od Sály po Labe, od Labe a Rína po Vltavu, od Vltavy po Dunaj, ' +
    'od Dunaja k Tatrom a Tokaju. Pieseň ide ďalej: aj mŕtvi spievajú.';
  const stats = [
    ['5', 'spevov (I–V)'],
    [Math.round(JOURNEY_SECONDS / 60) + ' min', 'dĺžka trasy'],
    ['7', 'riek a krajov'],
    ['∞', 'spievania']
  ];
  $('endStats').innerHTML = stats.map(s => `<div><b>${s[0]}</b><span>${s[1]}</span></div>`).join('');
  $('end').classList.remove('hidden');
}

/* štart */
setLoad(0.02, 'nahrázam terén…');
buildWorld().then(() => {
  // prvá snímka pred spustením — kamera na začiatku trasy
  riverCurve.getPointAt(0, _p);
  camera.position.set(_p.x - 34, 18, _p.z + 14);
  camera.lookAt(_p.x, 2, _p.z);
  camPos.copy(camera.position);
  camTgt.set(_p.x, 2, _p.z);
  animate();
});
