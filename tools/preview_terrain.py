#!/usr/bin/env python3
"""
tools/preview_terrain.py — offline náhľad na výšku terénu, ktorý hra uvidí.

Nejde o herný kód: je to len meradlo na retunovanie ABSOLÚTNYCH prahových konštánt
(groundColor, groundForest, pásy vegetácie), ktoré boli nadviazané na vymyslený
terén s 8 OSM bodmi. Teraz je podklad SRTM DEM, takže absolútne výšky sú celé
o inú úroveň a prahy treba dať nanovo.

    python3 tools/preview_terrain.py            # histogram + kľúčové body
    python3 tools/preview_terrain.py --ascii    # tiež reliéf

Replikuje len to, co rozhoduje o rozlozeni absolutnej vysky:
    DEM + koryto riverCarveAt + terrainRelief   (bez koridorov ciest a podloz budov,
                                                 tie su lokalne a nic nemenia)
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))

DATUM = 130.2
RIVER_BANK = 75.0
RIVER_DEPTH = 3.6
RIVER_WATER_LIFT = 1.5
WGRID_REACH = 45 + RIVER_BANK
WGRID_CS = WGRID_REACH + 2

# ---------- simplex 2D (bitovo rovnaky src/world/height.js) ----------
_s = 1337
_p = list(range(256))


def _rnd():
    global _s
    _s = (_s * 1103515245 + 12345) & 0x7FFFFFFF
    return _s / 0x7FFFFFFF


for _i in range(255, 0, -1):
    _j = int(_rnd() * (_i + 1))
    _p[_i], _p[_j] = _p[_j], _p[_i]
P = _p * 2
G = [1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 0, 1, 0, -1]
_F = 0.3660254037844386
_G = 0.21132486540518713


def sx_noise(x, z):
    s = (x + z) * _F
    i = math.floor(x + s)
    j = math.floor(z + s)
    t = (i + j) * _G
    x0 = x - (i - t)
    z0 = z - (j - t)
    i1 = 1 if x0 > z0 else 0
    j1 = 0 if x0 > z0 else 1
    x1 = x0 - i1 + _G
    z1 = z0 - j1 + _G
    x2 = x0 - 1 + 2 * _G
    z2 = z0 - 1 + 2 * _G
    ii = i & 255
    jj = j & 255
    n = 0.0
    t0 = 0.5 - x0 * x0 - z0 * z0
    if t0 > 0:
        t0 *= t0
        g = (P[ii + P[jj]] & 7) * 2
        n += t0 * t0 * (G[g] * x0 + G[g + 1] * z0)
    t1 = 0.5 - x1 * x1 - z1 * z1
    if t1 > 0:
        t1 *= t1
        g = (P[ii + i1 + P[jj + j1]] & 7) * 2
        n += t1 * t1 * (G[g] * x1 + G[g + 1] * z1)
    t2 = 0.5 - x2 * x2 - z2 * z2
    if t2 > 0:
        t2 *= t2
        g = (P[ii + 1 + P[jj + 1]] & 7) * 2
        n += t2 * t2 * (G[g] * x2 + G[g + 1] * z2)
    return 70 * n


def sx_fbm(x, z):
    return (sx_noise(x, z) * 0.65 + sx_noise(x * 2.13 + 7.3, z * 2.13 - 3.1) * 0.25
            + sx_noise(x * 4.41 - 5.2, z * 4.41 + 9.7) * 0.10)


def smooth01(t):
    return np.clip(t, 0.0, 1.0) * np.clip(t, 0.0, 1.0) * (3 - 2 * np.clip(t, 0.0, 1.0))


def smooth01s(t):
    t = 0.0 if t < 0 else (1.0 if t > 1 else t)
    return t * t * (3 - 2 * t)


def resample_line(pts, step):
    out = []
    for i in range(2, len(pts), 2):
        ax, az = pts[i - 2], pts[i - 1]
        bx, bz = pts[i], pts[i + 1]
        L = math.hypot(bx - ax, bz - az) or 1.0
        n = max(1, int(round(L / step)))
        for k in range(0 if i == 2 else 1, n + 1):
            out.append(ax + (bx - ax) * k / n)
            out.append(az + (bz - az) * k / n)
    return out


def load():
    meta = json.load(open(os.path.join(ROOT, "assets/terrain/hlohovec_dem.json")))
    a = np.asarray(Image.open(os.path.join(ROOT, "assets/terrain/hlohovec_dem.png")))
    v = (a[..., 0].astype(np.float64) * 256.0 + a[..., 1])
    dem = meta["base"] + v * meta["scale"] - DATUM          # uz v hracich Y
    gb = meta["bbox"]
    return meta, dem, gb


def water_samples(wl, gb):
    xs, zs, hw, bg = [], [], [], []
    for L in wl:
        n = (len(L) - 1) // 2
        if n < 2:
            continue
        pts = L[1:]
        big = L[0] >= 10
        r = resample_line(pts, 20 if big else 14)
        half = L[0] * 0.75 if big else max(4.0, L[0] * 0.5 + 3)
        for k in range(0, len(r), 2):
            xs.append(r[k])
            zs.append(r[k + 1])
            hw.append(half)
            bg.append(1.0 if big else 0.0)
    return (np.array(xs), np.array(zs), np.array(hw), np.array(bg), gb)


def carve(x, z, ws):
    xs, zs, hw, bg, gb = ws
    dx = xs - x
    dz = zs - z
    d = np.hypot(dx, dz)
    m = d < WGRID_REACH
    if not m.any():
        return 0.0, 0.0
    d = d[m]
    w = hw[m]
    big = bg[m] > 0.5
    best = 0.0
    rf = 0.0
    tb = 1.0 - smooth01((d[big] - w[big]) / RIVER_BANK)
    if tb.size:
        v = -RIVER_DEPTH * tb
        best = float(v.min()) if v.min() < best else best
        rf = float(tb.max())
    ms = (~big) & (d < w + 40)
    if ms.any():
        ts = 1.0 - smooth01((d[ms] - w[ms]) / 30.0)
        v = -2.2 * ts
        if v.min() < best:
            best = float(v.min())
    return best, rf


def main():
    ascii_art = "--ascii" in sys.argv
    meta, dem, gb = load()
    d = json.load(open(os.path.join(ROOT, "public/data/mapData.json")))
    ws = water_samples(d["water"], gb)
    G = dem.shape[0]
    MGW = (gb[2] - gb[0]) / (G - 1)
    MGD = (gb[3] - gb[1]) / (G - 1)
    TER_CELL = max(gb[2] - gb[0], gb[3] - gb[1]) / (G - 1)
    FBM_F = 1.0 / (TER_CELL * 24)
    DET_F = 1.0 / (TER_CELL * 8)

    h = dem.copy()
    X, Z = np.meshgrid(np.arange(G) * MGW + gb[0], np.arange(G) * MGD + gb[1])
    riverF = np.zeros_like(h)
    for iz in range(G):
        for ix in range(G):
            c, rf = carve(X[iz, ix], Z[iz, ix], ws)
            h[iz, ix] += c
            riverF[iz, ix] = rf
    # terrainRelief (oslabene v korte ako v hre)
    for iz in range(G):
        for ix in range(G):
            wx = X[iz, ix]
            wz = Z[iz, ix]
            rel = sx_fbm(wx * FBM_F, wz * FBM_F) * 2.0 + sx_noise(wx * DET_F + 3.7, wz * DET_F - 1.2) * 0.35
            h[iz, ix] += rel * (1 - 0.8 * riverF[iz, ix])

    print("DEM %dx%d, bunka %.1f x %.1f m, FBM baza %.0f m" % (G, G, MGW, MGD, 1 / FBM_F))
    print("herna Y (nadm. vyska - %.1f): min %.1f  max %.1f  median %.1f"
          % (DATUM, h.min(), h.max(), float(np.median(h))))
    print()
    bins = [-20, -10, -6, -3, 0, 2, 4, 6, 8, 10, 12, 14, 16, 20, 26, 34, 45, 60, 80, 100, 200]
    hh, ee = np.histogram(h, bins=bins)
    print("%-16s %8s %7s" % ("pas Y", "pocet", "podiel"))
    for i in range(len(hh)):
        if hh[i]:
            print("%6.0f .. %-6.0f %8d %6.1f%%" % (ee[i], ee[i + 1], hh[i], 100 * hh[i] / h.size))
    print("%-26s %8s %8s" % ("miesto", "Y", "n.m."))
    places = {
        "Nitrianska (kruh II)": (-230, 0),
        "Nam. sv. Michala": (-1218, -624),
        "Zamok": (-1810, -140),
        "Zamocka zahrada": (-1883, -128),
        "Urbánek (kopec)": (-1759, 483),
        "Kozí vrch": (-1676, -2746),
        "Váh pri rieke": (-1168, -2331),
        "zeleznicny most": (-1277, -1846),
        "Tesco / OC": (-1720, -1260),
        "S1 Center": (43, 140),
    }
    for nm, (px, pz) in places.items():
        ix = min(G - 1, max(0, int(round((px - gb[0]) / MGW))))
        iz = min(G - 1, max(0, int(round((pz - gb[1]) / MGD))))
        print("%-26s %8.1f %8.1f" % (nm, h[iz, ix], h[iz, ix] + DATUM))
    print()
    bed = h[riverF > 0.9]
    print("koryto (riverF > 0.9): n=%d  Y min %.1f  max %.1f"
          % (bed.size, bed.min() if bed.size else 0.0, bed.max() if bed.size else 0.0))
    print("hladina (dno + %.1f m): max %.1f  (nadm. %.1f m)"
          % (RIVER_WATER_LIFT, (bed + RIVER_WATER_LIFT).max() if bed.size else 0.0,
             (bed + RIVER_WATER_LIFT).max() + DATUM if bed.size else 0.0))

    if ascii_art:
        ch = " .:-=+*#%@"
        print()
        for r in range(0, G, 8):
            line = ""
            for c in range(0, G, 4):
                e = h[r, c]
                lvl = min(len(ch) - 1, int((e - h.min()) / (h.max() - h.min()) * len(ch)))
                line += ch[lvl]
            print("%7.0f |%s" % (gb[1] + r * MGD, line))
        print("        +" + "-" * 65)
        print("         x %.0f .. %.0f" % (gb[0], gb[2]))
    return 0


if __name__ == "__main__":
    sys.exit(main())