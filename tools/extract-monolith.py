#!/usr/bin/env python3
"""
tools/extract-monolith.py — rozdelí 31MB monolit index.html na modulárne assety.

Čo robí:
  1. Nájde `const OSM_DATA={...};` a uloží ho ako public/data/mapData.json
     (voliteľne pruned + zaokrúhlené na 1 desatinné miesto).
  2. Nájde `const RADIO_SRC=[...]` + `RADIO_NAMES=[...]` a dekóduje každý
     data:audio/*;base64 blob do public/audio/station-NN.ext
     + vygeneruje public/audio/manifest.json {name, file, mime}.
  3. Vypíše report pred/po (bytes, % úspora, gzip odhad).

Spustenie:
  python3 tools/extract-monolith.py [--prune] [--round 1]

  --prune  : zahodí redundantné OSM polia (tlabels duplicities, links ak sa
             dajú dopočítať, prázdne názvy) — defaultne ZAPNUTÉ mierne.
  --round N: počet desatinných miest pre súradnice (default 1 = ~10cm,
             OSM export už je v metroch 1:1).

Bezpečnosť: pôvodný index.html sa NEPREPIŠE. Výstup ide len do public/.
"""
import re, json, base64, sys, os, gzip
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# Po migrácii je index.html už slim shell — zdroj monolitu hľadaj v legacy zálohe.
def _pick_source():
    for c in [ROOT / "index.monolith.legacy.html", ROOT / "index.html"]:
        if c.exists() and c.stat().st_size > 1_000_000:
            return c
    return ROOT / "index.html"
SRC = _pick_source()
OUT_DATA = ROOT / "public" / "data" / "mapData.json"
OUT_AUDIO_DIR = ROOT / "public" / "audio"
OUT_MANIFEST = OUT_AUDIO_DIR / "manifest.json"

def eprint(*a): print(*a, file=sys.stderr)

def find_osm(t: str) -> str:
    idx = t.find("const OSM_DATA=")
    assert idx >= 0, "OSM_DATA nenájdené"
    bbox = t.find('"bbox"', idx)
    semi = t.find(";", bbox)
    return t[idx + len("const OSM_DATA="):semi]

def find_radio(t: str):
    idx = t.find("const RADIO_SRC=")
    assert idx >= 0, "RADIO_SRC nenájdené"
    # RADIO_SRC končí "];" — ale blob obsahuje ';' vnútri? Nie, base64 nemá ';'.
    # Hľadáme uzatváracie "];" od idx.
    end = t.find("];", idx) + 2
    src_block = t[idx:end]
    # RADIO_NAMES hľadáme spätne/dopredne v okolí
    m = re.search(r'(?:const\s+)?RADIO_NAMES\s*=\s*(\[[^\]]*\])', t[idx-5000:idx+200])
    names = json.loads(m.group(1)) if m else []
    # alternatívne: hľadaj v celom súbore
    if not names:
        m2 = re.search(r'RADIO_NAMES\s*=\s*(\[.*?\])', t, re.S)
        if m2:
            try: names = json.loads(m2.group(1))
            except Exception: names = []
    return src_block, names

def parse_js_string_array(src_block: str):
    # src_block = 'const RADIO_SRC=["data:...", ...]'
    # bezpečne vytiahni "..." reťazce (žiadny escaped quote vo vnútri base64)
    return re.findall(r'"(data:audio/[^"]+)"', src_block)

def prune_osm(d: dict, rnd: int = 1) -> dict:
    """Mierna pruna bez zmeny gameplaye:
    - súradnice zaokrúhli na `rnd` desatinných miest (10 cm pri 1)
    - z blds zahodí prázdne názvy na konci? NIE — indexy musia sedieť s links,
      preto len kvantizácia, nie mazanie záznamov.
    - links ponechá (937× ~30 B = 28 kB, potrebné pre ambient napojenia).
    - tlabels ponechá (1 kB).
    Ťažké polia (roads 81 kB, blds 410 kB) sú už v kompaktnom [w,x,z,...]
    formáte — ďalšie sekanie by rozbilo fyziku. Hlavná úspora je gzip +
    oddelený fetch (neblokuje parser).
    """
    def q(x):
        return round(float(x), rnd) if isinstance(x, (int, float)) else x
    def qlist(lst):
        # rekurzívne len pre čísla v plochých poliach; stringy nechaj
        out = []
        for v in lst:
            if isinstance(v, (int, float)):
                out.append(q(v))
            elif isinstance(v, list):
                out.append(qlist(v))
            else:
                out.append(v)
        return out
    pruned = {}
    for k, v in d.items():
        if isinstance(v, list):
            pruned[k] = qlist(v)
        else:
            pruned[k] = q(v) if isinstance(v, (int, float)) else v
    return pruned

