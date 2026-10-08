package `in`.roadassist.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ScanReportTest {

    private val config = DetectorConfig(
        modelAsset = "detector/m.onnx", modelName = "RAKSHA YOLO11n (multi-edge)",
        inputWidth = 512, inputHeight = 512,
        classes = listOf("pothole", "road_damage", "faded_marking", "manhole"),
        minConfidence = 0.3, iouThreshold = 0.45,
        reportAs = mapOf("pothole" to "pothole", "road_damage" to "road_damage"),
        map50 = 0.293,
    )

    private fun det(label: String, conf: Double, sev: Int = 4, frac: Double = 0.0123) =
        Detector.Detection(label, 0, conf, sev, frac, 1.0, 2.0, 3.0, 4.0)

    @Test fun `a pothole becomes a pothole report with its severity`() {
        val d = ScanReport.draft(det("pothole", 0.785, sev = 3), config)!!
        assertEquals("pothole", d.type)
        assertEquals(3, d.severity)
    }

    @Test fun `the note carries the prediction, its confidence and the model's mAP50`() {
        val n = ScanReport.note(det("road_damage", 0.785), config)
        assertTrue(n, n.startsWith("On-device model prediction, not verified: road_damage, 79% confidence"))
        assertTrue(n, n.contains("severity 4/5"))
        assertTrue(n, n.contains("box 1.2% of the frame"))
        assertTrue(n, n.contains("mAP50 0.293"))
        assertTrue(n, n.contains("RAKSHA YOLO11n (multi-edge)"))
    }

    @Test fun `the note always fits the server's 280 characters`() {
        val long = config.copy(modelName = "x".repeat(400))
        val n = ScanReport.note(det("pothole", 0.5), long)
        assertEquals(ScanReport.NOTE_MAX, n.length)
        assertTrue(ScanReport.note(det("pothole", 0.5), config).length <= ScanReport.NOTE_MAX)
    }

    @Test fun `a class the server cannot take has no draft`() {
        assertNull(ScanReport.draft(det("manhole", 0.9), config))
        assertNull(ScanReport.draft(det("faded_marking", 0.9), config))
    }

    @Test fun `severity is held to the server's 1-5 even if a caller passes junk`() {
        assertEquals(5, ScanReport.draft(det("pothole", 0.9, sev = 9), config)!!.severity)
        assertEquals(1, ScanReport.draft(det("pothole", 0.9, sev = 0), config)!!.severity)
    }

    @Test fun `percent rounds and clamps`() {
        assertEquals(79, ScanReport.percent(0.785))
        assertEquals(30, ScanReport.percent(0.30))
        assertEquals(100, ScanReport.percent(1.2))
        assertEquals(0, ScanReport.percent(-0.1))
    }

    @Test fun `fps is printed with a dot in every locale`() {
        val saved = java.util.Locale.getDefault()
        try {
            java.util.Locale.setDefault(java.util.Locale.GERMANY)
            assertEquals("4.2", ScanReport.fpsText(4.2))
        } finally {
            java.util.Locale.setDefault(saved)
        }
    }

    @Test fun `fill-centre crops the long side, as PreviewView does`() {
        // A 480 x 640 frame in a 1080 x 1080 view: scaled to 1080 wide, 1440 tall, 180 cut top and bottom.
        val f = ScanReport.fit(480, 640, 1080f, 1080f, crop = true)
        assertEquals(2.25f, f.scale, 1e-6f)
        assertEquals(0f, f.dx, 1e-4f)
        assertEquals(-180f, f.dy, 1e-4f)
    }

    @Test fun `fit letterboxes the short side`() {
        val f = ScanReport.fit(720, 540, 1080f, 1080f, crop = false)
        assertEquals(1.5f, f.scale, 1e-6f)
        assertEquals(0f, f.dx, 1e-4f)
        assertEquals(135f, f.dy, 1e-4f)
    }

    @Test fun `fit of an empty view does not divide by zero`() {
        assertEquals(ScanReport.Fit(1f, 0f, 0f), ScanReport.fit(720, 540, 0f, 0f, crop = true))
    }

    @Test fun `fps is smoothed and ignores a zero gap`() {
        assertEquals(5.0, ScanReport.nextFps(0.0, 200), 1e-9)
        assertEquals(5.0 * 0.8 + 10.0 * 0.2, ScanReport.nextFps(5.0, 100), 1e-9)
        assertEquals(5.0, ScanReport.nextFps(5.0, 0), 0.0)
    }

    @Test fun `a restored live camera with the permission gone shows the start card, not a black preview`() {
        assertEquals(ScanReport.MODE_NONE, ScanReport.resumeMode(ScanReport.MODE_CAMERA, cameraGranted = false))
        assertEquals(ScanReport.MODE_CAMERA, ScanReport.resumeMode(ScanReport.MODE_CAMERA, cameraGranted = true))
        assertEquals(ScanReport.MODE_PHOTO, ScanReport.resumeMode(ScanReport.MODE_PHOTO, cameraGranted = false))
        assertEquals(ScanReport.MODE_NONE, ScanReport.resumeMode(ScanReport.MODE_NONE, cameraGranted = false))
    }
}
