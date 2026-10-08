# AGENTS.md — Kruháč Simulator: Útek z Hlohovca

Static Three.js browser game (Slovak UI). Vite + ES modules, no backend, no tests.
`index.html` = slim shell with all HUD markup; `src/main.js` = the only entrypoint.

## Commands

```bash
npm run dev            # vite dev server on http:// (COOP: same-origin header)
npm run build          # -> dist/index.html (single inlined JS+CSS) + dist/data + dist/audio
npm run build:portable # inlines mp3/wav too -> ~25 MB HTML, parser stalls. Avoid.
npm run preview        # serve dist/

# offline generátory mapy (všetky idempotentné, nič v repore neprepíšu omylom)
python3 tools/build_dem.py         # SRTM DEM -> assets/terrain/hlohovec_dem.{png,json}
python3 tools/gen_osm_extra.py     # OSM export -> public/data/osmExtra.json
python3 tools/preview_terrain.py   # meradlo: histogram výšok + kľúčové body (--ascii)
```

`node`/`npm` are **not installed in this sandbox** (only `deno` + `python3` 3.14,
`oiiotool`, ImageMagick, `chromium`). `deno install` stiahne `node_modules`, takže
potom funguje `deno check`/`deno lint`. Overiť že hra naozaj nabehne sa dá aj
bez node: `python3 -m http.server 8811` v koreni repa a potom `chromium
--headless=new --enable-unsafe-swiftshader --screenshot=... http://127.0.0.1:8811/index.html`
— konzola (`[map] [DEM] [boot] [VODA] vegetácia`) sa vypíše cez
`--enable-logging=stderr --v=1 | grep CONSOLE`.

## Terén: výšková mapa je SRTM DEM, nie analytický model

Podklad terénu je raster nadmorských výšok v `assets/terrain/hlohovec_dem.png`
(16-bitová hodnota rozložená do dvoch kanálov — canvas `getImageData` vracia len
8 bitov, takže 16-bitová PNG by sa v hre stratila na 0,7 m/krok). Rozsah DEM je
presne `computeBounds()`, teda `bbox ± 400 m`, a rozmermi sedí s `TER_SEG+1`
(257×257) — **jeden bod DEM == jeden vrchol terénovej mriežky**, žiadna
interpolácia ani posun. `height.js:demAt()` je spodok, `landAt()` = DEM + malá
korekcia z OSM `ele=` (ohraničená na `ELE_MAX_FIX` = 2,5 m) + zvlnenie.

Prečo to nie je v `mapData.json`: DEM je 50 kB binárka a `osmExtra.json` je
generovaný. `public/data/osmExtra.json` (`blds`, `elev`, `trees`) je **vrstva
navyše** nad `mapData.json`, ktorú generuje `tools/gen_osm_extra.py`; `prebuild`
ju nedokáže prepísať, takže je bezpečná. `mapData.js:loadWorld()` zloží obe.

`build_dem.py`/`gen_osm_extra.py` si berú body **mimo bounding boxu exportu** zo
starých dát, lebo `~/Downloads/map(3).osm` pokrýva x −2568..980, z −3057..323 a
mapa siahá na x −2874..1634, z −3104..1163. Bez toho by zmizlo ~1600 stromov.
Všetko idie cez DEM, takže výsledok je vždy nadmnožina.

## ⚠ Poradie bootu: `computeBounds()` pred `buildWaterSamples()`

`main.js` volá `computeBounds()` ako **prvý** krok po načítaní mapy. Všetky
priestorové mriežky (`S.WGRID` voda, `S.RDG` koridory ciest, `S.RGRID`,
`S.BGRID`, `UGRID`) sa počítajú z `S.GB.x1-S.GB.x0`, takže predtým — keď
`S.GB` bolo ešte `{0,0,0,0}` — vyšlo `nx = ceil(0/cs) = 0` a **ticho** sa nič
nestalo: koryto Váhu sa nikdy nevyrezalo do terénu a vozovka sa nikdy neuhla
do terénu. Presunúť `computeBounds()` dole je jediná oprava; nič iné v tom
poradí nepoužívaj.

## ⚠ `npm run build` silently rewrites tracked data

`prebuild` → `npm run extract:check` → `python3 tools/extract-monolith.py --round 1`,
which finds the 32 MB monolith at `/home/stanislav/index.monolith.legacy.html`
(hardcoded fallback, `tools/extract-monolith.py:31`) and **overwrites**
`public/data/mapData.json`, `public/audio/station-*`, `public/audio/manifest.json`.
It exits 0, so the `|| echo` guard in `prebuild` never fires.

Verified: running it with no code changes dirties `public/data/mapData.json`.
Always `git status` after a build, and never run `npm run extract` casually —
it clobbers hand-tuned map/audio data.

## Audio: 23 MB binárky sú VERZOVANÉ v gite

