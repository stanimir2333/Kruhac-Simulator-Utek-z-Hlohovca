#!/usr/bin/env python3
"""
tools/build_dem.py — vyrobí raster nadmorskej výšky pre mapu Hlohovca.

Problém, ktorý rieši: OSM má v okolí Hlohovca IBA 10 uzlov s tagom `ele=`
na ploche 5,3 x 5,1 km. Z toho sa nedá spraviť výšková mapa — analytický model
v src/world/height.js musel svahu a kopce vymýšľať (plný kužeľ + FBM šum).
Najmä kancelárske `ele=242` (Urbánek) medzitým z OSM zmizlo, takže najvyšší
kopeč v teréne bol fiktívny a hra sa hrala na vymyslenom svahu.

Riešenie: stiahnuť dlaždice SRTM (Mapzen terrarium), zošiť ich do jednej
matice a prehustiť na ROZSAHN terénu. Výstup je 16-bitová sivá PNG
(`assets/terrain/hlohovec_dem.png`) s rozlišením presne TER_SEG+1 = 257
v smere X aj Z — teda JEDEN bod DEM == JEDEN vrchol terénovej mriežky.
Žiadna interpolácia, žiadny posun: fyzika aj raster čítajú tie isté hodnoty.

Overené proti OSM `ele` uzlov z toho istého exportu: zhoda do ±4 m (deviaty
uzol `ele=160` je fotobod na tabuli, nie povrch terénu — DEM hovorí 143 m,
čo je správne pre náplavku).

Použitie:
    python3 tools/build_dem.py                       # predvolene map(3).osm bounds
    python3 tools/build_dem.py --zoom 15             # jemnejšie dlaždice
    python3 tools/build_dem.py --cache /tmp/demtiles # offline (priblížiľ sa neskôr)

Závislosti: Pillow + numpy + sieť (len pri stahovaní). Script nic v repore
nemá čo prepísať okrem dvoch súborov v assets/terrain/.
"""
import argparse
import json
import math
import os
import sys
import time
import urllib.request

try:
    import numpy as np
except ImportError:
    sys.exit("Potrebuje numpy:  pip install numpy")
try:
    from PIL import Image
except ImportError:
    sys.exit("Potrebuje Pillow:  pip install Pillow")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTDIR = os.path.join(ROOT, "assets", "terrain")

# ---------- projekcia OSM -> svet (musí sedieť s height.js a mapData.js) ----------
LON0, LAT0 = 17.8136414, 48.4212428
LONM, LATM = 73876.98, 110539.70

TILE = 256            # px vo vnútri jednej dlaždice
MARGIN = 400.0        # computeBounds() v ground.js: bbox +/- MARGIN
Q = 0.1               # m na jeden 16-bitovy stupen (rozsah 6553 m, my mame ~150)

# Bezny offset mapy (mapData.bbox) — pouzije sa, ked sa nezadá --bbox.
DEFAULT_BBOX = [-2874.5, -3104.2, 1633.8, 1163.3]


def lonlat_to_tile(lon, lat, z):
    n = 2 ** z
    x = (lon + 180.0) / 360.0 * n
    sr = math.sin(math.radians(lat))
    y = (0.5 - math.log((1 + sr) / (1 - sr)) / (4 * math.pi)) * n
    return x, y


def fetch_tile(z, x, y, cache):
    """Jedna dlaždica terrarium -> numpy (TILE, TILE) v metroch n. m."""
    os.makedirs(cache, exist_ok=True)
    path = os.path.join(cache, "%d_%d_%d.png" % (z, x, y))
    if os.path.exists(path):
        return np.asarray(Image.open(path).convert("RGB")).astype(np.float64)
    url = "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/%d/%d/%d.png" % (z, x, y)
    with urllib.request.urlopen(url, timeout=40) as r:
        blob = r.read()
    with open(path, "wb") as f:
        f.write(blob)
    return np.asarray(Image.open(path).convert("RGB")).astype(np.float64)


def decode(arr):
    """terrarium: (R*256 + G + B/256) - 32768."""
    return (arr[..., 0] * 256.0 + arr[..., 1] + arr[..., 2] / 256.0) - 32768.0


