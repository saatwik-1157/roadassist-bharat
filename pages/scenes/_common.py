"""
Shared pieces for the per-stage 3D scenes on the public page.

Every scene is built from a REAL screenshot of the running application, set into
a perspective-warped device, inside a procedurally drawn scene that shows what
that stage actually does. Nothing is a mockup and nothing is stock imagery —
the same rule ppt/render_visuals.py follows, and these reuse its helpers.

Each scene module exposes render() and can also be run on its own:

    python pages/scenes/scene_dispatch.py
"""
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ppt"))

# Re-exported so a scene imports everything from one place.
from render_visuals import (  # noqa: E402,F401
    BLUE, CYAN, GOLD, RED, GREEN, GROUND,
    perspective_coeffs, glow, rounded_mask, device_frame, tilt, drop, net_lines,
)

SHOTS = ROOT / "app" / "docs" / "screenshots"
OUT = SHOTS / "scene"
OUT.mkdir(parents=True, exist_ok=True)

# One canvas for every stage, so switching stages never moves the layout.
W, H = 1600, 1000
# Close to the page background (#0a0c10), so a scene's edge disappears into it.
PAGE_BG = (10, 12, 16)


def save(img: Image.Image, shot: str) -> Path:
    """Write the scene as the web-sized file the page loads, and report its size."""
    if img.size != (W, H):
        raise SystemExit(f"{shot}: scene is {img.size}, must be {(W, H)}")
    path = OUT / f"{shot}.webp"
    img.convert("RGB").save(path, "WEBP", quality=84, method=6)
    kb = path.stat().st_size // 1024
    if kb > 260:
        raise SystemExit(f"{shot}: {kb} KB is over the 260 KB budget - simplify the scene")
    print(f"  scene/{shot}.webp  {kb} KB")
    return path
