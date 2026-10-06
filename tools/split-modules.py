#!/usr/bin/env python3
"""
tools/split-modules.py — STAGE-2 migrácia JS logiky monolitu → src/* (poloautomatická).

Monolit má ~525 kB čistej logiky (bez OSM/RADIO) v jednom <script type="module">.
Ručne prepisovať 11 902 riadkov je chyba-prone; tento skript:

  1. Rozseká script na sekcie podľa `// ---------- NADPIS ----------` komentárov.
  2. Navrhne mapovanie sekcia → cieľový modul (src/world/..., src/physics/...).
  3. Vypíše TODO checklist s riadkami + odhadom; nič neprepisuje bez --write.
  4. S --write vytvorí src/migrated/<slug>.js s pôvodným kódom + import hlavičkou,
     aby sa dalo postupne presúvať do finálnych modulov (terrain.js, vehicle.js…).

Spustenie:
  python3 tools/split-modules.py            # len report
  python3 tools/split-modules.py --write    # + src/migrated/*.js

Mapovanie je heuristika — finálne slovo má človek pri presune do modulov.
Hotové moduly (police.js, mapData.js, loader.js…) sa NESAHÁJÚ.
"""
import re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
import subprocess
_cands = [ROOT / "index.monolith.legacy.html", ROOT / "index.html", Path("/tmp/legacy.html"),
          Path("/home/stanislav/index.monolith.legacy.html")]
SRC = next((c for c in _cands if c.exists() and c.stat().st_size > 1_000_000), None)
if SRC is None:  # monolit je commitnutý v git HEAD
    r = subprocess.run(["git", "show", "HEAD:index.html"], cwd=ROOT, capture_output=True)
    Path("/tmp/legacy.html").write_bytes(r.stdout)
    SRC = Path("/tmp/legacy.html")

MAP = [
    ("TERÉN", "src/world/terrain.js"), ("VODNÉ LÍNIE", "src/world/terrain.js"),
    ("VÝŠKOV", "src/world/terrain.js"), ("ANALYTICKÝ TERÉN", "src/world/terrain.js"),
    ("FYZIKA", "src/physics/vehicle.js"), ("6-STUPŇ", "src/physics/vehicle.js"),
    ("OBB", "src/physics/vehicle.js"), ("ČASTICE", "src/physics/vehicle.js"),
    ("MAPA Z OSM", "src/world/roads.js"), ("TRASA", "src/world/roads.js"),
    ("kruháče", "src/world/roads.js"), ("FARBY TERÉNU", "src/world/terrain.js"),
    ("BUDOV", "src/world/buildings.js"), ("VEŽA KOSTOLA", "src/world/buildings.js"),
    ("FASÁD", "src/world/buildings.js"), ("VEGETÁC", "src/world/nature.js"),
    ("OBLOHA", "src/world/nature.js"), ("AUTÁ", "src/ai/traffic.js"),
    ("DOPRAVA", "src/ai/traffic.js"), ("HRÁČ", "src/physics/vehicle.js"),
    ("UPDATE: HRÁČ", "src/physics/vehicle.js"), ("KAMERA", "src/core/engine.js"),
    ("AUDIO", "src/audio/sfx.js"), ("RÁDIO", "src/audio/radio.js"),
    ("HUD", "src/ui/hud.js"), ("BUDÍKY", "src/ui/dashboard.js"),
    ("MINIMAPA", "src/ui/minimap.js"), ("NASTAVENIA", "src/ui/menus.js"),
    ("CHEAT", "src/physics/vehicle.js"), ("DRIFT", "src/physics/vehicle.js"),
    ("MISIE", "src/ui/hud.js"), ("STAV HRY", "src/core/state.js"),
    ("VSTUP", "src/core/input.js"), ("GLOBÁLNE THREE", "src/core/engine.js"),
    ("MATERIÁLY", "src/core/engine.js"), ("TEXTÚR", "src/core/engine.js"),
    ("INIT", "src/main.js"), ("SLUČKA", "src/main.js"), ("ŠTART", "src/main.js"),
]

def target_for(title):
    for k, mod in MAP:
        if k.lower() in title.lower(): return mod
    return "src/migrated/misc.js"

def main():
    write = "--write" in sys.argv
    t = SRC.read_text(encoding="utf-8", errors="ignore")
    js = t[t.find('<script type="module">'):t.find("</script>", t.find('<script type="module">'))]
    # odstráň OSM + RADIO bloky z analýzy (tie sú už v public/)
    js = re.sub(r"const OSM_DATA=.*?\"bbox\":.*?\};", "/* OSM_DATA → public/data/mapData.json */", js, flags=re.S)
    js = re.sub(r"const RADIO_SRC=\[.*?\];", "/* RADIO_SRC → public/audio/* */", js, flags=re.S)
    parts = re.split(r"(// -{5,}.*?)(?=\n)", js)
    # parts: [code, header, code, header, code...] — spoj header+nasledujúci code
    sections = []
    buf = ""
    for p in parts:
        if p.startswith("// ---"):
            if buf.strip(): sections.append(("(úvod)", buf)); buf = ""
            sections.append((p.strip()[:100], ""))  # header, code príde v ďalšom
        else:
            if sections and sections[-1][1] == "":
                h, _ = sections.pop(); sections.append((h, p))
            else: buf += p
    if buf.strip(): sections.append(("(zvyšok)", buf))
    print(f"zdroj: {SRC.name}  sekcií: {len(sections)}  logika: {len(js)/1e3:.0f} kB")
    print()
    print(f"{'RIADKY':>8}  {'MODUL':28s}  NADPIS")
    total = 0
    outdir = ROOT / "src" / "migrated"
    if write: outdir.mkdir(parents=True, exist_ok=True)
    for title, code in sections:
        lines = code.count("\n")
        total += lines
        mod = target_for(title)
        print(f"{lines:8d}  {mod:28s}  {title[:80]}")
        if write and lines > 3:
            slug = re.sub(r"[^a-z0-9]+", "-", title.strip('/- :').lower())[:60].strip("-") or "sec"
            (outdir / f"{slug}.js").write_text(f"// MIGRATED from monolit: {title}\n// CIEĽ: {mod} — skopíruj odtiaľto po overení.\n// OSM_DATA/RADIO_SRC už NIE SÚ inline (importuj z mapData.js / radio.js).\n{code[:20000]}", encoding="utf-8")
    print(f"\nspolu ~{total} riadkov logiky. Ďalší krok: presúvaj src/migrated/*.js do cieľových modulov.")
    print("Hotové (nemaž): src/ai/police.js, src/world/mapData.js, src/core/loader.js, src/main.js.")

if __name__ == "__main__":
    main()
