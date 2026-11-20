#!/usr/bin/env python3
"""
tools/gen_gta_textures.py — GTA SA–štýlové textúry (idempotentné, do assets/).

Generuje výstup (všetky idempotentné):

  road/asphalt_diffuse.jpg    — kamenný asfalt, trhliny, zrno, opotrebovanie
  road/asphalt_normal.png     — normálová mapa z výškového poľa (štýl JS fAsphalt)
  road/asphalt_roughness.png  — drsnosť asfaltu
  road/tiremark.png           — opotrebovanie pneuma (tiek s radiacou alfa)
  road/crosswalk.png           — zeb1972? no — biela štrajkpolia crosswalku
  terrain/grass_diffuse.jpg   — trávnik s kvetináčmi a trstinami (GTA SA)
  terrain/dirt_diffuse.png    — prirodzená hlina s tire tracks
  buildings/brick.jpg         — tehla s mortarem + múchová patina
  buildings/concrete_diffuse.jpg — betónové podlahy (trhliny, plyny)
  veg/shrubs.png              — sprite: trstiny + kvetináče (GTA SA zahradka)
  skybox/sky.jpg              — GTA SA denná obloha (gradients + slnko + mliekom)

Periódický šum je vektorizovaná podoba z `src/world/textures.js` (thash/tval/fbm/ridge)
bez b lesions.
"""
import os

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A = os.path.join(ROOT, "assets", "textures")   # vÅ¡etky difuznÃ©/normal/roughness textÃºry
SKYBOX = os.path.join(ROOT, "assets", "skybox")  # dennÃ¡ obloha (sky.jpg) — kde ho naÄÃ­ta sky.js


# =============================================================================
# PERIÓDICKÝ ŠUM — vektorizovaná podoba thash/tval/tfbm/tridge z textures.js
# =============================================================================
def thash_vec(ix, iy, seed):
    """Hash kubice -> [0,1]. Vektorizovaná verzia textures.js `thash`."""
    h = (ix * 374761393 + iy * 668265263 + seed * 2246822519) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return (h ^ (h >> 16)).astype(np.float64) / 2.0 ** 32


def tval_vec(x, y, seed):
    """Perličkový prechod v texelových súradniciach — kopír presnej tvar."""
    xi = np.floor(x).astype(np.int64)
    yi = np.floor(y).astype(np.int64)
    xf = x - xi
    yf = y - yi
    u = xf * xf * (3 - 2 * xf)
    v = yf * yf * (3 - 2 * yf)
    a = thash_vec(xi, yi, seed)
    b = thash_vec(xi + 1, yi, seed)
    c = thash_vec(xi, yi + 1, seed)
    d = thash_vec(xi + 1, yi + 1, seed)
    ab = a + (b - a) * u
    cd = c + (d - c) * u
    return ab + (cd - ab) * v


def fbm_vec(W, H, oct, seed):
    out = np.zeros((H, W))
    a = 1.0
    nrm = 0.0
    c = 16.0
    for o in range(oct):
        out += a * tval_vec(np.arange(W)[None, :] * c, np.arange(H)[:, None] * c, seed + o * 101)
        nrm += a
        a *= 0.5
        c *= 2
    return out / nrm


def ridge_vec(W, H, oct, seed):
    out = np.zeros((H, W))
    a = 1.0
    nrm = 0.0
    c = 16.0
    for o in range(oct):
        v = tval_vec(np.arange(W)[None, :] * c, np.arange(H)[:, None] * c, seed + o * 211)
        out += a * (1 - np.abs(2 * v - 1))
        nrm += a
        a *= 0.5
        c *= 2
    return out / nrm


