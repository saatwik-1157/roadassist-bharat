package `in`.roadassist.app

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import org.json.JSONArray
import org.json.JSONObject

/**
 * One of the caller's emergencies that is still open on the server, as
 * `GET /v1/me/incidents` lists it.
 *
 * This exists because the SOS UI used to exist only while raising one: an app
 * that was closed, killed or reinstalled mid-emergency could no longer see it
 * or say "I'm safe", and it stayed open with nobody able to end it but an
 * operator. Home now shows a card per open incident, built from this.
 */
data class OpenIncident(
    val id: String,
    val status: String,
    val stage: String,
    val reference: String?,
    val raisedAt: String,
    val severity: String,
    val canResolve: Boolean,
    val canCancel: Boolean,
    /** Responder units the server says it contacted. Absent (an older server) is zero. */
    val respondersNotified: Int = 0,
)

/**
 * The decisions behind the "Emergency open" cards, kept pure so they are
 * tested off-device (OpenIncidentsTest), the same way Layers.kt keeps its own.
 */
object OpenIncidents {

    /** What a card may offer. The server says which are legal; the app never guesses. */
    enum class Action { RESOLVE, CANCEL }

    /**
     * The product's stage vocabulary (the API's PUBLIC_STAGE), plus anything newer.
     *
     * RESPONDING on the wire means the escalation ladder ran: contacts texted
     * and the nearest unit LOCATED. It does not mean a responder was told, and
     * the card used to say "Responders have been alerted" for every one. Now
     * that sentence is [Stage.RESPONDING] only when the server reports
     * `respondersNotified` > 0; otherwise it is [Stage.ESCALATED].
     */
    enum class Stage { CREATED, RECEIVED, ESCALATED, RESPONDING, OTHER }

    /** The resolve outcome for a person closing their own emergency from the phone. */
    const val RESOLVE_OUTCOME = "self_resolved"

    /** Statuses that are history, not open — never shown even if a server sends one. */
    private val CLOSED = setOf("RESOLVED", "CANCELLED")

    /** Parse the `{ data: [...], meta }` envelope. A missing `data` is no incidents. */
    fun parse(envelope: JSONObject): List<OpenIncident> = parseArray(envelope.optJSONArray("data"))

    /**
     * Parse the array item by item. An item that is not an object, has no id or
     * no status, or is already closed is skipped — one bad row must never cost
     * the person the card for the emergency that IS open, and must never crash
     * the Home screen, which is where the SOS button lives.
     */
    fun parseArray(arr: JSONArray?): List<OpenIncident> {
        if (arr == null) return emptyList()
        val out = ArrayList<OpenIncident>(arr.length())
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            val id = o.str("id") ?: continue
            val status = o.str("status") ?: continue
            if (status.uppercase(Locale.ROOT) in CLOSED) continue
            out += OpenIncident(
                id = id,
                status = status,
                stage = o.str("stage") ?: "",
                reference = o.str("reference"),
                raisedAt = o.str("raisedAt") ?: "",
                severity = o.str("severity") ?: "",
                canResolve = o.optBoolean("canResolve", false),
                canCancel = o.optBoolean("canCancel", false),
                respondersNotified = o.optInt("respondersNotified", 0).coerceAtLeast(0),
            )
        }
        return out
    }

    /** The buttons a card shows, in display order. Empty when the server allows neither. */
    fun actions(incident: OpenIncident): List<Action> = buildList {
        if (incident.canResolve) add(Action.RESOLVE)
        if (incident.canCancel) add(Action.CANCEL)
    }

    /** "RA-7Q2K9P" when the incident has a reference, else the first block of its id. */
    fun label(incident: OpenIncident): String =
        incident.reference?.trim()?.takeIf { it.isNotEmpty() } ?: shortId(incident.id)

    /** The first group of a UUID, upper-cased: enough to tell two incidents apart on a card. */
    fun shortId(id: String): String = id.trim().substringBefore('-').take(8).uppercase(Locale.ROOT)

    fun stage(incident: OpenIncident): Stage = when (incident.stage.uppercase(Locale.ROOT)) {
        "SOS_CREATED" -> Stage.CREATED
        "SOS_RECEIVED" -> Stage.RECEIVED
        "RESPONDING" -> if (incident.respondersNotified > 0) Stage.RESPONDING else Stage.ESCALATED
        else -> Stage.OTHER
    }

    /** A stage the app has no sentence for yet, made readable: "HELP_ARRIVED" → "help arrived". */
    fun readableStage(raw: String): String = raw.trim().replace('_', ' ').lowercase(Locale.ROOT)

    /**
     * When it was raised, in the phone's own time zone: "12:40" today, and
     * "26 Sep, 12:40" on an earlier day — an emergency still open from
     * yesterday should look like it. Null when the timestamp cannot be read.
     */
    fun raisedLocal(
        iso: String,
        zone: ZoneId,
        locale: Locale,
        is24Hour: Boolean,
        today: LocalDate = LocalDate.now(zone),
    ): String? {
        val at = try { Instant.parse(iso.trim()).atZone(zone) } catch (_: Exception) { return null }
        val time = DateTimeFormatter.ofPattern(if (is24Hour) "HH:mm" else "h:mm a", locale).format(at)
        return if (at.toLocalDate() == today) time
        else DateTimeFormatter.ofPattern("d MMM", locale).format(at) + ", " + time
    }

    /** The list once [id] has been closed. */
    fun without(list: List<OpenIncident>, id: String): List<OpenIncident> = list.filterNot { it.id == id }

    /** The path and body for closing an incident with [action]. */
    fun closeRequest(id: String, action: Action): Pair<String, JSONObject> = when (action) {
        Action.RESOLVE -> "/v1/sos/$id/resolve" to JSONObject().put("outcome", RESOLVE_OUTCOME)
        Action.CANCEL -> "/v1/sos/$id/cancel" to JSONObject()
    }

    /** A non-blank string field, or null — org.json's optString turns JSON null into "null". */
    private fun JSONObject.str(key: String): String? =
        if (isNull(key)) null else optString(key).trim().takeIf { it.isNotEmpty() }
}
