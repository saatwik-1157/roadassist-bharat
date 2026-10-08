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

    // ── replay: whose entries, and what a failure means ───────────────────

    /** Tag an entry with the account it was raised under (null: signed out). */
    fun withOwner(entry: JSONObject, owner: String?): JSONObject =
        if (owner.isNullOrBlank()) entry else entry.put("owner", owner)

    /**
     * May the account signed in now replay this entry?
     *
     * An entry raised under an account replays only under that account: the
     * queue belongs to the phone, and replaying somebody else's SOS under the
     * next person to sign in would put their emergency on the wrong record.
     * An entry with no owner (raised from the sign-in screen, or by a build
     * that predates the tag) is this phone's emergency with no account behind
     * it, and the next session claims it rather than leaving it unsent.
     */
    fun isMine(entry: JSONObject, userId: String?): Boolean {
        val owner = entry.optString("owner", "")
        return owner.isEmpty() || owner == userId
    }

    enum class Next {
        /** Delivered. Remove it. */
        SENT,

        /** The server refused it for good. Drop it (to the dead-letter list) and go on. */
        DROP,

        /** The link or the server is struggling. Keep this and everything after it for the next try. */
        STOP,
    }

    /**
     * What a failed replay means.
     *
     * One rejected entry used to `break` the loop, so a single SOS the server
     * would never take (a 409 invalid_state on a confirm, a 409
     * reference_taken, a 400, a 403) sat at the head of the queue for ever and
     * every SOS behind it never sent. A 4xx is the server saying no to THIS
     * entry, and asking again gets the same answer, so it is dropped and the
     * loop goes on. Only the failures that say nothing about the entry stop
     * the replay: no answer at all, a 5xx, 401 (no usable session: kept for
     * the next sign-in), 408 and 429.
     */
    fun afterFailure(status: Int?): Next = when {
        status == null || status == 0 -> Next.STOP
        status == 401 || status == 408 || status == 425 || status == 429 -> Next.STOP
        status in 400..499 -> Next.DROP
        else -> Next.STOP
    }

    data class Replay(val sent: Set<String>, val dropped: List<JSONObject>) {
        val done: Set<String> get() = sent + dropped.map { keyOf(it) }
    }

    /**
     * Replay [snapshot]'s entries that [userId] may send, in order. [send]
     * posts one entry and throws on failure; [statusOf] reads the HTTP status
     * from what it threw (null when there was no answer). Pure given [send],
     * so every branch is pinned by SosQueueTest.
     */
    suspend fun replay(
        snapshot: JSONArray,
        userId: String?,
        statusOf: (Exception) -> Int?,
        send: suspend (JSONObject) -> Unit,
    ): Replay {
        val sent = LinkedHashSet<String>()
        val dropped = ArrayList<JSONObject>()
        for (i in 0 until snapshot.length()) {
            val entry = snapshot.getJSONObject(i)
            if (!isMine(entry, userId)) continue
            val next = try {
                send(entry); Next.SENT
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                afterFailure(statusOf(e))
            }
            when (next) {
                Next.SENT -> sent.add(keyOf(entry))
                Next.DROP -> dropped.add(entry)
                Next.STOP -> break
            }
        }
        return Replay(sent, dropped)
    }
}
