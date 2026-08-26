"""Fetch additional RDD2022 country splits for a multi-country detector.

RDD2022 (Arya et al.) publishes six countries in one figshare archive; only
byte-ranges for the requested inner zips are pulled (remotezip), never the full
13 GB. Norway (10.6 GB) is deliberately skipped — too large for this CPU box.
License is the same as the India split already in use (CC BY 4.0 / CC BY-SA 4.0;
we honour the stricter share-alike reading). See
docs/raksha/05-dataset-license-verification.md.

Usage: ../.venv/Scripts/python fetch_countries.py Czech Japan United_States
"""
from __future__ import annotations

import sys
import zipfile
from pathlib import Path

from remotezip import RemoteZip

ARCHIVE = "https://ndownloader.figshare.com/files/38030910"
DATA = Path(__file__).resolve().parent.parent / "data"


def main() -> None:
    countries = sys.argv[1:] or ["Czech", "Japan", "United_States"]
    DATA.mkdir(parents=True, exist_ok=True)
    with RemoteZip(ARCHIVE) as z:
        for c in countries:
            inner = f"RDD2022/{c}.zip"
            dest_dir = DATA / c
            if (dest_dir / "train" / "images").exists():
                print(f"[fetch] {c}: already present, skipping")
                continue
            print(f"[fetch] {c}: pulling {inner} ...", flush=True)
            z.extract(inner, DATA)                       # -> data/RDD2022/<c>.zip
            local_zip = DATA / inner
            print(f"[fetch] {c}: unzipping {local_zip.stat().st_size/1e6:.0f} MB ...", flush=True)
            with zipfile.ZipFile(local_zip) as inner_zip:
                inner_zip.extractall(DATA)               # -> data/<c>/train/...
            local_zip.unlink()
            imgs = len(list((dest_dir / "train" / "images").glob("*.jpg")))
            print(f"[fetch] {c}: done — {imgs} train images", flush=True)
    # tidy the now-empty RDD2022/ holder
    holder = DATA / "RDD2022"
    if holder.exists() and not any(holder.iterdir()):
        holder.rmdir()
    print("[fetch] all requested countries ready")


if __name__ == "__main__":
    main()
