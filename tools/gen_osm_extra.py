#!/usr/bin/env python3
"""
tools/gen_osm_extra.py — znovu vyrobí OSM vrstvy, ktoré sa dnes nesú v repote.

Problém
-------
1) `public/data/mapData.json` je GENEROVANÝ z monolit index.html a pri kazdom
   `npm run build` sa prepise (prebuild -> extract-monolith.py). Vsetko, co do
   neho pridame, by zmizlo. Preto nové vrstvy idú do VLASTNEHO suboru
   `public/data/osmExtra.json`, ktory sa prepise IBA tymto skriptom.

2) Z monolitovych dat ma baza 3 109 budov, ale samotny OSM export ich ma 5 693
   (a vsetky su vovnutra mapy). Chybajuca cast je hlavne import adres
   `minvskaddress` z roku 2023 - rodinne domy a garaze na juhu mesta, takze
   polovica sídliska v mape nemala STREchu.

3) `VEG_DATA` v src/world/nature.js je bol 125 kB literál na jednom riadku a
   NEMAL generator - nedalo sa ho znovu vyrobit, len opraviť. Tento skript je
   ten chýbajúci generator. Navyše pridá triedu `T` = skutočne zmapované stromy
   (`natural=tree`), ktoré sa doteraz vôbec nekreslili.

4) Elevacne body `elev` v mape obsahuju `Hlohovec, Urbánek 242 m`, ktorej v novom
   OSM uz nie je (a bol to jediny vysoký bod, co drzal kopec). Doplnia sa
   vsetky sucasne `ele` uzly.

Zaklad (body mimo pokrytia exportu)
------------------------------------
Export ma iny bounding box nez hra: pokriva x -2568..980, z -3057..323, ale mapa
saha na x -2874..1634, z -3104..1163 a trasa misie konci az na x=-2570. Cez
medzeru by sa z exportu stratilo ~1 600 stromov a nejakych budov. Preto skript
zachova vsetky body ZAKLADOVYCH dat, ktore lezia MIMO pokrytia exportu, a
prepisuje len to, co export naozaj obsahuje. Vysledok je vzdy nadmnozina.

Pouzitie:
    python3 tools/gen_osm_extra.py                      # ~/Downloads/map(3).osm
    python3 tools/gen_osm_extra.py --osm /path/to.osm
    python3 tools/gen_osm_extra.py --min-area 5 --seed 20260927

Vstup:  OSM XML (.osm), public/data/mapData.json, src/world/nature.js (VEG_DATA)
Vystup: public/data/osmExtra.json
"""
import argparse
import json
import math
import os
import re
import sys
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "data", "osmExtra.json")

# ---------- projekcia OSM -> svet (musi sediet s height.js a mapData.js) ----------
LON0, LAT0 = 17.8136414, 48.4212428
LONM, LATM = 73876.98, 110539.70

# Vyska budovy: height= tag > building:levels*3.2 > tabulka podla tagu.
# Tabulka je vypisana z dat (zhoda 2 614 sparovanych budov), nie odhadnuta.
LEVEL_M = 3.2
TAG_H = {
    "apartments": 18.0, "church": 10.0, "commercial": 9.0, "detached": 6.0,
    "garage": 3.2, "garages": 3.2, "government": 7.0, "greenhouse": 7.0,
    "guardhouse": 7.0, "industrial": 8.0, "kindergarten": 7.0, "retail": 8.0,
    "roof": 4.0, "school": 9.0, "service": 7.0, "shed": 3.0, "house": 6.0,
    "hut": 6.0, "barn": 7.0, "farm": 7.0, "sports_centre": 7.0, "stadium": 7.0,
    "warehouse": 8.0, "train_station": 7.0, "carport": 3.0, "stable": 3.0,
    "cattle_dairy": 7.0, "storage_tank": 3.0, "cabin": 6.0, "dormitory": 7.0,
    "college": 9.0, "university": 9.0, "hospital": 9.0, "cemetery": 3.0,
}
DEFAULT_H = 7.0

