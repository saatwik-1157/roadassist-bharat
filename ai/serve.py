"""RAKSHA detection service — the trained model, over HTTP.

    python ai/serve.py --weights ai/runs/yolo11s-multi-rich/weights/best.onnx

Then point the platform at it:

    RAKSHA_DETECT_URL=http://localhost:8500

── what this is, and what it is not ────────────────────────────────────────
It serves the road-damage detectors. It does NOT implement `/diagnose`, the
endpoint `AI_BASE_URL` expects, and it will not pretend to: no vehicle-fault
model has been trained, the platform's diagnosis is a rules engine by decision
(ADR-0006), and a stub returning plausible-looking faults would be exactly the
kind of thing CLAIMS-AUDIT.md exists to catch. `GET /health` says so out loud.

── the dependency argument ─────────────────────────────────────────────────
onnxruntime + numpy + pillow, about 50 MB, all Apache-2.0 or BSD/MIT. Not
ultralytics, which pulls ~2 GB of PyTorch and is AGPL-3.0. Training keeps using
ultralytics; only the serving path has to be small and distributable. See
`road_damage/onnx_detector.py` for the full reasoning.

── the stdlib HTTP server ──────────────────────────────────────────────────
`ThreadingHTTPServer`, not FastAPI, for the same reason: this is one route and
a health check, and a web framework would be the largest dependency in the file.
It is a single-purpose inference service on a private network, not a public API.
Requests are bounded by `--max-bytes`; ONNX Runtime holds its own thread pool,
so inference is serialised behind a lock rather than fighting itself.
"""
from __future__ import annotations

import argparse
import io
import json
import logging
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "road_damage"))

from onnx_detector import decode, read_class_names, read_input_size  # noqa: E402

log = logging.getLogger("raksha.serve")


