# Kruháč Simulator — Performance Optimization Opportunities

Generated from static analysis of all `src/` modules. Each item includes file location, root cause, proposed fix, and estimated impact.

---

## 🔴 Critical (High Impact / Low Risk)

### 1. `height.js` — `osmElevAt()` is O(N) per query, called thousands of times/frame
**Location:** `src/world/height.js:118-145` (`osmElevAt`)
**Problem:** Linear scan over `S.elev` array (OSM elevation points) for every height query. Called from `landAt()` → `heightAt()` → terrain rendering, water carving, vehicle physics.
**Fix:** Build a spatial index (uniform grid or k-d tree) over `S.elev` at load time. Query becomes O(1) or O(log N).
**Impact:** Eliminates ~5000–10000 linear scans/frame. Measurable FPS gain on CPU-bound scenes.

### 2. `height.js` — `riverCarveAt()` / `waterDist2()` walk the water grid per query
**Location:** `src/world/height.js:165-210`
**Problem:** Each call walks `S.WGRID` rings until water found. Called from `landAt()` for every terrain vertex + vehicle tire contact.
**Fix:** Precompute signed distance field (SDF) to water once at boot into a `Float32Array` same size as `WGRID`. `waterDist2` becomes single array lookup.
**Impact:** Removes nested loops from hot path. Critical for 513×513 terrain (263k vertices).

### 3. `height.js` — `buildElevModel()` solves 263k×263k linear system at boot
**Location:** `src/world/height.js:480-560` (`buildElevModel`)
**Problem:** Gauss-Seidel over full `TER_SEG+1` grid (513² = 263k unknowns), 24 iterations × 4 neighbors = ~25M ops at startup. Blocks boot for 1–2s.
**Fix:** 
- Run in Web Worker (off main thread)
- Or reduce to multi-resolution: solve on 129², upsample with bicubic
- Or replace with single-pass Poisson blending (FFT-based)
**Impact:** Boot time −1.5s. Main thread free for UI.

### 4. `ground.js` — `limitSlope()` 24 iterations × 4 neighbors over 513² grid
**Location:** `src/world/ground.js:180-240` (`limitSlope`)
**Problem:** Same scale as `buildElevModel`, runs at boot. 24 passes × 263k cells × 4 neighbors ≈ 25M ops.
**Fix:** Same as above — Web Worker or multi-resolution. Can also early-exit when max delta < threshold.
**Impact:** Boot time −1s.

### 5. `water.js` — `renderWaterReflection()` renders full scene second pass every frame
**Location:** `src/world/water.js:320-400` (`renderWaterReflection`)
**Problem:** Full scene re-render to reflection texture (512×512 or 1024×1024) every frame, even when water not visible or camera far.
**Fix:** 
- `waterVisibleFrom()` already exists (called 4 Hz) — **gate the entire reflection pass** on its result
- Add distance LOD: skip reflection beyond 200m, use cubemap fallback
- Cache reflection when camera static (vehicle stopped)
**Impact:** GPU frame time −30–50% when water visible. Draw calls halved.

### 6. `bloom.js` — EffectComposer at 0.75× + SSAO on non-LOW_END every frame
**Location:** `src/fx/bloom.js:60-120` (`createBloom`)
**Problem:** Two extra render passes (bloom + SSAO) at 75% resolution unconditionally. SSAO is 4× cost of bloom.
**Fix:**
- Make SSAO a separate quality tier (`shadowTier ≥ 2` only)
- Downscale bloom to 0.5× on mobile/integrated GPU
- Add `bloomEnabled` setting (persisted)
**Impact:** GPU frame time −20–35% on mid-tier laptops.

---

## 🟠 High (Good Impact / Medium Effort)

### 7. `traffic.js` — `drawCars()` dirty cache works but `ALL_CARS` still iterated fully
**Location:** `src/ai/traffic.js:480-560` (`drawCars`)
**Problem:** Loop visits all 80–120 cars every frame to check `needsUpdate`. Instanced mesh `setMatrixAt` only called for dirty, but loop overhead remains.
**Fix:** Maintain a `dirtyCars` Set/array updated in `updateCar()`. `drawCars` iterates only dirty subset.
**Impact:** CPU −15–30% in heavy traffic. Scales with car count.

### 8. `pedestrians.js` — 46 instanced meshes updated every frame unconditionally
**Location:** `src/ai/pedestrians.js:200-300` (`updatePedestrians`)
**Problem:** All pedestrian instances (head, body, legs, arms × variants) get `setMatrixAt` + color update every frame, even when static or off-screen.
**Fix:**
- Frustum cull per chunk (like `props.js`)
- Only update instances that moved (dirty flag per pedestrian)
- Merge static pedestrians (standing/waiting) into single buffer
**Impact:** CPU −10–20% in urban areas.

