#!/usr/bin/env python3
"""tools/cyrillic-check.py — overí, že v zdrojoch nie sú cyrilské homoglify
(rozlíšenie len pri vizuálnej kontrole je nemožné; takéto znaky rozbijú
komenty aj identifikátory). Hlásí riadok a znak v cyrilskom bloku U+0400..U+04FF."""
import sys
from pathlib import Path
bad = 0
root = Path(__file__).resolve().parent.parent
for arg in (sys.argv[1:] or [str(root/"src"/"world"/"textures.js")]):
    p = Path(arg)
    for ln, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
        for col, ch in enumerate(line, 1):
            if 0x0400 <= ord(ch) <= 0x04FF:
                print(f"{p.name}:{ln}:{col}: cyrilsky znak {ch!r} -> {line.strip()[:90]}")
                bad += 1
print("OK, cyrillic-clean" if bad == 0 else f"FAIL: {bad} znakov")
sys.exit(1 if bad else 0)