class Detector:
    """Loads the model once and serialises inference behind a lock."""

    def __init__(self, weights: Path, min_conf: float, iou: float):
        import numpy as np
        import onnxruntime as ort

        self.np = np
        self.weights = weights
        self.min_conf = min_conf
        self.iou = iou
        self.lock = threading.Lock()

        log.info("loading %s", weights)
        self.session = ort.InferenceSession(str(weights), providers=["CPUExecutionProvider"])
        self.class_names = read_class_names(self.session)
        self.model_w, self.model_h = read_input_size(self.session)
        self.input_name = self.session.get_inputs()[0].name
        # Matches detect.py, so a detection is traceable to a run either way.
        self.model_version = f"yolo-rdd2022in-{weights.stem}"
        log.info("classes=%s input=%dx%d", self.class_names, self.model_w, self.model_h)

    def preprocess(self, image_bytes: bytes):
        """Decode, letterbox to the model's input size, normalise to NCHW float32."""
        from PIL import Image

        np = self.np
        img = Image.open(io.BytesIO(image_bytes))
        # EXIF orientation: a phone photo is routinely stored rotated with a tag
        # saying so. Ignoring it detects potholes in a sideways world.
        try:
            from PIL import ImageOps
            img = ImageOps.exif_transpose(img)
        except Exception:  # noqa: BLE001 - a missing tag must not fail a detection
            pass
        img = img.convert("RGB")
        src_w, src_h = img.size

        scale = min(self.model_w / src_w, self.model_h / src_h)
        new_w, new_h = max(1, round(src_w * scale)), max(1, round(src_h * scale))
        resized = img.resize((new_w, new_h), Image.BILINEAR)

        # 114 grey is the padding ultralytics trains with; a black border would
        # be a feature the model has never seen.
        canvas = Image.new("RGB", (self.model_w, self.model_h), (114, 114, 114))
        canvas.paste(resized, ((self.model_w - new_w) // 2, (self.model_h - new_h) // 2))

        arr = np.asarray(canvas, dtype=np.float32) / 255.0
        return np.transpose(arr, (2, 0, 1))[None, ...], src_w, src_h

    def detect(self, image_bytes: bytes):
        t0 = time.perf_counter()
        tensor, src_w, src_h = self.preprocess(image_bytes)
        with self.lock:
            outputs = self.session.run(None, {self.input_name: tensor})
        raw = outputs[0][0]                      # [4 + classes, anchors]
        detections = decode(
            raw.tolist(), self.class_names, src_w, src_h,
            self.model_w, self.model_h, self.min_conf, self.iou,
        )
        return detections, (time.perf_counter() - t0) * 1000.0, (src_w, src_h)


def make_handler(det: Detector, max_bytes: int):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "raksha-serve"

        def _json(self, code: int, payload: dict):
            body = json.dumps(payload).encode("utf-8")
            self.send_response(code)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, fmt, *args):            # quieter than the default
            log.info("%s - %s", self.address_string(), fmt % args)

        def do_GET(self):
            if self.path.split("?")[0] != "/health":
                return self._json(404, {"error": {"code": "not_found"}})
            self._json(200, {
                "status": "ok",
                "model": det.model_version,
                "weights": det.weights.name,
                "classes": list(det.class_names.values()),
                "inputSize": [det.model_w, det.model_h],
                "minConfidence": det.min_conf,
                # Stated on every health check so nobody wires AI_BASE_URL here
                # and wonders why diagnosis never improves.
                "diagnose": "not implemented — no vehicle-fault model is trained; "
                            "the platform's diagnosis is a rules engine by decision (ADR-0006)",
            })

        def do_POST(self):
            if self.path.split("?")[0] != "/detect":
                return self._json(404, {"error": {"code": "not_found"}})

            try:
                length = int(self.headers.get("content-length") or 0)
            except ValueError:
                return self._json(400, {"error": {"code": "bad_content_length"}})
            if length <= 0:
                return self._json(400, {"error": {"code": "empty_body",
                                                  "title": "POST the image bytes as the body"}})
            if length > max_bytes:
                return self._json(413, {"error": {"code": "image_too_large",
                                                  "title": f"max {max_bytes} bytes"}})

            body = self.rfile.read(length)
            try:
                detections, ms, (w, h) = det.detect(body)
            except Exception as exc:  # noqa: BLE001
                # An undecodable image is the caller's problem and must not take
                # the service down; the detail is logged, never returned.
                log.warning("detect failed: %s", exc, exc_info=True)
                return self._json(400, {"error": {"code": "undecodable_image",
                                                  "title": "could not read that image"}})

            ingestable = [d for d in detections if d.ingestable]
            self._json(200, {
                "model": det.model_version,
                "imageSize": [w, h],
                "inferenceMs": round(ms, 1),
                "detections": [d.to_ingest(det.model_version) for d in ingestable],
                "notIngestable": [
                    {"type": d.type, "confidence": round(d.confidence, 3)}
                    for d in detections if not d.ingestable
                ],
                "note": "severity is a documented box-area heuristic, not a safety "
                        "standard. notIngestable classes are detected but the server's "
                        "enum does not accept them yet — reported, never silently sent.",
            })

    return Handler


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--weights", required=True, help="path to a .onnx export")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8500)
    ap.add_argument("--min-conf", type=float, default=0.30)
    ap.add_argument("--iou", type=float, default=0.45)
    ap.add_argument("--max-bytes", type=int, default=8_000_000)
    args = ap.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    weights = Path(args.weights)
    if not weights.exists():
        raise SystemExit(f"no weights at {weights}")
    if weights.suffix != ".onnx":
        raise SystemExit(
            f"{weights.name} is not an ONNX export. This service deliberately does not "
            "load .pt — that would need ultralytics and PyTorch. Export first:\n"
            "  yolo export model=best.pt format=onnx"
        )

    det = Detector(weights, args.min_conf, args.iou)
    server = ThreadingHTTPServer((args.host, args.port), make_handler(det, args.max_bytes))
    log.info("listening on http://%s:%d  (POST /detect, GET /health)", args.host, args.port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("shutting down")
        server.shutdown()


if __name__ == "__main__":
    main()
