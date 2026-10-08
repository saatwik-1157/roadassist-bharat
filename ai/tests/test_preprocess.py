"""serve.py builds the tensor ultralytics trained the model on.

serve.py resized with PIL's antialiased BILINEAR; ultralytics letterboxes with
cv2's INTER_LINEAR, which samples two pixels where PIL averages a footprint.
On RDD frames that changed 38% of pixels, by up to 93 grey levels, so the
served model looked at a softer road than it was trained on and its scores
drifted from detect.py's on the same image.

The expected images in tests/fixtures were made by ultralytics' own LetterBox
(tests/fixtures/make_fixtures.py); the sources are synthetic noise over
gradients, where any resampling difference shows. The comparison is exact.

Needs numpy and pillow, which serving needs anyway (requirements-serve.txt);
without them this module skips rather than failing the stdlib-only suite.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

AI = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(AI))
sys.path.insert(0, str(AI / "road_damage"))
FIXTURES = AI / "tests" / "fixtures"

try:
    import numpy as np
    from PIL import Image
except ImportError:  # pragma: no cover - the serving dependencies are absent
    np = None


@unittest.skipIf(np is None, "numpy and pillow are serving dependencies (requirements-serve.txt)")
class ServePreprocessMatchesUltralytics(unittest.TestCase):
    def check(self, name: str, model_w: int, model_h: int):
        from serve import preprocess

        src = (FIXTURES / f"letterbox_{name}_src.png").read_bytes()
        want = np.asarray(Image.open(FIXTURES / f"letterbox_{name}_expected_{model_w}x{model_h}.png").convert("RGB"))
        tensor, src_w, src_h = preprocess(src, model_w, model_h)
        self.assertEqual(tensor.shape, (1, 3, model_h, model_w))
        self.assertEqual(tensor.dtype, np.float32)
        self.assertEqual((src_w, src_h), Image.open(FIXTURES / f"letterbox_{name}_src.png").size)
        got = np.rint(tensor[0].transpose(1, 2, 0) * 255.0).astype(np.int16)
        diff = np.abs(got - want.astype(np.int16))
        self.assertEqual(int(diff.max()), 0, f"{int((diff > 0).sum())} values differ, by up to {int(diff.max())}")

    def test_a_downscale_with_an_odd_padding_split(self):
        # 97x61 into 40x40: 40x25, and 15 rows of padding split 7 / 8.
        self.check("down", 40, 40)

    def test_an_upscale_into_a_non_square_input(self):
        # 23x17 into 64 wide by 48 high: 64x47, one row of padding at the bottom.
        self.check("up", 64, 48)


if __name__ == "__main__":
    unittest.main(verbosity=2)
