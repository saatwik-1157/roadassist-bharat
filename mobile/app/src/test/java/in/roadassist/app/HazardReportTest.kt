package `in`.roadassist.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * POST /v1/raksha/report's optional `confidence` (0..1) and `modelVersion`
 * (1-40 of [A-Za-z0-9._-]): a scan report sends both, a hand-made one neither.
 */
class HazardReportTest {

    private val config = DetectorConfig(
        modelAsset = "detector/m.onnx", modelName = "RAKSHA YOLO11n (india-ft-gpu, 416)",
        inputWidth = 416, inputHeight = 416,
        classes = listOf("pothole", "road_damage", "faded_marking", "manhole"),
        minConfidence = 0.3, iouThreshold = 0.7,
        reportAs = mapOf("pothole" to "pothole", "road_damage" to "road_damage"),
        map50 = 0.516,
        modelSha256 = "04a662853b947aeda372bc34695df7f7a4419cd291ec5ddf1c5777d1462c9381",
    )
    private val allowed = Regex("^[A-Za-z0-9._-]{1,40}$")

    private fun det(conf: Double) = Detector.Detection("pothole", 0, conf, 3, 0.02, 1.0, 2.0, 3.0, 4.0)

    @Test fun `a scan report sends the detection's confidence and the model version`() {
        val d = ScanReport.draft(det(0.78491), config)!!
        val body = HazardReport.payload(d.type, d.severity, 28.6, 77.2, d.note, null,
            confidence = d.confidence, modelVersion = d.modelVersion)
        assertEquals(0.7849, body.getDouble("confidence"), 0.0)
        assertEquals("RAKSHA-YOLO11n-india-ft-gpu-416", body.getString("modelVersion"))
        assertEquals("pothole", body.getString("type"))
        assertEquals(3, body.getInt("severity"))
    }

    @Test fun `a report made by hand sends neither`() {
        val body = HazardReport.payload("road_damage", 2, 28.6, 77.2, "  big crack ", "QUJD")
        assertFalse(body.has("confidence"))
        assertFalse(body.has("modelVersion"))
        assertEquals("big crack", body.getString("note"))
        assertEquals("QUJD", body.getString("photoBase64"))
        assertEquals("image/jpeg", body.getString("photoMime"))
    }

    @Test fun `an empty note and no photo are left out`() {
        val body = HazardReport.payload("pothole", 3, 1.0, 2.0, "   ", null)
        assertFalse(body.has("note"))
        assertFalse(body.has("photoBase64"))
        assertFalse(body.has("photoMime"))
    }

    @Test fun `confidence is held to 0-1 and junk is dropped`() {
        assertEquals(1.0, HazardReport.payload("pothole", 3, 1.0, 2.0, null, null, confidence = 1.7).getDouble("confidence"), 0.0)
        assertEquals(0.0, HazardReport.payload("pothole", 3, 1.0, 2.0, null, null, confidence = -0.2).getDouble("confidence"), 0.0)
        assertFalse(HazardReport.payload("pothole", 3, 1.0, 2.0, null, null, confidence = Double.NaN).has("confidence"))
    }

    @Test fun `model version is cut to the server's charset and 40 characters`() {
        for (raw in listOf("RAKSHA YOLO11n (india-ft-gpu, 416)", "x".repeat(90), "a b/c\\d:e*f", " ..v1.2_beta.. ", "ऑफ़ model")) {
            val v = HazardReport.sanitizeModelVersion(raw)!!
            assertTrue("$raw -> $v", allowed.matches(v))
        }
        assertEquals(40, HazardReport.sanitizeModelVersion("x".repeat(90))!!.length)
        assertNull(HazardReport.sanitizeModelVersion("  ()  "))
        assertNull(HazardReport.sanitizeModelVersion(null))
        // A version that is already clean is not touched.
        assertEquals("yolo11n-india-ft-gpu_416.v2", HazardReport.sanitizeModelVersion("yolo11n-india-ft-gpu_416.v2"))
    }

    @Test fun `a model name with nothing usable falls back to the model's sha`() {
        val v = HazardReport.modelVersion(config.copy(modelName = "(())"))!!
        assertEquals(config.modelSha256!!.take(40), v)
        assertNull(HazardReport.modelVersion(config.copy(modelName = "(())", modelSha256 = null)))
    }

    @Test fun `a bad model version is never sent`() {
        assertFalse(HazardReport.payload("pothole", 3, 1.0, 2.0, null, null, modelVersion = " ").has("modelVersion"))
        val v = HazardReport.payload("pothole", 3, 1.0, 2.0, null, null, modelVersion = "a".repeat(60)).getString("modelVersion")
        assertTrue(allowed.matches(v))
    }

    @Test fun `the shipped detector json yields a valid model version`() {
        val shipped = DetectorConfig.parse(java.io.File("src/main/assets/detector/detector.json").readText())
        assertTrue(shipped.modelSha256!!.length == 64)
        assertTrue(allowed.matches(HazardReport.modelVersion(shipped)!!))
    }
}
