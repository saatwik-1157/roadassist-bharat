package `in`.roadassist.app

import org.json.JSONArray
import org.json.JSONObject

/**
 * The queued-SOS ALGEBRA, separated from the SharedPreferences plumbing.
 *
 * Same reasoning as [SosLadder]: `Emergency.queue` and `Emergency.flush` need a
 * Context and a live network, so none of it ran on a JVM — and the part that
 * decides which emergencies survive a flush is pure. It lives here so it can be
 * pinned by a test, and `Emergency` calls it rather than restating it.
 *
 * ── the bug this exists to prevent ────────────────────────────────────────
 * `flush` used to rebuild the queue from the snapshot it started with:
 *
 *     for (i in sent until arr.length()) remaining.put(arr.getJSONObject(i))
 *     prefs.edit().putString(QUEUE_KEY, remaining.toString()).apply()
 *
 * `arr` was read before several seconds of HTTP. An SOS queued during that
 * window — the user tapping SOS on the very screen whose LaunchedEffect starts
 * the flush — was not in `arr`, so the write erased it. A brand-new emergency,
 * silently deleted, with the UI reporting a successful sync.
 *
 * So removal is by IDENTITY against the CURRENT queue, never by index against a
 * stale snapshot.
 */
object SosQueue {

    /**
     * A stable identity for one queued SOS.
     *
     * The client reference is the real key — it is already the server's
     * idempotency key for the replay. Entries written by a build that predates
     * it fall back to their coordinates and timestamp, which is unique enough
     * to remove the right row and, if two were somehow identical, they are
     * interchangeable anyway.
     */
    fun keyOf(entry: JSONObject): String {
        val ref = entry.optString("ref", "")
        if (ref.isNotEmpty()) return ref
        return "legacy:" + entry.optLong("at", 0L) +
            ":" + entry.optDouble("lat", 0.0) +
            ":" + entry.optDouble("lng", 0.0)
    }

    /** The queue with one more SOS on the end. */
    fun append(current: JSONArray, entry: JSONObject): JSONArray {
        val next = JSONArray()
        for (i in 0 until current.length()) next.put(current.getJSONObject(i))
        next.put(entry)
        return next
    }

    /**
     * What stays queued after a flush.
     *
     * `current` must be re-read at write time, not carried from the start of
     * the flush — that is the whole point. Anything whose key the flush did not
     * confirm sent survives, including entries that did not exist when the
     * flush began.
     */
    fun remaining(current: JSONArray, sentKeys: Set<String>): JSONArray {
        val next = JSONArray()
        for (i in 0 until current.length()) {
            val entry = current.getJSONObject(i)
            if (keyOf(entry) in sentKeys) continue
            next.put(entry)
        }
        return next
    }
}
