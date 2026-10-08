package `in`.roadassist.app

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The queue must not lose an emergency raised while a flush is in the air.
 *
 * `Emergency.flush` reads the queue, spends several seconds on HTTP, then
 * writes back what should remain. It used to compute that from the snapshot it
 * started with and overwrite the whole key:
 *
 *     for (i in sent until arr.length()) remaining.put(arr.getJSONObject(i))
 *
 * An SOS queued during those seconds was not in `arr`, so the write erased it.
 * That window is not theoretical: the SOS screen's LaunchedEffect starts the
 * flush, and the SOS button that queues a new one is on the same screen.
 *
 * ── what this file does NOT prove ─────────────────────────────────────────
 * The fix has two halves. This pins the first: removal by identity against
 * whatever the queue holds now. The second — that `flush` RE-READS the queue
 * under the lock instead of writing back the snapshot it started with — is a
 * choice of argument, and no test of a pure function can catch a caller
 * passing the wrong one. It needs a Context, so it is verified by reading
 * `Emergency.flush`, not by running it. Said plainly rather than implied by a
 * green suite.
 */
class SosQueueTest {

    private fun entry(ref: String, lat: Double = 28.4, lng: Double = 77.0, at: Long = 1L) =
        JSONObject().put("ref", ref).put("lat", lat).put("lng", lng).put("at", at)

    private fun queueOf(vararg entries: JSONObject) =
        JSONArray().also { a -> entries.forEach { a.put(it) } }

    private fun refs(a: JSONArray) =
        (0 until a.length()).map { a.getJSONObject(it).optString("ref") }

    @Test
    fun `an SOS queued during a flush survives it`() {
        // The flush started with one entry and sent it.
        val snapshot = queueOf(entry("RA-AAAAAA"))
        val sent = setOf(SosQueue.keyOf(snapshot.getJSONObject(0)))

        // While the posts were in the air the user tapped SOS again.
        val current = SosQueue.append(snapshot, entry("RA-BBBBBB", at = 2L))

        val remaining = SosQueue.remaining(current, sent)

        assertEquals(
            "the newly raised emergency was erased by the flush",
            listOf("RA-BBBBBB"), refs(remaining),
        )
    }

    @Test
    fun `only the entries actually sent are removed`() {
        // The flush breaks on the first failure, so later entries stay.
        val q = queueOf(entry("RA-AAAAAA"), entry("RA-BBBBBB", at = 2L), entry("RA-CCCCCC", at = 3L))
        val sent = setOf("RA-AAAAAA")

        assertEquals(listOf("RA-BBBBBB", "RA-CCCCCC"), refs(SosQueue.remaining(q, sent)))
    }

    @Test
    fun `removal is by identity, not position`() {
        // THE DISCRIMINATING CASE, and the reason this test reads oddly.
        //
        // An unsent entry sits BEFORE a sent one. Dropping "the first N" — the
        // shape the old code used — keeps the wrong emergency here and throws
        // away the one that never went anywhere. Every other case in this file
        // happens to put the sent entries at the front, where dropping a prefix
        // gives the right answer by luck, so without this one the whole file
        // passes against the broken implementation.
        val q = queueOf(entry("RA-AAAAAA"), entry("RA-BBBBBB", at = 2L), entry("RA-CCCCCC", at = 3L))
        val sent = setOf("RA-BBBBBB")

        assertEquals(
            "an unsent emergency ahead of a sent one was discarded",
            listOf("RA-AAAAAA", "RA-CCCCCC"), refs(SosQueue.remaining(q, sent)),
        )
    }

    @Test
    fun `nothing sent means nothing removed`() {
        val q = queueOf(entry("RA-AAAAAA"), entry("RA-BBBBBB", at = 2L))
        assertEquals(listOf("RA-AAAAAA", "RA-BBBBBB"), refs(SosQueue.remaining(q, emptySet())))
    }

    @Test
    fun `an entry from a build with no reference still has a stable key`() {
        // Written before clientIncidentId existed. It must still be removable,
        // and must not collide with a different queued emergency.
        val legacy = JSONObject().put("lat", 28.4).put("lng", 77.0).put("at", 1700000000000L)
        val other = JSONObject().put("lat", 12.9).put("lng", 77.6).put("at", 1700000000001L)

        val key = SosQueue.keyOf(legacy)
        assertTrue("a legacy key must not look like a reference", !key.startsWith("RA-"))
        assertTrue(SosQueue.keyOf(legacy) != SosQueue.keyOf(other))
        assertEquals("the key must be stable across reads", key, SosQueue.keyOf(legacy))

        val remaining = SosQueue.remaining(queueOf(legacy, other), setOf(key))
        assertEquals(1, remaining.length())
        assertEquals(77.6, remaining.getJSONObject(0).getDouble("lng"), 0.0001)
    }

