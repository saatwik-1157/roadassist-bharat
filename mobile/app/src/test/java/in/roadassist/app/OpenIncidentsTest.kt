package `in`.roadassist.app

import java.time.LocalDate
import java.time.ZoneId
import java.util.Locale
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The decisions behind Home's "Emergency open" cards: what a response parses
 * into, which buttons a card offers, and how it names and dates an incident.
 *
 * The card is how somebody closes an emergency raised before the app was
 * closed or reinstalled, so a bad row must cost nothing but itself.
 */
class OpenIncidentsTest {

    private fun item(
        id: String = "3f2a9c1e-7b4d-4e2a-9c1e-0a1b2c3d4e5f",
        status: String = "CONFIRMED",
        stage: String = "SOS_RECEIVED",
        reference: Any? = "RA-7Q2K9P",
        raisedAt: String = "2026-09-27T07:10:00.000Z",
        canResolve: Boolean = true,
        canCancel: Boolean = true,
        respondersNotified: Any? = null,
    ): JSONObject = JSONObject()
        .put("id", id).put("status", status).put("stage", stage)
        .put("reference", reference ?: JSONObject.NULL)
        .put("raisedAt", raisedAt).put("severity", "HIGH")
        .put("canResolve", canResolve).put("canCancel", canCancel)
        .apply { if (respondersNotified != null) put("respondersNotified", respondersNotified) }

    private fun envelope(vararg items: Any): JSONObject =
        JSONObject().put("data", JSONArray().apply { items.forEach { put(it) } }).put("meta", JSONObject())

    @Test
    fun `an empty list means no cards`() {
        assertTrue(OpenIncidents.parse(envelope()).isEmpty())
        // An envelope with no data at all (or data that is not an array) is the same.
        assertTrue(OpenIncidents.parse(JSONObject()).isEmpty())
        assertTrue(OpenIncidents.parse(JSONObject().put("data", "nope")).isEmpty())
    }

    @Test
    fun `a full item parses every field`() {
        val list = OpenIncidents.parse(envelope(item()))
        assertEquals(1, list.size)
        val i = list[0]
        assertEquals("3f2a9c1e-7b4d-4e2a-9c1e-0a1b2c3d4e5f", i.id)
        assertEquals("CONFIRMED", i.status)
        assertEquals("SOS_RECEIVED", i.stage)
        assertEquals("RA-7Q2K9P", i.reference)
        assertEquals("2026-09-27T07:10:00.000Z", i.raisedAt)
        assertEquals("HIGH", i.severity)
        assertTrue(i.canResolve && i.canCancel)
    }

    @Test
    fun `malformed items are skipped, not fatal, and the good ones survive`() {
        val good = item(id = "aaaaaaaa-0000-0000-0000-000000000001")
        val list = OpenIncidents.parse(
            envelope(
                "not an object",
                42,
                JSONObject(),                                        // nothing at all
                item().apply { remove("id") },                       // no id
                item(id = "   "),                                    // blank id
                item().apply { put("status", JSONObject.NULL) },     // null status
                good,
            ),
        )
        assertEquals(listOf("aaaaaaaa-0000-0000-0000-000000000001"), list.map { it.id })
    }

    @Test
    fun `a closed incident is never shown even if a server sends one`() {
        val list = OpenIncidents.parse(
            envelope(item(id = "a", status = "RESOLVED"), item(id = "b", status = "cancelled"), item(id = "c")),
        )
        assertEquals(listOf("c"), list.map { it.id })
    }

    @Test
    fun `missing permission flags default to no buttons`() {
        val bare = JSONObject().put("id", "x-1").put("status", "CONFIRMED")
        val i = OpenIncidents.parse(envelope(bare)).single()
        assertTrue(OpenIncidents.actions(i).isEmpty())
        assertEquals("", i.stage)
        assertNull(i.reference)
    }

    @Test
    fun `buttons follow exactly what the server allows`() {
        fun actionsFor(r: Boolean, c: Boolean) =
            OpenIncidents.actions(OpenIncidents.parse(envelope(item(canResolve = r, canCancel = c))).single())

        assertEquals(listOf(OpenIncidents.Action.RESOLVE, OpenIncidents.Action.CANCEL), actionsFor(true, true))
        // Only canCancel (e.g. still AWAITING_CONFIRMATION): only "False alarm".
        assertEquals(listOf(OpenIncidents.Action.CANCEL), actionsFor(false, true))
        assertEquals(listOf(OpenIncidents.Action.RESOLVE), actionsFor(true, false))
        assertEquals(emptyList<OpenIncidents.Action>(), actionsFor(false, false))
    }

