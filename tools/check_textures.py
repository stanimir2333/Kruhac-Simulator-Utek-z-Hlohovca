#!/usr/bin/env python3
"""tools/check_textures.py - skontroluje textury v assets/textures/ proti slotom v hre.

    python3 tools/check_textures.py

Kontroluje pre kazdy slot v index.html:
  * existenciu suboru
  * format a to, ci ho prehliadač vobec dekoduje
  * power-of-two rozmery a limit 1024 (inak loader odmietne a pouzije fallback)
  * datovy typ: normalova mapa musi mat modru ~248 (tangent-space, +Y nahor),
    roughness musi byt bezfarebny a v 0..1
  * priemernu jasnost difuzii oproti fallbacku (teren nasobi farbou z
    vertexColors, takze rozdiel jasu je vidiet na celej mape)

Pozor na resize v ImageMagicku: `-resize 512x512` zmazuje POMEER STRAN (vlozi do
stvorca), `-resize 512x512!` ho nadsiluje. Fasada sa kresli na dlazbu 8x8 m, takze
potrebuje presne stvorcovy tvar, inak budu oknavy vysokedomuzke.

Skript nic nemeni - len vypisuje, co treba opravit. Exit code 1, ak je chyba.
"""
import os
import re
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("Potrebuje Pillow:  pip install Pillow")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEXDIR = os.path.join(ROOT, "assets", "textures")
MAXPX = 1024

# Subory, ktorych NEEXISTENCIA je zamerana (slot ide na proceduralny fallback).
PROC_ONLY = {"buildings/concrete_normal.png"}

# slot -> (druh, cielova priemerna luma 0-255 alebo None, tolerancia v %)
# luma ciel = priemerny fallback z procedurálnych painterov v index.html.
# Vacsia tolerancia = "tato textura je zamerne ina a viem, ze tak to chcem".
SLOTS = {
    "road/asphalt_diffuse.jpg":     ("diffuse", 61.0),
    "road/asphalt_normal.png":      ("normal",  None),
    "road/asphalt_roughness.png":   ("rough",   None),
    "terrain/grass_diffuse.jpg":    ("diffuse", 81.0),
    "terrain/dirt_diffuse.png":     ("diffuse", 77.7),
    "terrain/terrain_normal.png":   ("normal",  None),
    "buildings/wall.png":           ("diffuse", None),
    # betón je zamerne tmavší než fallback (realne albedo), takže 30 % tolerancie
    "buildings/concrete_diffuse.jpg":  ("diffuse", 165.0, 30),
    # normalová mapa zámerne chýba -> slot ide na procedurálnu (nie je biela guma)
    "buildings/concrete_normal.png":  ("normal",  None),
    "buildings/brick.jpg":          ("diffuse", 82.5),
    "buildings/brick_normal.png":   ("normal",  None),
    "buildings/wood.png":           ("diffuse", None),
    "buildings/wood_normal.png":    ("normal",  None),
    "buildings/gravel.png":         ("diffuse", 120.0),
}


def is_pot(n):
    return n > 0 and (n & (n - 1)) == 0


def stats(path):
    im = Image.open(path)
    fmt, size, mode = im.format, im.size, im.mode
    rgb = im.convert("RGB")
    buf = rgb.tobytes()
    n = len(buf) // 3
    r = sum(buf[0::3]) / n
    g = sum(buf[1::3]) / n
    b = sum(buf[2::3]) / n
    lum = (0.2126 * r + 0.7152 * g + 0.0722 * b)
    sat = max(r, g, b) - min(r, g, b)
    return fmt, size, mode, (r, g, b), lum, sat


def main():
    print("%-32s %-6s %-11s %6s %6s %7s %7s  %s" %
          ("subor", "W", "format", "luma", "blue", "sat", "blue2", "stav"))
    print("-" * 108)
    problems = []
    for rel, spec in sorted(SLOTS.items()):
        kind, target = spec[0], spec[1]
        tolpct = spec[2] if len(spec) > 2 else 18
        path = os.path.join(TEXDIR, rel)
        if not os.path.exists(path):
            # Neexistujuci subor NIE JE chyba - loader ticho pouzije proceduralny
            # fallback. Je to legitimny stav (nieto co v repu, alebo slot je
            # zamerne proceduralny). Zmena oproti minulemu stavu sa vypise zvysraznene.
            mark = "OK (zamerane proceduralny)" if rel in PROC_ONLY else "!! CHÝBA"
            print("%-32s %s" % (rel, mark))
            if rel not in PROC_ONLY:
                problems.append(rel + " (chýba - kým nevrátiš, slot ide na fallback)")
            continue
        try:
            fmt, (w, h), mode, rgb, lum, sat = stats(path)
        except Exception as e:
            print("%-32s !! nedekodovateľný: %s" % (rel, e))
            problems.append(rel + " (nedekodovateľný)")
            continue

        bad = []
        if not (is_pot(w) and is_pot(h)):
            bad.append("nie je power-of-two (loader ODMIETNE -> fallback)")
        if w > MAXPX or h > MAXPX:
            bad.append("väčšie ako %d px" % MAXPX)
        if fmt != ("JPEG" if rel.endswith(".jpg") else "PNG"):
            bad.append("obsah je %s, ale prípona hovorí %s" %
                       (fmt, "jpg" if rel.endswith(".jpg") else "png"))
        if kind == "normal":
            if rgb[2] < 200:
                extra = ""
                if sat < 6:
                    extra = " (bezfarebný = to je DISPLACEMENT, nie normála)"
                bad.append("modrá kanál %.0f, má byť ~248 - nie je to tangent-space normála%s"
                           % (rgb[2], extra))
            if lum > 252 and sat < 2:
                bad.append("celá biela - nič nepridáva, len zaberá VRAM")
        if kind == "rough" and sat > 6:
            bad.append("farebná (sat %.0f) - roughness má byť bezfarebný" % sat)
        if kind == "diffuse" and target:
            tol = tolpct
            dev = (lum - target) / target * 100
            if abs(dev) > tol:
                bad.append("jas %+.0f %% oproti fallbacku (%.0f, cieľ %.0f, tolerancia %.0f %%) - scéna zmení jas"
                           % (dev, lum, target, tol))

        state = "OK" if not bad else " | ".join(bad)
        if bad:
            problems.append(rel + ": " + bad[0])
        print("%-32s %-6d %-11s %6.1f %6.1f %7.1f %7s  %s" %
              (rel, w, fmt + " " + mode, lum, rgb[2], sat, "-", state))

    # nepouzite subory
    used = set(SLOTS)
    for dirpath, dirs, files in os.walk(TEXDIR):
        if any(d.startswith("_") for d in dirs):
            dirs[:] = []          # _zdroje/ = archiv zdrojov, nie sloty
            continue
        for fn in files:
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, TEXDIR)
            if rel in used or fn in (".gitkeep", "README.md"):
                continue
            print("\nnepoužitý súbor: %s (%.1f MB, slot ho nežiada - zbytočný v repo)"
                  % (rel, os.path.getsize(full) / 1048576.0))
            problems.append(rel + " (nepoužitý, zbytočný v repo)")

    print()
    if problems:
        print("TREBA OPRAVIŤ: %d" % len(problems))
        for p in problems:
            print("  -", p)
        return 1
    print("Všetky sloty sú v poriadku.")
    return 0


if __name__ == "__main__":
    sys.exit(main())