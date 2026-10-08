package `in`.roadassist.app

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Decode, NMS and geometry, on synthetic model outputs. Mirrors the cases in
 * ai/tests/test_onnx_detector.py so the two decoders are pinned to the same
 * behaviour; DetectorParityTest then checks them against each other on the
 * real model.
 */
class DetectorDecodeTest {

    private val names = listOf("pothole", "road_damage", "faded_marking", "manhole")

    /** A [4 + classes, anchors] output, flattened row-major, from anchor tuples. */
    private fun output(anchors: List<Pair<DoubleArray, DoubleArray>>, classes: Int = 4): Triple<FloatArray, Int, Int> {
        val rows = 4 + classes
        val n = anchors.size
        val out = FloatArray(rows * n)
        anchors.forEachIndexed { a, (box, scores) ->
            for (r in 0 until 4) out[r * n + a] = box[r].toFloat()
            for (c in 0 until classes) out[(4 + c) * n + a] = scores[c].toFloat()
        }
        return Triple(out, rows, n)
    }

    private fun anchor(cx: Double, cy: Double, w: Double, h: Double, vararg s: Double) =
        doubleArrayOf(cx, cy, w, h) to s

    private fun decode(
        o: Triple<FloatArray, Int, Int>,
        srcW: Int = 512, srcH: Int = 512, minConf: Double = 0.30, iou: Double = 0.45,
    ) = Detector.decode(o.first, o.second, o.third, names, srcW, srcH, 512, 512, minConf, iou)

    // ── iou ──────────────────────────────────────────────────────────────

    @Test fun `iou of identical boxes is 1`() =
        assertEquals(1.0, Detector.iou(doubleArrayOf(0.0, 0.0, 10.0, 10.0), doubleArrayOf(0.0, 0.0, 10.0, 10.0)), 1e-12)

    @Test fun `iou of disjoint and edge-touching boxes is 0`() {
        assertEquals(0.0, Detector.iou(doubleArrayOf(0.0, 0.0, 10.0, 10.0), doubleArrayOf(20.0, 20.0, 30.0, 30.0)), 0.0)
        assertEquals(0.0, Detector.iou(doubleArrayOf(0.0, 0.0, 10.0, 10.0), doubleArrayOf(10.0, 0.0, 20.0, 10.0)), 0.0)
    }

    @Test fun `iou of a half overlap`() =
        assertEquals(50.0 / 150.0, Detector.iou(doubleArrayOf(0.0, 0.0, 10.0, 10.0), doubleArrayOf(5.0, 0.0, 15.0, 10.0)), 1e-12)

    @Test fun `iou matches the Python's ground-truth figure`() {
        // ai/README.md: India_000005, predicted vs annotated pothole, IoU 0.753.
        val iou = Detector.iou(doubleArrayOf(74.0, 469.0, 355.0, 572.0), doubleArrayOf(20.0, 473.0, 368.0, 576.0))
        assertEquals(0.753, iou, 5e-4)
    }

    @Test fun `iou of a degenerate box is 0`() =
        assertEquals(0.0, Detector.iou(doubleArrayOf(5.0, 5.0, 5.0, 5.0), doubleArrayOf(0.0, 0.0, 10.0, 10.0)), 0.0)

    // ── nms ──────────────────────────────────────────────────────────────

    @Test fun `nms keeps the best of an overlapping pair and any far box`() {
        val boxes = listOf(
            doubleArrayOf(0.0, 0.0, 10.0, 10.0),
            doubleArrayOf(1.0, 1.0, 11.0, 11.0),
            doubleArrayOf(50.0, 50.0, 60.0, 60.0),
        )
        assertEquals(listOf(1, 2), Detector.nms(boxes, listOf(0.5, 0.9, 0.7), 0.45))
    }

    @Test fun `nms keeps a box whose overlap is exactly the threshold`() {
        // The Python keeps i when iou <= threshold.
        val boxes = listOf(doubleArrayOf(0.0, 0.0, 10.0, 10.0), doubleArrayOf(5.0, 0.0, 15.0, 10.0))
        assertEquals(listOf(0, 1), Detector.nms(boxes, listOf(0.9, 0.8), 50.0 / 150.0))
    }

    @Test fun `nms breaks a score tie by input order, as Python's stable sort does`() {
        val boxes = listOf(doubleArrayOf(0.0, 0.0, 10.0, 10.0), doubleArrayOf(0.0, 0.0, 10.0, 10.0))
        assertEquals(listOf(0), Detector.nms(boxes, listOf(0.6, 0.6), 0.45))
    }

    @Test fun `nms of nothing is nothing`() = assertEquals(emptyList<Int>(), Detector.nms(emptyList(), emptyList(), 0.45))

    // ── decode ───────────────────────────────────────────────────────────

