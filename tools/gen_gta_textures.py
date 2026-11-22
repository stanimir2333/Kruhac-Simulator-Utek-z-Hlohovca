#!/usr/bin/env python3
"""
tools/gen_gta_textures.py — PBR textúry pre Kruháč Simulator (idempotentné).

Všetky mapy sa generujú z PERIODICKÉHO šumu, takže dlaždica je bez švíkov
(ľavý == pravý, horný == spodný okraj). Pre každý povrch vzniká súčasne
difúzia, výškové pole (-> tangent-space normála) a drsnosť, takže mapy
navzájom sedia — normála nie je odlepená od obrázka.

Výstup (assets/textures/):
  road/asphalt_diffuse.jpg / asphalt_normal.jpg / asphalt_roughness.jpg
  road/pave_diffuse.jpg / pave_normal.jpg / pave_roughness.jpg
  road/tiremark.png, road/crosswalk.png
  terrain/grass_diffuse.jpg / terrain_normal.jpg / grass_roughness.jpg
  terrain/dirt_diffuse.jpg / dirt_normal.jpg / dirt_roughness.jpg
  buildings/brick.jpg / brick_normal.jpg / brick_roughness.jpg
  buildings/concrete_diffuse.jpg / concrete_normal.jpg / concrete_roughness.jpg
  buildings/wood.png / wood_normal.jpg
  buildings/gravel.jpg / gravel_normal.jpg / gravel_roughness.jpg
  buildings/roof_tile.jpg / roof_tile_normal.jpg / roof_tile_roughness.jpg
  veg/shrubs.png

Difúzie sú JPEG q92, normály JPEG q92 4:2:2 a drsnosť sivý JPEG —
1024² PNG normála mala 1–2,3 MB, takto má 0,2–0,7 MB a v hre to nie je vidieť.

Priemerná luma difúzií sa normalizuje na hodnoty, na ktoré je naladený
terén a materiály (asfalt 61, tráva 81, hlina 77,7, tehla 82,5, betón 165).
Bez toho by nová textúra rozsvietila alebo ztmavila celú scénu.

Spustenie:  python3 tools/gen_gta_textures.py
"""
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A = os.path.join(ROOT, "assets", "textures")


# =============================================================================
# PERIODICKÝ ŠUM
# =============================================================================
def _hash(ix, iy, seed):
    """Hash mriežky -> [0,1). ix/iy sú už zabalené do periódy."""
    ix = np.asarray(ix, dtype=np.int64)
    iy = np.asarray(iy, dtype=np.int64)
    h = (ix * 374761393 + iy * 668265263 + int(seed) * 2246822519) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFFFFFF).astype(np.float64) / 2.0 ** 32


def value_noise(W, H, cells, seed):
    """Dlaždicový value noise. `cells` = počet buniek cez šírku (celé číslo)."""
    cells = max(1, int(cells))
    xs = np.arange(W, dtype=np.float64) * cells / W
    ys = np.arange(H, dtype=np.float64) * cells / H
    xi = np.floor(xs).astype(np.int64)
    yi = np.floor(ys).astype(np.int64)
    xf = xs - xi
    yf = ys - yi
    u = xf * xf * (3 - 2 * xf)
    v = yf * yf * (3 - 2 * yf)
    x0 = xi % cells
    y0 = yi % cells
    x1 = (xi + 1) % cells
    y1 = (yi + 1) % cells
    a = _hash(x0[None, :], y0[:, None], seed)
    b = _hash(x1[None, :], y0[:, None], seed)
    c = _hash(x0[None, :], y1[:, None], seed)
    d = _hash(x1[None, :], y1[:, None], seed)
    ab = a + (b - a) * u[None, :]
    cd = c + (d - c) * u[None, :]
    return ab + (cd - ab) * v[:, None]


def value_noise_aniso(W, H, cx, cy, seed):
    """Dlaždicový šum s inou frekvenciou v X a Y (vlákna, steblá, stopy)."""
    cx = max(1, int(cx))
    cy = max(1, int(cy))
    xs = np.arange(W, dtype=np.float64) * cx / W
    ys = np.arange(H, dtype=np.float64) * cy / H
    xi = np.floor(xs).astype(np.int64)
    yi = np.floor(ys).astype(np.int64)
    xf = xs - xi
    yf = ys - yi
    u = xf * xf * (3 - 2 * xf)
    v = yf * yf * (3 - 2 * yf)
    x0 = xi % cx
    y0 = yi % cy
    x1 = (xi + 1) % cx
    y1 = (yi + 1) % cy
    a = _hash(x0[None, :], y0[:, None], seed)
    b = _hash(x1[None, :], y0[:, None], seed)
    c = _hash(x0[None, :], y1[:, None], seed)
    d = _hash(x1[None, :], y1[:, None], seed)
    ab = a + (b - a) * u[None, :]
    cd = c + (d - c) * u[None, :]
    return ab + (cd - ab) * v[:, None]


