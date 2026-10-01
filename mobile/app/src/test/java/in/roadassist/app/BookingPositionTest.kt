package `in`.roadassist.app

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A booking is placed where the phone measured the person to be. It is never
 * placed at the selected mechanic, and never at the NH-48 demo point
 * (28.4595, 77.0266) unless the person explicitly tapped the demo button.
 */
class BookingPositionTest {

    private val demoLat = 28.4595
    private val demoLng = 77.0266

    @Test
    fun `no fix and no demo choice is not sent`() {
        assertEquals(
            BookingPosition.Decision.NotSent(BookingPosition.Reason.NO_FIX),
            BookingPosition.decide(null, demoChosen = false),
        )
    }

    @Test
    fun `no fix never becomes the demo point without the demo tap`() {
        listOf(true, false).forEach { permitted ->
            val d = BookingPosition.decide(null, demoChosen = false, locationPermitted = permitted)
            assertFalse("a booking with no fix was sent somewhere (permitted=$permitted)",
                d is BookingPosition.Decision.Send)
        }
    }

    @Test
    fun `permission off is told apart from no fix`() {
        assertEquals(
            BookingPosition.Decision.NotSent(BookingPosition.Reason.PERMISSION_OFF),
            BookingPosition.decide(null, demoChosen = false, locationPermitted = false),
        )
        assertEquals(R.string.booking_reason_permission, BookingPosition.reasonRes(BookingPosition.Reason.PERMISSION_OFF))
        assertEquals(R.string.booking_reason_no_fix, BookingPosition.reasonRes(BookingPosition.Reason.NO_FIX))
    }

    @Test
    fun `demo chosen with no fix sends the demo point labelled as demo`() {
        assertEquals(
            BookingPosition.Decision.Send(demoLat, demoLng, "NH-48, KM 212 (demo point)"),
            BookingPosition.decide(null, demoChosen = true),
        )
    }

    @Test
    fun `a real fix is sent exactly with no marker`() {
        assertEquals(
            BookingPosition.Decision.Send(12.9716, 77.5946, null),
            BookingPosition.decide(12.9716 to 77.5946, demoChosen = false),
        )
    }

    @Test
    fun `a real fix wins even when demo is chosen`() {
        val d = BookingPosition.decide(12.9716 to 77.5946, demoChosen = true)
        assertEquals(BookingPosition.Decision.Send(12.9716, 77.5946, null), d)
        assertNull((d as BookingPosition.Decision.Send).marker)
    }

    @Test
    fun `a broken coordinate is treated as no fix`() {
        listOf(
            Double.NaN to 77.0, 28.0 to Double.NaN,
            Double.POSITIVE_INFINITY to 77.0, 28.0 to Double.NEGATIVE_INFINITY,
            90.5 to 77.0, -91.0 to 77.0, 28.0 to 180.5, 28.0 to -181.0,
            0.0 to 0.0,
        ).forEach { fix ->
            assertEquals("$fix", BookingPosition.Decision.NotSent(BookingPosition.Reason.NO_FIX),
                BookingPosition.decide(fix, demoChosen = false))
        }
    }

    @Test
    fun `the nearby list is searched around the fix, and the demo centre is labelled`() {
        val real = BookingPosition.nearbyCentre(12.9716 to 77.5946)
        assertEquals(BookingPosition.NearbyCentre(12.9716, 77.5946, isDemo = false), real)
        assertEquals("/v1/map/live?lat=12.9716&lng=77.5946&radiusKm=30", BookingPosition.nearbyPath(real))
        assertEquals(R.string.mechanics_nearby_around_you, BookingPosition.nearbyNoteRes(real))

        val demo = BookingPosition.nearbyCentre(null)
        assertEquals(BookingPosition.NearbyCentre(demoLat, demoLng, isDemo = true), demo)
        assertEquals(R.string.mechanics_nearby_around_demo, BookingPosition.nearbyNoteRes(demo))
        assertTrue(BookingPosition.nearbyCentre(0.0 to 0.0).isDemo)
    }

    /**
     * The pure function is only half the fix: the booking screen has to use
     * it. A revert to `target?.optDouble("lat", 28.4595)` at the call site would
     * leave every test above green, so this reads BookScreen's source and fails
     * if a demo coordinate, the mechanic's coordinates or the hardcoded marker
     * come back, or the decision stops going through [BookingPosition.decide].
     */
    @Test
    fun `the booking screen decides through BookingPosition and never uses the mechanic's position`() {
        val src = listOf(
            File("src/main/java/in/roadassist/app/MainActivity.kt"),
            File("app/src/main/java/in/roadassist/app/MainActivity.kt"),
        ).first { it.isFile }.readText().replace("\r\n", "\n")   // autocrlf checkouts
        val start = src.indexOf("private fun BookScreen(")
        assertTrue("BookScreen not found in MainActivity.kt", start >= 0)
        val end = src.indexOf("\n}\n", start)
        assertTrue("end of BookScreen not found", end > start)
        val body = src.substring(start, end)

        assertTrue("BookScreen no longer decides through BookingPosition.decide",
            body.contains("BookingPosition.decide("))
        assertTrue("the nearby list is no longer searched through BookingPosition.nearbyPath",
            body.contains("BookingPosition.nearbyPath("))
        assertTrue("the booking's lat/lng no longer come from the decision",
            body.contains(".put(\"lat\", at.lat).put(\"lng\", at.lng)"))
        listOf(
            "28.4595", "77.0266", "DEMO_LAT", "DEMO_LNG", "NH-48, KM 212",
            "optDouble(\"lat\"", "optDouble(\"lng\"", "getDouble(\"lat\"", "getDouble(\"lng\"",
        ).forEach {
            assertFalse("BookScreen contains '$it' again: a booking could be sent somewhere the person is not",
                body.contains(it))
        }
    }
}
