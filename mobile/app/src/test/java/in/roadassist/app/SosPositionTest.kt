package `in`.roadassist.app

import java.io.File
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * An SOS with no GPS fix is raised as "location unknown" on every rung: the
 * API body, the SMS text and the offline queue. It is never raised at the
 * NH-48 demo point (28.4595, 77.0266), which is where every no-fix SOS used
 * to send a responder.
 */
class SosPositionTest {

    private val demoLat = 28.4595
    private val demoLng = 77.0266
    private val ref = "RA-ABC234"

    // ── the decision ────────────────────────────────────────────────────────

    @Test
    fun `no fix is unknown, never the demo point`() {
        val pos = SosPosition.from(null)
        assertEquals(SosPosition.Unknown, pos)
        assertFalse("a no-fix SOS was placed at the NH-48 demo point",
            pos == SosPosition.Located(demoLat, demoLng))
    }

    @Test
    fun `a real fix is located exactly as measured`() {
        assertEquals(SosPosition.Located(12.971599, 77.594566), SosPosition.from(12.971599 to 77.594566))
    }

    @Test
    fun `a broken coordinate is unknown`() {
        listOf(
            Double.NaN to 77.0, 28.0 to Double.NaN, Double.POSITIVE_INFINITY to 77.0,
            90.5 to 77.0, -91.0 to 77.0, 28.0 to 180.5, 28.0 to -181.0,
            0.0 to 0.0,   // Null Island, refused by the server's SMS parser too
        ).forEach { assertEquals("$it", SosPosition.Unknown, SosPosition.from(it)) }
    }

    // ── data rung: POST /v1/sos ─────────────────────────────────────────────

    @Test
    fun `an unknown position is sent as locationUnknown with no coordinates`() {
        val body = SosPosition.apiBody(SosPosition.Unknown, ref)
        assertTrue(body.getBoolean("locationUnknown"))
        assertFalse("lat must be absent, not null or a stand-in", body.has("lat"))
        assertFalse("lng must be absent, not null or a stand-in", body.has("lng"))
        assertEquals(ref, body.getString("clientIncidentId"))
        assertEquals("manual", body.getString("source"))
    }

    @Test
    fun `a located position is sent as lat and lng without locationUnknown`() {
        val body = SosPosition.apiBody(SosPosition.Located(12.97, 77.59), ref)
        assertEquals(12.97, body.getDouble("lat"), 0.0)
        assertEquals(77.59, body.getDouble("lng"), 0.0)
        assertFalse(body.has("locationUnknown"))
        assertEquals(ref, body.getString("clientIncidentId"))
    }

    // ── SMS rung ────────────────────────────────────────────────────────────

    @Test
    fun `the SMS with no fix says location unknown and carries no number`() {
        val text = SosPosition.smsBody(SosPosition.Unknown)
        assertEquals("SOS location unknown RoadAssist", text)
        val words = text.lowercase().split(Regex("\\s+"))
        assertEquals("the server routes on the first word", "sos", words[0])
        assertFalse("no digit may stand in for a fix", text.any { it.isDigit() })
    }

    @Test
    fun `the SMS with a fix keeps the existing contract`() {
        assertEquals(SosLadder.smsBody(12.971599, 77.594566),
            SosPosition.smsBody(SosPosition.Located(12.971599, 77.594566)))
    }

    // ── offline queue ───────────────────────────────────────────────────────

    @Test
    fun `an unknown position is queued as null and replays as unknown`() {
        val entry = SosPosition.queueEntry(SosPosition.Unknown, ref, 1_000L)
        assertTrue(entry.has("lat") && entry.isNull("lat"))
        assertTrue(entry.has("lng") && entry.isNull("lng"))
        assertEquals(ref, entry.getString("ref"))
        // Through the same serialisation SharedPreferences stores.
        val back = JSONObject(entry.toString())
        assertEquals(SosPosition.Unknown, SosPosition.ofQueueEntry(back))
        assertTrue(SosPosition.apiBody(SosPosition.ofQueueEntry(back), ref).getBoolean("locationUnknown"))
    }

    @Test
    fun `a located position round-trips through the queue`() {
        val pos = SosPosition.Located(12.971599, 77.594566)
        val back = JSONObject(SosPosition.queueEntry(pos, ref, 1_000L).toString())
        assertEquals(pos, SosPosition.ofQueueEntry(back))
    }

    @Test
    fun `an entry with no coordinates at all is unknown`() {
        assertEquals(SosPosition.Unknown, SosPosition.ofQueueEntry(JSONObject().put("ref", ref)))
    }

    /**
     * Builds before 2026-10-01 queued the demo point for "no fix". The entry
     * below is the shape they wrote (no ref, a number where today writes
     * null); replayed as-is it would send a responder to NH-48.
     */
    @Test
    fun `a queued demo-point entry from an old build replays as unknown`() {
        val old = JSONObject("""{"lat":28.4595,"lng":77.0266,"at":1000}""")
        val pos = SosPosition.ofQueueEntry(old)
        assertEquals(SosPosition.Unknown, pos)
        val body = SosPosition.apiBody(pos, ref)
        assertTrue(body.getBoolean("locationUnknown"))
        assertFalse("the old demo lat would be sent as a real position", body.has("lat"))
        assertFalse("the old demo lng would be sent as a real position", body.has("lng"))
        assertEquals(SosPosition.Unknown, SosPosition.fromQueued(demoLat, demoLng))
        assertEquals(SosPosition.Unknown, SosPosition.fromQueued(demoLat + 5e-10, demoLng - 5e-10))
    }

