/**
 * The live road scan's arithmetic (apps/web/scan-core.js), held to the Python
 * serving path it ports. The literal file the browser loads is imported.
 *
 * Three kinds of check:
 *   · the severity rule's constants are READ from ai/road_damage/severity.py
 *     and compared, so a change on one side fails here, not on a map;
 *   · the geometry and decode cases are ai/tests/test_onnx_detector.py's own,
 *     run against the JavaScript;
 *   · every detection serve.py produced for the bundled sample images
 *     (scripts/scan-reference.json) gets the same severity from the port.
 * The browser's actual boxes are compared with serve.py's by scripts/scan-check.mjs.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import "../../web/scan-core.js";

type Det = { type: string; confidence: number; severity: number; boxFraction: number; box: number[]; ingestable: boolean };
const C = (globalThis as unknown as {
  RAScanCore: {
    BANDS: Array<[number, number]>; AGGRAVATED: string[]; MIN_SEVERITY: number; MAX_SEVERITY: number;
    INGESTABLE: string[]; NOT_REPORTABLE: Record<string, string>; NMS_IOU: number; NOTE_MAX: number;
    notReportableReason(cls: string): string | null;
    severity(cls: string, frac: number): number;
    letterboxParams(sw: number, sh: number, dw: number, dh: number): { scale: number; padX: number; padY: number };
    letterboxShape(sw: number, sh: number, dw: number, dh: number): { scale: number; newW: number; newH: number; left: number; top: number };
    letterboxTensor(rgba: Uint8ClampedArray, sw: number, sh: number, dw: number, dh: number): Float32Array;
    pyRound(x: number): number;
    undoLetterbox(box: number[], scale: number, px: number, py: number, sw: number, sh: number): number[];
    iou(a: number[], b: number[]): number;
    nms(boxes: number[][], scores: number[], thr: number): number[];
    decode(data: Float32Array, rows: number, anchors: number, names: string[], sw: number, sh: number,
      mw: number, mh: number, minConf?: number, iou?: number): Det[];
    pickReport(d: Det[]): Det | null;
    reportNote(d: Det[], model: string): string;
    nextDelay(elapsed: number, maxFps: number): number;
  };
}).RAScanCore;

const REPO = new URL("../../../../", import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, REPO), "utf8");

/** Build a flat [4 + classes, anchors] output from per-anchor tuples, as the Python test does. */
function output(rows: Array<[number, number, number, number, number[]]>) {
  const anchors = rows.length, nrows = 4 + rows[0][4].length;
  const data = new Float32Array(nrows * anchors);
  rows.forEach(([cx, cy, w, h, scores], a) => {
    data[a] = cx; data[anchors + a] = cy; data[2 * anchors + a] = w; data[3 * anchors + a] = h;
    scores.forEach((s, c) => { data[(4 + c) * anchors + a] = s; });
  });
  return { data, rows: nrows, anchors };
}
const NAMES = ["pothole", "road_damage", "faded_marking", "manhole"];
const dec = (o: ReturnType<typeof output>, minConf?: number) =>
  C.decode(o.data, o.rows, o.anchors, NAMES, 512, 512, 512, 512, minConf);

