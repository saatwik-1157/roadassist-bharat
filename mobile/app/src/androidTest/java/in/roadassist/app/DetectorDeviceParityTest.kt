package `in`.roadassist.app

import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The scanner end to end, on the phone: the APK's own detector.json and .onnx,
 * the app's [OrtRoadDetector] on Android's ONNX Runtime (CPU), on the four
 * fixed pictures mobile/tools/detector_parity_reference.py ran through
 * ai/serve.py. Every server detection must be found, same class, box IoU
 * above 0.9, confidence within 0.01 (different CPU kernels may round
 * differently in the last places).
 *
 *   ./gradlew :app:assembleDebug :app:assembleDebugAndroidTest
 *   adb install -r app/build/outputs/apk/debug/app-<abi>-debug.apk
 *   adb install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
 *   adb shell am instrument -w -e class in.roadassist.app.DetectorDeviceParityTest \
 *       in.roadassist.app.test/androidx.test.runner.AndroidJUnitRunner
 *
 * (Installing by hand rather than connectedDebugAndroidTest, which uninstalls
 * the app afterwards and so signs the phone out.) Results are logged under
 * the tag DetectorParity.
 */
@RunWith(AndroidJUnit4::class)
class DetectorDeviceParityTest {

    @Test
    fun theShippedModelFindsWhatTheServerFinds() {
        val inst = InstrumentationRegistry.getInstrumentation()
        val app = inst.targetContext
        val assets = inst.context.assets
        // The packager unzips "x.gz" assets into "x"; ask for either.
        val fx = ParityFixtures { name ->
            val path = "detector-parity/$name"
            val found = if (name.endsWith(".gz") && assets.list("detector-parity")?.contains(name) != true) {
                path.removeSuffix(".gz")
            } else path
            assets.open(found).use { it.readBytes() }
        }
        val config = DetectorConfig.parse(app.assets.open(DetectorConfig.ASSET).use { it.readBytes().decodeToString() })
        assertEquals(fx.expected.getString("model"), config.modelAsset)
        val model = app.assets.open(config.modelAsset).use { it.readBytes() }
        OrtRoadDetector(model, config).use { det ->
            for (name in fx.caseNames()) {
                val r = det.detect(fx.upright(fx.case(name)))
                for (line in fx.compare(name, r.detections, minIou = 0.9, confTolerance = 0.01)) {
                    Log.i("DetectorParity", "$line  (${r.preprocessMs} ms prep, ${r.inferenceMs} ms model)")
                }
            }
        }
    }
}
