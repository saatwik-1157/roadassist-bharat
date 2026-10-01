package `in`.roadassist.app

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A citizen hazard report goes to RAKSHA only at a position the phone
 * measured. With no fix it is not sent at all — never at the NH-48 demo point
 * (28.4595, 77.0266), which is where every no-fix report used to land.
 */
class HazardLocationTest {

    private val demoLat = 28.4595
    private val demoLng = 77.0266

    @Test
    fun `no fix is not sent`() {
        assertEquals(HazardLocation.ReportPosition.NoFix, HazardLocation.reportPosition(null))
    }

    @Test
    fun `no fix never becomes the demo point`() {
        val at = HazardLocation.reportPosition(null)
        assertFalse(
            "a report with no GPS fix was placed at the NH-48 demo point",
            at == HazardLocation.ReportPosition.Send(demoLat, demoLng),
        )
        assertFalse("a report with no GPS fix was sent somewhere", at is HazardLocation.ReportPosition.Send)
    }

    @Test
    fun `a real fix is sent exactly as measured`() {
        assertEquals(
            HazardLocation.ReportPosition.Send(12.9716, 77.5946),
            HazardLocation.reportPosition(12.9716 to 77.5946),
        )
    }

    @Test
    fun `a broken coordinate is treated as no fix`() {
        listOf(
            Double.NaN to 77.0, 28.0 to Double.NaN,
            Double.POSITIVE_INFINITY to 77.0, 28.0 to Double.NEGATIVE_INFINITY,
            90.5 to 77.0, -91.0 to 77.0, 28.0 to 180.5, 28.0 to -181.0,
        ).forEach { fix ->
            assertEquals("$fix", HazardLocation.ReportPosition.NoFix, HazardLocation.reportPosition(fix))
        }
    }

    @Test
    fun `the edges of the globe are still real positions`() {
        assertTrue(HazardLocation.reportPosition(90.0 to 180.0) is HazardLocation.ReportPosition.Send)
        assertTrue(HazardLocation.reportPosition(-90.0 to -180.0) is HazardLocation.ReportPosition.Send)
    }

    /**
     * The pure function is only half the fix: the dialog has to use it. A
     * revert to `loc?.first ?: 28.4595` at the call site would leave every test
     * above green, so this reads the dialog's source and fails if a demo
     * coordinate comes back into it or the decision stops going through
     * [HazardLocation.reportPosition].
     */
    @Test
    fun `the hazard dialog sends through reportPosition and has no demo fallback`() {
        val src = listOf(
            File("src/main/java/in/roadassist/app/MainActivity.kt"),
            File("app/src/main/java/in/roadassist/app/MainActivity.kt"),
        ).first { it.isFile }.readText().replace("\r\n", "\n")   // autocrlf checkouts
        val start = src.indexOf("private fun ReportHazardDialog(")
        assertTrue("ReportHazardDialog not found in MainActivity.kt", start >= 0)
        val end = src.indexOf("\n}\n", start)
        assertTrue("end of ReportHazardDialog not found", end > start)
        val body = src.substring(start, end)

        assertTrue("ReportHazardDialog no longer decides through HazardLocation.reportPosition",
            body.contains("HazardLocation.reportPosition("))
        listOf("28.4595", "77.0266", "DEMO_LAT", "DEMO_LNG", "approximate location").forEach {
            assertFalse("ReportHazardDialog contains '$it' again: a no-fix report would be sent somewhere made up",
                body.contains(it))
        }
    }
}
