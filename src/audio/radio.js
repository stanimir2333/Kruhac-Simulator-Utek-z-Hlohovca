// src/audio/radio.js — 8 staníc externe, lazy load až po prvom geste (autoplay policy).
// manifest.json (1 kB) sa fetchne hneď; mp3 (2–5 MB) až po kliku ŠTART / Q/E.

export async function loadRadioManifest() {
  // Vite: /audio/… (public/ → koreň). Plain `python -m http.server`: /public/audio/…
  for (const u of ['/audio/manifest.json', './audio/manifest.json', 'audio/manifest.json',
                   '/public/audio/manifest.json', './public/audio/manifest.json', 'public/audio/manifest.json']) {
    try {
      const r = await fetch(u);
      if (r.ok) return { list: await r.json(), base: u.replace('manifest.json', '') };
    } catch { /* ďalej */ }
  }
  return { list: [], base: '' };
}

export function createRadio(audioEl) {
  let list = [], idx = 0, base = '';
  async function setList(manifest, manifestBase) { list = manifest; base = manifestBase; updateLabel(); }
  function updateLabel() {
    const el = document.getElementById('radio-name');
    if (el) el.textContent = list[idx]?.name ?? 'RÁDIO HLOHOVEC (offline)';
  }
  function play(i) {
    if (!list.length) return false;
    idx = (i + list.length) % list.length;
    const st = list[idx];
    try {
      audioEl.src = base + st.file.replace(/^audio\//, '');
      audioEl.play().catch(() => {});
      updateLabel();
      return true;
    } catch { return false; }
  }
  return { setList, next: () => play(idx + 1), prev: () => play(idx - 1), play, updateLabel };
}