`public/audio/station-*.mp3|wav` (8 stôp, 23 MB) **musia zostať v repo**. GitHub
Pages slúži koreň repa, takže `public/audio/` je jediný zdroj, z ktorého sa
hrá. Nie je to východisko len pre túto úpravu: stopy sa generujú z monolitu
(`/home/stanislav/index.monolith.legacy.html`), ktorý **nie je v repo** — CI/Pages
build ich nedokáže vygenerovať. Ak ich niekedy omylom zignoruješ, deploy má
manifest (mená staníc svietia) ale 8 chýbajúcich mp3 → 404 spustený
`.catch(() => {})` (`src/audio/radio.js:30`) ticho prehltne a rádio je mŕtve
bez akejkoľvek chyby na obrazovke. Git LFS tu nepoužívame (Pages by servíroval
pointery).

There is **no deploy config at all**: no `.github/workflows`, no CNAME/.nojekyll,
`dist/` is gitignored. Pages slúži **koreň repa** (z `main`/root), takže
`index.html` beží bez buildu a `three` rieši importmap na unpkg
(`index.html:9`). Predpoklad na debug deployových chýb.

## Path resolution: the 6-candidate lists are load-bearing

`src/world/mapData.js:9` and `src/audio/radio.js:7` each try
`/data/…`, `./data/…`, `data/…`, `/public/data/…`, `./public/data/…`,
`public/data/…` in order. This exists because the game must boot from **Vite dev**,
from `dist/`, from `python -m http.server` at repo root, from a Pages deploy serving
the repo root (where data lives at `/public/…`), and from `file://`.
On a Pages *project* site the absolute candidates (`/public/…`) 404 because they
drop the `/<repo>/` prefix — only the `./public/…` one resolves. Same reason
`ASSET_ROOT = "assets/textures/"` is relative and hits the repo-root `assets/`.
`assets/terrain/hlohovec_dem.*` (SRTM DEM) goes through the same relative list,
`ASSET_CANDIDATES` in `src/world/mapData.js`. Add a new data path → add
candidates, don't switch to an absolute path.
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

### Git: môžeš commitovať a pushovať bez dožiadania

**Nevyžiadaj si povolenie na commit ani push.** Po hotovej práci v tomto rebu je
**štandard `git add -A && git commit && git push`** na `main` (origin je
`https://github.com/stanimir2333/Kruhac-Simulator-Utek-z-Hlohovca`). Používateľ
to povolil výslovne 2026-10-08.

Vyhnutie sa:
- NIKDY necommituj bez `git status` + `git diff` prehliadnutia. Toto repo má
  `prebuild`, ktorý ticho prepíše `public/data/mapData.json` a `public/audio/*`
  (pozri "npm run build silently rewrites tracked data") — ak sú tie súbory
  špinavé, NECH sú súčasťou commitu.
- NIKDY `git commit -a`/`-A` bez kontroly `git status --short public/` a bez
  `git diff --cached` — 8 stôp mp3 je 23 MB a Pages ich nedokáže vygenerovať.
- NIKDY `push --force`, `git config`, `git rebase -i`, `git commit --amend`.
  Force-push na `main` je vždy strata práce; reset je jediný pôvod commitu.
- Commituj celú zmenu ako JEDEN commit, ak nepovedal inak. Nechaj `git status`
  čistý a `git log --oneline -1` ukazuje tvoj commit.
- Pred pushom over `python3 tools/leak-check.py` + `deno check --no-remote` na
  zmenených súboroch. `node` v tomto sandboxe nie je nainštalovaný, takže
  `npm run dev` / `npm run build` spustiť nemožno — overenie kódu rob cez
  `deno check` a `deno lint` (pozri Verification).

Commit message: krátky, slovenský, bez tičňatých bodiek na konci, ~72 znaky.
Dobré vzory z histérie: `fix water white: initWater after cars + boot material
sync`, `legacy-exact: full AI traffic port + water reflection gaps closed`,
`hightmap-fix`, `add-peter`, `radio na pages: verzuj station-*.mp3`.

## Dead code — don't chase, don't "fix"

- `src/ai/police.js` (253 lines): not imported anywhere; police/heat removed on
  purpose. `main.js:28` explains it. `sfx.ping()` exists only for it — and so do
  `HEAT` in `src/core/config.js`, `riverbankSlowdown` in `water.js` and
  `waterDist2` in `height.js`. **Do not "clean up" these four**: deleting them
  leaves police.js with unresolvable imports.
- `#wanted` stars in the HUD have no handler (police is gone). `display:none`
  until police returns; the CSS is kept for that day.
- `tools/split-modules.py`, `tools/gen_placeholders.mjs`: one-off migration
  helpers. `gen_placeholders.mjs` is **stale** — it parses painters out of
  `index.html`, which is now a 12 KB shell with no painter block.

