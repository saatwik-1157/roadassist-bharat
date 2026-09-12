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
}
