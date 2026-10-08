package `in`.roadassist.app

import kotlin.math.max
import kotlin.math.min

/**
 * The scanner's pre- and post-processing, as pure Kotlin with no Android types,
 * so all of it runs in a JVM unit test against the real model.
 *
 * It is a port of the Python serving path, which is the reference
 * (ai/serve.py's preprocess and ai/road_damage/onnx_detector.py):
 *  - [letterboxTensor] is onnx_detector.letterbox: ultralytics' LetterBox
 *    (auto=False). The image is resized to round(side * scale) with OpenCV's
 *    INTER_LINEAR arithmetic ([resizeLinear]: 11-bit fixed-point weights and
 *    the same shifts, so the pixels are cv2's, which is what the model saw in
 *    training), placed at round(pad - 0.1) on a 114-grey canvas, divided by
 *    255 as float32, NCHW.
 *  - [decode], [nms], [iou], [letterboxParams] and [undoLetterbox] are
 *    onnx_detector.py line for line; boxes are un-letterboxed with the same
 *    integer padding that was painted.
 *
 * Android's own bitmap scaler is not used: its sampling differs from cv2's,
 * and the boxes would drift from what the server's detector finds on the same
 * picture. DetectorParityTest holds the tensor to the Python's byte for byte.
 */
object Detector {

    /** One detection in SOURCE pixel space (the upright image). */
    data class Detection(
        val label: String,
        val classIndex: Int,
        val confidence: Double,
        val severity: Int,
        val boxFraction: Double,
        val x1: Double,
        val y1: Double,
        val x2: Double,
        val y2: Double,
    )

    // ── pixels ────────────────────────────────────────────────────────────

    /** An upright image as packed 0xAARRGGBB ints, row-major. */
    class Image(val argb: IntArray, val width: Int, val height: Int) {
        init {
            require(width > 0 && height > 0 && argb.size == width * height) { "bad image ${width}x$height" }
        }
    }

    /**
     * Rotate clockwise by [degrees] (0, 90, 180 or 270): what CameraX's
     * ImageInfo.rotationDegrees asks for to make a frame upright.
     */
    fun rotate(img: Image, degrees: Int): Image {
        val w = img.width
        val h = img.height
        val src = img.argb
        return when (((degrees % 360) + 360) % 360) {
            0 -> img
            90 -> {
                // out is h wide, w tall; out(x, y) = in(y, h - 1 - x)
                val out = IntArray(w * h)
                for (y in 0 until w) for (x in 0 until h) out[y * h + x] = src[(h - 1 - x) * w + y]
                Image(out, h, w)
            }
            180 -> {
                val out = IntArray(w * h)
                for (i in out.indices) out[i] = src[src.size - 1 - i]
                Image(out, w, h)
            }
            270 -> {
                // out(x, y) = in(w - 1 - y, x)
                val out = IntArray(w * h)
                for (y in 0 until w) for (x in 0 until h) out[y * h + x] = src[x * w + (w - 1 - y)]
                Image(out, h, w)
            }
            else -> throw IllegalArgumentException("rotation must be a multiple of 90, got $degrees")
        }
    }

    private fun mirror(img: Image): Image {
        val w = img.width
        val out = IntArray(img.argb.size)
        for (y in 0 until img.height) for (x in 0 until w) out[y * w + x] = img.argb[y * w + (w - 1 - x)]
        return Image(out, w, img.height)
    }

    /**
     * Apply an EXIF orientation tag (1-8) the way PIL's ImageOps.exif_transpose
     * does, which serve.py calls before anything else. A phone photo is
     * routinely stored sideways with a tag saying so; ignoring it detects
     * potholes in a sideways world. Unknown values are left as they are.
     */
    fun applyExifOrientation(img: Image, orientation: Int): Image = when (orientation) {
        2 -> mirror(img)                       // FLIP_LEFT_RIGHT
        3 -> rotate(img, 180)                  // ROTATE_180
        4 -> mirror(rotate(img, 180))          // FLIP_TOP_BOTTOM
        5 -> mirror(rotate(img, 90))           // TRANSPOSE
        6 -> rotate(img, 90)                   // ROTATE_270 (PIL counts anticlockwise)
        7 -> mirror(rotate(img, 270))          // TRANSVERSE
        8 -> rotate(img, 270)                  // ROTATE_90
        else -> img
    }