# Rozpoctet na vegetaciu. Rozhodujuca nie je plocha polygonu (luka ma 3,2 km2
# a les 1,9 km2, ale viditelne su hlavne parky a ulice v meste), ale to, kam
# bod potrebujeme. Preto je kazdej skupine priradeny POVOLENY POCET bodov a
# hustota sa z neho odvodi: dens = plocha / kvota. Bez tohto by cap obsadil
# prvy polygon v poradi a mesto by ostalo holé.
# triedy: A listnaty, B ihlicnan, C ker
BUDGET = {
    "forest": (1600, 900, 0),      # lesy a lesiky (najvacsi kontrast, ale daleko)
    "park": (2000, 120, 400),      # parky, zahrady, cintoriny - NAJMENEJ vidiet v meste
    "grass": (600, 0, 320),        # luzy a travnati - na takom plocho m2 stromy nie su
    "scrub": (0, 0, 280),          # kroviny, vinohrady, zahradky
}
BANK_QUOTA = 450                  # kroviny v okoli koryta Vacahu (pocet)
AVE_STEP = 19.0               # rozostup aleje po ulici (m)
AVE_OFF = 6.2                 # odsadenie od osi (m)
AVE_MIN_W = 5.0               # len ulice sirsie ako 5 m
BANK_DIST = 170.0             # kroviny v okoli Vacahu
# t bezpecnostna poistka (veduc k to, aby trieda nikdy neprekrocila CAP)
CAP = {"A": 6000, "B": 2400, "C": 2600, "AVE": 900}


def wx(lon):
    return (lon - LON0) * LONM


def wz(lat):
    return -(lat - LAT0) * LATM


def tags(el):
    return {t.get("k"): t.get("v") for t in el.findall("tag")}


def area(P):
    s = 0.0
    for i in range(len(P)):
        x1, z1 = P[i]
        x2, z2 = P[(i + 1) % len(P)]
        s += x1 * z2 - x2 * z1
    return abs(s) * 0.5


def bbox(P):
    xs = [p[0] for p in P]
    zs = [p[1] for p in P]
    return min(xs), min(zs), max(xs), max(zs)


def parse(path):
    print("parujem %s (%.1f MB)..." % (path, os.path.getsize(path) / 1048576.0))
    r = ET.parse(path).getroot()
    nodes = {}
    for n in r.findall("node"):
        try:
            nodes[n.get("id")] = (float(n.get("lat")), float(n.get("lon")))
        except (TypeError, ValueError):
            pass
    b = r.find("bounds")
    cov = None
    if b is not None:
        cov = (wx(float(b.get("minlon"))), wz(float(b.get("maxlat"))),
               wx(float(b.get("maxlon"))), wz(float(b.get("minlat"))))
        print("pokrytie exportu: x %.0f..%.0f  z %.0f..%.0f" % (cov[0], cov[2], cov[1], cov[3]))
    ways, rels = {}, {}
    for w in r.findall("way"):
        ways[w.get("id")] = ([x.get("ref") for x in w.findall("nd")], tags(w))
    for m in r.findall("relation"):
        rels[m.get("id")] = ([(x.get("ref"), x.get("role")) for x in m.findall("member")],
                             tags(m))
    print("uzly %d, cesty %d, relacie %d" % (len(nodes), len(ways), len(rels)))
    return nodes, ways, rels, cov


def ring(nodes, refs):
    P = []
    for q in refs:
        if q not in nodes:
            return None
        la, lo = nodes[q]
        P.append((wx(lo), wz(la)))
    return P


def polys_of(nodes, ways, rels, way_ids):
    """Z way_id zoznamu vrati zoznam uzavretych kruznic (outer + holes)."""
    out = []
    for wid in way_ids:
        refs, _ = ways.get(wid, ([], {}))
        P = ring(nodes, refs)
        if P and len(P) >= 3:
            if P[0] == P[-1]:
                P = P[:-1]
            if len(P) >= 3:
                out.append(P)
    return out


def load_dem():
    """Nadmoce vysky z assets/terrain/hlohovec_dem.png (R=high, G=low byte)."""
    mp = os.path.join(ROOT, "assets", "terrain", "hlohovec_dem.png")
    jp = os.path.join(ROOT, "assets", "terrain", "hlohovec_dem.json")
    if not (os.path.exists(mp) and os.path.exists(jp)):
        print("  (DEM chýba — voda sa nedá overiť, beriem water[] zo základu)")
        return None
    try:
        from PIL import Image
    except ImportError:
        return None
    import numpy as np
    meta = json.load(open(jp, encoding="utf-8"))
    a = np.asarray(Image.open(mp)).astype(np.int64)
    g = meta["base"] + (a[..., 0] * 256 + a[..., 1]) * meta["scale"] - meta.get("datum", 130.2)
    return {"g": g, "bbox": meta["bbox"], "w": meta["w"]}


