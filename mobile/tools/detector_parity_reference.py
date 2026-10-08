"""Reference outputs for the Android scanner's parity tests.

The phone's detector (mobile/app/src/main/java/in/roadassist/app/Detector.kt)
is a port of the Python serving path. This script runs THAT Python path —
ai/serve.py's Detector, unmodified, which calls ai/road_damage/onnx_detector.py —
on a few fixed RDD2022 images and writes what it found, so the Kotlin tests can
hold the port to it. Two tests read these files:

  DetectorParityTest (JVM, every build): the Kotlin input tensor must be
  byte-identical to serve.py's (SHA-256 of the float32 tensor), and the Kotlin
  decoder fed the model's raw output must return serve.py's detections. With
  the same input bytes going into the same .onnx, that pins the whole chain.

  DetectorDeviceParityTest (instrumented, on a phone or emulator): the app's
  own OrtRoadDetector runs the shipped model end to end on Android's ONNX
  Runtime and must find the same boxes (IoU > 0.9).

The model's raw output is stored too (gzipped little-endian float32,
[4 + classes, anchors]) because ONNX Runtime's desktop build cannot run inside
a Gradle test JVM on this machine: the JetBrains runtime ships an old Visual
C++ runtime beside java.exe that onnxruntime.dll binds to and crashes in.

Usage:

    S:/PROJECTS/RoadAssist-Bharat/ai/.venv/Scripts/python mobile/tools/detector_parity_reference.py

ai/.venv carries the training stack and not onnxruntime; put onnxruntime on
PYTHONPATH (for example `pip install --target <dir> onnxruntime --no-deps`)
rather than installing into a venv a training run may be using. CPU only.
ai/.venv-gpu already has onnxruntime 1.30.0 (the serving pin) beside torch, and
is what regenerated these fixtures for raksha-yolo11n-india-ft-gpu-416 on
2026-10-08:

    S:/PROJECTS/RoadAssist-Bharat/ai/.venv-gpu/Scripts/python mobile/tools/detector_parity_reference.py

Run it again whenever assets/detector/detector.json names a different model:
the expected file records the model's SHA-256, and the test refuses to compare
a model against another model's answers.

Fixtures are written as the decoded pixels themselves (gzipped raw RGB, three
bytes a pixel, row-major; width and height are in expected.json), so the only
differences the test can see are in the pre/post-processing, not between two
JPEG decoders. Three shapes on purpose: a square frame (resize only), a 4:3
landscape crop (vertical letterbox padding, like a camera frame) and a 3:4
portrait crop (horizontal padding). A fourth fixture is the landscape crop
stored sideways, the way a phone's sensor delivers a frame; Kotlin turns it
upright by rotating 90 degrees clockwise, the path a CameraX frame takes with
rotationDegrees = 90, and is compared with Python on the same picture rotated
by PIL.

RDD2022 images: Arya et al., CC BY-SA 4.0 (see ai/README.md).
"""
from __future__ import annotations

import gzip
import hashlib
import io
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
MOBILE = HERE.parent
ROOT = MOBILE.parent
AI = ROOT / "ai"
sys.path.insert(0, str(AI))
sys.path.insert(0, str(AI / "road_damage"))

from PIL import Image  # noqa: E402

from serve import Detector  # noqa: E402  (the serving path itself, not a copy)

ASSETS = MOBILE / "app" / "src" / "main" / "assets"
OUT = MOBILE / "app" / "src" / "test" / "resources" / "detector-parity"
IMAGES = AI / "data" / "India" / "train" / "images"

# name -> (source image, crop box or None)
FIXTURES = {
    "square": ("India_000475.jpg", None),
    "landscape": ("India_000612.jpg", (0, 180, 720, 720)),   # 720 x 540
    "portrait": ("India_000147.jpg", (180, 0, 720, 720)),    # 540 x 720
}
# Case name -> (fixture file, clockwise rotation applied before detection)
CASES = [
    ("square", "square", 0),
    ("landscape", "landscape", 0),
    ("portrait", "portrait", 0),
    ("sideways-rot90", "sideways", 90),
]

# Every 9973rd value of the input tensor, plus the first and last: enough to
# show the resize and padding are value-for-value the Python's without committing a
# 3 MB tensor.
SAMPLE_STEP = 9973