    // ── OpenCV's INTER_LINEAR resize ─────────────────────────────────────

    /** Source taps and 11-bit weights along one axis (onnx_detector._linear_taps). */
    private class Taps(val i0: IntArray, val i1: IntArray, val w0: IntArray, val w1: IntArray)

    private fun linearTaps(srcN: Int, dstN: Int, clampFraction: Boolean): Taps {
        val i0 = IntArray(dstN)
        val i1 = IntArray(dstN)
        val w0 = IntArray(dstN)
        val w1 = IntArray(dstN)
        val ratio = srcN.toDouble() / dstN
        for (d in 0 until dstN) {
            // float64 arithmetic, then float32, exactly as the numpy does.
            val f = ((d + 0.5) * ratio - 0.5).toFloat()
            var lo = Math.floor(f.toDouble()).toInt()
            var frac = (f - lo).toFloat()
            if (clampFraction) {
                if (lo < 0) { frac = 0f; lo = 0 }
                if (lo >= srcN - 1) { frac = 0f; lo = srcN - 1 }
            }
            w1[d] = Math.rint((frac * 2048f).toDouble()).toInt()
            w0[d] = Math.rint(((1f - frac) * 2048f).toDouble()).toInt()
            i0[d] = lo.coerceIn(0, srcN - 1)
            i1[d] = (lo + 1).coerceIn(0, srcN - 1)
        }
        return Taps(i0, i1, w0, w1)
    }

    /** One channel of one output pixel: resize_linear's integer arithmetic. */
    @Suppress("NOTHING_TO_INLINE")
    private inline fun channel(a: Int, b: Int, c: Int, d: Int, shift: Int, wx0: Int, wx1: Int, wy0: Int, wy1: Int): Int {
        val row0 = ((a shr shift) and 0xFF) * wx0 + ((b shr shift) and 0xFF) * wx1
        val row1 = ((c shr shift) and 0xFF) * wx0 + ((d shr shift) and 0xFF) * wx1
        val v = (((row0 shr 4) * wy0) shr 16) + (((row1 shr 4) * wy1) shr 16)
        return ((v + 2) shr 2).coerceIn(0, 255)
    }

    /**
     * cv2.resize(..., INTER_LINEAR) on an RGB image, bit for bit, as
     * onnx_detector.resize_linear reproduces it: cv2 clamps the horizontal
     * fraction at the edges but keeps the vertical one, and both show up in
     * the first and last row or column. Alpha is dropped.
     */
    fun resizeLinear(img: Image, dw: Int, dh: Int): Image {
        require(dw > 0 && dh > 0)
        val sw = img.width
        val sh = img.height
        if (sw == dw && sh == dh) return img
        val ty = linearTaps(sh, dh, clampFraction = false)
        val tx = linearTaps(sw, dw, clampFraction = true)
        val src = img.argb
        val out = IntArray(dw * dh)
        for (y in 0 until dh) {
            val r0 = ty.i0[y] * sw
            val r1 = ty.i1[y] * sw
            val wy0 = ty.w0[y]
            val wy1 = ty.w1[y]
            for (x in 0 until dw) {
                val x0 = tx.i0[x]
                val x1 = tx.i1[x]
                val wx0 = tx.w0[x]
                val wx1 = tx.w1[x]
                val a = src[r0 + x0]
                val b = src[r0 + x1]
                val c = src[r1 + x0]
                val d = src[r1 + x1]
                out[y * dw + x] = (0xFF shl 24) or
                    (channel(a, b, c, d, 16, wx0, wx1, wy0, wy1) shl 16) or
                    (channel(a, b, c, d, 8, wx0, wx1, wy0, wy1) shl 8) or
                    channel(a, b, c, d, 0, wx0, wx1, wy0, wy1)
            }
        }
        return Image(out, dw, dh)
    }

    // ── letterbox ─────────────────────────────────────────────────────────

    /** onnx_detector.letterbox_shape: (scale, newW, newH, left, top). */
    class Shape(val scale: Double, val newW: Int, val newH: Int, val left: Int, val top: Int)