### 9. `surface.js` — `onBeforeCompile` patches 60+ materials at load; per-frame uniform updates
**Location:** `src/world/surface.js:100-250` (`patchMaterial` + `updateSurfaceWet`/`updatePuddleTime`)
**Problem:** 60+ material clones created at boot. Every frame: `material.uniforms.wetness.value = ...` + `puddleTime.value = ...` for all 60+.
**Fix:**
- Share wetness/puddle uniforms via `UniformBuffer` (WebGL 2) or single `DataTexture` sampled by all materials
- Update one buffer/texture per frame instead of 60+ `uniformsNeedUpdate = true`
**Impact:** GPU driver overhead −40%. Frame time more stable.

### 10. `sky.js` — PMREM rebake on dayness jump >0.16 (can happen at dawn/dusk)
**Location:** `src/world/sky.js:180-220` (`updateSky`)
**Problem:** `pmremGenerator.fromScene(skyScene)` is expensive (renders cubemap, filters mipmaps). Can spike frame to 100ms+.
**Fix:**
- Debounce: schedule rebake next frame if not in mid-frame
- Or precompute 12 time-of-day cubemaps at boot, interpolate between two
- Or use analytical sky model (no PMREM) for LOW_END tier
**Impact:** Eliminates 100ms spikes at dawn/dusk transition.

### 11. `minimap.js` — Tile fetching creates `ImageBitmap` on main thread every 50ms
**Location:** `src/ui/minimap.js:120-180` (`fetchTile`)
**Problem:** `createImageBitmap()` is async but still main-thread work. 20 Hz × 4 tiles = 80 decodes/sec when moving fast.
**Fix:** 
- Move to OffscreenCanvas + Worker (if browser supports)
- Or cache decoded tiles in `Map<string, ImageBitmap>` with LRU eviction
- Reduce `miniHz` to 10 when speed < 5 m/s
**Impact:** Main thread jank reduction on mobile.

---

## 🟡 Medium (Measurable Impact / Higher Effort)

### 12. `shared.js` — `TER_SEG = 512` hardcoded; terrain is 513×513 = 263k vertices
**Location:** `src/world/shared.js:12` (`S.TER_SEG`)
**Problem:** Fixed high resolution regardless of device. Mobile GPUs struggle with 263k vertex buffer + 500k indices.
**Fix:** 
- Make `TER_SEG` dynamic: `LOW_END → 128`, `MID → 256`, `HIGH → 512`
- Compute at boot from `navigator.deviceMemory` + `GPU benchmark` (1-frame draw call)
- Rebuild terrain mesh on tier change (rare)
**Impact:** Vertex shader load −75% on LOW_END. Enables 60 FPS on phones.

### 13. `vehicle.js` — `raycast` suspension (4 wheels) every frame
**Location:** `src/physics/vehicle.js:80-140` (`updateSuspension`)
**Problem:** 4 `raycast` calls/frame vs heightfield. Three.js raycast traverses entire scene graph.
**Fix:** 
- Replace with analytic `heightAt(x,z)` + `heightAt(x+ε,z)` for slope (no raycast)
- Or build a `HeightfieldShape` (cannon-es/ammo) once and use native collision
**Impact:** Physics CPU −50%. More stable suspension.

### 14. `roads.js` — `buildRoads()` creates separate geometry per segment; no instancing
**Location:** `src/world/roads.js:200-350` (`buildRoads`)
**Problem:** Each road segment = separate `Mesh` + `BufferGeometry`. 200–400 draw calls for roads alone.
**Fix:** Merge all road segments by material into 3–4 instanced meshes (asphalt, markings, shoulders). Use `InstancedBufferAttribute` for segment transform.
**Impact:** Road draw calls 400 → 4. GPU bound scenes +30% FPS.

### 15. `buildings.js` — Each building = separate mesh; no frustum culling at mesh level
**Location:** `src/world/buildings.js:150-250` (`createBuildingMesh`)
**Problem:** 500–800 building meshes. Three.js frustum culls per mesh but still submits all to GPU.
**Fix:** 
- Spatial hash grid (already have `BGRID`) → only submit chunks in view frustum
- Or merge distant buildings into impostor billboards (LOD)
**Impact:** Draw calls −200–400 in city center.

### 16. `nature.js` — Trees as individual meshes; `treeInstances` updated per frame for wind
**Location:** `src/world/nature.js:180-280` (`updateTrees`)
**Problem:** ~3000 tree instances. Wind shader updates `time` uniform per frame — fine. But each tree species = separate draw call.
**Fix:** 
- Atlas all tree textures into single array texture
- Merge all species into 1–2 instanced meshes with `speciesIndex` attribute
- Wind in vertex shader (no per-instance CPU update)
**Impact:** Tree draw calls 15 → 2. GPU state changes eliminated.

