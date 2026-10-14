"""Exact and perceptual duplicate checks for the leak-safe dataset builders.

Each image gets a sha256 of its bytes plus a 16x16 grey thumbnail (box-filtered,
squashed to the grid, so a resized or stretched-to-640x640 re-encode keeps it).
Two images are near-duplicates when the cosine similarity of their zero-mean
thumbnails is at least COS_MIN, comparing against the left-right mirror too
(Roboflow-style exports often carry flipped copies).

Why not a 64-bit aHash/dHash: on dashcam frames (sky on top, road below) they
collide constantly. Measured on RDD2022: 18% of 1,500 India images had a "match"
among 13k Japan images at dHash <= 10 and aHash <= 10 bits. The thumbnail cosine
separates far better (2026-10-13, 800 India images against 4,000 Japan images):

  unrelated images, best match:  median 0.886, 99th pct 0.956, max 0.975
  re-encoded copies (resized to 640x640, brightness/contrast +-25%, JPEG q40-90,
  30% of them also cropped 5% per side):  5th pct 0.952, median 0.999

so COS_MIN = 0.95 errs on the side of dropping a few unrelated images rather
than letting a copy through. Hashes of large reference sets are cached in an
.npz keyed by path, size and mtime.
"""
from __future__ import annotations

import hashlib
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

COS_MIN = 0.95
N = 16
IMG_EXT = {".jpg", ".jpeg", ".png", ".bmp"}


def hashes(path: Path) -> tuple[str, np.ndarray]:
    """(sha256, 16x16 grey thumbnail as uint8[256])."""
    raw = path.read_bytes()
    sha = hashlib.sha256(raw).hexdigest()
    with Image.open(path) as im:
        im.draft("L", (128, 128))  # JPEG DCT downscale: decode fast
        g = im.convert("L").resize((N, N), Image.BOX)
    return sha, np.asarray(g, dtype=np.uint8).ravel()


def list_images(*roots: Path) -> list[Path]:
    files = []
    for r in roots:
        if r.is_dir():
            files += [p for p in r.rglob("*") if p.suffix.lower() in IMG_EXT]
    return sorted(set(files))


def hash_many(paths: list[Path], cache: Path | None = None, workers: int = 8) -> dict:
    """{path str: (sha, thumb)}; uses / refreshes `cache`."""
    old = {}
    if cache and cache.exists():
        z = np.load(cache, allow_pickle=False)
        if "t" in z.files:
            for k, sz, mt, sha, t in zip(z["path"], z["size"], z["mtime"], z["sha"], z["t"]):
                old[str(k)] = (int(sz), float(mt), str(sha), t)
    res, todo = {}, []
    for p in paths:
        st = p.stat()
        o = old.get(str(p))
        if o and o[0] == st.st_size and o[1] == st.st_mtime:
            res[str(p)] = (o[2], o[3])
        else:
            todo.append(p)
    if todo:
        with ThreadPoolExecutor(workers) as ex:
            for p, h in zip(todo, ex.map(hashes, todo)):
                res[str(p)] = h
    if cache and todo:
        keep = {**{k: (v[2], v[3]) for k, v in old.items() if Path(k).exists()}, **res}
        keys = sorted(keep)
        st = [Path(k).stat() for k in keys]
        np.savez(cache, path=np.array(keys), size=np.array([s.st_size for s in st]),
                 mtime=np.array([s.st_mtime for s in st]),
                 sha=np.array([keep[k][0] for k in keys]),
                 t=np.stack([keep[k][1] for k in keys]).astype(np.uint8))
    return res


def unit(thumbs: np.ndarray) -> np.ndarray:
    v = thumbs.reshape(len(thumbs), -1).astype(np.float32)
    v -= v.mean(1, keepdims=True)
    return v / (np.linalg.norm(v, axis=1, keepdims=True) + 1e-6)


def mirror(thumbs: np.ndarray) -> np.ndarray:
    return thumbs.reshape(len(thumbs), N, N)[:, :, ::-1].reshape(len(thumbs), -1)


class Index:
    """Reference set to query new images against."""

    def __init__(self, table: dict):
        self.table = table
        self.keys = list(table)
        self.sha = {v[0]: k for k, v in table.items()}
        self.u = unit(np.stack([table[k][1] for k in self.keys])) if self.keys else None

    def match_many(self, table: dict, chunk: int = 2048) -> dict:
        """{query path: ('sha256'|'near', ref path, cosine)} for every query with a hit."""
        out = {}
        qk = list(table)
        for k in qk:
            if table[k][0] in self.sha:
                out[k] = ("sha256", self.sha[table[k][0]], 1.0)
        if self.u is None:
            return out
        th = np.stack([table[k][1] for k in qk])
        for s in range(0, len(qk), chunk):
            sim = np.maximum(unit(th[s:s + chunk]) @ self.u.T, unit(mirror(th[s:s + chunk])) @ self.u.T)
            j = sim.argmax(1)
            best = sim[np.arange(len(j)), j]
            for i in np.flatnonzero(best >= COS_MIN):
                out.setdefault(qk[s + i], ("near", self.keys[j[i]], round(float(best[i]), 4)))
        return out