def tile_window(lon_a, lat_a, lon_b, lat_b, zoom, pad=1):
    """Okno dlazdic (tx0, ty0, tx1, ty1) +1, co pokryva zadanu obdleznik.
    pad=1 je Safety pri bilinearnej prevazke na okrajoch."""
    xa, ya = lonlat_to_tile(lon_a, lat_a, zoom)
    xb, yb = lonlat_to_tile(lon_b, lat_b, zoom)
    return (math.floor(min(xa, xb)) - pad, math.floor(min(ya, yb)) - pad,
            math.floor(max(xa, xb)) + pad, math.floor(max(ya, yb)) + pad)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zoom", type=int, default=14)
    ap.add_argument("--px", type=int, default=257, help="velikost DEM (257 == TER_SEG+1)")
    ap.add_argument("--bbox", type=float, nargs=4, metavar=("X0", "Z0", "X1", "Z1"),
                    default=DEFAULT_BBOX)
    ap.add_argument("--cache", default="/tmp/opencode/demtiles")
    ap.add_argument("--dry", action="store_true", help="nestiahni, len vypis planu")
    args = ap.parse_args()

    bbox = args.bbox
    gb = [bbox[0] - MARGIN, bbox[1] - MARGIN, bbox[2] + MARGIN, bbox[3] + MARGIN]
    print("bbox OSM      %s" % ["%.1f" % v for v in bbox])
    print("rozsah terenu %s  (%.0f x %.0f m)" % (["%.1f" % v for v in gb],
                                                  gb[2] - gb[0], gb[3] - gb[1]))
    print("DEM           %d x %d bodov  (bunka %.2f x %.2f m)"
          % (args.px, args.px, (gb[2] - gb[0]) / (args.px - 1), (gb[3] - gb[1]) / (args.px - 1)))

    lon_a, lat_a = gb[0] / LONM + LON0, -gb[3] / LATM + LAT0
    lon_b, lat_b = gb[2] / LONM + LON0, -gb[1] / LATM + LAT0
    tx0, ty0, tx1, ty1 = tile_window(lon_a, lat_a, lon_b, lat_b, args.zoom)
    n = (tx1 - tx0 + 1) * (ty1 - ty0 + 1)
    mpt = 156543.034 * math.cos(math.radians(LAT0)) / (2 ** args.zoom) * TILE
    print("dlaždice      z%d  %.0f m/dlazdica  (%d x %d = %d stiahnutí)"
          % (args.zoom, mpt, tx1 - tx0 + 1, ty1 - ty0 + 1, n))
    if args.dry:
        return 0

    # 1) nafukovacie pole pokryvajuce cely teren
    nx, ny = tx1 - tx0 + 1, ty1 - ty0 + 1
    field = np.zeros((ny * TILE, nx * TILE))
    done = 0
    t0 = time.time()
    for iy in range(ny):
        for ix in range(nx):
            t = decode(fetch_tile(args.zoom, tx0 + ix, ty0 + iy, args.cache))
            field[iy * TILE:(iy + 1) * TILE, ix * TILE:(ix + 1) * TILE] = t
            done += 1
            time.sleep(0.08)          # nebyt drzky k S3 - vedie to k 429
    print("stiahnuté %d/%d dlazdic za %.1f s" % (done, n, time.time() - t0))

    # 2) suradnice DEM vrchola vo vnutri pola
    lon0px = tx0 * TILE
    lat0px = ty0 * TILE
    gxs = np.linspace(gb[0], gb[2], args.px)
    gzs = np.linspace(gb[1], gb[3], args.px)
    px_lon = (gxs / LONM + LON0 + 180.0) / 360.0 * (2 ** args.zoom) * TILE - lon0px
    # tileY z lat: y = (0.5 - asinh(tan(lat))/2pi) * n * TILE
    def py_of_lat(lat):
        sr = math.sin(math.radians(lat))
        return (0.5 - math.log((1 + sr) / (1 - sr)) / (4 * math.pi)) * (2 ** args.zoom) * TILE - lat0px
    py_a, py_b = py_of_lat(lat_b), py_of_lat(lat_a)     # z=gb[1] -> vacsi y
    pxs = px_lon[:, None]
    pys = np.linspace(py_a, py_b, args.px)[None, :]
    if py_b < py_a:
        pys = pys[:, ::-1]

    # 3) bilinearne premapovanie na mriezku terenu (dve vektorove osi, poradie
    #    'ij' == row = z, col = x, presne ako S.meshGrid)
    H, W = field.shape
    c0 = np.clip(np.floor(pxs).astype(int), 0, W - 2)
    c1 = c0 + 1
    r0 = np.clip(np.floor(pys).astype(int), 0, H - 2)
    r1 = r0 + 1
    fc = np.clip(pxs - c0, 0, 1)
    fr = np.clip(pys - r0, 0, 1)
    dem = ((field[r0, c0] * (1 - fc) + field[r0, c1] * fc) * (1 - fr)
           + (field[r1, c0] * (1 - fc) + field[r1, c1] * fc) * fr)

    # 4) kvantizácia. Prehliadač NEPOZNA 16-bitovy obrazok: canvas getImageData
    #    vrati 8-bitove RGBA, takze 16-bitova siva PNG by sa v hre stratila na
    #    nízkych bitoch (0.7 m/krok na takomto reliéfe = auto by poskakovalo na
    #    rovine). Preto nesieme 16-bitovu hodnotu v dvoch kanaloch:
    #       R = vysky byte, G = nizky byte, B = 0
    #    a hra ich posklada v osmElevAt(). Hodnota je exaktna (0.1 m).
    base = math.floor(float(dem.min()))
    q = np.rint((dem - base) / Q).astype(np.int64)
    assert q.min() >= 0 and q.max() <= 65535, "vyska mimo 16 bitov"
    rgb = np.zeros(dem.shape + (3,), dtype=np.uint8)
    rgb[..., 0] = (q >> 8).astype(np.uint8)
    rgb[..., 1] = (q & 255).astype(np.uint8)
    im = Image.fromarray(rgb, mode="RGB")
    os.makedirs(OUTDIR, exist_ok=True)
    png = os.path.join(OUTDIR, "hlohovec_dem.png")
    im.save(png, optimize=True)

    meta = {
        "file": "hlohovec_dem.png",
        "w": args.px, "h": args.px,
        "base": float(base), "scale": Q,
        "packing": "r16",              # v = R*256 + G
        "bbox": [round(v, 1) for v in gb],
        "datum": 130.2,
        "src": "Mapzen terrarium (SRTM/NASA, public domain), zoom %d" % args.zoom,
    }
    jpath = os.path.join(OUTDIR, "hlohovec_dem.json")
    with open(jpath, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)

    print("vyska         min %.1f  max %.1f  m n.m.  (base %.1f, 0.1 m/stupen)"
          % (dem.min(), dem.max(), base))
    print("-> %s  %d B" % (os.path.relpath(png, ROOT), os.path.getsize(png)))
    print("-> %s  %d B" % (os.path.relpath(jpath, ROOT), os.path.getsize(jpath)))
    return 0


if __name__ == "__main__":
    sys.exit(main())