describe("scan-core.js severity is severity.py", () => {
  it("has the same bands, aggravated classes and range as the Python file", () => {
    const py = read("ai/road_damage/severity.py");
    const bands = /BANDS = \((.+)\)\r?\n/.exec(py)![1];
    const parsed = [...bands.matchAll(/\(([\d.]+), (\d)\)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    assert.deepEqual(C.BANDS, parsed);
    const agg = /AGGRAVATED = \(([^)]*)\)/.exec(py)![1];
    assert.deepEqual(C.AGGRAVATED, [...agg.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));
    assert.equal(C.MIN_SEVERITY, Number(/MIN_SEVERITY = (\d)/.exec(py)![1]));
    assert.equal(C.MAX_SEVERITY, Number(/MAX_SEVERITY = (\d)/.exec(py)![1]));
  });

  it("matches the band edges exactly (a band's upper bound belongs to the next band)", () => {
    assert.equal(C.severity("road_damage", 0), 1);
    assert.equal(C.severity("road_damage", 0.0099), 1);
    assert.equal(C.severity("road_damage", 0.01), 2);
    assert.equal(C.severity("road_damage", 0.03), 3);
    assert.equal(C.severity("road_damage", 0.07), 4);
    assert.equal(C.severity("road_damage", 0.15), 5);
    assert.equal(C.severity("road_damage", 0.9), 5);
  });

  it("raises a pothole one step and never past 5", () => {
    assert.equal(C.severity("pothole", 0.005), 2);
    assert.equal(C.severity("pothole", 0.1), 5);
    assert.equal(C.severity("pothole", 0.5), 5);
    assert.equal(C.severity("manhole", 0.005), 1);
  });

  it("gives every detection serve.py produced on the sample images the severity serve.py gave it", () => {
    const ref = JSON.parse(read("app/scripts/scan-reference.json"));
    let n = 0;
    for (const img of ref.images) {
      for (const d of img.detections) {
        // boxFraction is rounded to 5 places in the file; recompute it from the box.
        const frac = ((d.box[2] - d.box[0]) * (d.box[3] - d.box[1])) / (img.size[0] * img.size[1]);
        assert.equal(C.severity(d.type, frac), d.severity, `${img.image} ${d.type}`);
        n++;
      }
    }
    assert.ok(n >= 3, `only ${n} reference detections`);
  });
});

describe("scan-core.js letterbox is onnx_detector.py's", () => {
  it("needs no padding for a square image into a square input", () => {
    const p = C.letterboxParams(720, 720, 512, 512);
    assert.ok(Math.abs(p.scale - 512 / 720) < 1e-12);
    assert.equal(p.padX, 0); assert.equal(p.padY, 0);
  });
  it("pads a wide image top and bottom, a tall one left and right", () => {
    const wide = C.letterboxParams(1280, 720, 512, 512);
    assert.ok(Math.abs(wide.scale - 0.4) < 1e-12);
    assert.equal(wide.padX, 0); assert.ok(Math.abs(wide.padY - (512 - 288) / 2) < 1e-9);
    const tall = C.letterboxParams(720, 1280, 512, 512);
    assert.ok(Math.abs(tall.padX - (512 - 288) / 2) < 1e-9); assert.equal(tall.padY, 0);
  });
  it("round-trips a box through letterbox and back", () => {
    for (const [w, h] of [[720, 720], [1280, 720], [720, 1280], [640, 480]]) {
      const p = C.letterboxParams(w, h, 512, 512);
      const box = [w * 0.2, h * 0.3, w * 0.6, h * 0.9];
      const model = [box[0] * p.scale + p.padX, box[1] * p.scale + p.padY, box[2] * p.scale + p.padX, box[3] * p.scale + p.padY];
      C.undoLetterbox(model, p.scale, p.padX, p.padY, w, h).forEach((v, i) => assert.ok(Math.abs(v - box[i]) < 1e-4, `${w}x${h}`));
    }
  });
  it("clamps a box into the frame", () => {
    assert.deepEqual(C.undoLetterbox([-50, -50, 900, 900], 512 / 720, 0, 0, 720, 720), [0, 0, 720, 720]);
  });
  it("sizes and places the image as ultralytics' LetterBox does (onnx_detector.letterbox_shape)", () => {
    assert.equal(C.pyRound(2.5), 2); assert.equal(C.pyRound(3.5), 4); assert.equal(C.pyRound(287.6), 288);
    const shape = (w: number, h: number) => { const s = C.letterboxShape(w, h, 512, 512); return [s.newW, s.newH, s.left, s.top]; };
    assert.deepEqual(shape(1280, 720), [512, 288, 0, 112]);
    assert.deepEqual(shape(720, 405), [512, 288, 0, 112]);
    // An odd padding (512 - 169 = 343) puts the extra pixel at the bottom:
    // round(171.5 - 0.1) = 171 on top, 172 below.
    assert.deepEqual(shape(1000, 331), [512, 169, 0, 171]);
    // decode() undoes the integer border that was painted, not the fractional ideal.
    assert.deepEqual(C.letterboxParams(1000, 331, 512, 512).padY, 171);
  });
  it("reproduces onnx_detector.letterbox pixel for pixel (cv2 INTER_LINEAR, 114 grey border)", () => {
    const fx = JSON.parse(readFileSync(new URL("./scan-letterbox.fixture.json", import.meta.url), "utf8"));
    for (const c of fx.cases) {
      const [sw, sh] = c.src, [dw, dh] = c.dst;
      const s = C.letterboxShape(sw, sh, dw, dh);
      assert.deepEqual([s.newW, s.newH, s.left, s.top], c.shape.slice(1), `${sw}x${sh} shape`);
      const rgba = new Uint8ClampedArray(sw * sh * 4);
      for (let i = 0; i < sw * sh; i++) {
        rgba[i * 4] = c.rgb[i * 3]; rgba[i * 4 + 1] = c.rgb[i * 3 + 1]; rgba[i * 4 + 2] = c.rgb[i * 3 + 2]; rgba[i * 4 + 3] = 255;
      }
      const t = C.letterboxTensor(rgba, sw, sh, dw, dh), plane = dw * dh;
      let diff = 0;
      for (let p = 0; p < plane; p++) {
        for (let ch = 0; ch < 3; ch++) {
          if (Math.round(t[ch * plane + p] * 255) !== c.letterboxed[p * 3 + ch]) diff++;
        }
      }
      assert.equal(diff, 0, `${sw}x${sh} -> ${dw}x${dh}: ${diff} channel values differ from Python`);
    }
  });
});

describe("scan-core.js IoU and NMS are onnx_detector.py's", () => {
  it("computes IoU on the Python test's cases", () => {
    assert.equal(C.iou([0, 0, 10, 10], [0, 0, 10, 10]), 1);
    assert.equal(C.iou([0, 0, 10, 10], [20, 20, 30, 30]), 0);
    assert.equal(C.iou([0, 0, 10, 10], [10, 0, 20, 10]), 0);
    assert.ok(Math.abs(C.iou([0, 0, 10, 10], [5, 0, 15, 10]) - 50 / 150) < 1e-12);
    assert.ok(Math.abs(C.iou([74, 469, 355, 572], [20, 473, 368, 576]) - 0.753) < 5e-4);
    assert.equal(C.iou([5, 5, 5, 5], [0, 0, 10, 10]), 0);
  });
  it("suppresses a cluster to its strongest box, keeps separate ones, returns best first", () => {
    assert.deepEqual(C.nms([[0, 0, 10, 10], [1, 1, 11, 11], [2, 2, 12, 12]], [0.5, 0.9, 0.6], 0.45), [1]);
    assert.deepEqual(C.nms([[0, 0, 10, 10], [100, 100, 110, 110]], [0.5, 0.9], 0.45).sort(), [0, 1]);
    assert.deepEqual(C.nms([[0, 0, 10, 10], [100, 100, 110, 110], [200, 200, 210, 210]], [0.1, 0.9, 0.5], 0.45), [1, 2, 0]);
    assert.deepEqual(C.nms([], [], 0.45), []);
  });
});

describe("scan-core.js decode is onnx_detector.decode", () => {
  it("decodes a centred box to the centre of the source", () => {
    const [d] = dec(output([[256, 256, 100, 100, [0.9, 0, 0, 0]]]));
    assert.equal(d.type, "pothole");
    assert.ok(Math.abs(d.box[0] - 206) < 1e-9 && Math.abs(d.box[2] - 306) < 1e-9);
  });
  it("takes the class score as the confidence (no objectness channel)", () => {
    const [d] = dec(output([[256, 256, 50, 50, [0.42, 0, 0, 0]]]));
    assert.ok(Math.abs(d.confidence - 0.42) < 1e-6);
  });
  it("lets the highest-scoring class win and drops anchors under the threshold", () => {
    assert.equal(dec(output([[256, 256, 50, 50, [0.3, 0.8, 0.1, 0.2]]]))[0].type, "road_damage");
    const found = dec(output([[100, 100, 20, 20, [0.1, 0, 0, 0]], [300, 300, 20, 20, [0.8, 0, 0, 0]]]), 0.3);
    assert.equal(found.length, 1);
  });
  it("collapses overlapping anchors of one class but never across classes", () => {
    assert.equal(dec(output([[256, 256, 100, 100, [0.7, 0, 0, 0]], [258, 258, 100, 100, [0.9, 0, 0, 0]]])).length, 1);
    const two = dec(output([[256, 256, 100, 100, [0.8, 0, 0, 0]], [256, 256, 110, 110, [0, 0.75, 0, 0]]]));
    assert.deepEqual(two.map((d) => d.type).sort(), ["pothole", "road_damage"]);
  });
  it("returns the strongest first and takes severity from the shared rule", () => {
    const found = dec(output([[50, 50, 20, 20, [0.4, 0, 0, 0]], [400, 400, 20, 20, [0.95, 0, 0, 0]], [200, 200, 20, 20, [0.6, 0, 0, 0]]]));
    assert.deepEqual(found.map((d) => Math.round(d.confidence * 100) / 100), [0.95, 0.6, 0.4]);
    const [big] = dec(output([[256, 256, 362, 362, [0.9, 0, 0, 0]]]));
    assert.equal(big.severity, 5); assert.ok(big.boxFraction > 0.4);
  });
  it("flags, and keeps, a class the report endpoint cannot accept", () => {
    const found = dec(output([[100, 100, 30, 30, [0.9, 0, 0, 0]], [300, 300, 30, 30, [0, 0, 0, 0.9]]]));
    const by = Object.fromEntries(found.map((d) => [d.type, d.ingestable]));
    assert.equal(by.pothole, true); assert.equal(by.manhole, false);
    assert.deepEqual(C.INGESTABLE, ["pothole", "road_damage"]);
  });
  it("says why each class outside the enum is not filed, and nothing for one inside it", () => {
    assert.equal(C.notReportableReason("pothole"), null);
    assert.equal(C.notReportableReason("road_damage"), null);
    assert.match(C.notReportableReason("manhole")!, /manhole covers, closed ones included/);
    assert.match(C.notReportableReason("faded_marking")!, /marking/);
    assert.match(C.notReportableReason("some_future_class")!, /pothole, road damage and obstruction/);
  });
  it("can say something true about every class of every model the page serves", () => {
    // The sidecars scan.js loads (its MODEL_SIDECAR_* lines: the WebGPU model
    // and the WebAssembly one), not a copy of their class lists.
    const js = read("app/apps/web/scan.js");
    const paths = [...js.matchAll(/var MODEL_SIDECAR_[A-Z]+ = "([^"]+)";/g)].map((m) => m[1]);
    assert.equal(paths.length, 2, "scan.js names a WebGPU and a WebAssembly model");
    for (const path of paths) {
      const sidecar = JSON.parse(read("app/apps/web/" + path));
      for (const cls of sidecar.classes as string[]) {
        assert.ok(C.INGESTABLE.includes(cls) || cls in C.NOT_REPORTABLE, `${path}: ${cls} has no reason for not being reportable`);
      }
    }
    // The report route's enum (raksha.ts) is what INGESTABLE may contain.
    const route = /app\.post\("\/v1\/raksha\/report"[\s\S]*?type: z\.enum\(\[([^\]]+)\]\)/.exec(read("app/apps/api/src/raksha.ts"))![1];
    const accepted = [...route.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    for (const cls of C.INGESTABLE) assert.ok(accepted.includes(cls), `${cls} is not a type POST /v1/raksha/report accepts`);
  });
  it("decodes the two-class model through the same code, and refuses a malformed output", () => {
    const o = output([[256, 256, 60, 60, [0.1, 0.85]]]);
    const [d] = C.decode(o.data, o.rows, o.anchors, ["pothole", "road_damage"], 512, 512, 512, 512);
    assert.equal(d.type, "road_damage");
    assert.throws(() => C.decode(new Float32Array(4), 4, 1, NAMES, 512, 512, 512, 512), /unexpected model output/);
  });
  it("maps a letterboxed box back to the wide source", () => {
    // 1280x720 into 512: scale 0.4, 112 px bars top and bottom.
    const o = output([[256, 112 + 144, 40, 40, [0.9, 0]]]);
    const [d] = C.decode(o.data, o.rows, o.anchors, ["pothole", "road_damage"], 1280, 720, 512, 512);
    assert.deepEqual(d.box.map((v) => Math.round(v * 1000) / 1000), [590, 310, 690, 410]);
  });
});

describe("scan-core.js report helpers", () => {
  const det = (type: string, confidence: number, severity: number, ingestable = true): Det =>
    ({ type, confidence, severity, ingestable, boxFraction: 0.01, box: [0, 0, 1, 1] });

  it("files the most severe reportable prediction, ties broken by confidence", () => {
    assert.equal(C.pickReport([det("road_damage", 0.9, 2), det("pothole", 0.4, 4)])!.type, "pothole");
    assert.equal(C.pickReport([det("pothole", 0.4, 3), det("road_damage", 0.6, 3)])!.confidence, 0.6);
    assert.equal(C.pickReport([det("manhole", 0.9, 5, false)]), null, "a class outside the enum is never filed");
    assert.equal(C.pickReport([]), null);
  });

  it("writes a note that says these are predictions and always fits the server's 280 characters", () => {
    const one = C.reportNote([det("pothole", 0.62, 4)], "yolo11n-multi-rich-gpu-best-640-7645b9b9");
    assert.match(one, /predictions, not verified/);
    assert.match(one, /pothole 62% sev 4/);
    const many = C.reportNote(Array.from({ length: 40 }, (_, i) => det(i % 2 ? "pothole" : "road_damage", 0.5, 3)), "yolo11n-multi-rich-gpu-best-640-7645b9b9");
    assert.ok(many.length <= C.NOTE_MAX, `note is ${many.length} characters`);
    assert.match(many, /\+\d+ more\./);
    assert.match(C.reportNote([det("manhole", 0.8, 2, false)], "m"), /not reportable/);
  });

  it("throttles the loop to the frame cap and never schedules a negative delay", () => {
    assert.equal(C.nextDelay(25, 8), 100);
    assert.equal(C.nextDelay(300, 8), 0);
  });

  it("uses the serving path's NMS threshold", () => {
    const py = read("ai/road_damage/onnx_detector.py");
    assert.equal(C.NMS_IOU, Number(/^NMS_IOU = ([\d.]+)/m.exec(py)![1]));
  });
});
