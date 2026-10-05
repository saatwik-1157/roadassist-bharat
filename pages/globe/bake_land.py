#!/usr/bin/env python3
"""Bake the dot globe's land and sea dots into pages/globe/land.bin.

The data: Natural Earth 1:110m land polygons, ne_110m_land.geojson, from the
official Natural Earth vector repository (github.com/nvkelso/natural-earth-vector,
geojson/ne_110m_land.geojson). Natural Earth is in the public domain
(naturalearthdata.com/about/terms-of-use): no permission is needed and no
licence applies. The page credits it anyway, under the globe.

The page never fetches Natural Earth. This script is run by hand against a
downloaded copy and its output, a small binary file, is committed and served
from the showcase's own origin like every other asset.

    python pages/globe/bake_land.py path/to/ne_110m_land.geojson

What it writes (little-endian, 4-byte header then Int16 pairs):

    uint16 nLand, uint16 nSea
    nLand x (int16 lat, int16 lon)    land dots, hundredths of a degree
    nSea  x (int16 lat, int16 lon)    sea dots, hundredths of a degree

Each set is a Fibonacci lattice (the same spiral the globe drew before it had
coastlines), kept where it falls on land or on sea. Land is dense, so India's
outline reads at the globe's size; sea is sparse and drawn faint, so the
sphere still turns visibly over the oceans. A point is on land when it is
inside an odd number of the polygon rings (even-odd), so holes such as the
Caspian come out as water. The lattice is fixed, so a rebuild from the same
file is byte-for-byte identical. Needs numpy.
"""
import json
import math
import struct
import sys
from pathlib import Path

import numpy as np

LAND_N = 14000   # lattice size for land: ~1.7 degree spacing, ~4,000 dots kept
SEA_N = 2000     # lattice size for sea: ~4.5 degree spacing, ~1,400 dots kept
OUT = Path(__file__).with_name("land.bin")


def lattice(n):
    """The globe's Fibonacci spiral, as (lat, lon) in degrees, lon in [-180, 180)."""
    i = np.arange(n, dtype=np.float64)
    y = 1 - (i + 0.5) * 2 / n
    ga = math.pi * (3 - math.sqrt(5))
    lon = np.mod(i * ga, 2 * math.pi) - math.pi
    return np.degrees(np.arcsin(y)), np.degrees(lon)


def rings(geojson):
    for f in geojson["features"]:
        g = f["geometry"]
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        for poly in polys:
            for ring in poly:
                yield np.asarray(ring, dtype=np.float64)


def on_land(lat, lon, all_rings):
    inside = np.zeros(lat.shape, dtype=bool)
    py, px = lat[:, None], lon[:, None]
    for r in all_rings:
        x1, y1 = r[:-1, 0][None, :], r[:-1, 1][None, :]
        x2, y2 = r[1:, 0][None, :], r[1:, 1][None, :]
        crosses = (y1 > py) != (y2 > py)
        with np.errstate(divide="ignore", invalid="ignore"):
            xi = x1 + (py - y1) * (x2 - x1) / (y2 - y1)
        inside ^= (np.count_nonzero(crosses & (px < xi), axis=1) & 1).astype(bool)
    return inside


def pack(lat, lon):
    a = np.empty((lat.size, 2), dtype="<i2")
    a[:, 0] = np.round(lat * 100)
    a[:, 1] = np.round(lon * 100)
    return a.tobytes()


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    all_rings = list(rings(json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))))
    la, lo = lattice(LAND_N)
    m = on_land(la, lo, all_rings)
    land = (la[m], lo[m])
    sa, so = lattice(SEA_N)
    s = ~on_land(sa, so, all_rings)
    sea = (sa[s], so[s])
    body = struct.pack("<HH", land[0].size, sea[0].size) + pack(*land) + pack(*sea)
    OUT.write_bytes(body)
    print(f"{OUT.name}: {land[0].size} land + {sea[0].size} sea dots, {len(body):,} bytes "
          f"from {len(all_rings)} rings")


if __name__ == "__main__":
    main()