def dem_at(dem, x, z):
    g, bb = dem["g"], dem["bbox"]
    w = dem["w"]
    cw = (bb[2] - bb[0]) / (w - 1)
    cd = (bb[3] - bb[1]) / (w - 1)
    fx = min(max((x - bb[0]) / cw, 0), w - 1.001)
    fz = min(max((z - bb[1]) / cd, 0), w - 1.001)
    ix, iz = int(fx), int(fz)
    u, v = fx - ix, fz - iz
    return (float(g[iz, ix]) * (1 - u) + float(g[iz, ix + 1]) * u) * (1 - v) + \
           (float(g[iz + 1, ix]) * (1 - u) + float(g[iz + 1, ix + 1]) * u) * v


def in_valley(dem, x, z, tol):
    """Bod lezi v udoli, ak nie je vysoko nad nizsim bodom okolia.
    (Toz istý test ako src/world/height.js pruneWaterLines.)"""
    import math
    here = dem_at(dem, x, z)
    lo = here
    for i in range(8):
        a = i * math.pi / 4
        for r in (260.0, 520.0):
            v = dem_at(dem, x + math.cos(a) * r, z + math.sin(a) * r)
            if v < lo:
                lo = v
    return (here - lo) < tol


def rnd_factory(seed):
    s = [seed]

    def rnd():
        s[0] = (s[0] * 1103515245 + 12345) & 0x7FFFFFFF
        return s[0] / 0x7FFFFFFF

    return rnd


def scatter_in(P, dens, rnd, acc, cap):
    """Nahodny rozptyl vo vnutri kruznice ray-castingom.
    `dens` = (nA, nB, nC) body na m2. Ak trieda dosiahne cap, preskoci sa
    (a ked dobehne vsetko, skoncime - inak by sme generovali desiatky tisic
    bodov, ktore by sa zahodili)."""
    if dens[0] <= 0 and dens[1] <= 0 and dens[2] <= 0:
        return 0
    x0, z0, x1, z1 = bbox(P)
    w = x1 - x0
    h = z1 - z0
    if w <= 0 or h <= 0:
        return 0
    A = area(P)
    n_a = int(A / dens[0]) if dens[0] > 0 else 0
    n_b = int(A / dens[1]) if dens[1] > 0 else 0
    n_c = int(A / dens[2]) if dens[2] > 0 else 0
    want = n_a + n_b + n_c
    if want <= 0:
        return 0
    n = len(P)
    got = 0
    put = 0
    tries = int(want * 4.0) + 16   # uzke/konkavne polygony casto odmietnu bod
    for _ in range(tries):
        if got >= want:
            break
        if (len(acc["A"]) >= cap["A"] and n_a > 0
                and len(acc["B"]) >= cap["B"] and n_b > 0
                and len(acc["C"]) >= cap["C"] and n_c > 0):
            break
        px = x0 + rnd() * w
        pz = z0 + rnd() * h
        ins = False
        j = n - 1
        for i in range(n):
            zi, zj = P[i][1], P[j][1]
            if (zi > pz) != (zj > pz):
                xi, xj = P[i][0], P[j][0]
                if px < (xj - xi) * (pz - zi) / (zj - zi) + xi:
                    ins = not ins
            j = i
        if not ins:
            continue
        got += 1
        p = (round(px, 1), round(pz, 1))
        if got <= n_a:
            if len(acc["A"]) < cap["A"]:
                acc["A"].append(p)
                put += 1
        elif got <= n_a + n_b:
            if len(acc["B"]) < cap["B"]:
                acc["B"].append(p)
                put += 1
        elif len(acc["C"]) < cap["C"]:
            acc["C"].append(p)
            put += 1
    return put


def gen_elev(path):
    """Vsetky uzly s tagom ele= z exportu (max. 10 pre Hlohovec)."""
    out = []
    for n in _iter_nodes(path):
        t = tags(n)
        if "ele" not in t:
            continue
        try:
            e = float(t["ele"])
        except ValueError:
            continue
        out.append([round(wx(float(n.get("lon"))), 1),
                    round(wz(float(n.get("lat"))), 1),
                    e, t.get("name", "") or ""])
    return out


