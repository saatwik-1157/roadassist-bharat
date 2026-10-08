package `in`.roadassist.app

import org.json.JSONArray
import org.json.JSONObject

/**
 * One booking in progress on the Assist tab, and what to do with it when the
 * person comes back to the tab.
 *
 * BookScreen kept the booking it had created, and the offers dispatch
 * returned, in plain `remember`. The Assist tab leaves the composition on
 * every tab switch, so looking at the map while mechanics were being asked
 * dropped the booking: the offers vanished and "Book & dispatch" created a
 * SECOND booking, with a new idempotency key minted per tap ("and-" + nanoTime)
 * so the server could not tell it was the same request.
 *
 * Now the draft (booking id, reference, the offers as JSON and the key) is
 * hoisted into saveable app state the way the tracked booking is, the key is
 * minted once per draft and saved BEFORE the request goes out, and on return
 * the booking is re-read from the server and [resume] decides what to show.
 * Pure, so BookingDraftTest pins it off-device.
 */
object BookingDraft {

    /** The draft as app state: four saveable strings, null when there is none. */
    data class State(
        val key: String? = null,
        val id: String? = null,
        val ref: String? = null,
        val offers: String? = null,
    )

    /** A fresh idempotency key for a new draft. The server takes up to 80 characters. */
    fun newKey(): String = "and-" + java.util.UUID.randomUUID()

    /** The draft's key: the saved one if this draft already has one, else a new one. */
    fun keyFor(saved: String?): String = saved?.takeIf { it.isNotBlank() } ?: newKey()

    enum class Resume {
        /** Mechanics are being asked right now: keep showing the offers we have. */
        SHOW_OFFERS,

        /** Created but nobody is being asked (REQUESTED, NO_SUPPLY): dispatch THIS booking again. */
        DISPATCH,

        /** A mechanic has it: go to Track. */
        TRACK,

        /** Over (cancelled, completed, paid): start a new draft. */
        FINISHED,
    }

    private val FINISHED_STATUSES = setOf("CANCELLED", "COMPLETED", "PAID")
    private val DISPATCHABLE = setOf("DRAFT", "REQUESTED", "NO_SUPPLY")

    fun resume(status: String, hasMechanic: Boolean): Resume = when {
        status in FINISHED_STATUSES -> Resume.FINISHED
        hasMechanic -> Resume.TRACK
        status == "MATCHING" -> Resume.SHOW_OFFERS
        status in DISPATCHABLE -> Resume.DISPATCH
        else -> Resume.TRACK
    }

    /** Offers as a string, for saved state (a JSONObject has no Saver). */
    fun saveOffers(offers: List<JSONObject>): String =
        JSONArray().also { a -> offers.forEach { a.put(it) } }.toString()

    fun loadOffers(saved: String?): List<JSONObject> {
        if (saved.isNullOrBlank()) return emptyList()
        return try {
            val a = JSONArray(saved)
            (0 until a.length()).map { a.getJSONObject(it) }
        } catch (_: Exception) { emptyList() }
    }
}