Already removed (were dead, now gone): `overlapOBB`, `gearRatio`, `heightAt`,
`gridAlloc`, `pruneOSM`, `fetchFirst`, `sfx.getBalance`, `isMuted`,
`driftState`, `driftBreak`, `nearSNP`, `photoMatFor`, `landmarkTex`, `LM_SEEN`,
`SNP_PTS`, the `PHOTO_*`/`CORR_*` stubs, `buildTrafficMesh`/`buildPoliceMesh`/
`flashBars` (`src/world/cars.js` now only builds the player mesh),
`mapDragEnd`/`setMapDragEnd`/`mapWasDragged`, engine's `onRender`/`setViewDist`,
and the duplicate deck-height formula (`routeDeckY` delegates to
`wheelGroundY` in `height.js` — one source of truth, don't re-fork it).

## Load-bearing invariants — don't break these

- **`gridQuery(g, x, z, ring, out)`** takes the output buffer as a parameter and
  `S.GQ` is **gone**. Each grid owns its scratch (`RGRID_GQ`, `VEG_GQ`, `BLD_GQ`,
  `WARP_GQ`). The old shared `S.GQ` only worked because no query nested; a
  `roadDist2()` call inside a `BGRID` loop would have silently corrupted the
  outer result. Never reintroduce a module-global here.
- **`routeSamplesFlat` returns `[pts, sArr]`.** It used to publish `s` values in
  a module-global `RS`, and `buildRoads` captured it twice — the second call
  overwrote the first, so the `pre` strip got the bridge's `s` values and
  `deckBlend()` lifted the first ~45 m of the route to deck height. No shared
  state between calls.
- **`drawCars` dirty cache** compares each car's transform against the last one
  written (`c.drawOn`/`c.d*`). `needsUpdate` only fires when something actually
  changed, and `bi`/`wi`/`hi` must advance for skipped cars too or every instance
  after a frozen one shifts by one. `buildCarMeshes` clears `drawOn` before the
  first draw.
- **Touch controls**: `main.js` adds `body.touch` + `#touch.on` when
  `S.IS_MOBILE`. Without it the pedals stay `display:none` and mobile is
  unplayable.
- **`state.paused` is shared** by the big map (`menus.js`) and the hidden-tab
  handler (`main.js`, guarded by `pausedByTab`). The tab handler must not unpause
  a game paused by the map.
- **Settings source of truth**: `shadowTier` is the only state for the shadow
  map; `settings.rtQ` is *derived* from it (`RT_TIER_FROM_SHADOW`) and only `sh`
  is persisted. The `set-shq` and `set-rtq` buttons both write `shadowTier` —
  that's intentional, they are two views of one setting.
- **FPS cap** comes from `settings.fps` via `wireSettingsUI` → `applyAll`. Don't
  re-add an `engine.setFpsCap(...)` in the boot path with a hardcoded value.

## Verification

No test/lint/typecheck scripts exist. What actually exists and passes today:

```bash
python3 tools/leak-check.py        # undefined-identifier scan, src/world/*.js ONLY
python3 tools/check_textures.py    # texture slots vs assets/ (needs Pillow; exit 1 on drift)
deno lint --json src/              # unused vars, prefer-const … (no repo config; not enforced)
deno check --no-remote src/*.js    # parse + type check per file (needs `deno install` once)
python3 tools/preview_terrain.py   # off-line: čo uvidí heightAtAnalytic + kľúčové body
python3 tools/gen_osm_extra.py     # idempotentný; 2. beh musí dať byte-identické JSON
python3 tools/build_dem.py --dry   # vypíše plán tile-ov bez stahovania
```

`leak-check.py` only covers `src/world/` — a clean run there says nothing about
`src/audio`, `src/game`, `src/ai`, or `src/ui`. `deno lint` has no repo config,
so expect ~40 pre-existing findings; only `no-unused-vars` and `no-undef` matter
for a change. Na `src/world/{height,ground,nature,mapData}.js` + `main.js` je
ich dnes 4 a je to presne baseline z HEAD — nepridávaj nové. Everything else is manual: load the game,
watch the console (`[boot]`, `[map]`, `[DEM]`, `[TEX]` lines), and drive it with
the keybinds — `WASD` drive, `H` horn, `Q`/`E` radio, `X` mute, `R` restart
(+ 2.5 s dashboard self-test), `M` map, `T` turbo, `F` Peter, `F3` bloom cycle,
`ESC` settings. Cheat codes are typed GTA-style (`NOCLIP` = ghost cam, `WARPZAMOK`, `WARPURBANEK`,
`WARPBRIDGE`, `WARPSTATION`, `WARPPETER`, `FIXCAR`, `TURBO`) and suppress
single-key shortcuts
while a prefix is being typed (`cheatLocked()`), so press those keys alone when
testing a shortcut.

**Bez node sa dá overiť aj vizuálne** (pozri Commands): `python3 -m http.server`
+ `chromium --headless=new --enable-unsafe-swiftshader`. Screenshoty sú v
/tmp a hra beží ~10 FPS pod softwarovým WebGL — to nie je výkonnostný údaj,
`#fps` je vtedy bez zmyslu. Over, čo konzola vypíše (`blds`, `vegetácia:`,
`hladina … m n.m.`) a čo je na snímke.

`#fps` now shows `FPS · N DC · Nk tri` (2 Hz) — draw calls and triangles from
`renderer.info`. That readout is the tool for any further perf work; check it
before and after instead of guessing. `[boot]`/`[TEX]` now print per-step boot
timings in ms for the same reason.