def sstep(a, b, t):
    t = np.clip((t - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def paint_ellipse(arr, cx, cz, rx, ry, color, blend):
    """Nakreslí elipsu do float poľa arr[z, x]; blend blenduje nahor over arr."""
    x0 = max(0, int(np.floor(cx - rx)))
    x1 = min(arr.shape[1], int(np.ceil(cx + rx)))
    z0 = max(0, int(np.floor(cz - ry)))
    z1 = min(arr.shape[0], int(np.ceil(cz + ry)))
    if x1 <= x0 or z1 <= z0:
        return
    xs, zs = np.mgrid[z0:z1, x0:x1]
    nx = (xs - cx) / rx
    nz = (zs - cz) / ry
    d = np.sqrt(nx * nx + nz * nz)
    m = np.clip(1.0 - d, 0, 1)
    m = m * m * (3 - 2 * m)
    arr[z0:z1, x0:x1] = arr[z0:z1, x0:x1] + (color - arr[z0:z1, x0:x1]) * m[..., None] * blend


def normals_from_height(hf, strength):
    """Tangent-space normálová mapa — rovnaká konvencia ako textures.js normalCanvas
    (R/G menšie, B≈1 = štandardné three.js tangent-space)."""
    xm = np.roll(hf, 1, axis=1)
    xp = np.roll(hf, -1, axis=1)
    ym = np.roll(hf, 1, axis=0)
    yp = np.roll(hf, -1, axis=0)
    nx = (xm - xp) * strength
    ny = (ym - yp) * strength
    inv = 1.0 / np.sqrt(nx * nx + ny * ny + 1.0)
    R = (nx * inv * 0.5 + 0.5) * 255
    G = (ny * inv * 0.5 + 0.5) * 255
    B = (inv * 0.5 + 0.5) * 255
    return np.clip(np.stack([R, G, B], axis=-1), 0, 255).astype(np.uint8)


def save_jpg(arr, path, quality=90):
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB").save(path, "JPEG", quality=quality)


def save_png(arr, path):
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA" if arr.shape[2] == 4 else "RGB").save(path)


def luma(path):
    im = Image.open(path).convert("RGB")
    a = np.asarray(im, dtype=np.float64)
    return float((0.2126 * a[:, :, 0] + 0.7152 * a[:, :, 1] + 0.0722 * a[:, :, 2]).mean())


# =============================================================================
# ASPHALT — GTA SA: kamenný asfalt, trhliny, zrno, opotrebovanie, tire tread
# =============================================================================
def asphalt_base(W):
    col = np.full((W, W, 3), 61.0)
    col += fbm_vec(W, W, 3, 11)[..., None] * 5.0
    col += np.random.default_rng(9).random((W, W, 3)) * 4 - 2
    col += sstep(0.55, 0.82, fbm_vec(W, W, 2, 47))[..., None] * 18
    col += (sstep(0.55, 0.75, fbm_vec(W, W, 4, 17)) - 0.5)[..., None] * 5
    crack = 1 - sstep(0.02, 0.14, ridge_vec(W, W, 3, 83))
    col -= crack[..., None] * 4
    col -= sstep(0.66, 0.88, fbm_vec(W, W, 3, 131))[..., None] * 9
    col += (sstep(0.6, 0.8, fbm_vec(W, W, 3, 27)) - 0.5)[..., None] * 3
    # tire marks: krátke svetlé výstupky od pneumatík (GTA SA)
    rng = np.random.default_rng(42)
    for i in range(6):
        cx = rng.integers(8, W - 8)
        cz = rng.integers(8, W - 8)
        ang = rng.uniform(0, 2 * np.pi)
        L = rng.uniform(6, 10)
        dx, dz = np.cos(ang) * L, np.sin(ang) * L
        paint_ellipse(col, cx + dx / 2, cz + dz / 2, np.hypot(L / 2, 2.0), 2.0,
                      np.array([235., 210., 175.]), 0.55)
    # tire tread: jemné verticalne nádymy (oproti smere jazdy, 1 z rád by nemala byť pravidelná)
    rng_t = np.random.default_rng(3)
    for i in range(3, W, 9):
        col[:, i:i + 2] += 2 + rng_t.uniform(-1, 1)
    # sparkle kamienkami
    rng2 = np.random.default_rng(5)
    col += (rng2.random((W, W, 3)) < 0.004) * (np.array([12., 12., 12.]) + rng2.random((W, W, 3)) * 6)
    return np.clip(col, 0, 255)


def gen_asphalt_diffuse(W=512):
    return asphalt_base(W)


def gen_asphalt_normal(W=512):
    f = fbm_vec(W, W, 3, 11)
    hf = f * 6.0 + np.random.default_rng(9).random((W, W)) * 4 - 2
    hf += sstep(0.55, 0.82, fbm_vec(W, W, 2, 47)) * 18
    hf += (sstep(0.55, 0.75, fbm_vec(W, W, 4, 17)) - 0.5) * 5
    crack = 1 - sstep(0.02, 0.14, ridge_vec(W, W, 3, 83))
    hf -= crack * 5
    hf -= sstep(0.66, 0.88, fbm_vec(W, W, 3, 131)) * 2.2
    for i in range(3, W, 9):
        hf[:, i:i + 2] += 1.5
    return normals_from_height(hf / 12.0, 1.0)


def gen_asphalt_roughness(W=512):
    crack = 1 - sstep(0.02, 0.14, ridge_vec(W, W, 3, 83))
    stone = sstep(0.55, 0.82, fbm_vec(W, W, 2, 47))
    r = np.full((W, W), 0.79)
    r -= crack * 0.30
    r -= sstep(0.66, 0.88, fbm_vec(W, W, 3, 131)) * 0.12
    r += stone * 0.04
    r += (crack > 0.5) * 0.05
    r = np.clip(r, 0.35, 0.95) * 255
    return np.stack([r, r, r], axis=-1)


# =============================================================================
# TIRE MARK — opotrebovanie pneuma (tiek s radiacou alfa, GTA SA)
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
    out[..., 3] = np.clip(a * 1.0, 0, 1) * 255
    return out


# =============================================================================
# CROSSWALK — biely crosswalk (štrajky perpendikulárne na cestu)
# =============================================================================
def gen_crosswalk(W=512):
    out = np.zeros((W, W, 4), dtype=np.uint8)
    out[..., 0] = 250
    out[..., 1] = 246
    out[..., 2] = 234
    r = np.repeat(np.linspace(0, 1, W)[:, None], W, axis=1)
    a = np.zeros((W, W))
    for c in [0.06 + i * 0.145 for i in range(7)]:
        band = (r > c - 0.09) & (r < c + 0.09)
        a[band] = np.maximum(a[band], 1.0)
    out[..., 3] = np.clip(a * 0.93 + 0.02, 0, 1) * 255
    return out


# =============================================================================
# GRASS — trávnik, kvetináče, trstinami (GTA SA)
# =============================================================================
def gen_grass_diffuse(W=1024):
    rng = np.random.default_rng(7)
    out = np.full((W, W, 3), (70.0, 88.0, 50.0))
    out += rng.uniform(-8, 8, (W, W, 3))
    # kvetináče
    n = 0
    for y in range(8, W, 8):
        for x in range(8, W, 8):
            seed = 60000 + (x // 16) + (y // 16) * 32
            if thash_vec(np.int64(x), np.int64(y), seed).item() < 0.025:
                col = {0: np.array([238., 234., 218.]),
                       1: np.array([212., 184., 48.]),
                       2: np.array([170., 32., 34.]),
                       3: np.array([105., 122., 160.])}[(x * 7 + y * 13) % 4] + rng.uniform(-2, 2, 3)
                paint_ellipse(out, x, y, 1.2, 1.2, col, 0.8)
                n += 1
    # trstiny
    smoke = sstep(0.55, 0.92, fbm_vec(W, W, 4, 5))
    for cy in range(32, W, 32):
        for cx in range(32, W, 32):
            m = smoke[cy, cx]
            if m < 0.3:
                continue
            r = 40 + m * 50
            paint_ellipse(out, cx, cy, r, r * 0.75, np.array([46., 60., 34.]), 0.6 + m * 0.3)
            n += 1
    # holé pôdok
    bare = sstep(0.82, 0.95, fbm_vec(W, W, 4, 97))
    out += bare[..., None] * np.array([-12., -14., -12.])
    return np.clip(out, 0, 255)


# =============================================================================
# DIRT — prirodzená hlina, tire tracks, vedra
# =============================================================================
def gen_dirt_diffuse(W=512):
    out = np.full((W, W, 3), (98.0, 74.0, 54.0))
    out += np.random.default_rng(31).random((W, W, 3)) * 8 - 4
    rng = np.random.default_rng(33)
    for i in range(6):
        x0 = rng.uniform(4, W - 4)
        z0 = rng.uniform(4, W - 4)
        ang = rng.uniform(0, 2 * np.pi)
        L = 30 + rng.uniform(0, 10)
        paint_ellipse(out, x0 + np.cos(ang) * L / 2, z0 + np.sin(ang) * L / 2,
                      L / 2 + 1, 1.4, np.array([190., 172., 145.]), 0.55)
    cr = ridge_vec(W, W, 3, 91)
    out -= sstep(0.03, 0.15, cr)[..., None] * 7
    for y in range(8, W, 8):
        for x in range(8, W, 8):
            seed = 70000 + (x // 16) + (y // 16) * 32
            if thash_vec(np.int64(x), np.int64(y), seed).item() < 0.045:
                j = rng.uniform(-6, 6, 3)
                paint_ellipse(out, x, y, 1.2, 1.2, np.array([94., 74., 54.]) + j, 0.7)
    return np.clip(out, 0, 255)


# =============================================================================
# BRICK — GTA SA: tehly, morte, múchová patina
# =============================================================================
def gen_brick_diffuse(W=512):
    bw = W // 4
    bh = W // 8
    rng = np.random.default_rng(77)
    out = np.zeros((W, W, 3))
    for y in range(W):
        row = y // bh
        fx = (np.arange(W) + (row % 2) * bw * 0.5) % W
        in_row = (y % bh) < bh * 0.80
        in_col = (fx % bw) < bw * 0.86
        mot = ~(in_row & in_col)
        bid = (row * 17 + (fx // bw).astype(int) * 29) % 5
        j = rng.uniform(-10, 10, W)
        tone = 0.78 + bid * 0.07
        brick_color = np.stack([128 * tone + j, 58 * tone + j, 40 * tone + j], axis=-1) * 0.79
        out[y, mot] = np.array([176., 172., 162.]) + rng.uniform(-6, 6, 3)
        out[y, ~mot] = brick_color[~mot]
    # múchová patina na horných okrajoch tehlov
    rng2 = np.random.default_rng(99)
    for y in range(0, W, 4):
        mossy = rng2.random(W) < 0.05
        if not mossy.any():
            continue
        mot = (y % bh) >= bh * 0.80
        cols = np.logical_and(mossy, np.logical_not(mot))
        out[y, cols] = np.array([106., 126., 66.]) + rng2.uniform(-4, 4, 3)
    return np.clip(out, 0, 255)


# =============================================================================
# CONCRETE — betónové podlahy (trhlinky, plyny, piliny)
# =============================================================================
def gen_concrete_diffuse(W=1024):
    out = np.full((W, W, 3), (175., 168., 158.))
    out += np.random.default_rng(13).random((W, W, 3)) * 10 - 5
    out -= sstep(0.03, 0.16, ridge_vec(W, W, 3, 59))[..., None] * 8
    out -= sstep(0.8, 0.95, fbm_vec(W, W, 2, 67))[..., None] * 12
    out -= sstep(0.62, 0.78, fbm_vec(W, W, 2, 71))[..., None] * 6
    out += (sstep(0.6, 0.8, fbm_vec(W, W, 2, 73)) - 0.5)[..., None] * 5
    return np.clip(out, 0, 255)


# =============================================================================
# SHRUBS — GTA SA štýlové zahradky: trstiny + kvetináče (sprite)
# =============================================================================
def gen_shrubs(W=512):
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    rng = np.random.default_rng(1234)

    def stalk(x, y0, y1, bw, color):
        # trstina: vertikálna tesaňa od základu (y0, hlbšie) po vrchol (y1, vyše)
        for y in range(y1, y0):
            t = (y0 - y) / max(1, (y0 - y1))
            w = max(1, int(bw * t))
            d.rectangle([x - w // 2, y, x + w // 2, y + 1], fill=color)

    ybase = int(W * 0.65)
    for i, x in enumerate([W * 0.25, W * 0.5, W * 0.75]):
        x = int(x + rng.uniform(-6, 6))
        top = int(W * 0.14 + i * W * 0.13 + rng.uniform(-3, 3))
        bw = int(W * 0.045 * rng.uniform(0.8, 1.4))
        color = tuple(int(v) for v in (52 + rng.uniform(-4, 4), 66 + rng.uniform(-4, 4), 30 + rng.uniform(-4, 4)))
        stalk(x, ybase, top, bw, color)
        # svetlý vrchol trstiny
        d.ellipse([x - bw // 2 - 1, top - 2, x + bw // 2 + 1, top + 2],
                  fill=tuple(int(v) for v in (78 + rng.uniform(-4, 4), 96 + rng.uniform(-4, 4), 44 + rng.uniform(-4, 4))))
        # kvetináč na vrchu trstiny: žlté súknečky + bielý stonka
        for j in range(4):
            yy = top - 5 - j * 4
            d.ellipse([x - 2, yy - 2, x + 2, yy + 2],
                      fill=tuple(int(v) for v in (200 + rng.uniform(-8, 8), 160 + rng.uniform(-8, 8), 40 + rng.uniform(-8, 8))))
            d.ellipse([x - 2, yy - 5, x + 2, yy - 1],
                      fill=tuple(int(v) for v in (238 + rng.uniform(-5, 5), 232 + rng.uniform(-5, 5), 206 + rng.uniform(-5, 5))))
    # malé kvety okolo (celý sprite)
    for _ in range(16):
        x, y = int(rng.uniform(8, W - 8)), int(rng.uniform(20, W - 8))
        col = [(220, 180, 45), (238, 232, 215), (170, 30, 40)][rng.integers(0, 3)]
        d.ellipse([x - 2, y - 2, x + 2, y + 2], fill=col)
    return np.asarray(img)


# =============================================================================
# SKY — GTA SA denná obloha (gradients + slnko + mliekom)
# =============================================================================
def gen_sky(W=1024, H=600):
    zen = np.array([0x88, 0xba, 0xe6], dtype=np.float64)   # svetlá zelenkastá tón
    hor = np.array([0xf6, 0xec, 0xd2], dtype=np.float64)   # pale, warm horizon
    white = np.array([1.05, 1.02, 0.95])
    vh = np.linspace(0, 1, H)[:, None] * np.ones((1, W))   # (H, W): 0 = vrch, 1 = povrch
    t = sstep(0.30, 0.60, vh)
    img = zen[None, None] * (1 - t[..., None]) + hor[None, None] * t[..., None]
    for (c0, c1, a) in [(0.55, 0.62, 0.28), (0.62, 0.70, 0.30), (0.70, 0.78, 0.22)]:
        m = sstep(c0 - 0.02, c1 + 0.02, vh)[..., None]
        img = img * (1 - m * a) + white[None, None] * m * a
    u = 0.58
    for (ru, rv, alpha) in [(0.035, 0.18, 0.90), (0.055, 0.11, 0.35), (0.07, 0.05, 0.15)]:
        dx = (np.linspace(0, 1, W)[None, :] - u) / ru
        dy = (vh - rv) / rv
        m = (np.sqrt(dx * dx + dy * dy) < 1) * alpha
        img = img + white[None, None] * m[..., None]
    return np.clip(img, 0, 255).astype(np.uint8)


# =============================================================================
# MAIN
# =============================================================================
def main():
    for sub in ("road", "terrain", "buildings", "veg"):
        os.makedirs(os.path.join(A, sub), exist_ok=True)
    os.makedirs(SKYBOX, exist_ok=True)

    print("== asphalt ==")
    save_jpg(gen_asphalt_diffuse(512), os.path.join(A, "road/asphalt_diffuse.jpg"))
    save_png(gen_asphalt_normal(512), os.path.join(A, "road/asphalt_normal.png"))
    save_png(gen_asphalt_roughness(512), os.path.join(A, "road/asphalt_roughness.png"))
    print("  diffuse luma:", round(luma(os.path.join(A, "road/asphalt_diffuse.jpg")), 1), "(target 61)")
    im = np.asarray(Image.open(os.path.join(A, "road/asphalt_normal.png")))
    print("  normal B mean:", round(im[..., 2].mean(), 1), " sat:", round(im[..., 0].astype(int).max() - im[..., 0].astype(int).min(), 0))

    print("== tiremark / crosswalk ==")
    save_png(gen_tiremark(512), os.path.join(A, "road/tiremark.png"))
    save_png(gen_crosswalk(512), os.path.join(A, "road/crosswalk.png"))

    print("== grass ==")
    save_jpg(gen_grass_diffuse(1024), os.path.join(A, "terrain/grass_diffuse.jpg"))
    print("  diffuse luma:", round(luma(os.path.join(A, "terrain/grass_diffuse.jpg")), 1), "(target 81)")

    print("== dirt ==")
    save_png(gen_dirt_diffuse(512), os.path.join(A, "terrain/dirt_diffuse.png"))
    print("  diffuse luma:", round(luma(os.path.join(A, "terrain/dirt_diffuse.png")), 1), "(target 77.7)")

    print("== brick ==")
    save_jpg(gen_brick_diffuse(512), os.path.join(A, "buildings/brick.jpg"))
    print("  diffuse luma:", round(luma(os.path.join(A, "buildings/brick.jpg")), 1), "(target 82.5)")

    print("== concrete ==")
    save_jpg(gen_concrete_diffuse(1024), os.path.join(A, "buildings/concrete_diffuse.jpg"))
    print("  diffuse luma:", round(luma(os.path.join(A, "buildings/concrete_diffuse.jpg")), 1), "(target ~165)")

    print("== shrubs ==")
    save_png(gen_shrubs(512), os.path.join(A, "veg/shrubs.png"))

    print("== sky ==")
    save_jpg(gen_sky(1024, 600), os.path.join(SKYBOX, "sky.jpg"))

    print("done")


if __name__ == "__main__":
    main()
