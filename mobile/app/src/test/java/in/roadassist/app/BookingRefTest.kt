package `in`.roadassist.app

import java.io.File
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A booking is shown to people by its short reference — the one the web app,
 * SMS and history print — and never by its UUID. The UUID stays in requests.
 */
class BookingRefTest {

    private val id = "1c7f585d-e4e4-4c19-a75a-0123456789ab"

    @Test
    fun `the server's reference is shown as it is`() {
        assertEquals("RA4F2A9B1C", BookingRef.label("RA4F2A9B1C", id))
        assertEquals("RA4F2A9B1C", BookingRef.label("  RA4F2A9B1C \n", id))
    }

    @Test
    fun `without a reference the label is the id's first block, upper-cased, with no RA`() {
        // Not "RA1C7F585D": the reference is minted from a different UUID, so
        // an RA-prefixed id would look like a reference and match nothing.
        assertEquals("1C7F585D", BookingRef.label(null, id))
        assertEquals("1C7F585D", BookingRef.label("", id))
        assertEquals("1C7F585D", BookingRef.label("   ", id))
        assertEquals("1C7F585D", BookingRef.label("null", id))
        assertEquals("1C7F585D", BookingRef.shortId("  $id  "))
        assertEquals("ABCDEF12", BookingRef.shortId("abcdef1234567890"))
    }

    @Test
    fun `a booking object gives its reference, and JSON null is no reference`() {
        val b = JSONObject().put("id", id).put("reference", "RA00C0FFEE")
        assertEquals("RA00C0FFEE", BookingRef.of(b))
        assertEquals("RA00C0FFEE", BookingRef.label(b))

        val nulled = JSONObject().put("id", id).put("reference", JSONObject.NULL)
        assertNull(BookingRef.of(nulled))
        assertEquals("1C7F585D", BookingRef.label(nulled))

        val missing = JSONObject().put("id", id)
        assertNull(BookingRef.of(missing))
        assertEquals("1C7F585D", BookingRef.label(missing))
        assertNull(BookingRef.of(null as JSONObject?))
    }

    @Test
    fun `no label ever contains the full id`() {
        listOf<String?>(null, "", "RA4F2A9B1C").forEach { ref ->
            assertFalse(BookingRef.label(ref, id).contains(id))
            assertTrue(BookingRef.label(ref, id).length <= 10)
        }
    }

    private fun mainActivity(): String = listOf(
        File("src/main/java/in/roadassist/app/MainActivity.kt"),
        File("app/src/main/java/in/roadassist/app/MainActivity.kt"),
    ).first { it.isFile }.readText().replace("\r\n", "\n")

    @Test
    fun `Track names the booking by its reference, not its UUID`() {
        val src = mainActivity()
        assertFalse("Track prints the raw booking id again", src.contains("Sub(\"Booking \$bookingId\")"))
        assertTrue(src.contains("BookingRef.label(reference ?: knownReference, bookingId)"))
        // The id is still what the API is called with.
        assertTrue(src.contains("Api.get(\"/v1/bookings/\$bookingId\")"))
    }

    @Test
    fun `the pre-filled sign-in number is in the API's demo block`() {
        val src = mainActivity()
        val prefill = Regex("""var msisdn by rememberSaveable \{ mutableStateOf\("(\+\d+)"\) \}""")
            .find(src)?.groupValues?.get(1)
        assertEquals("+917000009876", prefill)
        // +91 70000 00000 to +91 70000 09999.
        assertTrue(Regex("""\+91700000\d{4}""").matches(prefill!!))
        assertFalse("the old real-looking number is back", src.contains("9876543210"))
    }
}
