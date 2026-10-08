package `in`.roadassist.app

import java.io.File
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A hazard report made offline is saved and replayed, not refused.
 *
 * It used to be "Not sent… not saved": the dialog caught the failed post and
 * told the person to try again later. Now no answer (or a 5xx, 401, 408, 429)
 * saves the exact body to a queue of its own that the app-wide replay posts,
 * under the SOS queue's rules; only a 4xx refusal stays in the dialog.
 *
 * Not proved here (it needs a Context): that Hazards keeps its own
 * preferences file and lock, and that SosReplay gives it its own trigger.
 * Those are read in Hazards.kt and SosReplay.kt.
 */
class HazardQueueTest {

    private val statusOf: (Exception) -> Int? = { e -> (e as? ApiException)?.status }

    private fun body(note: String, photo: String? = "QUJDRA==") = HazardReport.payload(
        "pothole", 4, 28.61, 77.21, note, photo, confidence = 0.81, modelVersion = "RAKSHA-YOLO11n",
    )

    private fun queueOf(vararg e: JSONObject) = JSONArray().also { a -> e.forEach { a.put(it) } }

    @Test fun `no answer, a 5xx and a lost session save the report instead of refusing it`() {
        for (s in listOf(null, 0, 500, 502, 503, 401, 408, 429)) {
            assertEquals("status $s", HazardQueue.Live.QUEUE, HazardQueue.afterLiveFailure(s))
        }
    }

    @Test fun `a 4xx is the server refusing this report, so it stays in the dialog`() {
        for (s in listOf(400, 403, 404, 409, 413, 422)) {
            assertEquals("status $s", HazardQueue.Live.REFUSED, HazardQueue.afterLiveFailure(s))
        }
    }

    @Test fun `a queued entry keeps the whole body, photo, confidence and model version included`() {
        val e = HazardQueue.entry(body("deep"), "ref-1", 42L, "u-1")
        val back = HazardQueue.bodyOf(JSONObject(e.toString()))
        assertEquals("ref-1", SosQueue.keyOf(e))
        assertEquals("u-1", e.getString("owner"))
        assertEquals("QUJDRA==", back.getString("photoBase64"))
        assertEquals(0.81, back.getDouble("confidence"), 0.0)
        assertEquals("RAKSHA-YOLO11n", back.getString("modelVersion"))
        assertEquals(28.61, back.getDouble("lat"), 0.0)
        assertEquals("deep", back.getString("note"))
    }

    @Test fun `the replay posts stored bodies, drops a 4xx, keeps the rest after a 5xx`() = kotlinx.coroutines.runBlocking {
        val q = queueOf(
            HazardQueue.entry(body("a"), "r-a", 1, "u-1"),
            HazardQueue.entry(body("b"), "r-b", 2, "u-1"),
            HazardQueue.entry(body("c"), "r-c", 3, "u-1"),
            HazardQueue.entry(body("d"), "r-d", 4, "u-1"),
        )
        val answers = mapOf("a" to 201, "b" to 422, "c" to 503)
        val posted = ArrayList<String>()
        val r = HazardQueue.replay(q, "u-1", statusOf) { b ->
            posted.add(b.getString("note"))
            val s = answers[b.getString("note")] ?: 201
            if (s !in 200..299) throw ApiException("no", status = s)
        }
        assertEquals(listOf("a", "b", "c"), posted)
        assertEquals(setOf("r-a"), r.sent)
        assertEquals(listOf("r-b"), r.dropped.map { SosQueue.keyOf(it) })
        val left = SosQueue.remaining(q, r.done)
        assertEquals(listOf("r-c", "r-d"), (0 until left.length()).map { SosQueue.keyOf(left.getJSONObject(it)) })
    }

    @Test fun `an IO error stops the replay and keeps every report`() = kotlinx.coroutines.runBlocking {
        val q = queueOf(HazardQueue.entry(body("a"), "r-a", 1, null), HazardQueue.entry(body("b"), "r-b", 2, null))
        val r = HazardQueue.replay(q, "u-1", statusOf) { throw java.io.IOException("offline") }
        assertTrue(r.done.isEmpty())
    }

    @Test fun `another account's reports wait for that account`() = kotlinx.coroutines.runBlocking {
        val q = queueOf(HazardQueue.entry(body("mine"), "r-1", 1, "u-1"), HazardQueue.entry(body("theirs"), "r-2", 2, "u-2"))
        val posted = ArrayList<String>()
        HazardQueue.replay(q, "u-1", statusOf) { posted.add(it.getString("note")) }
        assertEquals(listOf("mine"), posted)
    }

    @Test fun `the queue is capped and refused reports keep no photo`() {
        assertTrue(HazardQueue.canQueue(HazardQueue.MAX_ENTRIES - 1))
        assertFalse(HazardQueue.canQueue(HazardQueue.MAX_ENTRIES))
        val dead = HazardQueue.withDead(JSONArray(), List(25) { HazardQueue.entry(body("n$it"), "r$it", it.toLong(), null) })
        assertEquals(20, dead.length())
        val last = HazardQueue.bodyOf(dead.getJSONObject(19))
        assertEquals("n24", last.getString("note"))
        assertFalse(last.has("photoBase64"))
        assertTrue(last.getBoolean("photoDropped"))
    }

    @Test fun `the queued photo budget is well under the live cap`() {
        assertTrue(HazardQueue.PHOTO_MAX_BYTES <= 150 * 1024)
        assertTrue(HazardQueue.PHOTO_LADDER.all { (side, q) -> side <= 1280 && q in 1..100 })
    }

    // ── the words, in all eight languages ──────────────────────────────────

    private val res = File("src/main/res")
    private val locales = listOf("values", "values-hi", "values-ta", "values-te", "values-bn",
        "values-mr", "values-kn", "values-gu")

    private fun xml(dir: String) = File(res, "$dir/strings.xml").readText()

    private fun string(dir: String, key: String): String? =
        Regex("<string name=\"$key\"[^>]*>(.*?)</string>", RegexOption.DOT_MATCHES_ALL)
            .find(xml(dir))?.groupValues?.get(1)

    @Test fun `the saved and sent messages exist in every language`() {
        for (dir in locales) {
            assertTrue("$dir has no report_saved_offline", !string(dir, "report_saved_offline").isNullOrBlank())
            assertTrue("$dir has no toast_hazard_synced", "<plurals name=\"toast_hazard_synced\">" in xml(dir))
        }
        assertEquals("Saved on this phone — sends automatically when you are back online",
            string("values", "report_saved_offline"))
    }

    @Test fun `nothing still says a hazard report is not saved`() {
        for (k in listOf("scan_offline_note", "report_not_sent_offline")) {
            val en = string("values", k)!!
            assertFalse("$k: $en", "not saved" in en)
        }
        assertTrue("saved on this phone" in string("values", "scan_offline_note")!!)
    }

    @Test fun `the hazard dialog builds its body with HazardReport and queues on failure`() {
        val src = File("src/main/java/in/roadassist/app/MainActivity.kt").readText()
        assertFalse("an inline report body is back", Regex("raksha/report\",\\s*JSONObject\\(").containsMatchIn(src))
        assertTrue(src.contains("HazardReport.payload("))
        assertTrue(src.contains("Hazards.queue("))
        assertTrue(src.contains("R.string.report_saved_offline"))
        assertTrue(src.contains("R.plurals.toast_hazard_synced"))
    }
}
