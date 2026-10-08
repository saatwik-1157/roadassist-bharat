package `in`.roadassist.app

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A booking in progress survives a tab switch, and is never booked twice.
 *
 * BookScreen held the booking and its offers in plain `remember`, and minted a
 * new idempotency key per tap ("and-" + nanoTime). Leaving the Assist tab
 * dropped both, and "Book & dispatch" then created a second booking the server
 * could not recognise as a repeat.
 */
class BookingDraftTest {

    @Test
    fun `the same draft sends the same idempotency key every time`() {
        val key = BookingDraft.keyFor(null)
        assertEquals(key, BookingDraft.keyFor(key))
        assertEquals(key, BookingDraft.keyFor(key))
    }

    @Test
    fun `a new draft gets a new key that the server accepts`() {
        val a = BookingDraft.keyFor(null)
        val b = BookingDraft.keyFor(null)
        assertNotEquals("two drafts shared a key", a, b)
        assertTrue("the server takes at most 80 characters", a.length <= 80)
        assertTrue(a.startsWith("and-"))
    }

    @Test
    fun `offers survive saved state`() {
        val offers = listOf(
            JSONObject().put("id", "o-1").put("etaMinutes", 12),
            JSONObject().put("id", "o-2").put("etaMinutes", 19),
        )
        val back = BookingDraft.loadOffers(BookingDraft.saveOffers(offers))
        assertEquals(listOf("o-1", "o-2"), back.map { it.getString("id") })
        assertEquals(emptyList<JSONObject>(), BookingDraft.loadOffers(null))
        assertEquals(emptyList<JSONObject>(), BookingDraft.loadOffers("not json"))
    }

    @Test
    fun `coming back to the tab picks the booking up where the server has it`() {
        assertEquals(BookingDraft.Resume.SHOW_OFFERS, BookingDraft.resume("MATCHING", hasMechanic = false))
        assertEquals(BookingDraft.Resume.DISPATCH, BookingDraft.resume("REQUESTED", hasMechanic = false))
        assertEquals(BookingDraft.Resume.DISPATCH, BookingDraft.resume("NO_SUPPLY", hasMechanic = false))
        assertEquals(BookingDraft.Resume.TRACK, BookingDraft.resume("ASSIGNED", hasMechanic = true))
        assertEquals(BookingDraft.Resume.TRACK, BookingDraft.resume("EN_ROUTE", hasMechanic = true))
        assertEquals(BookingDraft.Resume.FINISHED, BookingDraft.resume("CANCELLED", hasMechanic = false))
        assertEquals(BookingDraft.Resume.FINISHED, BookingDraft.resume("PAID", hasMechanic = true))
    }

    @Test
    fun `the draft is app state, not the booking screen's`() {
        // The structural half of the fix: BookScreen takes the draft as a
        // parameter and keeps no booking of its own.
        val src = java.io.File("src/main/java/in/roadassist/app/MainActivity.kt").readText()
        val book = src.substringAfter("private fun BookScreen(").substringBefore("ScreenColumn {")
        assertTrue("BookScreen must take the hoisted draft", "draft: BookingDraft.State" in book)
        assertTrue("BookScreen keeps its own bookingId again",
            "var bookingId by remember" !in book)
        assertTrue("a key is minted per tap again", "System.nanoTime()" !in src.substringAfter("private fun BookScreen("))
    }
}
