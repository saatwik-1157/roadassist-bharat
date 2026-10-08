package `in`.roadassist.app

import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.zip.GZIPInputStream

/**
 * The parity fixtures written by mobile/tools/detector_parity_reference.py
 * (src/test/resources/detector-parity/), shared by the JVM test and the
 * instrumented one. [open] reads a fixture file by name: a class-path
 * resource on the JVM, an asset on the device.
 */
class ParityFixtures(private val open: (String) -> ByteArray) {

    val expected: JSONObject = JSONObject(open("expected.json").decodeToString())

    fun case(name: String): JSONObject {
        val cases = expected.getJSONArray("cases")
        for (i in 0 until cases.length()) if (cases.getJSONObject(i).getString("case") == name) return cases.getJSONObject(i)
        throw AssertionError("no case $name in expected.json")
    }

    fun caseNames(): List<String> {
        val cases = expected.getJSONArray("cases")
        return (0 until cases.length()).map { cases.getJSONObject(it).getString("case") }
    }

    /**
     * A fixture, unzipped. The Android packager stores a .gz asset already
     * decompressed (and drops the suffix), so data that does not start with
     * the gzip magic is returned as it is.
     */
    private fun gunzip(name: String): ByteArray {
        val raw = open(name)
        val gz = raw.size > 2 && raw[0] == 0x1f.toByte() && raw[1] == 0x8b.toByte()
        return if (gz) GZIPInputStream(raw.inputStream()).use { it.readBytes() } else raw
    }

    /** The case's picture, upright: the stored pixels, rotated as the case says. */
    fun upright(c: JSONObject): Detector.Image {
        val w = c.getInt("imageWidth")
        val h = c.getInt("imageHeight")
        val rgb = gunzip(c.getString("image"))
        check(rgb.size == w * h * 3) { "${c.getString("image")}: ${rgb.size} bytes for ${w}x$h" }
        val px = IntArray(w * h) { i ->
            val r = rgb[3 * i].toInt() and 0xFF
            val g = rgb[3 * i + 1].toInt() and 0xFF
            val b = rgb[3 * i + 2].toInt() and 0xFF
            (0xFF shl 24) or (r shl 16) or (g shl 8) or b
        }
        return Detector.rotate(Detector.Image(px, w, h), c.getInt("rotate"))
    }

    /** The model's raw [rows, anchors] output for the case, as serve.py got it. */
    fun rawOutput(c: JSONObject): FloatArray {
        val bytes = gunzip(c.getString("output"))
        val n = c.getInt("outputRows") * c.getInt("outputAnchors")
        check(bytes.size == n * 4) { "${c.getString("output")}: ${bytes.size} bytes, expected ${n * 4}" }
        val out = FloatArray(n)
        ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer().get(out)
        return out
    }

    /**
     * Match every reference detection to one of [got]: same class, the best
     * IoU among the unused ones. Returns one line per pair for the report and
     * throws [AssertionError] on any miss, any extra, IoU <= [minIou], or a
     * confidence or severity that differs.
     */
    fun compare(name: String, got: List<Detector.Detection>, minIou: Double, confTolerance: Double): List<String> {
        val want = case(name).getJSONArray("detections")
        val lines = ArrayList<String>()
        if (want.length() != got.size) throw AssertionError("$name: python found ${want.length()}, kotlin ${got.size}: $got")
        val unused = got.toMutableList()
        for (i in 0 until want.length()) {
            val w = want.getJSONObject(i)
            val type = w.getString("type")
            val wb = w.getJSONArray("box").let { b -> DoubleArray(4) { b.getDouble(it) } }
            val best = unused.filter { it.label == type }
                .maxByOrNull { Detector.iou(wb, doubleArrayOf(it.x1, it.y1, it.x2, it.y2)) }
                ?: throw AssertionError("$name: no $type found by kotlin")
            unused.remove(best)
            val iou = Detector.iou(wb, doubleArrayOf(best.x1, best.y1, best.x2, best.y2))
            val pyConf = w.getDouble("confidence")
            lines.add(
                String.format(
                    java.util.Locale.ROOT,
                    "%-15s %-11s conf py %.4f kt %.4f  severity py %d kt %d  IoU %.6f",
                    name, type, pyConf, best.confidence, w.getInt("severity"), best.severity, iou,
                ),
            )
            if (iou <= minIou) throw AssertionError("$name: $type IoU $iou <= $minIou")
            if (kotlin.math.abs(pyConf - best.confidence) > confTolerance) {
                throw AssertionError("$name: $type confidence py $pyConf kt ${best.confidence}")
            }
            if (w.getInt("severity") != best.severity) throw AssertionError("$name: $type severity differs")
        }
        return lines
    }
}
