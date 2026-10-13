"""Add US and Canadian cities of 20k+ that the original table left out (it stopped near 47k).

Burlington VT, Harrisburg PA, Missoula MT and other college and capital towns are real tour stops. A new
city joins the nearest bigger metro anchor in its country within 25 km; otherwise it becomes its own anchor.
New rows go at the end so existing anchor indexes stay valid.

  python3 scripts/add-small-cities.py cities15000.txt [src/data/cities.json]
"""
import json, math, sys

MIN_POP, JOIN_KM = 20_000, 25
src = sys.argv[1]
path = sys.argv[2] if len(sys.argv) > 2 else "src/data/cities.json"
C = json.load(open(path))

def km(a, b):
    return math.hypot((a["lat"] - b["lat"]) * 111, (a["lon"] - b["lon"]) * 111 * math.cos(math.radians(a["lat"])))

have = {(c["n"], c["cc"], c["a1"]) for c in C}
near = [(i, c) for i, c in enumerate(C) if c["cc"] in ("US", "CA")]
added = 0
for line in open(src, encoding="utf8"):
    f = line.rstrip("\n").split("\t")
    cc, pop, fcode = f[8], int(f[14] or 0), f[7]
    if cc not in ("US", "CA") or pop < MIN_POP or fcode in ("PPLX", "PPLH"):
        continue
    row = {"n": f[1], "cc": cc, "a1": f[10], "lat": round(float(f[4]), 4), "lon": round(float(f[5]), 4), "pop": pop}
    if (row["n"], cc, row["a1"]) in have:
        continue
    # Skip if an existing city sits on top of it (same place under another name).
    if any(km(row, c) < 3 for _, c in near if c["cc"] == cc):
        continue
    anchors = [(i, c) for i, c in near if c["cc"] == cc and "a" not in c and c["pop"] > pop]
    best = min(anchors, key=lambda ic: km(row, ic[1]), default=None)
    i = len(C)
    if best and km(row, best[1]) <= JOIN_KM:
        row["a"] = best[0]
        C[best[0]]["m"] = C[best[0]].get("m", C[best[0]]["pop"]) + pop
    else:
        row["m"] = pop
    C.append(row)
    near.append((i, row))
    have.add((row["n"], cc, row["a1"]))
    added += 1
json.dump(C, open(path, "w"), separators=(",", ":"), ensure_ascii=False)
print("added", added, "now", len(C))