def fbm(W, H, base, octaves, seed, persistence=0.5):
    out = np.zeros((H, W), dtype=np.float64)
    amp = 1.0
    norm = 0.0
    cells = max(1, int(base))
    for o in range(octaves):
        out += amp * value_noise(W, H, cells, seed + o * 101)
        norm += amp
        amp *= persistence
        cells *= 2
    return out / norm


def ridged(W, H, base, octaves, seed):
    out = np.zeros((H, W), dtype=np.float64)
    amp = 1.0
    norm = 0.0
    cells = max(1, int(base))
    for o in range(octaves):
        out += amp * (1.0 - np.abs(2.0 * value_noise(W, H, cells, seed + o * 211) - 1.0))
        norm += amp
        amp *= 0.5
        cells *= 2
    return out / norm


def sstep(a, b, t):
    t = np.clip((t - a) / (b - a), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def worley(W, H, cells, seed, jitter=0.88):
    """Dlaždicové Voronoi: F1, F2 a ID bunky. F1/F2 normalizované na ~0..1."""
    cells = max(1, int(cells))
    cw = W / cells
    ch = H / cells
    f1 = np.full((H, W), 1e9, dtype=np.float32)
    f2 = np.full((H, W), 1e9, dtype=np.float32)
    cid = np.zeros((H, W), dtype=np.int32)
    gy, gx = np.mgrid[0:cells, 0:cells]
    r1 = _hash(gx, gy, seed)
    r2 = _hash(gx, gy, seed + 7)
    px = (gx + 0.5 + (r1 - 0.5) * jitter) * cw
    py = (gy + 0.5 + (r2 - 0.5) * jitter) * ch
    for j in range(cells):
        for i in range(cells):
            cx = float(px[j, i])
            cy = float(py[j, i])
            offs = [(0, 0)]
            if cx < cw: offs.append((-W, 0))
            if cx > W - cw: offs.append((W, 0))
            if cy < ch: offs.append((0, -H))
            if cy > H - ch: offs.append((0, H))
            for ox, oy in offs:
                x0 = int(max(0, np.floor(cx + ox - cw)))
                x1 = int(min(W, np.ceil(cx + ox + cw)))
                y0 = int(max(0, np.floor(cy + oy - ch)))
                y1 = int(min(H, np.ceil(cy + oy + ch)))
                if x1 <= x0 or y1 <= y0:
                    continue
                dx = np.arange(x0, x1, dtype=np.float32) + 0.5 - (cx + ox)
                dy = np.arange(y0, y1, dtype=np.float32) + 0.5 - (cy + oy)
                d = np.sqrt(dx[None, :] * dx[None, :] + dy[:, None] * dy[:, None])
                sl = (slice(y0, y1), slice(x0, x1))
                f1s = f1[sl]
                m = d < f1s
                f2[sl] = np.where(m, f1s, np.minimum(f2[sl], d))
                f1[sl] = np.where(m, d, f1s)
                cid[sl] = np.where(m, j * cells + i, cid[sl])
    scale = 1.0 / (0.7 * min(cw, ch))
    return np.clip(f1 * scale, 0, 1.5), np.clip(f2 * scale, 0, 1.5), cid


# =============================================================================
# POMOCNÉ: normal, drsnosť, luma, uloženie
# =============================================================================
def normals_from_height(hf, strength=1.0):
    xm = np.roll(hf, 1, axis=1)
    xp = np.roll(hf, -1, axis=1)
    ym = np.roll(hf, 1, axis=0)
    yp = np.roll(hf, -1, axis=0)
    nx = (xm - xp) * strength
    ny = (ym - yp) * strength
    inv = 1.0 / np.sqrt(nx * nx + ny * ny + 1.0)
    R = (nx * inv * 0.5 + 0.5) * 255.0
    G = (ny * inv * 0.5 + 0.5) * 255.0
    B = (inv * 0.5 + 0.5) * 255.0
    return np.clip(np.stack([R, G, B], axis=-1), 0, 255).astype(np.uint8)


def gray_map(f):
    v = np.clip(f, 0, 1) * 255.0
    return np.repeat(v[..., None], 3, axis=-1).astype(np.uint8)


def srgb_to_linear(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * (c ** (1 / 2.4)) - 0.055) * 255.0


def match_luma(img, target, tolerance=0.5):
    """Posun priemernej lumy na cieľ (lineárny zisk, jemne ohraničený)."""
    lin = srgb_to_linear(img)
    lum = 0.2126 * lin[..., 0] + 0.7152 * lin[..., 1] + 0.0722 * lin[..., 2]
    cur = float(lum.mean())
    if cur <= 1e-6:
        return img
    tgt = target / 255.0
    gain = tgt / cur
    gain = float(np.clip(gain, 0.55, 1.9))
    out = linear_to_srgb(lin * gain)
    # ak stále nesedí (clipping), doladíme v sRGB
    for _ in range(3):
        cur2 = float((0.2126 * out[..., 0] + 0.7152 * out[..., 1] + 0.0722 * out[..., 2]).mean())
        if abs(cur2 - target) <= tolerance:
            break
        out *= target / max(1e-6, cur2)
    return np.clip(out, 0, 255)


def save_jpg(arr, rel, quality=92):
    path = os.path.join(A, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB").save(
        path, "JPEG", quality=quality, optimize=True, progressive=True)


def save_png(arr, rel):
    path = os.path.join(A, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    mode = "RGBA" if arr.shape[2] == 4 else "RGB"
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), mode).save(path, "PNG", optimize=True)


