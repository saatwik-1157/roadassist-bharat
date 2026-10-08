/* RoadAssist — the live road scan's arithmetic, with no DOM and no model.
 *
 * Everything here is a port of the Python serving path, line for line, so the
 * browser and the server cannot disagree about a box or a severity:
 *
 *   severity()            ai/road_damage/severity.py
 *   letterboxShape()      onnx_detector.letterbox_shape (ultralytics' LetterBox)
 *   letterboxParams()     onnx_detector.letterbox_params
 *   letterboxTensor()     onnx_detector.letterbox + resize_linear (cv2 INTER_LINEAR)
 *   undoLetterbox()       onnx_detector.undo_letterbox
 *   iou(), nms()          onnx_detector.iou / nms
 *   decode()              onnx_detector.decode
 *
 * A letterbox that is wrong does not crash: it shifts every box, and on this
 * platform a box becomes a pin on an authority's map. So these are pinned by
 * apps/api/test/scan-core.test.ts against the Python constants and by
 * scripts/scan-check.mjs against serve.py's actual output on the same images.
 *
 * A classic script (no import/export), like photo-shrink.js: scan.html loads it
 * with a plain <script src> and the unit test imports the same file. It only
 * defines globalThis.RAScanCore.
 */
(function (global) {
  "use strict";

  /* ── severity.py ──────────────────────────────────────────────────────── */

  /** Upper bound of each band, as a fraction of frame area (severity.BANDS). */
  var BANDS = [[0.01, 1], [0.03, 2], [0.07, 3], [0.15, 4]];
  /** Classes judged worse than their size alone suggests (severity.AGGRAVATED). */
  var AGGRAVATED = ["pothole"];
  var MIN_SEVERITY = 1;
  var MAX_SEVERITY = 5;

  /** Severity 1-5 for a detection covering `boxFrac` of the frame. */
  function severity(clsName, boxFrac) {
    var s = MAX_SEVERITY;
    for (var i = 0; i < BANDS.length; i++) {
      if (boxFrac < BANDS[i][0]) { s = BANDS[i][1]; break; }
    }
    if (AGGRAVATED.indexOf(clsName) >= 0) s = Math.min(MAX_SEVERITY, s + 1);
    return Math.max(MIN_SEVERITY, s);
  }

  /* ── onnx_detector.py ─────────────────────────────────────────────────── */

  /**
   * Classes the server's report enum accepts (onnx_detector.INGESTABLE). A
   * class outside it is shown and labelled, never sent as something else.
   */
  var INGESTABLE = ["pothole", "road_damage"];

  /**
   * Why a detected class is not filed, in the person's words. The report
   * route takes pothole, road_damage or obstruction (raksha.ts), and neither
   * rich-model class is honestly one of those: road_damage is cracking (the
   * model's own training map, convert_voc_to_yolo.MVP_MAP), so a worn line
   * filed under it would send a pavement crew to paint; and RDD2022's D50
   * labels every manhole cover, intact ones included, so filing it as an
   * obstruction would pin a hazard on every closed cover.
   */
  var NOT_REPORTABLE = {
    faded_marking: "a worn road marking is not a pothole, crack or obstruction, the only types RAKSHA takes",
    manhole: "the model finds manhole covers, closed ones included, so a cover is not a hazard by itself",
  };
  var NOT_REPORTABLE_DEFAULT = "RAKSHA takes only pothole, road damage and obstruction reports";

  /** The reason a detection cannot be reported, or null when it can. */
  function notReportableReason(clsName) {
    if (INGESTABLE.indexOf(clsName) >= 0) return null;
    return Object.prototype.hasOwnProperty.call(NOT_REPORTABLE, clsName) ? NOT_REPORTABLE[clsName] : NOT_REPORTABLE_DEFAULT;
  }

  /**
   * NMS IoU threshold (onnx_detector.NMS_IOU): ultralytics' predict default,
   * the value detect.py and serve.py share. A box is dropped when its IoU with
   * a stronger box of the same class is ABOVE it.
   */
  var NMS_IOU = 0.7;

  /** Python's round(): halves go to the even neighbour (round(2.5) == 2). */
  function pyRound(x) {
    var f = Math.floor(x), d = x - f;
    if (d > 0.5) return f + 1;
    if (d < 0.5) return f;
    return f % 2 === 0 ? f : f + 1;
  }

  /**
   * (scale, newW, newH, left, top): ultralytics' LetterBox(auto=False), as
   * onnx_detector.letterbox_shape computes it. The size is rounded, and the
   * padding split with round(d - 0.1), so an odd padding puts the extra pixel
   * at the bottom/right, where the model saw it in training.
   */
  function letterboxShape(srcW, srcH, dstW, dstH) {
    var scale = Math.min(dstW / srcW, dstH / srcH);
    var newW = Math.max(1, pyRound(srcW * scale)), newH = Math.max(1, pyRound(srcH * scale));
    return {
      scale: scale, newW: newW, newH: newH,
      left: pyRound((dstW - newW) / 2 - 0.1), top: pyRound((dstH - newH) / 2 - 0.1),
    };
  }

  /** Scale and the integer border actually painted, as decode() undoes it. */
  function letterboxParams(srcW, srcH, dstW, dstH) {
    var s = letterboxShape(srcW, srcH, dstW, dstH);
    return { scale: s.scale, padX: s.left, padY: s.top };
  }

  /** numpy's rint: round half to even. */
  var rint = pyRound;

  /**
   * Source taps and 11-bit weights for one axis, as onnx_detector._linear_taps
   * computes them (which is cv2 INTER_LINEAR's fixed-point arithmetic). The
   * float32 steps are float32 here too (Math.fround), because the weight a
   * pixel gets depends on where float32 rounds the fraction.
   */
  function linearTaps(srcN, dstN, clampFraction) {
    var i0 = new Int32Array(dstN), i1 = new Int32Array(dstN), w0 = new Int32Array(dstN), w1 = new Int32Array(dstN);
    var ratio = srcN / dstN;
    for (var i = 0; i < dstN; i++) {
      var f = Math.fround((i + 0.5) * ratio - 0.5);
      var a = Math.floor(f);
      var frac = Math.fround(f - a);
      if (clampFraction) {
        if (a < 0) { frac = 0; a = 0; }
        if (a >= srcN - 1) { frac = 0; a = srcN - 1; }
      }
      w1[i] = rint(Math.fround(frac * 2048));
      w0[i] = rint(Math.fround(Math.fround(1 - frac) * 2048));
      i0[i] = Math.min(Math.max(a, 0), srcN - 1);
      i1[i] = Math.min(Math.max(a + 1, 0), srcN - 1);
    }
    return { i0: i0, i1: i1, w0: w0, w1: w1 };
  }

  /**
   * RGBA source pixels -> the model's NCHW float32 input, letterboxed exactly
   * as onnx_detector.letterbox does it: cv2-style INTER_LINEAR resize (not the
   * browser's smoothed drawImage, which is a softer image than training saw),
   * pasted at (left, top) on 114 grey, scaled to [0, 1].
   */
  function letterboxTensor(rgba, srcW, srcH, dstW, dstH) {
    var g = letterboxShape(srcW, srcH, dstW, dstH);
    var plane = dstW * dstH, out = new Float32Array(3 * plane).fill(114 / 255);
    var same = g.newW === srcW && g.newH === srcH;
    var ty = same ? null : linearTaps(srcH, g.newH, false);
    var tx = same ? null : linearTaps(srcW, g.newW, true);
    for (var y = 0; y < g.newH; y++) {
      var oy = (g.top + y) * dstW + g.left;
      for (var x = 0; x < g.newW; x++) {
        var o = oy + x;
        for (var c = 0; c < 3; c++) {
          var v;
          if (same) {
            v = rgba[(y * srcW + x) * 4 + c];
          } else {
            var r0 = ty.i0[y] * srcW, r1 = ty.i1[y] * srcW, x0 = tx.i0[x], x1 = tx.i1[x];
            var row0 = rgba[(r0 + x0) * 4 + c] * tx.w0[x] + rgba[(r0 + x1) * 4 + c] * tx.w1[x];
            var row1 = rgba[(r1 + x0) * 4 + c] * tx.w0[x] + rgba[(r1 + x1) * 4 + c] * tx.w1[x];
            v = ((((row0 >> 4) * ty.w0[y]) >> 16) + (((row1 >> 4) * ty.w1[y]) >> 16) + 2) >> 2;
            if (v > 255) v = 255; else if (v < 0) v = 0;
          }
          out[c * plane + o] = v / 255;
        }
      }
    }
    return out;
  }

  function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }

  function undoLetterbox(box, scale, padX, padY, srcW, srcH) {
    return [
      clamp((box[0] - padX) / scale, 0, srcW),
      clamp((box[1] - padY) / scale, 0, srcH),
      clamp((box[2] - padX) / scale, 0, srcW),
      clamp((box[3] - padY) / scale, 0, srcH),
    ];
  }

  function iou(a, b) {
    var ix1 = Math.max(a[0], b[0]), iy1 = Math.max(a[1], b[1]);
    var ix2 = Math.min(a[2], b[2]), iy2 = Math.min(a[3], b[3]);
    var inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
    if (inter <= 0) return 0;
    var areaA = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]);
    var areaB = Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
    var union = areaA + areaB - inter;
    return union > 0 ? inter / union : 0;
  }

  /** Greedy NMS, best score first. Per-class suppression is the caller's job. */
  function nms(boxes, scores, iouThreshold) {
    var order = boxes.map(function (_, i) { return i; });
    // Array.prototype.sort is stable, as Python's sorted() is, so equal scores
    // keep their anchor order on both sides.
    order.sort(function (x, y) { return scores[y] - scores[x]; });
    var kept = [];
    while (order.length) {
      var best = order.shift();
      kept.push(best);
      order = order.filter(function (i) { return iou(boxes[best], boxes[i]) <= iouThreshold; });
    }
    return kept;
  }

  /**
   * A YOLO11 output, [4 + classes, anchors] row-major, to detections in SOURCE
   * pixels. No objectness channel: the class score is the confidence.
   *
   * `data` is the flat output tensor (Float32Array), `rows` and `anchors` its
   * last two dimensions, `classNames` the sidecar's list in index order.
   */
  function decode(data, rows, anchors, classNames, srcW, srcH, modelW, modelH, minConf, iouThreshold) {
    var numClasses = rows - 4;
    if (numClasses < 1) throw new Error("unexpected model output with " + rows + " rows");
    if (data.length < rows * anchors) throw new Error("model output is shorter than its shape");
    minConf = minConf == null ? 0.30 : minConf;
    iouThreshold = iouThreshold == null ? NMS_IOU : iouThreshold;

    var lb = letterboxParams(srcW, srcH, modelW, modelH);
    var frame = srcW * srcH;

    // Insertion-ordered, like the Python dict it mirrors.
    var perClass = new Map();
    for (var a = 0; a < anchors; a++) {
      var bestCls = -1, bestScore = 0;
      for (var c = 0; c < numClasses; c++) {
        var s = data[(4 + c) * anchors + a];
        if (s > bestScore) { bestCls = c; bestScore = s; }
      }
      if (bestCls < 0 || bestScore < minConf) continue;
      var cx = data[a], cy = data[anchors + a], w = data[2 * anchors + a], h = data[3 * anchors + a];
      if (!perClass.has(bestCls)) perClass.set(bestCls, { boxes: [], scores: [] });
      var g = perClass.get(bestCls);
      g.boxes.push([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2]);
      g.scores.push(bestScore);
    }

    var out = [];
    perClass.forEach(function (g, clsId) {
      var keep = nms(g.boxes, g.scores, iouThreshold);
      for (var k = 0; k < keep.length; k++) {
        var i = keep[k];
        var name = classNames[clsId];
        if (name == null) continue;   // a class the model knows and the sidecar does not name
        var box = undoLetterbox(g.boxes[i], lb.scale, lb.padX, lb.padY, srcW, srcH);
        var frac = frame ? Math.max(0, (box[2] - box[0]) * (box[3] - box[1])) / frame : 0;
        out.push({
          type: name,
          confidence: g.scores[i],
          severity: severity(name, frac),
          boxFraction: frac,
          box: box,
          ingestable: INGESTABLE.indexOf(name) >= 0,
        });
      }
    });
    out.sort(function (x, y) { return y.confidence - x.confidence; });
    return out;
  }

  /* ── browser-side helpers that are still pure ─────────────────────────── */

  /**
   * The detection a report is filed under: the most severe one the server's
   * enum accepts, ties broken by confidence. null when nothing is reportable.
   */
  function pickReport(detections) {
    var best = null;
    (detections || []).forEach(function (d) {
      if (!d.ingestable) return;
      if (!best || d.severity > best.severity ||
          (d.severity === best.severity && d.confidence > best.confidence)) best = d;
    });
    return best;
  }

  var NOTE_MAX = 280;   // POST /v1/raksha/report: note is z.string().max(280)

  /**
   * The report's note: every detection in the frame, as the model's prediction
   * with its confidence. The report itself carries only the reported
   * detection's confidence and the model version (stored on the RAKSHA row),
   * so this note is the only place the OTHER detections' numbers travel -
   * which is why they are spelled out here.
   */
  function reportNote(detections, modelVersion) {
    var head = "Live road scan, on-device model " + modelVersion + " (predictions, not verified):";
    var parts = (detections || []).map(function (d) {
      return " " + d.type + " " + Math.round(d.confidence * 100) + "% sev " + d.severity +
        (d.ingestable ? "" : " (not reportable)");
    });
    var tail = " Boxes on the photo are the model's.";
    var note = head;
    for (var i = 0; i < parts.length; i++) {
      var more = parts.length - i - 1;
      var piece = parts[i] + (i < parts.length - 1 ? ";" : ".");
      var reserve = more ? (" +" + more + " more.").length : 0;
      if ((note + piece).length + reserve + tail.length > NOTE_MAX) {
        note += " +" + (parts.length - i) + " more.";
        break;
      }
      note += piece;
    }
    if ((note + tail).length <= NOTE_MAX) note += tail;
    return note.slice(0, NOTE_MAX);
  }

  /** Frames per second over a sliding window of completed inferences. */
  function FpsMeter(windowMs) {
    this.windowMs = windowMs || 3000;
    this.stamps = [];
  }
  FpsMeter.prototype.tick = function (now) {
    this.stamps.push(now);
    var cutoff = now - this.windowMs;
    while (this.stamps.length && this.stamps[0] < cutoff) this.stamps.shift();
  };
  FpsMeter.prototype.fps = function (now) {
    var cutoff = now - this.windowMs;
    var recent = this.stamps.filter(function (t) { return t >= cutoff; });
    if (recent.length < 2) return 0;
    return (recent.length - 1) / ((recent[recent.length - 1] - recent[0]) / 1000);
  };
  FpsMeter.prototype.reset = function () { this.stamps = []; };

  /** Delay before the next inference so the loop never exceeds `maxFps`. */
  function nextDelay(elapsedMs, maxFps) {
    return Math.max(0, 1000 / maxFps - elapsedMs);
  }

  global.RAScanCore = {
    BANDS: BANDS, AGGRAVATED: AGGRAVATED, MIN_SEVERITY: MIN_SEVERITY, MAX_SEVERITY: MAX_SEVERITY,
    INGESTABLE: INGESTABLE, NOT_REPORTABLE: NOT_REPORTABLE, notReportableReason: notReportableReason,
    NMS_IOU: NMS_IOU, NOTE_MAX: NOTE_MAX,
    severity: severity, letterboxShape: letterboxShape, letterboxParams: letterboxParams,
    linearTaps: linearTaps, letterboxTensor: letterboxTensor, pyRound: pyRound,
    undoLetterbox: undoLetterbox, iou: iou, nms: nms, decode: decode,
    pickReport: pickReport, reportNote: reportNote, FpsMeter: FpsMeter, nextDelay: nextDelay,
  };
})(globalThis);
