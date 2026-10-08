package `in`.roadassist.app

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * ONNX Runtime for Android declares a content provider,
 * ai.onnxruntime.TelemetryInitializer, that starts with the app and sends
 * usage telemetry with device identifiers to Microsoft. The app removes it in
 * its manifest. A dependency bump or a manifest tidy that drops the removal
 * would quietly put it back, so it is pinned here; the merged manifest of a
 * real build was checked as well (see release/INSTALL.md).
 */
class OnnxTelemetryOffTest {

    private val manifest = File("src/main/AndroidManifest.xml").readText()

    @Test fun `the runtime's telemetry provider is removed from the merged manifest`() {
        val provider = Regex("""<provider\b[^>]*android:name="ai\.onnxruntime\.TelemetryInitializer"[^>]*>""")
            .find(manifest)?.value
        assertTrue("no <provider> entry for ai.onnxruntime.TelemetryInitializer", provider != null)
        assertTrue("the provider entry must say tools:node=\"remove\": $provider", provider!!.contains("""tools:node="remove""""))
    }
}