    @Test fun `below threshold anchors are dropped`() {
        val found = decode(output(listOf(anchor(100.0, 100.0, 20.0, 20.0, 0.10, 0.0, 0.0, 0.0), anchor(300.0, 300.0, 20.0, 20.0, 0.80, 0.0, 0.0, 0.0))))
        assertEquals(1, found.size)
        assertEquals(0.80, found[0].confidence, 1e-6)
    }

    @Test fun `an anchor exactly at the threshold is kept`() {
        val found = decode(output(listOf(anchor(100.0, 100.0, 20.0, 20.0, 0.5, 0.0, 0.0, 0.0))), minConf = 0.5)
        assertEquals(1, found.size)
    }

    @Test fun `overlapping anchors of one class collapse`() {
        val found = decode(output(listOf(anchor(256.0, 256.0, 100.0, 100.0, 0.70, 0.0, 0.0, 0.0), anchor(258.0, 258.0, 100.0, 100.0, 0.90, 0.0, 0.0, 0.0))))
        assertEquals(1, found.size)
        assertEquals(0.90, found[0].confidence, 1e-6)
    }

    @Test fun `a pothole inside a cracked patch stays two detections`() {
        val found = decode(output(listOf(anchor(256.0, 256.0, 100.0, 100.0, 0.80, 0.0, 0.0, 0.0), anchor(256.0, 256.0, 110.0, 110.0, 0.0, 0.75, 0.0, 0.0))))
        assertEquals(listOf("pothole", "road_damage"), found.map { it.label }.sorted())
    }

    @Test fun `results come back strongest first`() {
        val found = decode(output(listOf(
            anchor(50.0, 50.0, 20.0, 20.0, 0.40, 0.0, 0.0, 0.0),
            anchor(400.0, 400.0, 20.0, 20.0, 0.95, 0.0, 0.0, 0.0),
            anchor(200.0, 200.0, 20.0, 20.0, 0.60, 0.0, 0.0, 0.0),
        )))
        assertEquals(listOf(0.95, 0.60, 0.40), found.map { Math.round(it.confidence * 100) / 100.0 })
    }

    @Test fun `the best class wins, and a tie goes to the lower index`() {
        val found = decode(output(listOf(anchor(100.0, 100.0, 20.0, 20.0, 0.4, 0.4, 0.9, 0.0), anchor(300.0, 300.0, 20.0, 20.0, 0.6, 0.6, 0.0, 0.0))))
        assertEquals(setOf("faded_marking", "pothole"), found.map { it.label }.toSet())
    }

    @Test fun `severity comes from the shared heuristic`() {
        val (d) = decode(output(listOf(anchor(256.0, 256.0, 362.0, 362.0, 0.9, 0.0, 0.0, 0.0))))
        assertEquals(5, d.severity)
        assertTrue(d.boxFraction > 0.4)
    }

    @Test fun `boxes are mapped back through the letterbox into source pixels`() {
        // A 1024 x 512 frame letterboxed into 512 x 512: scale 0.5, 128 px bars
        // above and below. A model-space box (100..200, 178..278) is source
        // (200..400, 100..300).
        val found = Detector.decode(
            output(listOf(anchor(150.0, 228.0, 100.0, 100.0, 0.9, 0.0, 0.0, 0.0))).let { it.first },
            8, 1, names, 1024, 512, 512, 512, 0.3, 0.45,
        )
        val d = found.single()
        assertArrayEquals(doubleArrayOf(200.0, 100.0, 400.0, 300.0), doubleArrayOf(d.x1, d.y1, d.x2, d.y2), 1e-9)
        assertEquals(200.0 * 200.0 / (1024.0 * 512.0), d.boxFraction, 1e-12)
    }

    @Test fun `a box running into the padding is clamped to the frame`() {
        val d = Detector.decode(
            output(listOf(anchor(20.0, 140.0, 80.0, 60.0, 0.9, 0.0, 0.0, 0.0))).first,
            8, 1, names, 1024, 512, 512, 512, 0.3, 0.45,
        ).single()
        assertEquals(0.0, d.x1, 0.0)
        assertEquals(0.0, d.y1, 0.0)
    }

