// tools/gen_placeholders.mjs - vygeneruje PLACEHOLDER PNG textúry do assets/textures/
//
// Spustenie:  deno run --allow-read --allow-write tools/gen_placeholders.mjs
//
// Čo robí: načíta TEXACNY a f* paintery PRIAMO z index.html (žiadna kópia logiky -
// ak sa zmenia farby v hre, placeholder sa zmení tiež), a zapíše ich do PNG.
// Kým tieto súbory existujú, TextureLoader ich načíta a hra vôbec nepoužije
// procedurálny fallback. Kým ich NAJDEŠ lepšie, proste prepíš súbory vlastnými
// fotkami - rozmery musia zostať tie isté (pozri assets/textures/README.md).
//
// PNG: RGBA8, filter 0, IDAT = zlib(deflate) cez CompressionStream. Bez závislostí.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

// ---------- minimálna canvas substitúcia -------------------------------------
// Paintery kreslia len cez fillRect + fillStyle (a to je aj speckle()), takže
// stačí rasterizovať plné obdĺžniky s blendingom source-over. Bez antialiasingu
// na hranách - na placeholder je to nepodstatné (a browser to kreslí inak).
function parseColor(s) {
  if (s[0] === "#") {
    let h = s.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  const m = String(s).match(/rgba?\(([^)]+)\)/);
  if (m) {
    const p = m[1].split(",").map(Number);
    return [p[0] | 0, p[1] | 0, p[2] | 0, p.length > 3 ? p[3] : 1];
  }
  return [0, 0, 0, 1];
}

class Ctx {
  constructor(canvas) {
    this.canvas = canvas;
    this.fillStyle = "#000000";
    this.img = null;
  }
  buf() {
    if (!this.img) {
      const W = this.canvas.width, H = this.canvas.height;
      const data = new Uint8ClampedArray(W * H * 4);
      for (let i = 3; i < data.length; i += 4) data[i] = 255; // nepružný základ
      this.img = { data, width: W, height: H };
    }
    return this.img;
  }
  fillRect(x, y, w, h) {
    const im = this.buf(), d = im.data, W = im.width;
    const c = parseColor(this.fillStyle), a = c[3];
    const x0 = Math.max(0, Math.round(x)), x1 = Math.min(W, Math.round(x + w));
    const y0 = Math.max(0, Math.round(y)), y1 = Math.min(im.height, Math.round(y + h));
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const j = (yy * W + xx) * 4;
        d[j] = d[j] * (1 - a) + c[0] * a;
        d[j + 1] = d[j + 1] * (1 - a) + c[1] * a;
        d[j + 2] = d[j + 2] * (1 - a) + c[2] * a;
        d[j + 3] = 255;
      }
    }
  }
  createImageData(w, h) {
    return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
  }
  getImageData() {
    return this.buf();
  }
  putImageData(img) {
    this.img = img;
  }
  strokeRect() {}
  fillText() {}
  beginPath() {}
  arc() {}
  fill() {}
  createRadialGradient() {
    return { addColorStop() {} };
  }
}

globalThis.document = {
  createElement() {
    const c = {
      width: 1,
      height: 1,
      getContext() {
        if (!this._c) this._c = new Ctx(this);
        return this._c;
      },
    };
    return c;
  },
};

// ---------- vytiahnutie painterov z index.html ---------------------------------
// index.html je 32 MB, preto sa neparsujeme ako DOM: prejdeme len znaky medzi
// prvým `function thash(` a `function buildTextures(` (to je presne blok generátorov)
// a vyhodíme z neho `export`.
const html = readFileSync(resolve(ROOT, "index.html"), "utf8");
const a = html.indexOf("function thash(");
const b = html.indexOf("function buildTextures(");
if (a < 0 || b < 0 || b < a) {
  console.error("index.html: nenašiel som blok generátorov textúr (thash .. buildTextures)");
  process.exit(1);
}
const block = html.slice(a, b).replace(/\bfunction /g, "export function ");
const mod = await import("data:text/javascript;base64," + btoa(unescape(encodeURIComponent(block))));
const {
  newCanvas, normalCanvas, grayCanvas, commitField, fAsphalt, fGrass, fDirt, fTerrainN,
  fConcrete, fBrick, fBallast, fWood, winLayout, paintFacade,
} = mod;

