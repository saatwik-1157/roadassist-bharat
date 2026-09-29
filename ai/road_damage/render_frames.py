"""
Render the RAKSHA dashboard's hazard frames: each RDD2022 India image behind a
live detection, with the model's own boxes drawn on it.

    cd ai
    .venv/Scripts/python road_damage/render_frames.py \
        --weights ../runs/runs/full/weights/best.pt \
        --report cv-live-show.json --out ../app/apps/web/assets/raksha-frames

The dashboard's detections come from cv-live-show.json (replayed into the API
by scripts/raksha-simulator.mjs). This re-runs the SAME weights on the same
images and keeps only the boxes whose class and confidence match a detection
in that report, so every box on a frame is one the dashboard lists: nothing is
hand-drawn and nothing extra is shown. It fails if any detection cannot be
matched, which is how a wrong checkpoint is caught rather than published.

Images are RDD2022 (Arya et al., CC BY-SA 4.0); the annotated frames are a
derivative under the same licence and the dashboard credits it.
"""
import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from ultralytics import YOLO

COLOURS = {"pothole": (255, 122, 69), "road_damage": (54, 214, 224)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", required=True)
    ap.add_argument("--report", default="cv-live-show.json")
    ap.add_argument("--images", nargs="+", default=["data/yolo-full/images/val", "data/India/train/images"])
    ap.add_argument("--out", required=True)
    ap.add_argument("--width", type=int, default=960)
    args = ap.parse_args()

    report = json.loads(Path(args.report).read_text(encoding="utf8"))
    wanted = {r["imageRef"]: r["detections"] for r in report["results"] if r["detections"]}
    model = YOLO(args.weights, task="detect")
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    try:
        font = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 22)
    except OSError:
        font = ImageFont.load_default()

    unmatched = []
    for name, dets in wanted.items():
        path = next((Path(d) / name for d in args.images if (Path(d) / name).exists()), None)
        if path is None:
            sys.exit(f"missing source image {name}")
        result = model.predict(str(path), imgsz=640, conf=0.30, verbose=False)[0]
        boxes = [(model.names[int(b.cls[0])], float(b.conf[0]), [float(v) for v in b.xyxy[0]])
                 for b in result.boxes]
        keep = []
        for d in dets:
            hit = next((b for b in boxes if b[0] == d["type"] and abs(b[1] - d["confidence"]) < 0.002), None)
            if hit is None:
                unmatched.append(f"{name}: {d['type']} {d['confidence']}")
            else:
                keep.append(hit)

        image = Image.open(path).convert("RGB")
        scale = args.width / image.width
        image = image.resize((args.width, round(image.height * scale)), Image.LANCZOS)
        draw = ImageDraw.Draw(image, "RGBA")
        for cls, conf, (x1, y1, x2, y2) in keep:
            x1, y1, x2, y2 = (v * scale for v in (x1, y1, x2, y2))
            colour = COLOURS.get(cls, (240, 180, 41))
            draw.rectangle([x1, y1, x2, y2], fill=colour + (22,), outline=colour + (255,), width=4)
            label = f"{cls.replace('_', ' ')} {conf:.2f}"
            width = draw.textlength(label, font=font)
            top = y1 - 32 if y1 > 34 else y1 + 4
            draw.rounded_rectangle([x1, top, x1 + width + 16, top + 30], radius=6, fill=colour + (235,))
            draw.text((x1 + 8, top + 3), label, fill=(8, 10, 14), font=font)
        image.save(out / name.replace(".jpg", ".webp"), "WEBP", quality=80, method=6)

    if unmatched:
        sys.exit("detections the weights did not reproduce (wrong checkpoint?):\n  " + "\n  ".join(unmatched))
    print(f"{len(wanted)} frames, {sum(len(d) for d in wanted.values())} detections, all matched -> {out}")


if __name__ == "__main__":
    main()
