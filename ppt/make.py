"""Assemble the slide parts and build the deck.

    python ppt/make.py
"""
import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
core = (HERE / "build_deck.py").read_text(encoding="utf-8")
# Order matters: part_c2 is the Razorpay slide, inserted between the last
# Module 2 slide and the Module 3 introduction.
ORDER = ["a", "b", "c", "c2", "c3", "d", "e", "f", "g"]
parts = [(HERE / f"part_{c}.py").read_text(encoding="utf-8") for c in ORDER]
tail = '\nout = OUT / "RoadAssist-Bharat-SWE4004.pptx"\nprs.save(str(out))\nprint(f"{len(prs.slides._sldIdLst)} slides -> {out}")\n'

# Morph on the module hand-offs and the architecture build-up; fade elsewhere.
# Applied afterwards through PowerPoint (see README) — this list is the source
# of truth for which slides get it.
MORPH = [5, 6, 7, 8, 10, 11, 12, 13, 15, 16, 17, 18, 20, 21, 22, 23, 24, 25]
(HERE / "morph-slides.txt").write_text(",".join(map(str, MORPH)), encoding="utf-8")

built = HERE / "make_generated.py"
built.write_text(core + "".join(parts) + tail, encoding="utf-8")
sys.exit(subprocess.call([sys.executable, str(built)]))