    @Test
    fun `a queued real fix next to the demo point is located unchanged`() {
        val near = JSONObject(SosPosition.queueEntry(SosPosition.Located(28.4596, 77.0266), ref, 1_000L).toString())
        val pos = SosPosition.ofQueueEntry(near)
        assertEquals(SosPosition.Located(28.4596, 77.0266), pos)
        val body = SosPosition.apiBody(pos, ref)
        assertEquals(28.4596, body.getDouble("lat"), 0.0)
        assertEquals(77.0266, body.getDouble("lng"), 0.0)
        assertFalse(body.has("locationUnknown"))
        assertEquals(SosPosition.Located(demoLat, 77.0267), SosPosition.fromQueued(demoLat, 77.0267))
    }

    @Test
    fun `a queued null position is unknown`() {
        assertEquals(SosPosition.Unknown, SosPosition.fromQueued(null, null))
        assertEquals(SosPosition.Unknown, SosPosition.fromQueued(null, demoLng))
        assertEquals(SosPosition.Unknown, SosPosition.fromQueued(demoLat + 1.0, null))
    }

    @Test
    fun `a null-position entry still has a stable queue key`() {
        val entry = JSONObject(SosPosition.queueEntry(SosPosition.Unknown, ref, 1_000L).toString())
        assertEquals(ref, SosQueue.keyOf(entry))
    }

    // ── what the person is told ─────────────────────────────────────────────

    @Test
    fun `an unknown position tells the person to give 112 their location on every rung`() {
        SosLadder.Rung.values().forEach { rung ->
            val res = SosPosition.unknownNoticeRes(SosPosition.Unknown, rung)
            assertEquals("$rung",
                if (rung == SosLadder.Rung.QUEUED) R.string.sos_location_unknown_saved else R.string.sos_location_unknown,
                res)
            assertNull("$rung", SosPosition.unknownNoticeRes(SosPosition.Located(12.9, 77.5), rung))
        }
    }

    // ── the call sites ──────────────────────────────────────────────────────

    private fun source(name: String): String = listOf(
        File("src/main/java/in/roadassist/app/$name"),
        File("app/src/main/java/in/roadassist/app/$name"),
    ).first { it.isFile }.readText().replace("\r\n", "\n")   // autocrlf checkouts

    /**
     * The pure functions above stay green if fireSos goes back to
     * `loc?.first ?: DEMO_LAT`, so this reads Home's SOS code and fails if a
     * demo coordinate comes back into it or the decision stops going through
     * SosPosition.
     */
    @Test
    fun `fireSos raises through SosPosition and has no demo fallback`() {
        val src = source("MainActivity.kt")
        // Since 1.1.1 fireSos lives in SosPanel (shared by Home and the
        // sign-in screen) and the data rung's body in sosDataSummary.
        val start = src.indexOf("val fireSos: () -> Unit = fire@{")
        assertTrue("fireSos not found in MainActivity.kt", start >= 0)
        val end = src.indexOf("\n    }\n", start)
        assertTrue("end of fireSos not found", end > start)
        val summaryStart = src.indexOf("private suspend fun sosDataSummary(")
        assertTrue("sosDataSummary not found", summaryStart >= 0)
        val summary = src.substring(summaryStart, src.indexOf("\n}\n", summaryStart))
        val body = src.substring(start, end) + summary

        assertTrue("fireSos no longer decides through SosPosition.from", body.contains("SosPosition.from("))
        assertTrue("fireSos no longer builds its API body with SosPosition.apiBody", body.contains("SosPosition.apiBody("))
        listOf("28.4595", "77.0266", "DEMO_LAT", "DEMO_LNG", "demo location").forEach {
            assertFalse("fireSos contains '$it' again: a no-fix SOS would send a responder somewhere made up",
                body.contains(it))
        }
        // The stand-in declaration lived just above fireSos.
        val panel = src.substring(src.indexOf("fun SosPanel("), end)
        assertFalse("SosPanel declares a demo SOS coordinate again", Regex("""val DEMO_L(AT|NG)""").containsMatchIn(panel))
    }

    /** The ladder's SMS, queue and replay carry the position, not raw numbers. */
    @Test
    fun `the ladder's SMS, queue and replay go through SosPosition`() {
        val src = source("Emergency.kt")
        assertTrue(src.contains("SosPosition.smsBody(pos)"))
        assertTrue(src.contains("SosPosition.queueEntry(pos"))
        assertTrue(src.contains("SosPosition.apiBody(SosPosition.ofQueueEntry("))
        assertFalse("raise takes raw coordinates again", Regex("""fun raise\([^)]*lat: Double""").containsMatchIn(src))
        assertFalse("queue takes raw coordinates again", Regex("""fun queue\([^)]*lat: Double""").containsMatchIn(src))
    }
}