# Normála = 3 kanály vektorov. PNG z 1024² gradientov malo 1–2,3 MB; JPEG q92
# ~0,2–0,7 MB a v hre je rozdiel neviditeľný. 4:2:2 (subsampling=1) je
# kompromis: tento build libjpeg nevie 4:4:4 (spadne na "Suspension not
# allowed"), a 4:2:0 by rozmazal R/G kanály (X/Y normály) na polovicu.
# Drsnosť je jeden kanál -> sivý JPEG (tretinová veľkosť).
def save_nrm(arr, rel, quality=92):
    path = os.path.join(A, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB").save(
        path, "JPEG", quality=quality, optimize=True, progressive=True, subsampling=1)


def save_rgh(arr, rel, quality=90):
    path = os.path.join(A, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    g = np.clip(arr[..., 0] if arr.ndim == 3 else arr, 0, 255).astype(np.uint8)
    Image.fromarray(g, "L").save(
        path, "JPEG", quality=quality, optimize=True, progressive=True)


def luma(path):
    im = Image.open(path).convert("RGB")
    a = np.asarray(im, dtype=np.float64)
    return float((0.2126 * a[:, :, 0] + 0.7152 * a[:, :, 1] + 0.0722 * a[:, :, 2]).mean())


# =============================================================================
# ASFALT
# =============================================================================
def gen_asphalt(W=1024):
    macro = fbm(W, W, 8, 4, 11)
    patch = fbm(W, W, 4, 3, 131)
    fine = fbm(W, W, 128, 3, 29)
    grain = fbm(W, W, 256, 2, 37)
    f1, f2, cid = worley(W, W, 112, 47)
    stone = sstep(0.18, 0.62, 1.0 - f1)
    stone_edge = sstep(0.03, 0.16, f2 - f1) * (1.0 - stone)
    crack = 1.0 - sstep(0.015, 0.115, ridged(W, W, 20, 4, 83))
    tar = sstep(0.70, 0.88, fbm(W, W, 5, 3, 151))
    tone = _hash(cid % 112, cid // 112, 53)

    hf = stone * 0.55 + fine * 0.20 + grain * 0.10 + patch * 0.15 - crack * 0.65 - tar * 0.12
    l = 50.0 + macro * 8.0 + (patch - 0.5) * 11.0 + (fine - 0.5) * 9.0
    l += stone * (7.0 + tone * 13.0) - stone_edge * 5.0
    l -= crack * 26.0 + tar * 13.0
    l += (grain - 0.5) * 7.0
    # drobné kremenné zrnká
    spark = sstep(0.985, 0.998, value_noise(W, W, 512, 61))
    l += spark * 30.0
    # jemný modrastý nádych čerstvého asfaltu
    img = np.stack([l * 0.96, l * 0.98, l * 1.02], axis=-1)
    img = match_luma(img, 61.0)

    rough = 0.90 - stone * 0.16 + crack * 0.05 + tar * 0.28 + (fine - 0.5) * 0.06
    rough = np.clip(rough, 0.35, 0.99)
    return img, normals_from_height(hf, 2.2), gray_map(rough)


# =============================================================================
# TRÁVA
# =============================================================================
def gen_grass(W=1024):
    rng = np.random.default_rng(7)
    clump = fbm(W, W, 5, 4, 5)
    mid = fbm(W, W, 24, 4, 61)
    fine = fbm(W, W, 96, 3, 71)
    dry = sstep(0.56, 0.86, fbm(W, W, 7, 3, 97))
    bare = sstep(0.72, 0.93, fbm(W, W, 13, 3, 131))
    shade = sstep(0.42, 0.80, fbm(W, W, 3, 3, 149))

    t = np.clip(clump * 1.15 + mid * 0.55 + fine * 0.28 - 0.48, 0, 1)
    r = 48.0 + t * 34.0 + dry * 30.0 + bare * 24.0
    g = 62.0 + t * 36.0 + dry * 16.0 + bare * 14.0
    b = 34.0 + t * 24.0 + dry * 7.0 + bare * 5.0
    r -= shade * 9.0
    g -= shade * 7.0
    b -= shade * 4.0
    img = np.stack([r, g, b], axis=-1)
    img += (rng.random((W, W, 3)) - 0.5) * 8.0

    hf = clump * 0.45 + mid * 0.35 + fine * 0.20 - bare * 0.30

    # steblá: tisíce krátkych zvislých ťahov, hustota podľa clump
    n_blades = int(W * W * 0.045)
    xs = rng.integers(1, W - 1, n_blades)
    ys = rng.integers(2, W - 8, n_blades)
    ln = rng.integers(2, 7, n_blades)
    lean = rng.integers(-1, 2, n_blades)
    bright = rng.random(n_blades)
    for k in range(n_blades):
        x = int(xs[k]); y = int(ys[k]); L = int(ln[k])
        if bare[y, x] > 0.62 and bright[k] < 0.7:
            continue
        # steblo je svetlejšie pri špičke, tmavšie pri päte
        for j in range(L):
            xx = int(np.clip(x + (lean[k] if j > L * 0.55 else 0), 0, W - 1))
            yy = int(np.clip(y - j, 0, W - 1))
            v = 0.55 + 0.45 * (j / max(1, L - 1))
            img[yy, xx, 0] += (18.0 + bright[k] * 20.0) * v
            img[yy, xx, 1] += (26.0 + bright[k] * 24.0) * v
            img[yy, xx, 2] += (10.0 + bright[k] * 10.0) * v
            hf[yy, xx] += 0.09

    # drobné kvety a suché stonky
    n_flowers = 260
    fx = rng.integers(2, W - 2, n_flowers)
    fy = rng.integers(2, W - 2, n_flowers)
    for k in range(n_flowers):
        x = int(fx[k]); y = int(fy[k])
        if bare[y, x] > 0.45:
            continue
        c = rng.integers(0, 3)
        col = ((238, 232, 208), (222, 196, 64), (188, 176, 206))[c]
        img[max(0, y - 1):y + 1, max(0, x - 1):x + 1, 0] += col[0] * 0.35
        img[max(0, y - 1):y + 1, max(0, x - 1):x + 1, 1] += col[1] * 0.35
        img[max(0, y - 1):y + 1, max(0, x - 1):x + 1, 2] += col[2] * 0.35
        hf[max(0, y - 1):y + 1, max(0, x - 1):x + 1] += 0.12

    img = match_luma(img, 81.0)
    rough = 0.93 + (fine - 0.5) * 0.05 - dry * 0.03
    return img, normals_from_height(hf, 2.6), gray_map(np.clip(rough, 0.8, 0.99))


# =============================================================================
# HLINA / POĽNÁ CESTA
# =============================================================================
def gen_dirt(W=1024):
    macro = fbm(W, W, 6, 4, 313)
    fine = fbm(W, W, 96, 3, 331)
    f1, f2, cid = worley(W, W, 128, 347)
    peb = sstep(0.30, 0.72, 1.0 - f1)
    crack = 1.0 - sstep(0.02, 0.12, ridged(W, W, 28, 3, 359))
    wet = sstep(0.68, 0.90, fbm(W, W, 4, 3, 371))
    tone = _hash(cid % 128, cid // 128, 373)

    # dve koľaje (pozdĺž Y), mierne vtlacené a vyleštené
    xs = np.arange(W, dtype=np.float64) / W
    rut = np.zeros(W)
    for c in (0.30, 0.70):
        rut += np.exp(-((xs - c) / 0.055) ** 2)
    rut = np.clip(rut, 0, 1)[None, :]

    hf = macro * 0.30 + fine * 0.22 + peb * 0.48 - crack * 0.42 - rut * 0.18
    l = 78.0 + macro * 20.0 + (fine - 0.5) * 13.0 + peb * (8.0 + tone * 18.0)
    l -= crack * 22.0 + wet * 17.0 + rut * 9.0
    r = l * 1.04 + peb * 4.0
    g = l * 0.88 + peb * 3.0
    b = l * 0.68
    img = np.stack([r, g, b], axis=-1)
    img = match_luma(img, 77.7)
    rough = 0.97 - peb * 0.10 + crack * 0.02 - wet * 0.22 - rut * 0.10
    return img, normals_from_height(hf, 2.0), gray_map(np.clip(rough, 0.55, 0.99))


# =============================================================================
# BETÓN
# =============================================================================
def gen_concrete(W=1024):
    macro = fbm(W, W, 8, 4, 211)
    fine = fbm(W, W, 128, 3, 223)
    f1, f2, cid = worley(W, W, 160, 227)
    agg = sstep(0.35, 0.78, 1.0 - f1)
    pit = sstep(0.86, 0.97, fbm(W, W, 96, 2, 229))
    stain = sstep(0.58, 0.90, fbm(W, W, 4, 4, 233))
    crack = 1.0 - sstep(0.02, 0.10, ridged(W, W, 18, 4, 239))
    # debniace dosky: jemné vodorovné škáry každú 1/4 dlaždice
    yy = np.arange(W)[:, None]
    seam = sstep(2.0, 0.0, np.abs(((yy + W // 8) % (W // 4)) - 0.0))
    seam = np.clip(seam, 0, 1) * 0.5

    hf = macro * 0.25 + fine * 0.25 + agg * 0.35 - pit * 0.30 - crack * 0.55 - seam * 0.15
    l = 150.0 + macro * 22.0 + (fine - 0.5) * 12.0 + agg * 12.0
    l -= pit * 22.0 + stain * 26.0 + crack * 28.0 + seam * 12.0
    img = np.stack([l * 1.00, l * 0.995, l * 0.975], axis=-1)
    img = match_luma(img, 165.0)
    rough = 0.90 + (fine - 0.5) * 0.06 + stain * 0.04 - agg * 0.05
    return img, normals_from_height(hf, 2.0), gray_map(np.clip(rough, 0.6, 0.99))


# =============================================================================
# TEHLA
# =============================================================================
def gen_brick(W=1024):
    rng = np.random.default_rng(77)
    bw, bh = W // 4, W // 8
    ys = np.arange(W)[:, None]
    xs = np.arange(W)[None, :]
    row = ys // bh
    off = (row % 2) * (bw // 2)
    fx = (xs + off) % W
    col = (fx // bw).astype(np.int64)
    in_row = (ys % bh) < bh * 0.82
    in_col = (fx % bw) < bw * 0.88
    brick = in_row & in_col
    # vzdialenosť od okraja tehly (px) pre zaoblenie a odštiepenie
    ex = np.minimum(fx % bw, bw - 1 - (fx % bw))
    ey = np.minimum(ys % bh, bh - 1 - (ys % bh))
    edge = np.minimum(ex, ey).astype(np.float64)
    bevel = sstep(0.0, 5.0, edge)
    tone = _hash(col % 4, row % 8, 79)
    tone2 = _hash(col % 4, row % 8, 83)
    grain = fbm(W, W, 160, 3, 89)
    mortar_n = fbm(W, W, 48, 3, 97)
    soot = sstep(0.72, 0.94, fbm(W, W, 5, 3, 101))
    moss = sstep(0.78, 0.95, fbm(W, W, 9, 3, 103))

    hf = np.where(brick, 0.55 + bevel * 0.25 + (grain - 0.5) * 0.10,
                  0.12 + (mortar_n - 0.5) * 0.12)
    # farba tehly: červenohnedá s variáciou, škvrny a pálenie
    base_r = 150.0 + tone * 34.0
    base_g = 74.0 + tone * 22.0
    base_b = 52.0 + tone * 14.0
    sp = (grain - 0.5) * 28.0 + (tone2 - 0.5) * 10.0
    r = np.where(brick, base_r + sp, 178.0 + (mortar_n - 0.5) * 16.0)
    g = np.where(brick, base_g + sp, 173.0 + (mortar_n - 0.5) * 16.0)
    b = np.where(brick, base_b + sp * 0.8, 162.0 + (mortar_n - 0.5) * 14.0)
    # tmavé jamky a odštiepené rohy
    chip = (value_noise(W, W, 256, 107) > 0.83) & (edge < 7)
    r = np.where(chip, r * 0.62, r)
    g = np.where(chip, g * 0.60, g)
    b = np.where(chip, b * 0.58, b)
    r -= soot * 26.0
    g -= soot * 24.0
    b -= soot * 20.0
    r = np.where(moss > 0.3, r * 0.78 + 22, r)
    g = np.where(moss > 0.3, g * 0.92 + 34, g)
    b = np.where(moss > 0.3, b * 0.70 + 12, b)
    # vnútro škáry je tmavšie (kontaktný tieň)
    r = np.where(brick, r, r - 18.0)
    g = np.where(brick, g, g - 18.0)
    b = np.where(brick, b, b - 16.0)
    img = match_luma(np.stack([r, g, b], axis=-1), 82.5)
    rough = np.where(brick, 0.86 + (grain - 0.5) * 0.07, 0.96)
    return img, normals_from_height(hf, 3.2), gray_map(np.clip(rough, 0.6, 0.99))


# =============================================================================
# DREVO / KÔRA
# =============================================================================
def gen_wood(W=512):
    fib = value_noise_aniso(W, W, 160, 12, 617)
    fib2 = value_noise_aniso(W, W, 48, 8, 619)
    knot = sstep(0.82, 0.97, fbm(W, W, 8, 3, 631))
    crack = 1.0 - sstep(0.02, 0.10, ridged(W, W, 24, 3, 641))
    grain = fbm(W, W, 192, 2, 643)
    moss = sstep(0.78, 0.94, fbm(W, W, 7, 3, 647))
    hf = fib * 0.45 + fib2 * 0.35 + grain * 0.15 + knot * 0.30 - crack * 0.45
    t = np.clip(fib * 1.3 + fib2 * 0.5 - 0.35, 0, 1)
    r = 92.0 + t * 58.0
    g = 64.0 + t * 44.0
    b = 42.0 + t * 28.0
    r -= knot * 38.0 + crack * 22.0
    g -= knot * 30.0 + crack * 20.0
    b -= knot * 18.0 + crack * 14.0
    r = np.where(moss > 0.25, r * 0.80 + 18, r)
    g = np.where(moss > 0.25, g * 0.94 + 32, g)
    b = np.where(moss > 0.25, b * 0.74 + 10, b)
    img = match_luma(np.stack([r, g, b], axis=-1), 93.5)
    return img, normals_from_height(hf, 2.0)


# =============================================================================
# ŠTRK / BALLAST
# =============================================================================
def gen_gravel(W=512):
    f1, f2, cid = worley(W, W, 46, 503)
    stone = sstep(0.16, 0.64, 1.0 - f1)
    gap = sstep(0.05, 0.30, f2 - f1) * (1.0 - stone)
    tone = _hash(cid % 46, cid // 46, 509)
    grit = fbm(W, W, 128, 3, 521)
    dust = fbm(W, W, 8, 3, 523)
    hf = stone * 0.80 + grit * 0.12 - gap * 0.30
    l = 80.0 + dust * 22.0 + stone * (26.0 + tone * 46.0) - gap * 30.0
    l += (grit - 0.5) * 14.0
    img = np.stack([l * 1.00, l * 0.985, l * 0.95], axis=-1)
    img = match_luma(img, 120.0)
    rough = 0.98 - stone * 0.16 + gap * 0.02
    return img, normals_from_height(hf, 2.8), gray_map(np.clip(rough, 0.65, 0.99))


# =============================================================================
# ŠKRIDLOVÁ STRECHA
# =============================================================================
def gen_roof_tile(W=1024):
    ROWS, COLS = 8, 8
    rh, cw = W // ROWS, W // COLS
    ys = np.arange(W)[:, None]
    xs = np.arange(W)[None, :]
    row = ys // rh
    off = (row % 2) * (cw // 2)
    fx = (xs + off) % W
    col = (fx // cw).astype(np.int64)
    xp = (fx % cw) / cw
    yp = (ys % rh) / rh
    tone = _hash(col % COLS, row % ROWS, 701)
    grain = fbm(W, W, 128, 3, 709)
    moss = sstep(0.76, 0.93, fbm(W, W, 6, 3, 719))
    soot = sstep(0.80, 0.95, fbm(W, W, 11, 3, 727))
    # profil S-škridlice: valec + prepad na okraji
    arc = np.sqrt(np.clip(1.0 - ((xp * 2 - 1) * 0.72) ** 2, 0, 1))
    step = sstep(0.0, 0.30, yp) * (1.0 - sstep(0.78, 1.0, yp))
    hf = arc * 0.60 + step * 0.30 + grain * 0.10
    l = 82.0 + arc * 58.0 + step * 30.0 + (grain - 0.5) * 22.0
    l *= 0.82 + tone * 0.34
    r = l * 1.02
    g = l * 0.55
    b = l * 0.40
    r = np.where(moss > 0.25, r * 0.80 + 18, r)
    g = np.where(moss > 0.25, g * 1.05 + 30, g)
    b = np.where(moss > 0.25, b * 0.72 + 10, b)
    r -= soot * 22.0; g -= soot * 20.0; b -= soot * 16.0
    img = match_luma(np.stack([r, g, b], axis=-1), 118.0)
    rough = 0.92 - (1.0 - arc) * 0.06 + moss * 0.05
    return img, normals_from_height(hf, 3.0), gray_map(np.clip(rough, 0.6, 0.99))


# =============================================================================
# DLÁŽDENIE CHODNÍKOV
# =============================================================================
def gen_pave(W=1024):
    N = 8
    pw = W // N
    ys = np.arange(W)[:, None]
    xs = np.arange(W)[None, :]
    row = ys // pw
    off = (row % 2) * (pw // 2)
    fx = (xs + off) % W
    col = (fx // pw).astype(np.int64)
    xp = (fx % pw) / pw
    yp = (ys % pw) / pw
    ej = np.minimum(np.minimum(xp, 1 - xp), np.minimum(yp, 1 - yp))
    joint = 1.0 - sstep(0.025, 0.075, ej)
    bevel = sstep(0.06, 0.18, ej)
    tone = _hash(col % N, row % N, 811)
    grain = fbm(W, W, 160, 3, 821)
    damp = sstep(0.62, 0.90, fbm(W, W, 4, 3, 853))
    moss = sstep(0.80, 0.95, fbm(W, W, 12, 3, 857))
    chip = (value_noise(W, W, 256, 859) > 0.88) & (ej < 0.16)
    hf = bevel * 0.30 - joint * 0.85 + grain * 0.10
    l = 158.0 + tone * 34.0 + (grain - 0.5) * 14.0 + bevel * 10.0
    l -= joint * 82.0 + damp * 42.0
    l = np.where(chip, l * 0.78, l)
    r = l * 1.00; g = l * 0.985; b = l * 0.955
    r = np.where(moss > 0.3, r * 0.80 + 18, r)
    g = np.where(moss > 0.3, g * 0.92 + 30, g)
    b = np.where(moss > 0.3, b * 0.72 + 10, b)
    img = match_luma(np.stack([r, g, b], axis=-1), 168.0)
    rough = 0.90 + tone * 0.05 + joint * 0.05 - damp * 0.08
    return img, normals_from_height(hf, 3.0), gray_map(np.clip(rough, 0.6, 0.99))


# =============================================================================
# DEKALTY: TIRE MARK + CROSSWALK
# =============================================================================
def gen_tiremark(W=512):
    cx = cz = W / 2
    ys, xs = np.mgrid[0:W, 0:W]
    r = np.sqrt((xs - cx) ** 2 + (ys - cz) ** 2) / W
    a = sstep(0.38, 0.02, r)
    for k in range(3):
        a += sstep(0.10, 0.36, np.abs(ys / W - 0.35 - k * 0.12)) * sstep(0.5, 0.85, r) * 0.5
    a += np.random.default_rng(77).random((W, W)) * 0.2 - 0.1
    out = np.zeros((W, W, 4), dtype=np.uint8)
    out[..., 0] = 240
    out[..., 1] = 235
    out[..., 2] = 218
    out[..., 3] = np.clip(a, 0, 1) * 255
    return out


def gen_crosswalk(W=512):
    out = np.zeros((W, W, 4), dtype=np.uint8)
    out[..., 0] = 250
    out[..., 1] = 246
    out[..., 2] = 234
    v = np.repeat(np.linspace(0, 1, W)[:, None], W, axis=1)
    a = np.zeros((W, W))
    for c in [0.06 + i * 0.145 for i in range(7)]:
        band = (v > c - 0.09) & (v < c + 0.09)
        a[band] = np.maximum(a[band], 1.0)
    # opotrebované okraje: jemný šum v alfe
    a *= 0.93 + 0.07 * fbm(W, W, 96, 2, 311)
    out[..., 3] = np.clip(a, 0, 1) * 255
    return out


# =============================================================================
# ZÁHONY / TRSTINY (alfa sprite)
# =============================================================================
def gen_shrubs(W=512):
    SS = 2  # supersampling
    S = W * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    rng = np.random.default_rng(1234)
    ybase = int(S * 0.72)
    clumps = [(0.25, 0.62, 0.34), (0.52, 0.84, 0.38), (0.78, 0.68, 0.32)]
    for ci, (cx, hmax, spread) in enumerate(clumps):
        x0 = S * cx
        for b in range(46):
            t = rng.random()
            top = ybase - S * hmax * (0.55 + t * 0.55)
            x1 = x0 + (rng.random() - 0.5) * S * spread
            x2 = x0 + (rng.random() - 0.5) * S * spread * 0.9
            w = max(1, int(S * (0.004 + rng.random() * 0.006)))
            shade = 0.55 + rng.random() * 0.45
            col = (int(54 * shade + 20), int(82 * shade + 22), int(38 * shade + 12), 255)
            d.line([(x0 + (rng.random() - 0.5) * S * 0.10, ybase),
                    (x2, top + S * 0.05), (x1, top)], fill=col, width=w)
        # klasy / kvety
        for f in range(7):
            fx = x0 + (rng.random() - 0.5) * S * spread * 0.8
            fy = ybase - S * hmax * (0.72 + rng.random() * 0.35)
            r = S * (0.006 + rng.random() * 0.006)
            col = [(206, 174, 48, 255), (238, 232, 210, 255), (170, 34, 44, 255)][f % 3]
            d.ellipse([fx - r, fy - r, fx + r, fy + r], fill=col)
    # malé trsy pri zemi
    for k in range(40):
        fx = rng.uniform(S * 0.08, S * 0.92)
        fy = ybase + rng.uniform(-S * 0.02, S * 0.06)
        r = S * rng.uniform(0.008, 0.02)
        d.ellipse([fx - r, fy - r, fx + r, fy + r], fill=(40, 62, 30, 255))
    img = img.resize((W, W), Image.LANCZOS)
    return np.asarray(img)


# =============================================================================
# MAIN
# =============================================================================
def main():
    for sub in ("road", "terrain", "buildings", "veg"):
        os.makedirs(os.path.join(A, sub), exist_ok=True)

    print("== asfalt ==")
    dif, nrm, rgh = gen_asphalt(1024)
    save_jpg(dif, "road/asphalt_diffuse.jpg")
    save_nrm(nrm, "road/asphalt_normal.jpg")
    save_rgh(rgh, "road/asphalt_roughness.jpg")
    print("  luma:", round(luma(os.path.join(A, "road/asphalt_diffuse.jpg")), 1), "(cieľ 61)")

    print("== dlažba ==")
    dif, nrm, rgh = gen_pave(1024)
    save_jpg(dif, "road/pave_diffuse.jpg")
    save_nrm(nrm, "road/pave_normal.jpg")
    save_rgh(rgh, "road/pave_roughness.jpg")

    print("== dekality ==")
    save_png(gen_tiremark(512), "road/tiremark.png")
    save_png(gen_crosswalk(512), "road/crosswalk.png")

    print("== tráva ==")
    dif, nrm, rgh = gen_grass(1024)
    save_jpg(dif, "terrain/grass_diffuse.jpg")
    save_nrm(nrm, "terrain/terrain_normal.jpg")
    save_rgh(rgh, "terrain/grass_roughness.jpg")
    print("  luma:", round(luma(os.path.join(A, "terrain/grass_diffuse.jpg")), 1), "(cieľ 81)")

    print("== hlina ==")
    dif, nrm, rgh = gen_dirt(1024)
    save_jpg(dif, "terrain/dirt_diffuse.jpg")
    save_nrm(nrm, "terrain/dirt_normal.jpg")
    save_rgh(rgh, "terrain/dirt_roughness.jpg")
    print("  luma:", round(luma(os.path.join(A, "terrain/dirt_diffuse.jpg")), 1), "(cieľ 77,7)")

    print("== betón ==")
    dif, nrm, rgh = gen_concrete(1024)
    save_jpg(dif, "buildings/concrete_diffuse.jpg")
    save_nrm(nrm, "buildings/concrete_normal.jpg")
    save_rgh(rgh, "buildings/concrete_roughness.jpg")
    print("  luma:", round(luma(os.path.join(A, "buildings/concrete_diffuse.jpg")), 1), "(cieľ 165)")

    print("== tehla ==")
    dif, nrm, rgh = gen_brick(1024)
    save_jpg(dif, "buildings/brick.jpg")
    save_nrm(nrm, "buildings/brick_normal.jpg")
    save_rgh(rgh, "buildings/brick_roughness.jpg")
    print("  luma:", round(luma(os.path.join(A, "buildings/brick.jpg")), 1), "(cieľ 82,5)")

    print("== drevo ==")
    dif, nrm = gen_wood(512)
    save_png(dif, "buildings/wood.png")
    save_nrm(nrm, "buildings/wood_normal.jpg")

    print("== štrk ==")
    dif, nrm, rgh = gen_gravel(512)
    save_jpg(dif, "buildings/gravel.jpg")
    save_nrm(nrm, "buildings/gravel_normal.jpg")
    save_rgh(rgh, "buildings/gravel_roughness.jpg")
    print("  luma:", round(luma(os.path.join(A, "buildings/gravel.jpg")), 1), "(cieľ 120)")

    print("== škridla ==")
    dif, nrm, rgh = gen_roof_tile(1024)
    save_jpg(dif, "buildings/roof_tile.jpg")
    save_nrm(nrm, "buildings/roof_tile_normal.jpg")
    save_rgh(rgh, "buildings/roof_tile_roughness.jpg")

    print("== záhony ==")
    save_png(gen_shrubs(512), "veg/shrubs.png")

    print("done")


if __name__ == "__main__":
    main()
