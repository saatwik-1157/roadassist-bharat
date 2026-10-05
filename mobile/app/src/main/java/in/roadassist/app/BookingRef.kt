package `in`.roadassist.app

import java.util.Locale
import org.json.JSONObject

/**
 * The name a person sees for a booking: its short reference, never its UUID.
 *
 * The server mints the reference once, when the booking is created
 * (`"RA" + 8 hex characters, upper-cased` — app/apps/api/src/domain/reference.ts),
 * and the web app, the SMS replies and the history list all show that same
 * string. It is drawn from a separate random UUID, NOT from the booking id, so
 * it cannot be worked out from the id: shortening the id to "RA…" would print
 * something that looks like a reference and matches nothing the user could
 * quote to support. So the server's field is used whenever it is known, and
 * only when it is not (the Track screen before its first read lands, or a row
 * without one) does the label fall back to the first block of the id, with no
 * "RA" in front so it is never mistaken for a reference.
 *
 * The full id is still what every request uses; this is display only.
 */
object BookingRef {

    /** The server's reference, trimmed, or null when absent, blank or JSON null. */
    fun of(reference: String?): String? =
        reference?.trim()?.takeIf { it.isNotEmpty() && it != "null" }

    /** The reference a booking JSON object carries, if any. */
    fun of(booking: JSONObject?): String? =
        if (booking == null || booking.isNull("reference")) null else of(booking.optString("reference"))

    /** The first group of a UUID, upper-cased: "1c7f585d-…" → "1C7F585D". */
    fun shortId(id: String): String = id.trim().substringBefore('-').take(8).uppercase(Locale.ROOT)

    /** What to show for a booking: its reference when known, else [shortId] of its id. */
    fun label(reference: String?, id: String): String = of(reference) ?: shortId(id)

    /** [label] for a booking as the API returns it. */
    fun label(booking: JSONObject): String = of(booking) ?: shortId(booking.optString("id"))
}