    @Test
    fun `the label is the reference, else the short id`() {
        val withRef = OpenIncidents.parse(envelope(item())).single()
        assertEquals("RA-7Q2K9P", OpenIncidents.label(withRef))

        // JSON null must not become the four-letter string "null".
        val nullRef = OpenIncidents.parse(envelope(item(reference = null))).single()
        assertNull(nullRef.reference)
        assertEquals("3F2A9C1E", OpenIncidents.label(nullRef))

        val blankRef = OpenIncidents.parse(envelope(item(reference = "  "))).single()
        assertEquals("3F2A9C1E", OpenIncidents.label(blankRef))

        assertEquals("ABC", OpenIncidents.shortId("abc"))
    }

    @Test
    fun `stages map onto the product vocabulary, anything newer is made readable`() {
        fun stageOf(s: String) = OpenIncidents.stage(OpenIncidents.parse(envelope(item(stage = s))).single())
        assertEquals(OpenIncidents.Stage.CREATED, stageOf("SOS_CREATED"))
        assertEquals(OpenIncidents.Stage.RECEIVED, stageOf("SOS_RECEIVED"))
        assertEquals(OpenIncidents.Stage.ESCALATED, stageOf("RESPONDING"))
        assertEquals(OpenIncidents.Stage.OTHER, stageOf("HELP_ARRIVED"))
        assertEquals("help arrived", OpenIncidents.readableStage("HELP_ARRIVED"))
    }

    @Test
    fun `responders are said to be alerted only when the server says it notified them`() {
        // RESPONDING means the ladder ran and LOCATED the nearest unit. The card
        // said "Responders have been alerted" for every one, while the server
        // contacted no unit at all.
        fun stageOf(n: Any?) = OpenIncidents.stage(
            OpenIncidents.parse(envelope(item(status = "RESPONDING", stage = "RESPONDING", respondersNotified = n))).single())
        assertEquals(OpenIncidents.Stage.ESCALATED, stageOf(0))
        assertEquals(OpenIncidents.Stage.ESCALATED, stageOf(null))   // an older server: no field
        assertEquals(OpenIncidents.Stage.RESPONDING, stageOf(1))
        assertEquals(OpenIncidents.Stage.RESPONDING, stageOf(3))
    }

    @Test
    fun `a respondersNotified that is not a count of one or more reads as zero`() {
        for (bad in listOf(-2, "abc", JSONObject.NULL, "")) {
            val i = OpenIncidents.parse(envelope(item(stage = "RESPONDING", respondersNotified = bad))).single()
            assertEquals("$bad", 0, i.respondersNotified)
            assertEquals("$bad", OpenIncidents.Stage.ESCALATED, OpenIncidents.stage(i))
        }
        assertEquals(2, OpenIncidents.parse(envelope(item(respondersNotified = 2))).single().respondersNotified)
    }

    @Test
    fun `raised time is shown in the phone's own zone`() {
        val ist = ZoneId.of("Asia/Kolkata")
        val today = LocalDate.of(2026, 9, 27)
        // 07:10Z is 12:40 in India.
        assertEquals("12:40", OpenIncidents.raisedLocal("2026-09-27T07:10:00.000Z", ist, Locale.ENGLISH, true, today))
        assertEquals("12:40 PM", OpenIncidents.raisedLocal("2026-09-27T07:10:00.000Z", ist, Locale.ENGLISH, false, today))
        // An emergency still open from yesterday carries its date.
        assertEquals("26 Sep, 23:30", OpenIncidents.raisedLocal("2026-09-26T18:00:00Z", ist, Locale.ENGLISH, true, today))
        // Unreadable timestamps do not throw.
        assertNull(OpenIncidents.raisedLocal("", ist, Locale.ENGLISH, true, today))
        assertNull(OpenIncidents.raisedLocal("yesterday", ist, Locale.ENGLISH, true, today))
    }

    @Test
    fun `closing removes only that card`() {
        val list = OpenIncidents.parse(envelope(item(id = "a"), item(id = "b"), item(id = "c")))
        assertEquals(listOf("a", "c"), OpenIncidents.without(list, "b").map { it.id })
        assertEquals(listOf("a", "b", "c"), OpenIncidents.without(list, "zzz").map { it.id })
    }

    @Test
    fun `close requests hit the existing endpoints with the right bodies`() {
        val (rp, rb) = OpenIncidents.closeRequest("id-1", OpenIncidents.Action.RESOLVE)
        assertEquals("/v1/sos/id-1/resolve", rp)
        assertEquals("self_resolved", rb.getString("outcome"))
        assertEquals(1, rb.length())

        val (cp, cb) = OpenIncidents.closeRequest("id-1", OpenIncidents.Action.CANCEL)
        assertEquals("/v1/sos/id-1/cancel", cp)
        assertEquals(0, cb.length())
    }
}