def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--round", type=int, default=1)
    ap.add_argument("--no-prune", action="store_true")
    args = ap.parse_args()

    raw = SRC.read_text(encoding="utf-8", errors="ignore")
    print(f"vstup: {SRC}  {len(raw)/1e6:.2f} MB  ({len(raw)} B)")

    # --- 1) OSM ---
    osm_str = find_osm(raw)
    print(f"OSM_DATA blok: {len(osm_str)/1e3:.1f} kB raw")
    d = json.loads(osm_str)
    print(f"OSM top-level keys ({len(d)}): {list(d.keys())}")
    for k, v in d.items():
        n = len(v) if isinstance(v, list) else 1
        print(f"  {k:12s} záznamov={n}")
    if not args.no_prune:
        d = prune_osm(d, args.round)
    OUT_DATA.parent.mkdir(parents=True, exist_ok=True)
    # kompaktný JSON (bez medzier) = najmenší payload; gzip ho aj tak zožerie
    compact = json.dumps(d, separators=(",", ":"), ensure_ascii=False)
    OUT_DATA.write_text(compact, encoding="utf-8")
    gz = gzip.compress(compact.encode("utf-8"))
    print(f"→ {OUT_DATA.relative_to(ROOT)}  {len(compact)/1e3:.1f} kB  (gzip ~{len(gz)/1e3:.1f} kB)")

    # --- 2) AUDIO ---
    src_block, names = find_radio(raw)
    uris = parse_js_string_array(src_block)
    print(f"RADIO_SRC: {len(uris)} stôp, blok {len(src_block)/1e6:.2f} MB")
    print(f"RADIO_NAMES: {names}")
    OUT_AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    manifest = []
    total_bin = 0
    for i, uri in enumerate(uris):
        m = re.match(r"data:(audio/[a-z0-9]+);base64,(.*)", uri, re.S)
        assert m, f"stopa {i}: zlý data URI"
        mime, b64 = m.group(1), m.group(2)
        ext = {"audio/mpeg": "mp3", "audio/wav": "wav", "audio/ogg": "ogg"}.get(mime, "bin")
        name = names[i] if i < len(names) else f"STATION {i}"
        # bezpečný slug pre súbor
        fname = f"station-{i:02d}.{ext}"
        data = base64.b64decode(b64)
        (OUT_AUDIO_DIR / fname).write_bytes(data)
        total_bin += len(data)
        manifest.append({"id": i, "name": name, "file": f"audio/{fname}", "mime": mime, "bytes": len(data)})
        print(f"  [{i}] {name[:40]:40s} {mime:10s} {len(data)/1e6:.2f} MB → {fname}")
    OUT_MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"→ {OUT_MANIFEST.relative_to(ROOT)} + {len(uris)} súborov, spolu {total_bin/1e6:.2f} MB binárne")

    # --- 3) REPORT ---
    mono = len(raw.encode("utf-8"))
    rest_estimate = mono - len(src_block) - len(osm_str)
    print()
    print("REPORT ─────────────────────────────")
    print(f"monolit           : {mono/1e6:6.2f} MB")
    print(f"  ├ OSM_DATA      : {len(osm_str)/1e3:7.1f} kB  → externý JSON (async fetch, neblokuje parser)")
    print(f"  ├ RADIO_SRC b64 : {len(src_block)/1e6:7.2f} MB  → externé audio ({total_bin/1e6:.2f} MB bin, lazy load)")
    print(f"  └ zvyšok (JS+CSS+HTML): {rest_estimate/1e6:.2f} MB → Vite bundle (code-split, minify, gzip)")
    print()
    print("Ďalší krok: `npm run dev` (modulárne, rýchle) / `npm run build` (singlefile dist/*.html).")
    print("Hra na disku naďalej funguje cez file:// — fetch má fallback na zabudovaný tiny-O SM (pozri src/world/mapData.js).")

if __name__ == "__main__":
    main()
