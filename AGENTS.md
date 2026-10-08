# AGENTS.md — Kruháč Simulator: Útek z Hlohovca

Static Three.js browser game (Slovak UI). Vite + ES modules, no backend, no tests.
`index.html` = slim shell with all HUD markup; `src/main.js` = the only entrypoint.

## Commands

```bash
npm run dev            # vite dev server on http:// (COOP: same-origin header)
npm run build          # -> dist/index.html (single inlined JS+CSS) + dist/data + dist/audio
npm run build:portable # inlines mp3/wav too -> ~25 MB HTML, parser stalls. Avoid.
npm run preview        # serve dist/
```

`node`/`npm` are **not installed in this sandbox** (only `deno` + `python3` 3.14,
`oiiotool`, ImageMagick). Install node >= 18 before touching JS, or verify by
reading code — you cannot run the dev server here.

## ⚠ `npm run build` silently rewrites tracked data

`prebuild` → `npm run extract:check` → `python3 tools/extract-monolith.py --round 1`,
which finds the 32 MB monolith at `/home/stanislav/index.monolith.legacy.html`
(hardcoded fallback, `tools/extract-monolith.py:31`) and **overwrites**
`public/data/mapData.json`, `public/audio/station-*`, `public/audio/manifest.json`.
It exits 0, so the `|| echo` guard in `prebuild` never fires.

Verified: running it with no code changes dirties `public/data/mapData.json`.
Always `git status` after a build, and never run `npm run extract` casually —
it clobbers hand-tuned map/audio data.

## Audio: assets are gitignored, so deploys are silent

Only `public/audio/manifest.json` is tracked; `station-*.mp3|wav` are gitignored
(regenerate locally with `npm run extract`, or un-comment the Git-LFS line in
`.gitattributes` + the block in `.gitignore`). A fresh clone / GitHub Pages build
therefore has a manifest but **zero mp3s** — the radio label still shows a station
name while `radio.play()` sets a `src` that 404s and is swallowed by
`.catch(() => {})` (`src/audio/radio.js:30`). There is no error UI.

There is **no deploy config at all**: no `.github/workflows`, no CNAME/.nojekyll,
`dist/` is gitignored. Pages must be serving the repo root or a manually copied
`dist/` — confirm which before debugging a deploy-only bug.

## Path resolution: the 6-candidate lists are load-bearing

`src/world/mapData.js:9` and `src/audio/radio.js:7` each try
`/data/…`, `./data/…`, `data/…`, `/public/data/…`, `./public/data/…`,
`public/data/…` in order. This exists because the game must boot from **Vite dev**,
from `dist/`, from `python -m http.server` at repo root, from a Pages deploy serving
the repo root (where data lives at `/public/…`), and from `file://`.
Add a new data path → add candidates, don't switch to an absolute path.
`file://` degrades to `TINY_FALLBACK` map + procedural textures, never errors.

## Architecture

- **Factory + dependency injection, no classes.** Every module exports
  `createX(...)` / `updateX(...)`. `src/core/state.js` is a mutable singleton
  created once in `main.js` and injected; modules must not import `main.js`
  (no import cycles). Same for `settings.js`: it receives a `ctx` object.
- `src/world/shared.js` holds shared mutable globals (`S`) — cache, not config.
- `src/core/config.js` is the constants module, but `WORLD.mapUrls`,
  `WORLD.textureBase`, `WORLD.audioManifestUrl`, `HEAT` are **unused** (each
  module hardcodes its own candidates). Don't "fix" config.js expecting a
  single source of truth — edit the module that hardcodes it.
- Loop contract: `createEngine()` (`src/core/engine.js`) owns rAF + FPS cap;
  `main.js` registers one `onTick` that early-returns while
  `!state.started || state.paused`. Anything per-frame must be gated on that.
  Bloom plugs in via `engine.setRenderOverride()`.
- Texture loading is **append-only**: each slot creates a procedural
  `CanvasTexture` first, then swaps `source.data` when the file arrives
  (same POT dims → no new GPU upload). Missing/broken/non-POT files fall back
  silently. See `assets/textures/README.md` — it is authoritative for texture
  rules (256/512/1024 POT, sRGB vs linear, `flipY = false` facades, luma targets).
- `public/assets` is a **symlink** to `../assets`. If it doesn't resolve after a
  copy/deploy, textures silently go procedural — check the symlink, not the loader.

## Conventions

- **All comments, user-facing strings, toasts and commit messages are Slovak.**
  Match that. Commit style is short: `fix water white: initWater after cars…`,
  `add-peter`, `hightmap-fix`.
- 2-space indent, semicolons, single quotes in JS; Slovak section headers as
  `// ---------- NADPIS ----------`.
- Ported modules keep provenance comments naming monolith line ranges — keep them
  accurate when editing.

## Dead code — don't chase, don't "fix"

- `src/ai/police.js` (253 lines): not imported anywhere; police/heat removed on
  purpose. `main.js:28` explains it. `sfx.ping()` exists only for it.
- `sfx.getBalance()`, unused `WORLD` import in `src/audio/radio.js:3`.
- HUD with no handler (keyboard only): `#snd-btn` (mute), `#radio-prev`,
  `#radio-next`, `#wanted` stars. CSS gives them `pointer-events:auto`, which
  looks clickable but isn't.
- `tools/split-modules.py`, `tools/gen_placeholders.mjs`: one-off migration
  helpers. `gen_placeholders.mjs` is **stale** — it parses painters out of
  `index.html`, which is now a 12 KB shell with no painter block.

## Verification

No test/lint/typecheck scripts exist. What actually exists and passes today:

```bash
python3 tools/leak-check.py        # undefined-identifier scan, src/world/*.js ONLY
python3 tools/check_textures.py     # texture slots vs assets/ (needs Pillow; exit 1 on drift)
```

`leak-check.py` only covers `src/world/` — a clean run there says nothing about
`src/audio`, `src/game`, `src/ai`, or `src/ui`.

Everything else is manual: load the game, watch the console (`[boot]`, `[map]`,
`[TEX]` lines), and drive it with the keybinds — `WASD` drive, `H` horn,
`Q`/`E` radio, `X` mute, `R` restart (+ 2.5 s dashboard self-test), `M` map,
`T` turbo, `F` Peter, `F3` bloom cycle, `ESC` settings. Cheat codes are typed
GTA-style (`NOCLIP`, `WARPZAMOK`, `WARPPETER`, `FIXCAR`, `TURBO`) and suppress
single-key shortcuts while a prefix is being typed (`cheatLocked()`), so press
those keys alone when testing a shortcut.