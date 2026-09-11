"""The severity heuristic, in one place.

It lives in its own module because two things now compute it — `detect.py`, the
CLI, and `serve.py`, the HTTP service — and a heuristic that reaches the database
is exactly the wrong thing to have two copies of. Importing it also means the
unit tests no longer need to stub `ultralytics` just to reach a pure function.

ENGINEERING ASSUMPTION, documented, not a safety claim: bounding-box area as a
fraction of the frame is a crude proxy for how much of the carriageway a defect
occupies. A pothole of equal size is worse than a surface crack, so it gets +1.

The 1-5 range is load-bearing. `raksha_detections` carries
`CHECK (severity BETWEEN 1 AND 5)`, so a 6 is refused at ingest and the
detection is lost — the cap is not cosmetic.
"""
from __future__ import annotations

#: Upper bound of each band, as a fraction of frame area.
BANDS = ((0.01, 1), (0.03, 2), (0.07, 3), (0.15, 4))

#: Classes judged worse than their size alone suggests.
AGGRAVATED = ("pothole",)

MIN_SEVERITY = 1
MAX_SEVERITY = 5


def severity(cls_name: str, box_frac: float) -> int:
    """Severity 1-5 for a detection covering `box_frac` of the frame."""
    s = MAX_SEVERITY
    for upper, band in BANDS:
        if box_frac < upper:
            s = band
            break
    if cls_name in AGGRAVATED:
        s = min(MAX_SEVERITY, s + 1)
    return max(MIN_SEVERITY, s)