    @Test
    fun `append does not mutate the queue it was given`() {
        val original = queueOf(entry("RA-AAAAAA"))
        SosQueue.append(original, entry("RA-BBBBBB", at = 2L))
        assertEquals("append mutated its input", 1, original.length())
    }

    // ── replay: one refused entry must not block the rest (fix 5) ──────────

    /** A send that answers each ref with a status: 0 is no answer at all, 2xx is delivered. */
    private fun sender(answers: Map<String, Int>, posted: MutableList<String>): suspend (JSONObject) -> Unit = { o ->
        val ref = o.getString("ref")
        posted.add(ref)
        val status = answers[ref] ?: 201
        if (status == 0) throw java.io.IOException("no route")
        if (status !in 200..299) throw ApiException("refused", status = status)
    }

    private val statusOf: (Exception) -> Int? = { e -> (e as? ApiException)?.status }

    @Test
    fun `a refused entry is dropped and the ones behind it still send`() = kotlinx.coroutines.runBlocking {
        // A 409 invalid_state at the head used to `break` the loop for ever.
        val posted = mutableListOf<String>()
        val r = SosQueue.replay(
            queueOf(entry("RA-AAAAAA"), entry("RA-BBBBBB"), entry("RA-CCCCCC")), "u-1", statusOf,
            sender(mapOf("RA-AAAAAA" to 409), posted),
        )
        assertEquals(listOf("RA-AAAAAA", "RA-BBBBBB", "RA-CCCCCC"), posted)
        assertEquals(setOf("RA-BBBBBB", "RA-CCCCCC"), r.sent)
        assertEquals(listOf("RA-AAAAAA"), r.dropped.map { it.getString("ref") })
        assertEquals("a dropped entry must leave the queue", 0,
            SosQueue.remaining(queueOf(entry("RA-AAAAAA"), entry("RA-BBBBBB"), entry("RA-CCCCCC")), r.done).length())
    }

    @Test
    fun `400 and 403 are terminal too`() {
        for (status in listOf(400, 403, 404, 409, 422)) {
            assertEquals("$status", SosQueue.Next.DROP, SosQueue.afterFailure(status))
        }
    }

    @Test
    fun `no answer, a 5xx, 401 and 429 stop the replay and keep everything`() = kotlinx.coroutines.runBlocking {
        for (status in listOf(0, 500, 503, 401, 429)) {
            val posted = mutableListOf<String>()
            val r = SosQueue.replay(
                queueOf(entry("RA-AAAAAA"), entry("RA-BBBBBB")), "u-1", statusOf,
                sender(mapOf("RA-AAAAAA" to status), posted),
            )
            assertEquals("$status kept going", listOf("RA-AAAAAA"), posted)
            assertTrue("$status lost an entry", r.done.isEmpty())
        }
    }

    @Test
    fun `only the signed-in account replays its own entries`() = kotlinx.coroutines.runBlocking {
        val mine = SosQueue.withOwner(entry("RA-AAAAAA"), "u-1")
        val theirs = SosQueue.withOwner(entry("RA-BBBBBB"), "u-2")
        val unowned = SosQueue.withOwner(entry("RA-CCCCCC"), null)   // raised signed out
        val posted = mutableListOf<String>()
        val r = SosQueue.replay(queueOf(mine, theirs, unowned), "u-1", statusOf, sender(emptyMap(), posted))
        assertEquals(listOf("RA-AAAAAA", "RA-CCCCCC"), posted)
        assertEquals(setOf("RA-AAAAAA", "RA-CCCCCC"), r.sent)
        assertEquals("another account's SOS must stay queued", 1,
            SosQueue.remaining(queueOf(mine, theirs, unowned), r.done).length())
    }

    @Test
    fun `an entry raised signed in carries its owner`() {
        val e = SosQueue.withOwner(SosPosition.queueEntry(SosPosition.Unknown, "RA-AAAAAA", 1L), "u-1")
        assertEquals("u-1", e.getString("owner"))
        assertTrue(SosQueue.isMine(e, "u-1"))
        assertTrue(!SosQueue.isMine(e, "u-2"))
        assertTrue(!SosQueue.isMine(e, null))
    }
}
