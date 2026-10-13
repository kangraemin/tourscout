"""Re-split metro anchors outside the US, Canada and Japan.

The original GeoNames rollup merged cities up to 80 km apart, which folded Liverpool and Sheffield into
Manchester and Cardiff into Bristol. Bands book those as separate markets. Here any city of 250k+ that is
more than 25 km from its anchor becomes its own anchor, and smaller towns join the nearest anchor within 40 km.
Metro population is the sum of member populations.
"""
import json, math, sys

KEEP = {"US", "CA", "JP"}
BIG, SPLIT_KM, JOIN_KM = 250_000, 25, 40
path = sys.argv[1] if len(sys.argv) > 1 else "src/data/cities.json"
C = json.load(open(path))

def km(a, b):
    return math.hypot((a["lat"] - b["lat"]) * 111, (a["lon"] - b["lon"]) * 111 * math.cos(math.radians(a["lat"])))

idx = [i for i, c in enumerate(C) if c["cc"] not in KEEP]
anchor = {}
for i in sorted(idx, key=lambda i: -C[i]["pop"]):
    c = C[i]
    old = c.get("a", i)
    if old == i or (c["pop"] >= BIG and km(c, C[old]) > SPLIT_KM):
        anchor[i] = i
anchors = [i for i in anchor]
for i in idx:
    if i in anchor:
        continue
    c = C[i]
    best = min((a for a in anchors if C[a]["cc"] == c["cc"] and C[a]["pop"] > c["pop"]), key=lambda a: km(c, C[a]), default=None)
    anchor[i] = best if best is not None and km(c, C[best]) <= JOIN_KM else i
for i in idx:
    C[i].pop("m", None)
    a = anchor[i]
    if a == i:
        C[i].pop("a", None)
    else:
        C[i]["a"] = a
for i in idx:
    if anchor[i] == i:
        C[i]["m"] = sum(C[j]["pop"] for j in idx if anchor[j] == i)
json.dump(C, open(path, "w"), separators=(",", ":"), ensure_ascii=False)