def png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def main() -> None:
    config = json.loads((ASSETS / "detector" / "detector.json").read_text(encoding="utf-8"))
    model = ASSETS / config["model"]
    det = Detector(model, float(config["minConfidence"]), float(config["iouThreshold"]))
    names = list(det.class_names[i] for i in sorted(det.class_names))
    if names != config["classes"]:
        raise SystemExit(f"detector.json classes {config['classes']} != model metadata {names}")
    if [det.model_h, det.model_w] != [config["inputHeight"], config["inputWidth"]]:
        raise SystemExit("detector.json input size disagrees with the model's imgsz metadata")

    OUT.mkdir(parents=True, exist_ok=True)
    pixels = {}
    for name, (src, crop) in FIXTURES.items():
        img = Image.open(IMAGES / src).convert("RGB")
        if crop:
            img = img.crop(crop)
        pixels[name] = img
    # The landscape crop as a sensor would hand it over: turned 90 degrees
    # anticlockwise, so it needs 90 clockwise to be upright again.
    pixels["sideways"] = pixels["landscape"].transpose(Image.Transpose.ROTATE_90)
    for name, img in pixels.items():
        # mtime=0: the same pixels always give the same bytes.
        (OUT / f"{name}.rgb.gz").write_bytes(gzip.compress(img.tobytes(), mtime=0))

    cases = []
    for case, fixture, rot in CASES:
        img = pixels[fixture]
        if rot:
            # PIL rotates anticlockwise; 90 clockwise is ROTATE_270.
            img = img.transpose({90: Image.Transpose.ROTATE_270,
                                 180: Image.Transpose.ROTATE_180,
                                 270: Image.Transpose.ROTATE_90}[rot])
        data = png_bytes(img)
        tensor, w, h = det.preprocess(data)
        flat = tensor.reshape(-1)
        idx = sorted(set([0, flat.size - 1] + list(range(0, flat.size, SAMPLE_STEP))))
        found, _, _ = det.detect(data)
        raw = det.session.run(None, {det.input_name: tensor})[0][0].astype("<f4")
        rows, anchors = raw.shape
        (OUT / f"{case}.out.gz").write_bytes(gzip.compress(raw.tobytes(), mtime=0))
        cases.append({
            "case": case,
            "image": f"{fixture}.rgb.gz",
            "imageWidth": pixels[fixture].size[0],
            "imageHeight": pixels[fixture].size[1],
            "rotate": rot,
            "width": w,
            "height": h,
            "tensorSha256": hashlib.sha256(flat.astype("<f4").tobytes()).hexdigest(),
            "tensorSum": float(flat.astype("float64").sum()),
            "output": f"{case}.out.gz",
            "outputRows": int(rows),
            "outputAnchors": int(anchors),
            "tensorSamples": [[i, float(flat[i])] for i in idx],
            "detections": [
                {"type": d.type, "confidence": d.confidence, "severity": d.severity,
                 "boxFraction": d.box_fraction, "box": list(d.box)}
                for d in found
            ],
        })
        print(case, w, h, [(d.type, round(d.confidence, 3), [round(v) for v in d.box]) for d in found])

    # The resize on awkward ratios. The RDD frames above shrink by exactly 45/32,
    # where every tap lands on a 1/64 grid and the weight rounding and cv2's
    # edge clamping never come into play; a noise image resized up, down and
    # sideways by odd factors exercises both.
    import numpy as np
    from onnx_detector import resize_linear
    noise = np.random.RandomState(1234).randint(0, 256, size=(61, 97, 3), dtype=np.uint8)
    (OUT / "noise.rgb.gz").write_bytes(gzip.compress(noise.tobytes(), mtime=0))
    resizes = []
    for w, h in [(53, 88), (40, 23), (211, 37), (97, 60), (13, 131), (512, 322)]:
        out = resize_linear(noise, w, h)
        resizes.append({"width": w, "height": h, "sha256": hashlib.sha256(out.tobytes()).hexdigest()})

    expected = {
        "_": "Written by mobile/tools/detector_parity_reference.py from ai/serve.py. Do not edit by hand.",
        "model": config["model"],
        "modelSha256": hashlib.sha256(model.read_bytes()).hexdigest(),
        "minConfidence": det.min_conf,
        "iouThreshold": det.iou,
        "cases": cases,
        "noise": {"image": "noise.rgb.gz", "width": 97, "height": 61, "resizes": resizes},
    }
    (OUT / "expected.json").write_text(json.dumps(expected, indent=1), encoding="utf-8")
    print("wrote", OUT)


if __name__ == "__main__":
    main()