    fun letterboxShape(srcW: Int, srcH: Int, dstW: Int, dstH: Int): Shape {
        val scale = min(dstW.toDouble() / srcW, dstH.toDouble() / srcH)
        // Python's round() is half-to-even, which is Math.rint.
        val newW = max(1, Math.rint(srcW * scale).toInt())
        val newH = max(1, Math.rint(srcH * scale).toInt())
        val left = Math.rint((dstW - newW) / 2.0 - 0.1).toInt()
        val top = Math.rint((dstH - newH) / 2.0 - 0.1).toInt()
        return Shape(scale, newW, newH, left, top)
    }

    /** onnx_detector.letterbox_params: (scale, padX, padY), the painted integer border. */
    fun letterboxParams(srcW: Int, srcH: Int, dstW: Int, dstH: Int): Triple<Double, Double, Double> {
        val s = letterboxShape(srcW, srcH, dstW, dstH)
        return Triple(s.scale, s.left.toDouble(), s.top.toDouble())
    }

    /**
     * serve.py's preprocess after decoding: the letterboxed image as an NCHW
     * float32 tensor of [modelW] x [modelH], RGB / 255.
     */
    fun letterboxTensor(img: Image, modelW: Int, modelH: Int, out: FloatArray? = null): FloatArray {
        val shape = letterboxShape(img.width, img.height, modelW, modelH)
        val resized = resizeLinear(img, shape.newW, shape.newH)
        val plane = modelW * modelH
        val t = out ?: FloatArray(3 * plane)
        require(t.size == 3 * plane) { "tensor buffer is ${t.size}, need ${3 * plane}" }
        java.util.Arrays.fill(t, 114f / 255f)
        val px = resized.argb
        for (y in 0 until shape.newH) {
            val ty = y + shape.top
            if (ty < 0 || ty >= modelH) continue
            for (x in 0 until shape.newW) {
                val tx = x + shape.left
                if (tx < 0 || tx >= modelW) continue
                val p = px[y * shape.newW + x]
                val i = ty * modelW + tx
                t[i] = ((p shr 16) and 0xFF).toFloat() / 255f
                t[plane + i] = ((p shr 8) and 0xFF).toFloat() / 255f
                t[2 * plane + i] = (p and 0xFF).toFloat() / 255f
            }
        }
        return t
    }

    // ── post-processing ───────────────────────────────────────────────────