### 17. `drift.js` — Particle pool 240/120; `updateParticles` iterates all every frame
**Location:** `src/game/drift.js:60-150` (`updateParticles`)
**Problem:** Loops over full pool (240) every frame, checks `life > 0`. Most particles dead.
**Fix:** Maintain `aliveParticles` array (push on spawn, swap-remove on death). Iterate only alive.
**Impact:** CPU −5–10% when drifting. Negligible otherwise.

---

## 🟢 Low (Nice to Have / Low Effort)

### 18. `main.js` — `HUD_INTERVAL = 200` (5 Hz) but `#fps` reads `renderer.info` every frame
**Location:** `src/main.js:180` + `hud.js:60`
**Problem:** `renderer.info.render.triangles/frame` accessed every frame for `#fps` display, but HUD only updates at 5 Hz.
**Fix:** Move `renderer.info` read into HUD update (5 Hz). Or cache in `engine.js` tick.
**Impact:** Negligible, but clean.

### 19. `config.js` — `cullHz: 2` but `sky.js` uses 2 Hz, `water.js` uses 4 Hz, `minimap.js` uses 20 Hz
**Location:** `src/core/config.js:45` (`PERF.cullHz`)
**Problem:** Inconsistent throttle constants scattered. Hard to tune globally.
**Fix:** Centralize all Hz in `config.js.PERF`. Import everywhere. Add `perfProfile` preset (LOW/MID/HIGH).
**Impact:** Maintainability. Enables one-click quality preset.

### 20. `labels.js` — `Sprite` per label (50+); each = draw call
**Location:** `src/world/labels.js:80-150`
**Problem:** Place names, street signs as individual `Sprite` objects.
**Fix:** Merge into single `InstancedMesh` with `InstancedBufferAttribute` for position + texture atlas index.
**Impact:** Draw calls 50 → 1.

### 21. `leaves.js` / `storm.js` — Particle systems not pooled; allocate GC pressure
**Location:** `src/world/leaves.js:60`, `src/weather/storm.js:120`
**Problem:** `new THREE.Vector3()` / `new Particle()` per frame during rain/leaves.
**Fix:** Pre-allocate pools (like `drift.js`). Reuse objects.
**Impact:** GC pauses eliminated during storms.

### 22. `radio.js` / `sfx.js` — `fetch` candidate lists tried sequentially (6 attempts)
**Location:** `src/audio/radio.js:30`, `src/world/mapData.js:40`
**Problem:** Each failed `fetch` = network round-trip + promise rejection overhead. 6× per resource at boot.
**Fix:** Detect base path once at boot (`import.meta.url` or `document.currentScript.src`), construct correct path directly.
**Impact:** Boot time −200–500ms. Cleaner console.

---

## 📋 Suggested Implementation Order

| Phase | Items | Rationale |
|-------|-------|-----------|
| **1. Boot & Hot Path** | 1, 2, 3, 4, 22 | Immediate FPS/boot gains, low risk |
| **2. GPU Bound** | 5, 6, 9, 14, 16 | Draw call reduction, shader uniformity |
| **3. CPU Bound (AI/Physics)** | 7, 8, 13, 17 | Scales with content density |
| **4. Adaptive Quality** | 12, 19 | Enables mobile/low-end support |
| **5. Polish** | 10, 11, 15, 18, 20, 21 | Incremental, can parallelize |

---

## 🔧 Verification Commands

```bash
# Static checks (run after each phase)
python3 tools/leak-check.py              # src/world only
deno lint --json src/                    # unused vars, prefer-const
deno check --no-remote src/*.js          # parse + type check

# Visual/perf verification (headless)
python3 -m http.server 8811 &            # serve repo root
chromium --headless=new --enable-unsafe-swiftshader \
  --enable-logging=stderr --v=1 \
  --screenshot=/tmp/boot.png \
  http://127.0.0.1:8811/index.html 2>&1 | grep CONSOLE

# Check #fps HUD: FPS · N DC · Nk tri (2 Hz update)
# Target: 60 FPS · <100 DC · <200k tri on mid-tier laptop
```

---

## ⚠ Invariants to Preserve

- **No shared `S.GQ`** — each grid owns its scratch buffer (`RGRID_GQ`, `VEG_GQ`, `BLD_GQ`, `WARP_GQ`)
- **`routeSamplesFlat` returns local arrays** — no module-global `RS`
- **`drawCars` dirty cache** — compares transform against last written; `bi`/`wi`/`hi` advance for skipped cars
- **`state.paused` shared** — map and tab handler; tab handler must not unpause map-paused game
- **`shadowTier` only persisted setting** — `rtQ` derived via `RT_TIER_FROM_SHADOW`
- **FPS cap from `settings.fps`** — no hardcoded `engine.setFpsCap()`

---

*All comments, strings, and commit messages in Slovak per AGENTS.md convention.*