// ---------- PNG zápis ----------------------------------------------------------
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return (buf) => {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

function chunk(type, data) {
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, data.length);
  const body = new Uint8Array(4 + data.length);
  body.set([type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)]);
  body.set(data, 4);
  const crc = new Uint8Array(4);
  new DataView(crc.buffer).setUint32(0, CRC(body));
  return [len, body, crc];
}

async function zlibDeflate(bytes) {
  // CompressionStream("deflate") = zlib kontajner (RFC 1950) = presne to, co PNG
  // chce v IDAT. "deflate-raw" by bol bez hlavičky a preložil by to.
  const cs = new CompressionStream("deflate");
  const w = cs.writable.getWriter();
  w.write(bytes);
  w.close();
  const parts = [];
  let n = 0;
  for await (const chunk_ of cs.readable) {
    parts.push(chunk_);
    n += chunk_.length;
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function writePNG(file, rgba, size) {
  const raw = new Uint8Array(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter type 0 (None)
    raw.set(rgba.subarray(y * size * 4, (y + 1) * size * 4), y * (size * 4 + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, size);
  dv.setUint32(4, size);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [
    sig,
    ...chunk("IHDR", ihdr),
    ...chunk("IDAT", await zlibDeflate(raw)),
    ...chunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    buf.set(p, o);
    o += p.length;
  }
  const path = resolve(ROOT, "assets/textures", file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
  return buf.length;
}

// ---------- čo sa generuje -----------------------------------------------------
const HQ = 512, MID = 256;
const A = fAsphalt(HQ);
const G = fGrass(HQ);
const D = fDirt(HQ);
const C = fConcrete(HQ);
const BR = fBrick(MID);
const BA = fBallast(MID);
const WD = fWood(MID);

const px = (c) => c.getContext("2d").img.data;
const jobs = [
  ["road/asphalt_diffuse.jpg", A.dif, HQ],
  ["road/asphalt_normal.png", normalCanvas(HQ, A.hf, 1.4), HQ],
  ["road/asphalt_roughness.png", grayCanvas(HQ, A.rg), HQ],
  ["terrain/grass_diffuse.jpg", commitField(G), HQ],
  ["terrain/terrain_normal.png", normalCanvas(256, fTerrainN(), 6.0), 256],
  ["terrain/dirt_diffuse.png", commitField(D), HQ],
  ["buildings/concrete_diffuse.png", commitField(C), HQ],
  ["buildings/concrete_normal.png", normalCanvas(HQ, C.hf, 1.6), HQ],
  ["buildings/wood.png", commitField(WD), MID],
  ["buildings/wood_normal.png", normalCanvas(MID, WD.hf, 1.8), MID],
  ["buildings/gravel.png", commitField(BA), MID],
  ["buildings/brick.jpg", commitField(BR), MID],
  ["buildings/brick_normal.png", normalCanvas(MID, BR.hf, 2.2), MID],
  // fasáda: musí sedieť na tej istej mriežke okien ako emisívna/roughness/normal
  // mapa v hre (winLayout), inak by svietilo iné okno než ktoré je na stene
  ["buildings/wall.png", paintCanvas(HQ, (g, s) => paintFacade(g, s, winLayout(HQ))), HQ],
];

// canvas, do ktorého paintFacade kreslí, musíme z bundlu vyviesť ako hotový obrázok
function paintCanvas(size, painter) {
  const c = newCanvas(size);
  painter(c.getContext("2d"), size);
  return c;
}

// paintCanvas je použitý už v jobs -> ho treba deklarovať pred ním (function
// declaration sa hoistuje, takže toto je len pre poriadok v súbore)

let total = 0;
for (const [file, canvas, size] of jobs) {
  if (!canvas) {
    console.log("  -- preskočené (painter chýba):", file);
    continue;
  }
  const bytes = await writePNG(file, px(canvas), size);
  total += bytes;
  console.log("  " + file.padEnd(32) + size + "x" + size + "  " + (bytes / 1024).toFixed(0) + " kB");
}
console.log("spolu " + (total / 1024).toFixed(0) + " kB placeholderov v " + OUT);