    /** Intersection over union of two xyxy boxes (onnx_detector.iou). */
    fun iou(a: DoubleArray, b: DoubleArray): Double {
        val ix1 = max(a[0], b[0])
        val iy1 = max(a[1], b[1])
        val ix2 = min(a[2], b[2])
        val iy2 = min(a[3], b[3])
        val iw = max(0.0, ix2 - ix1)
        val ih = max(0.0, iy2 - iy1)
        val inter = iw * ih
        if (inter <= 0) return 0.0
        val areaA = max(0.0, a[2] - a[0]) * max(0.0, a[3] - a[1])
        val areaB = max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])
        val union = areaA + areaB - inter
        return if (union > 0) inter / union else 0.0
    }

    /**
     * Greedy non-maximum suppression; kept indices, best score first. Ties keep
     * input order (Python's sort is stable, and so is Kotlin's). Per-class
     * suppression is the caller's job, as in the Python.
     */
    fun nms(boxes: List<DoubleArray>, scores: List<Double>, iouThreshold: Double): List<Int> {
        var order = boxes.indices.sortedByDescending { scores[it] }
        val kept = ArrayList<Int>()
        while (order.isNotEmpty()) {
            val best = order[0]
            kept.add(best)
            order = order.drop(1).filter { iou(boxes[best], boxes[it]) <= iouThreshold }
        }
        return kept
    }

    /** onnx_detector.undo_letterbox: model space back to source pixels, clamped. */
    fun undoLetterbox(box: DoubleArray, scale: Double, padX: Double, padY: Double, srcW: Int, srcH: Int): DoubleArray {
        val x1 = ((box[0] - padX) / scale).coerceIn(0.0, srcW.toDouble())
        val y1 = ((box[1] - padY) / scale).coerceIn(0.0, srcH.toDouble())
        val x2 = ((box[2] - padX) / scale).coerceIn(0.0, srcW.toDouble())
        val y2 = ((box[3] - padY) / scale).coerceIn(0.0, srcH.toDouble())
        return doubleArrayOf(x1, y1, x2, y2)
    }

    /**
     * onnx_detector.decode. [output] is the model's [4 + classes, anchors]
     * tensor flattened row-major: cx, cy, w, h, then one score per class. There
     * is no objectness channel in v8/v11 — the class score IS the confidence.
     */
    fun decode(
        output: FloatArray,
        rows: Int,
        anchors: Int,
        classes: List<String>,
        srcW: Int,
        srcH: Int,
        modelW: Int,
        modelH: Int,
        minConf: Double,
        iouThreshold: Double,
    ): List<Detection> {
        val numClasses = rows - 4
        require(numClasses >= 1) { "unexpected model output with $rows rows" }
        require(output.size >= rows * anchors) { "output has ${output.size} values, expected ${rows * anchors}" }
        val (scale, padX, padY) = letterboxParams(srcW, srcH, modelW, modelH)
        val frame = srcW.toDouble() * srcH

        val perClass = LinkedHashMap<Int, MutableList<Pair<DoubleArray, Double>>>()
        for (a in 0 until anchors) {
            var bestCls = -1
            var bestScore = 0.0
            for (c in 0 until numClasses) {
                val s = output[(4 + c) * anchors + a].toDouble()
                if (s > bestScore) {
                    bestCls = c
                    bestScore = s
                }
            }
            if (bestCls < 0 || bestScore < minConf) continue
            val cx = output[a].toDouble()
            val cy = output[anchors + a].toDouble()
            val w = output[2 * anchors + a].toDouble()
            val h = output[3 * anchors + a].toDouble()
            val box = doubleArrayOf(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)
            perClass.getOrPut(bestCls) { ArrayList() }.add(box to bestScore)
        }

        val out = ArrayList<Detection>()
        for ((cls, items) in perClass) {
            val boxes = items.map { it.first }
            val scores = items.map { it.second }
            for (i in nms(boxes, scores, iouThreshold)) {
                val name = classes.getOrNull(cls) ?: continue
                val b = undoLetterbox(boxes[i], scale, padX, padY, srcW, srcH)
                val frac = if (frame != 0.0) max(0.0, (b[2] - b[0]) * (b[3] - b[1])) / frame else 0.0
                out.add(
                    Detection(
                        label = name, classIndex = cls, confidence = scores[i],
                        severity = RoadSeverity.of(name, frac), boxFraction = frac,
                        x1 = b[0], y1 = b[1], x2 = b[2], y2 = b[3],
                    ),
                )
            }
        }
        return out.sortedByDescending { it.confidence }
    }

    // ── the model's own metadata ──────────────────────────────────────────

    /**
     * Class names from the ONNX metadata key "names", which ultralytics writes
     * as a Python dict repr: {0: 'pothole', 1: 'road_damage'}. Returned in
     * index order, or null when absent or unreadable (the caller decides).
     */
    fun parseNames(raw: String?): List<String>? {
        if (raw.isNullOrBlank()) return null
        val body = raw.trim()
        if (!body.startsWith("{") || !body.endsWith("}")) return null
        val entry = Regex("""(\d+)\s*:\s*(?:'([^']*)'|"([^"]*)")""")
        val map = sortedMapOf<Int, String>()
        for (m in entry.findAll(body)) {
            map[m.groupValues[1].toInt()] = m.groupValues[2].ifEmpty { m.groupValues[3] }
        }
        if (map.isEmpty() || map.keys.toList() != (0 until map.size).toList()) return null
        return map.values.toList()
    }

    /** The metadata key "imgsz" ("[512, 512]") as (height, width), or null. */
    fun parseImgsz(raw: String?): Pair<Int, Int>? {
        val m = Regex("""^\s*\[\s*(\d+)\s*,\s*(\d+)\s*]\s*$""").find(raw ?: return null) ?: return null
        return m.groupValues[1].toInt() to m.groupValues[2].toInt()
    }
}
