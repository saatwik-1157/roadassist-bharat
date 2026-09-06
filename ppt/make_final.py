"""Build the final submission deck.

    python ppt/make_final.py

Same pattern as make.py: concatenate the primitives in build_deck.py with the
slide source, run the result, and save. Keeping the two decks in separate
drivers means the Review-1 deck can still be rebuilt unchanged.

Screenshots come from app/docs/screenshots/. Capture them first:

    npm start                            # in app/
    node scripts/capture-screens.mjs
"""
import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
SHOTS = HERE.parent / "app" / "docs" / "screenshots"

if not SHOTS.exists() or not any(SHOTS.glob("*.png")):
    print("! no screenshots in app/docs/screenshots — slides will show labelled")
    print("  placeholders instead. Run: node scripts/capture-screens.mjs")

core = (HERE / "build_deck.py").read_text(encoding="utf-8")
body = (HERE / "part_final.py").read_text(encoding="utf-8")
tail = (
    '\nout = OUT / "RoadAssist-Bharat-FINAL.pptx"\n'
    'prs.save(str(out))\n'
    'print(f"{len(prs.slides._sldIdLst)} slides -> {out}")\n'
)

built = HERE / "make_final_generated.py"
built.write_text(core + body + tail, encoding="utf-8")
sys.exit(subprocess.call([sys.executable, str(built)]))