    @Test fun `a two-class model decodes with two score rows`() {
        val o = output(listOf(anchor(100.0, 100.0, 20.0, 20.0, 0.1, 0.8)), classes = 2)
        val d = Detector.decode(o.first, o.second, o.third, listOf("pothole", "road_damage"), 512, 512, 512, 512, 0.3, 0.45)
        assertEquals("road_damage", d.single().label)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `an output with no class rows is refused`() {
        Detector.decode(FloatArray(4), 4, 1, names, 512, 512, 512, 512, 0.3, 0.45)
    }

    @Test fun `an odd padding puts the extra pixel at the bottom, as ultralytics does`() {
        // 640 x 479 into 512: scale 0.8, 512 x 383, 129 px of padding.
        // round(64.5 - 0.1) = 64 on top, so 65 below.
        val s = Detector.letterboxShape(640, 479, 512, 512)
        assertEquals(512, s.newW)
        assertEquals(383, s.newH)
        assertEquals(0, s.left)
        assertEquals(64, s.top)
    }

    @Test fun `letterbox params match onnx_detector`() {
        val (s, px, py) = Detector.letterboxParams(1280, 720, 512, 512)
        assertEquals(0.4, s, 1e-12)
        assertEquals(0.0, px, 1e-9)
        assertEquals(112.0, py, 1e-9)
    }

    // ── pixels ───────────────────────────────────────────────────────────

    /** 3 x 2: a b c / d e f */
    private val tiny = Detector.Image(intArrayOf(1, 2, 3, 4, 5, 6), 3, 2)

    @Test fun `rotate 90 clockwise`() {
        val r = Detector.rotate(tiny, 90)
        assertEquals(2, r.width)
        assertEquals(3, r.height)
        assertArrayEquals(intArrayOf(4, 1, 5, 2, 6, 3), r.argb)
    }

    @Test fun `rotate 180 and 270`() {
        assertArrayEquals(intArrayOf(6, 5, 4, 3, 2, 1), Detector.rotate(tiny, 180).argb)
        assertArrayEquals(intArrayOf(3, 6, 2, 5, 1, 4), Detector.rotate(tiny, 270).argb)
        assertArrayEquals(tiny.argb, Detector.rotate(Detector.rotate(tiny, 90), 270).argb)
    }

    @Test fun `exif orientations match PIL's exif_transpose`() {
        assertArrayEquals(intArrayOf(3, 2, 1, 6, 5, 4), Detector.applyExifOrientation(tiny, 2).argb)  // mirror
        assertArrayEquals(intArrayOf(4, 5, 6, 1, 2, 3), Detector.applyExifOrientation(tiny, 4).argb)  // flip
        assertArrayEquals(intArrayOf(1, 4, 2, 5, 3, 6), Detector.applyExifOrientation(tiny, 5).argb)  // transpose
        assertArrayEquals(intArrayOf(6, 3, 5, 2, 4, 1), Detector.applyExifOrientation(tiny, 7).argb)  // transverse
        assertArrayEquals(Detector.rotate(tiny, 90).argb, Detector.applyExifOrientation(tiny, 6).argb)
        assertArrayEquals(Detector.rotate(tiny, 270).argb, Detector.applyExifOrientation(tiny, 8).argb)
        assertArrayEquals(tiny.argb, Detector.applyExifOrientation(tiny, 0).argb)
    }

    @Test fun `resizing to the same size is the identity, as in the Python`() {
        val img = Detector.Image(IntArray(12) { 0xFF000000.toInt() or (it * 20) }, 4, 3)
        assertTrue(Detector.resizeLinear(img, 4, 3) === img)
    }

    @Test fun `a flat colour stays that colour through the resize`() {
        val c = 0xFF336699.toInt()
        val img = Detector.Image(IntArray(97 * 61) { c }, 97, 61)
        val r = Detector.resizeLinear(img, 40, 23)
        assertTrue(r.argb.all { it == c })
    }

    @Test fun `the letterbox pads with 114 grey`() {
        val img = Detector.Image(IntArray(64 * 32) { 0xFFFFFFFF.toInt() }, 64, 32)
        val t = Detector.letterboxTensor(img, 64, 64)
        assertEquals(114f / 255f, t[0], 0f)                 // top bar
        assertEquals(1f, t[32 * 64 + 10], 0f)               // inside the picture
        assertEquals(114f / 255f, t[63 * 64 + 63], 0f)      // bottom bar
    }

    // ── metadata ─────────────────────────────────────────────────────────

    @Test fun `class names are read from ultralytics' python dict`() {
        assertEquals(listOf("pothole", "road_damage"), Detector.parseNames("{0: 'pothole', 1: 'road_damage'}"))
        assertEquals(
            listOf("pothole", "road_damage", "faded_marking", "manhole"),
            Detector.parseNames("{0: 'pothole', 1: 'road_damage', 2: 'faded_marking', 3: 'manhole'}"),
        )
    }

    @Test fun `names with a gap or no braces are not guessed at`() {
        assertNull(Detector.parseNames("{0: 'pothole', 2: 'manhole'}"))
        assertNull(Detector.parseNames("pothole, road_damage"))
        assertNull(Detector.parseNames(null))
    }

    @Test fun `imgsz is read from metadata`() {
        assertEquals(512 to 512, Detector.parseImgsz("[512, 512]"))
        assertEquals(416 to 416, Detector.parseImgsz("[416,416]"))
        assertNull(Detector.parseImgsz("512"))
    }
}
