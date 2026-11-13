#!/usr/bin/env python3
"""Konvertuje OSM export (Drahovce) na mapData.json v schéme hry."""
import argparse, json, math, os, xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LON0, LAT0 = 17.8136414, 48.4212428
LONM, LATM = 73876.98, 110539.70

def wx(lon): return (lon - LON0) * LONM
def wz(lat): return -(lat - LAT0) * LATM

def tags(el): return {t.get("k"): t.get("v") for t in el.findall("tag")}

def ring(nodes, refs):
    P = []
    for q in refs:
        if q not in nodes: return None
        la, lo = nodes[q]
        P.append((wx(lo), wz(la)))
    return P

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--osm", default=r"C:\Users\jerry\Downloads\map.osm")
    ap.add_argument("--out", default=os.path.join(ROOT, "public", "data", "mapData-drahovce.json"))
    args = ap.parse_args()

    r = ET.parse(args.osm).getroot()
    nodes = {}
    for n in r.findall("node"):
        try:
            nodes[n.get("id")] = (float(n.get("lat")), float(n.get("lon")))
        except (TypeError, ValueError):
            pass
    ways = {}
    for w in r.findall("way"):
        ways[w.get("id")] = ([x.get("ref") for x in w.findall("nd")], tags(w))

    # bbox z bounds
    b = r.find("bounds")
    if b is not None:
        x0 = wx(float(b.get("minlon"))); z0 = wz(float(b.get("maxlat")))
        x1 = wx(float(b.get("maxlon"))); z1 = wz(float(b.get("minlat")))
    else:
        xs=[]; zs=[]
        for la,lo in nodes.values():
            xs.append(wx(lo)); zs.append(wz(la))
        x0,z0,x1,z1 = min(xs),min(zs),max(xs),max(zs)
    bbox = [round(x0,1), round(z0,1), round(x1,1), round(z1,1)]

    # cesty (highways)
    HW_W = {"motorway":9,"trunk":8,"primary":7,"secondary":6,"tertiary":5,
            "unclassified":4,"residential":4,"service":3,"track":3,"footway":1.5,
            "path":1.5,"cycleway":2}
    roads = []
    for wid,(refs,t) in ways.items():
        if "highway" not in t: continue
        P = ring(nodes, refs)
        if not P or len(P) < 2: continue
        hw = HW_W.get(t.get("highway"), 4)
        if t.get("width"):
            try: hw = float(t["width"])
            except ValueError: pass
        flat = [hw]
        for x,z in P: flat += [round(x,1), round(z,1)]
        roads.append(flat)

    # voda
    WATER_W = {"river":40,"stream":8,"canal":12,"ditch":3,"drain":2}
    water = []
    for wid,(refs,t) in ways.items():
        if "waterway" not in t: continue
        P = ring(nodes, refs)
        if not P or len(P) < 2: continue
        ww = WATER_W.get(t.get("waterway"), 4)
        flat = [ww]
        for x,z in P: flat += [round(x,1), round(z,1)]
        water.append(flat)

    # koľaje
    rails = []
    for wid,(refs,t) in ways.items():
        if t.get("railway"): 
            P = ring(nodes, refs)
            if P and len(P)>=2:
                flat=[2]
                for x,z in P: flat += [round(x,1), round(z,1)]
                rails.append(flat)

    # elev
    elev = []
    for nid,(la,lo) in nodes.items():
        # find node element tags
        pass
    for n in r.findall("node"):
        t = tags(n)
        if "ele" not in t: continue
        try:
            e = float(t["ele"])
            la=float(n.get("lat")); lo=float(n.get("lon"))
        except (ValueError, TypeError):
            continue
        elev.append([round(wx(lo),1), round(wz(la),1), e, t.get("name","") or ""])

    # route: chain primary ways
    primary_ways = [(wid, ways[wid]) for wid in ways if "highway" in ways[wid][1] and ways[wid][1].get("highway")=="primary"]
    # build adjacency by endpoints
    # map way -> list of node refs
    # chain
    chain_nodes = []
    if primary_ways:
        # start with first
        used=set()
        # find a way whose first node not used as endpoint? just start first
        cur = primary_ways[0]
        used.add(cur[0])
        cur_refs = cur[1][0]
        chain_nodes = list(cur_refs)
        changed=True
        while changed:
            changed=False
            last = chain_nodes[-1]
            for wid,(refs,t) in primary_ways:
                if wid in used: continue
                if refs and refs[0]==last:
                    used.add(wid); chain_nodes += refs[1:]; changed=True; break
                if refs and refs[-1]==last:
                    used.add(wid); chain_nodes += list(reversed(refs))[:-1] if False else refs[::-1][1:]; 
                    # simpler: append reversed without last
                    chain_nodes += [r for r in reversed(refs)][1:]
                    changed=True; break
        # dedup consecutive
        dedup=[]
        for q in chain_nodes:
            if not dedup or dedup[-1]!=q: dedup.append(q)
        chain_nodes=dedup

    route_pts=[]
    for q in chain_nodes:
        if q in nodes:
            la,lo = nodes[q]
            route_pts += [round(wx(lo),1), round(wz(la),1)]
    if len(route_pts) < 4:
        # fallback: use all primary nodes
        seen=set()
        for wid,(refs,t) in primary_ways:
            for q in refs:
                if q in nodes and q not in seen:
                    seen.add(q)
                    la,lo=nodes[q]
                    route_pts += [round(wx(lo),1), round(wz(la),1)]
    if len(route_pts) < 4:
        # ultimate fallback
        route_pts = [bbox[0], bbox[1], bbox[2], bbox[3]]

    # rounds: none (detect junction roundabout not present)
    rounds = []

    # pois
    pois = []
    for n in r.findall("node"):
        t = tags(n)
        if t.get("place") in ("village","town","city","hamlet"):
            la=float(n.get("lat")); lo=float(n.get("lon"))
            pois.append([round(wx(lo),1), round(wz(la),1), t.get("name","") or "Drahovce"])

    # streets: primary road name
    streets = []
    # name of primary road
    pname = None
    for wid,(refs,t) in ways.items():
        if t.get("highway")=="primary" and t.get("name"):
            pname = t["name"]; break
    if pname:
        streets = [[0, 1, pname]]  # will be scaled; placeholder s-range

    # greens: landuse polygons (format [cx,cz,w,h, name?, flag?, ring...])
    greens = []
    for wid,(refs,t) in ways.items():
        if refs and refs[0]==refs[-1] and len(refs)>=4:
            lu=t.get("landuse"); nat=t.get("natural"); lei=t.get("leisure")
            grp=None
            if nat in ("forest","wood") or lu=="forest": grp="forest"
            elif lei in ("park","garden") or lu in ("grass","meadow","village_green","recreation_ground","cemetery"): grp="park"
            if not grp: continue
            P = ring(nodes, refs)
            if not P or len(P)<3: continue
            if P[0]==P[-1]: P=P[:-1]
            if len(P)<3: continue
            cx=sum(p[0] for p in P)/len(P)
            cz=sum(p[1] for p in P)/len(P)
            # ring flat
            ringflat=[round(v,1) for p in P for v in p]
            name = t.get("name","") or ""
            greens.append([round(cx,1), round(cz,1), round((max(p[0] for p in P)-min(p[0] for p in P)),1),
                          round((max(p[1] for p in P)-min(p[1] for p in P)),1), name, ringflat, 2.0])

    osm = {
        "elev": elev,
        "route": route_pts,
        "streets": streets,
        "roundabouts": rounds,
        "bridge": [0,0,0],
        "pois": pois,
        "length": 1,
        "roads": roads,
        "dirt": [],
        "rounds": rounds,
        "blds": [],
        "water": water,
        "tlabels": [],
        "links": [],
        "rails": rails,
        "rbridges": [],
        "greens": greens,
        "bbox": bbox,
    }

    # length: cumulative route length
    L=0
    for i in range(2,len(route_pts),2):
        L += math.hypot(route_pts[i]-route_pts[i-2], route_pts[i+1]-route_pts[i-1])
    osm["length"] = round(L,1) if L>0 else 1

    with open(args.out,"w",encoding="utf-8") as f:
        json.dump(osm, f, separators=(",",":"), ensure_ascii=False)
    print("->", args.out, os.path.getsize(args.out)/1024, "kB", "route pts", len(route_pts)//2, "roads", len(roads))

if __name__=="__main__":
    main()