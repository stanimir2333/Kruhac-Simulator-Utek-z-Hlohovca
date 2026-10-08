// src/core/loader.js — async načítanie bez freezu main threadu.
// Princípy:
//  - fetch() s progress callbackom (Content-Length alebo chunky),
//  - JSON.parse() v malých kúskoch: najprv text, potom parse v idle (1 frame pauza pred/po),
//  - yielduj event loopu cez requestAnimationFrame / setTimeout(0), aby preloader stihol prekresliť.
export async function fetchWithProgress(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total) {
    const buf = await res.arrayBuffer();
    onProgress?.(1, buf.byteLength, buf.byteLength);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.byteLength;
    onProgress?.(total ? got / total : 0, got, total);
    // daj prehliadaču šancu prekresliť preloader každých ~64 kB
    if (got % 65536 < value.byteLength) await nextFrame();
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  return out.buffer;
}

export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
export const idle = (ms = 0) => new Promise((r) => setTimeout(r, ms));

// Vracia { data, bytes } — bytes je veľkosť stiahnutého payloadu, aby volajúci
// nemusel JSON.stringify() celej mapy len na to, aby vypísal jej veľkosť
// (0,5 MB stringify je na hlavnom vlákne zbytočný hitch).
export async function fetchJsonAsync(url, onProgress) {
  const buf = await fetchWithProgress(url, onProgress);
  await nextFrame(); // nech preloader prekreslí 100 % pred parse
  const text = new TextDecoder().decode(new Uint8Array(buf));
  await idle(0);     // parse beží až v ďalšom tasku — UI medzitým žije
  return { data: JSON.parse(text), bytes: buf.byteLength };
}
