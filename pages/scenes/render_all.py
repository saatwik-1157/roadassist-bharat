"""
Render every 3D scene the public page loads, from the committed screenshots.

    python pages/scenes/render_all.py

Re-run it after `node app/scripts/capture-screens.mjs` so the scenes show the
same build as the screenshots beside them. The outputs are committed, like the
thumbnails, so what a reviewer saw in the PR is what Pages publishes.
"""
import importlib
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

# One module per journey stage, in the order the page shows them, then the hero.
MODULES = [
    "scene_home", "scene_diagnosis", "scene_dispatch", "scene_tracking",
    "scene_offgrid", "scene_sync", "scene_payment", "scene_raksha", "hero_3d",
]

if __name__ == "__main__":
    print("rendering scenes:")
    for name in MODULES:
        mod = importlib.import_module(name)
        (mod.render if hasattr(mod, "render") else mod.main)()
    print("done")