def base_veg():
    """Body stromov, ktore musia prezit, aj ked ich novy export nepokryva.

    Zdroj je VYSTUP predosleho behu (public/data/osmExtra.json) - tak je
    beh idempotentny a ziadny bod nezmizne. Ak subor este nie je, skusi sa
    povodny literal VEG_DATA v src/world/nature.js (z monolithu), aby bol
    prvy beh z novym exportom co najkompletnejsi.
    """
    out = {"A": [], "B": [], "C": [], "AVE": []}
    prev = os.path.join(ROOT, "public", "data", "osmExtra.json")
    if os.path.exists(prev):
        d = json.load(open(prev, encoding="utf-8"))
        for k in out:
            out[k] = [tuple(p) for p in (d.get("trees", {}) or {}).get(k, [])]
        if any(out.values()):
            return out
    p = os.path.join(ROOT, "src", "world", "nature.js")
    src = open(p, encoding="utf-8").read()
    if "VEG_DATA={" not in src:
        print("  (zadny zaklad stromov - VEG_DATA je uz v osmExtra.json)")
        return out
    i = src.index("VEG_DATA={") + len("VEG_DATA=")
    depth, q = 1, i + 1
    while True:
        if src[q] == "{":
            depth += 1
        elif src[q] == "}":
            depth -= 1
        if depth == 0:
            break
        q += 1
    body = src[i:q + 1]
    for key in out:
        k = body.index(key + ":[")
        j = body.index("[", k)
        depth, p2 = 0, j
        while True:
            if body[p2] == "[":
                depth += 1
            elif body[p2] == "]":
                depth -= 1
            if depth == 0:
                break
            p2 += 1
        out[key] = [(float(a), float(b)) for a, b in
                    re.findall(r"\[(-?[\d.]+),\s*(-?[\d.]+)\]", body[j:p2 + 1])]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--osm", default=os.path.expanduser("~/Downloads/map(3).osm"))
    ap.add_argument("--min-area", type=float, default=5.0)
    ap.add_argument("--seed", type=int, default=20260927)
    args = ap.parse_args()

    base = json.load(open(os.path.join(ROOT, "public", "data", "mapData.json"),
                          encoding="utf-8"))
    nodes, ways, rels, cov = parse(args.osm)
    rnd = rnd_factory(args.seed)
    dem = load_dem()

    # ---------------- 1) BUDOVY ----------------
    # Uzavrete cesty s tagom building= + outer ringy multipolygonovych relacii.
    ids = [w for w, (refs, t) in ways.items() if "building" in t and refs and refs[0] == refs[-1]]
    rel_ids = []
    for rid, (mem, t) in rels.items():
        if "building" in t:
            rel_ids.extend(ref for ref, role in mem if role == "outer" and ref in ways)
    print("budovy: %d uzavretych cest + %d outer ringov z relacii" % (len(ids), len(rel_ids)))
    blds = []
    skip_small = 0
    for wid in ids + rel_ids:
        refs, t = ways[wid]
        P = ring(nodes, refs)
        if not P or len(P) < 4:
            continue
        if P[0] == P[-1]:
            P = P[:-1]
        if len(P) < 3:
            continue
        a = area(P)
        if a < args.min_area:
            skip_small += 1
            continue
        h = None
        if t.get("height"):
            try:
                h = float(t["height"])
            except ValueError:
                h = None
        if h is None and t.get("building:levels"):
            try:
                h = float(t["building:levels"]) * LEVEL_M
            except ValueError:
                h = None
        if h is None:
            h = TAG_H.get(t.get("building"), DEFAULT_H)
        cx = sum(p[0] for p in P) / len(P)
        cz = sum(p[1] for p in P) / len(P)
        name = t.get("name", "") or ""
        tag = t.get("building", "yes") or "yes"
        blds.append([round(cx, 1), round(cz, 1), round(h, 1), name, tag]
                    + [round(v, 1) for p in P for v in p])
    print("  z exportu pouzite %d budov (odhodenych %d pod %.1f m2)"
          % (len(blds), skip_small, args.min_area))

    # body mimo pokrytia exportu si nechame zo zakladu
    kept_base = 0
    if cov:
        cx0, cz0, cx1, cz1 = cov
        for b in base["blds"]:
            if not (cx0 <= b[0] <= cx1 and cz0 <= b[1] <= cz1):
                blds.append(b)
                kept_base += 1
    blds.sort(key=lambda b: (b[0], b[1]))
    print("  zo zakladu ponechano %d budov mimo pokrytia exportu -> spolu %d"
          % (kept_base, len(blds)))

    # ---------------- 2) ELEVACNE BODY ----------------
    elev = gen_elev(args.osm)
    print("elev: %d uzlov s ele= z exportu (zaklad mal %d)" % (len(elev), len(base["elev"])))

    # ---------------- 3) VEGETACIA ----------------
    acc = {"A": [], "B": [], "C": [], "AVE": [], "T": []}

    # a) skutoocne zmapovane stromy - najvysia priorita, ide o vsetko
    ntree = 0
    for n in _iter_nodes(args.osm):
        t = tags(n)
        if t.get("natural") != "tree":
            continue
        try:
            acc["T"].append((round(wx(float(n.get("lon"))), 1),
                             round(wz(float(n.get("lat"))), 1)))
            ntree += 1
        except (TypeError, ValueError):
            pass
    print("stromy: %d uzlov natural=tree" % ntree)

    # c) kroviny v okoli koryta Vacahu - vlastny kvota, lebo inak by ich
    #    polyglony zaplnili CAP['C'] skôr
    wl = base.get("water", [])
    nbank = 0
    for L in wl:
        if L[0] < 10:
            continue
        pts = [(L[i], L[i + 1]) for i in range(1, len(L), 2)]
        for i in range(len(pts) - 1):
            ax, az = pts[i]
            bx, bz = pts[i + 1]
            seg = math.hypot(bx - ax, bz - az)
            if seg < 1e-6:
                continue
            k = max(1, int(seg / 12))
            for j in range(k + 1):
                if nbank >= BANK_QUOTA:
                    break
                cx = ax + (bx - ax) * j / k
                cz = az + (bz - az) * j / k
                # OSM river je v okolí hrubý a jeho chybný koniec leží na svahu
                # (pozri pruneWaterLines v src/world/height.js) — kroviny len
                # pri reálnom koryte, inak by rastli na svahu 130 m nad nížinou
                if dem and not in_valley(dem, cx, cz, 12):
                    continue
                a = rnd() * math.tau
                r = BANK_DIST * math.sqrt(rnd())
                acc["C"].append((round(cx + math.cos(a) * r, 1),
                                 round(cz + math.sin(a) * r, 1)))
                nbank += 1
    print("  brehy   koryto Vacahu -> %5d kerov" % nbank)

    # b) polygony zelene
    park_polys = []
    groups = {"forest": [], "park": [], "grass": [], "scrub": []}
    for w, (refs, t) in ways.items():
        if not refs or refs[0] != refs[-1] or len(refs) < 4:
            continue
        lu, nat, lei = t.get("landuse"), t.get("natural"), t.get("leisure")
        if nat in ("forest", "wood") or lu == "forest":
            g = "forest"
        elif lei in ("park", "garden", "garden_centre", "nature_reserve") or lu in (
                "village_green", "recreation_ground", "cemetery"):
            g = "park"
        elif nat in ("scrub", "heath"):
            g = "scrub"
        elif lu in ("vineyard", "orchard", "allotments", "farmyard") or nat == "grassland":
            g = "scrub"
        elif lu in ("grass", "meadow") or nat == "grassland":
            g = "grass"
        else:
            continue
        groups[g].append(w)
    # parky a cintoriny zo zakladu (mapData.greens) - uz normalizovane kruznice
    for gi in base.get("greens", []):
        rp = gi[5]
        if len(rp) >= 6:
            park_polys.append([(rp[i], rp[i + 1]) for i in range(0, len(rp), 2)])
    for g, wlist in groups.items():
        polys = park_polys if g == "park" else []
        for w in wlist:
            P = ring(nodes, ways[w][0])
            if P and P[0] == P[-1]:
                P = P[:-1]
            if P and len(P) >= 3:
                polys.append(P)
        tot = sum(area(P) for P in polys)
        # hustota = plocha / kvota (0 kvota -> trieda vypnuta)
        dens = []
        for ci, q in enumerate(BUDGET[g]):
            dens.append((tot / q) if q > 0 and tot > 0 else 0.0)
        n = 0
        for P in polys:
            n += scatter_in(P, dens, rnd, acc, CAP)
        print("  %-7s %4d polygonz (%.0f m2) -> %5d bodov  hustota %s m2/bod"
              % (g, len(polys), tot, n,
                 "/".join("%.0f" % v if v else "-" for v in dens)))

    # d) aleje popri uliciach (z OSM + zo zakladu, aby nezanikli mimo exportu)
    nave = 0
    seen = set()

    def avenue_from(flat, w):
        nonlocal nave
        if w < AVE_MIN_W or len(flat) < 4:
            return
        pts = [(flat[i], flat[i + 1]) for i in range(1, len(flat), 2)]
        acc_n = 0.0
        for i in range(len(pts) - 1):
            ax, az = pts[i]
            bx, bz = pts[i + 1]
            L = math.hypot(bx - ax, bz - az)
            if L < 1e-6:
                continue
            dx, dz = (bx - ax) / L, (bz - az) / L
            nx, nz = -dz, dx
            s = acc_n
            while s < L:
                px = ax + dx * s
                pz = az + dz * s
                for sgn in (1, -1):
                    k = (round(px + nx * AVE_OFF * sgn, 1), round(pz + nz * AVE_OFF * sgn, 1))
                    if k in seen or len(acc["AVE"]) >= CAP["AVE"]:
                        continue
                    seen.add(k)
                    acc["AVE"].append(k)
                    nave += 1
                s += AVE_STEP
            acc_n = s - L
    for w, (refs, t) in ways.items():
        if t.get("highway") and refs and refs[0] == refs[-1]:
            P = ring(nodes, refs)
            if P:
                avenue_from([0] + [v for p in P for v in p],
                            float(t.get("width") or 6) if t.get("width") else 6.0)
    for r in base.get("roads", []):
        avenue_from(r, r[0])
    print("  aleje   -> %5d stromov" % nave)

    # e) zakladove body mimo pokrytia exportu nechavame. DEDUPLICATE, lebo
    #    inak by sa pri kazdom behu zdvojovali (zdroj je predoslehy vystup).
    vegbase = base_veg()
    if cov:
        cx0, cz0, cx1, cz1 = cov
        keep = {"A": 0, "B": 0, "C": 0, "AVE": 0}
        have = {k: set(acc[k]) for k in ("A", "B", "C", "AVE")}
        for k in ("A", "B", "C", "AVE"):
            for x, z in vegbase[k]:
                if cx0 <= x <= cx1 and cz0 <= z <= cz1:
                    continue                      # to uz pokriva novy export
                q = (round(x, 1), round(z, 1))
                if q in have[k]:
                    continue
                have[k].add(q)
                acc[k].append(q)
                keep[k] += 1
        print("  zo zakladu mimo pokrytia: A+%d B+%d C+%d AVE+%d"
              % (keep["A"], keep["B"], keep["C"], keep["AVE"]))

    trees = {k: acc[k] for k in ("A", "B", "C", "AVE", "T")}
    print("  celkom A=%d B=%d C=%d AVE=%d T=%d"
          % (len(trees["A"]), len(trees["B"]), len(trees["C"]),
             len(trees["AVE"]), len(trees["T"])))

    out = {
        "blds": blds,
        "elev": elev,
        "trees": trees,
        "src": {
            "osm": os.path.basename(args.osm),
            "bounds": [round(v, 1) for v in cov] if cov else None,
            "seed": args.seed,
            "min_area": args.min_area,
            "note": "budovy/elev/stromy z noveho OSM exportu; body mimo jeho "
                    "bounding boxu su z public/data/mapData.json (generator "
                    "v src/world/nature.js). Spust: python3 tools/gen_osm_extra.py",
        },
    }
    compact = json.dumps(out, separators=(",", ":"), ensure_ascii=False)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(compact)
    print("\n-> %s  %.1f kB" % (os.path.relpath(OUT, ROOT), len(compact) / 1024.0))
    return 0


def _iter_nodes(path):
    for _, el in ET.iterparse(path, events=("end",)):
        if el.tag == "node":
            yield el
            el.clear()


if __name__ == "__main__":
    sys.exit(main())