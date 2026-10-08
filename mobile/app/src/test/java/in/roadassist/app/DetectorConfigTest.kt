package `in`.roadassist.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File

class DetectorConfigTest {

    private val good = """
        {
          "model": "detector/m.onnx",
          "modelName": "Test model",
          "inputWidth": 416, "inputHeight": 416,
          "classes": ["pothole", "road_damage", "faded_marking", "manhole"],
          "reportAs": {"pothole": "pothole", "road_damage": "road_damage"},
          "minConfidence": 0.3, "iouThreshold": 0.45, "map50": 0.512
        }
    """.trimIndent()

    private fun rejects(json: String, mentioning: String) {
        try {
            DetectorConfig.parse(json)
            fail("accepted: $json")
        } catch (e: IllegalArgumentException) {
            assertTrue("message '${e.message}' should mention $mentioning", e.message!!.contains(mentioning))
        }
    }

    private fun with(key: String, value: String): String =
        good.replace(Regex("\"$key\":\\s*(\"[^\"]*\"|\\[[^]]*]|\\{[^}]*}|[0-9.]+)"), "\"$key\": $value")

    @Test fun `the config that ships parses and matches the model beside it`() {
        val c = DetectorConfig.parse(File("src/main/assets/${DetectorConfig.ASSET}").readText())
        assertTrue("model file ${c.modelAsset} missing", File("src/main/assets/${c.modelAsset}").isFile)
        assertEquals(listOf("pothole", "road_damage", "faded_marking", "manhole"), c.classes)
        assertEquals(416, c.inputWidth)
        assertEquals(416, c.inputHeight)
        assertEquals("0.516", c.map50Text())
        // Every reportable class is a type the server's enum takes.
        assertTrue(c.reportAs.values.all { it in DetectorConfig.SERVER_TYPES })
        // The same mapping as the web scan (scan-core.js INGESTABLE): a worn
        // marking or a manhole cover is shown, never filed as something else.
        assertEquals(mapOf("pothole" to "pothole", "road_damage" to "road_damage"), c.reportAs)
    }

    @Test fun `a full four-class 416 config, the next model's shape, parses`() {
        val c = DetectorConfig.parse(good)
        assertEquals("detector/m.onnx", c.modelAsset)
        assertEquals(416, c.inputWidth)
        assertEquals(416, c.inputHeight)
        assertEquals(listOf("pothole", "road_damage", "faded_marking", "manhole"), c.classes)
        assertEquals(mapOf("pothole" to "pothole", "road_damage" to "road_damage"), c.reportAs)
        assertEquals(0.3, c.minConfidence, 0.0)
        assertEquals(0.45, c.iouThreshold, 0.0)
        assertEquals("0.512", c.map50Text())
    }

    @Test fun `map50 is printed with a dot whatever the locale`() {
        val saved = java.util.Locale.getDefault()
        try {
            java.util.Locale.setDefault(java.util.Locale.GERMANY)
            assertEquals("0.512", DetectorConfig.parse(good).map50Text())
        } finally {
            java.util.Locale.setDefault(saved)
        }
    }

    @Test fun `classes the server cannot take are simply not reportable`() {
        val c = DetectorConfig.parse(good)
        assertEquals(null, c.reportAs["manhole"])
    }

    @Test fun `no reportAs means nothing is reportable, not everything`() {
        val c = DetectorConfig.parse(good.replace(Regex("\"reportAs\":\\s*\\{[^}]*},"), ""))
        assertTrue(c.reportAs.isEmpty())
    }

    @Test fun `not JSON is refused with a reason`() = rejects("{nope", "not valid JSON")

    @Test fun `missing model is refused`() = rejects(good.replace("\"model\": \"detector/m.onnx\",", ""), "\"model\"")

    @Test fun `a model path that escapes assets is refused`() {
        rejects(with("model", "\"../secrets.onnx\""), "relative .onnx")
        rejects(with("model", "\"/data/m.onnx\""), "relative .onnx")
        rejects(with("model", "\"detector/m.tflite\""), "relative .onnx")
    }

    @Test fun `an input size off the YOLO stride is refused`() {
        rejects(with("inputWidth", "500"), "multiple of 32")
        rejects(with("inputHeight", "0"), "multiple of 32")
        rejects(with("inputWidth", "416.5"), "multiple of 32")
        rejects(with("inputWidth", "\"416\""), "must be a number")
    }

    @Test fun `empty, blank or duplicate classes are refused`() {
        rejects(with("classes", "[]"), "non-empty array")
        rejects(with("classes", "[\"pothole\", \"\"]"), "class 1")
        rejects(with("classes", "[\"pothole\", \"pothole\"]"), "unique")
    }

    @Test fun `thresholds outside 0-1 are refused`() {
        rejects(with("minConfidence", "0"), "minConfidence")
        rejects(with("minConfidence", "1.5"), "minConfidence")
        rejects(with("iouThreshold", "1"), "iouThreshold")
        rejects(with("map50", "47.2"), "map50")
    }

    @Test fun `reportAs may only name known classes and server types`() {
        rejects(with("reportAs", "{\"crater\": \"pothole\"}"), "not in classes")
        rejects(with("reportAs", "{\"manhole\": \"manhole\"}"), "must be one of")
    }
}
