package `in`.roadassist.app

import org.junit.AfterClass
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.BeforeClass
import org.junit.Test
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest

/**
 * The phone's pre- and post-processing against the server's, on the real model.
 *
 * mobile/tools/detector_parity_reference.py ran ai/serve.py (which calls
 * ai/road_damage/onnx_detector.py) on four fixed RDD2022 pictures and saved
 * the input tensor's SHA-256, the model's raw output, and what it detected
 * (src/test/resources/detector-parity/). This holds the Kotlin port to it:
 *
 *  - the input tensor [Detector.letterboxTensor] builds is byte-identical to
 *    serve.py's: cv2's INTER_LINEAR resize, ultralytics' letterbox offsets, 114 grey and /255 all
 *    reproduced exactly, so the model receives the same bytes;
 *  - [Detector.decode] fed the model's raw output returns serve.py's
 *    detections: same count, same classes, confidence within 1e-6, box IoU
 *    above 0.9 (in practice 1.0), same severity.
 *
 * Same input bytes into the same .onnx gives the same output, so the two
 * together pin the whole chain. The cases are a square frame, a landscape and
 * a portrait crop (letterbox padding on each axis) and a sideways frame turned
 * upright by [Detector.rotate], the path every CameraX frame takes.
 * DetectorDeviceParityTest (androidTest) runs the model itself on the phone.
 *
 * When detector.json names a different model the fixtures belong to the old
 * one; this fails with the command that regenerates them rather than
 * comparing one model with another model's answers.
 */
class DetectorParityTest {

    companion object {
        private lateinit var config: DetectorConfig
        private lateinit var fx: ParityFixtures
        private val report = StringBuilder()

        @BeforeClass
        @JvmStatic
        fun load() {
            config = DetectorConfig.parse(File("src/main/assets/${DetectorConfig.ASSET}").readText())
            fx = ParityFixtures { name ->
                requireNotNull(DetectorParityTest::class.java.getResourceAsStream("/detector-parity/$name")) {
                    "missing test resource detector-parity/$name"
                }.use { it.readBytes() }
            }
        }

        @AfterClass
        @JvmStatic
        fun done() {
            File("build/reports/detector-parity-jvm.txt").apply { parentFile?.mkdirs() }.writeText(report.toString())
            print(report)
        }

        private fun sha256(t: FloatArray): String {
            val buf = ByteBuffer.allocate(t.size * 4).order(ByteOrder.LITTLE_ENDIAN)
            buf.asFloatBuffer().put(t)
            return MessageDigest.getInstance("SHA-256").digest(buf.array()).joinToString("") { "%02x".format(it) }
        }
    }

    private fun checkTensor(name: String) {
        val c = fx.case(name)
        val img = fx.upright(c)
        assertEquals(c.getInt("width"), img.width)
        assertEquals(c.getInt("height"), img.height)
        val t = Detector.letterboxTensor(img, config.inputWidth, config.inputHeight)
        val samples = c.getJSONArray("tensorSamples")
        for (i in 0 until samples.length()) {
            val s = samples.getJSONArray(i)
            assertEquals("$name tensor[${s.getInt(0)}]", s.getDouble(1), t[s.getInt(0)].toDouble(), 0.0)
        }
        assertEquals("$name: input tensor bytes differ from serve.py's", c.getString("tensorSha256"), sha256(t))
        report.append("$name: input tensor SHA-256 identical to serve.py (${t.size} floats)\n")
    }

    private fun checkDecode(name: String) {
        val c = fx.case(name)
        val got = Detector.decode(
            fx.rawOutput(c), c.getInt("outputRows"), c.getInt("outputAnchors"), config.classes,
            c.getInt("width"), c.getInt("height"), config.inputWidth, config.inputHeight,
            config.minConfidence, config.iouThreshold,
        )
        fx.compare(name, got, minIou = 0.9, confTolerance = 1e-6).forEach { report.append(it).append('\n') }
    }

    @Test fun `the fixtures were made with the model that ships`() {
        val model = File("src/main/assets/${config.modelAsset}").readBytes()
        val sha = MessageDigest.getInstance("SHA-256").digest(model).joinToString("") { "%02x".format(it) }
        assertEquals(
            "detector.json now names a different model from the one the parity fixtures were made with. " +
                "Regenerate them: ai/.venv/Scripts/python mobile/tools/detector_parity_reference.py",
            fx.expected.getString("modelSha256"), sha,
        )
        assertEquals(fx.expected.getString("model"), config.modelAsset)
        assertEquals(fx.expected.getDouble("minConfidence"), config.minConfidence, 0.0)
        assertEquals(fx.expected.getDouble("iouThreshold"), config.iouThreshold, 0.0)
        for (n in fx.caseNames()) assertEquals(4 + config.classes.size, fx.case(n).getInt("outputRows"))
    }

    @Test fun `square frame - tensor identical to serve py`() = checkTensor("square")
    @Test fun `landscape frame - tensor identical to serve py`() = checkTensor("landscape")
    @Test fun `portrait frame - tensor identical to serve py`() = checkTensor("portrait")
    @Test fun `sideways frame turned upright - tensor identical to serve py`() = checkTensor("sideways-rot90")

    @Test fun `square frame - same detections as serve py`() = checkDecode("square")
    @Test fun `landscape frame - same detections as serve py`() = checkDecode("landscape")
    @Test fun `portrait frame - same detections as serve py`() = checkDecode("portrait")
    @Test fun `sideways frame turned upright - same detections as serve py`() = checkDecode("sideways-rot90")

    @Test fun `the resize is cv2's on awkward ratios, up, down and sideways`() {
        // The RDD frames shrink by exactly 45/32, where weight rounding and
        // cv2's edge clamp never matter; these sizes exercise both.
        val n = fx.expected.getJSONObject("noise")
        val src = fx.upright(
            org.json.JSONObject().put("image", n.getString("image"))
                .put("imageWidth", n.getInt("width")).put("imageHeight", n.getInt("height")).put("rotate", 0),
        )
        val sizes = n.getJSONArray("resizes")
        for (i in 0 until sizes.length()) {
            val r = sizes.getJSONObject(i)
            val out = Detector.resizeLinear(src, r.getInt("width"), r.getInt("height"))
            val rgb = ByteArray(out.argb.size * 3)
            out.argb.forEachIndexed { j, p ->
                rgb[3 * j] = (p shr 16).toByte(); rgb[3 * j + 1] = (p shr 8).toByte(); rgb[3 * j + 2] = p.toByte()
            }
            val sha = MessageDigest.getInstance("SHA-256").digest(rgb).joinToString("") { "%02x".format(it) }
            assertEquals("resize to ${r.getInt("width")}x${r.getInt("height")}", r.getString("sha256"), sha)
        }
        report.append("noise: ${sizes.length()} awkward resizes byte-identical to onnx_detector.resize_linear\n")
    }

    @Test fun `every case finds something, so the comparison is not vacuous`() {
        for (n in fx.caseNames()) {
            assertTrue("$n has no reference detections", fx.case(n).getJSONArray("detections").length() > 0)
        }
    }
}
