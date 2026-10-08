package `in`.roadassist.app

import android.content.Context
import androidx.core.content.edit
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

/**
 * The offline hazard-report queue's storage and replay ([HazardQueue] is the
 * pure part).
 *
 * A report made with no connection used to be refused ("Not sent… not
 * saved"). Now it is saved here, photo re-encoded small, and posted by the
 * app-wide replay ([SosReplay]) once there is a network and a session.
 *
 * Its own preferences file, not the "roadassist" file the SOS queue lives in:
 * SharedPreferences loads and rewrites a whole file at a time, and a queued
 * photo is tens of kilobytes, so sharing it would make every SOS queue write
 * pay for the hazard photos. Its own lock and its own trigger, for the same
 * reason: nothing on this path can hold up an SOS.
 */
object Hazards {
    private const val PREFS = "roadassist.hazards"
    private const val QUEUE_KEY = "ra.hazard.queue"
    /** Reports the server refused for good (a 4xx). Never replayed; photos stripped. */
    private const val DEAD_KEY = "ra.hazard.dead"

    /** Guards the read-modify-write of [QUEUE_KEY]. Never held across I/O. */
    private val lock = Any()

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun depth(ctx: Context): Int = synchronized(lock) {
        JSONArray(prefs(ctx).getString(QUEUE_KEY, "[]")).length()
    }

    /** Save [body] to send later. False when the queue is full (nothing saved). */
    fun queue(ctx: Context, body: JSONObject, owner: String? = Api.userId): Boolean {
        val entry = HazardQueue.entry(body, UUID.randomUUID().toString(), System.currentTimeMillis(), owner)
        synchronized(lock) {
            val p = prefs(ctx)
            val current = JSONArray(p.getString(QUEUE_KEY, "[]"))
            if (!HazardQueue.canQueue(current.length())) return false
            p.edit(commit = true) { putString(QUEUE_KEY, SosQueue.append(current, entry).toString()) }
        }
        return true
    }

    /** Post queued reports this session may send; returns how many were delivered. */
    suspend fun flush(ctx: Context): Int {
        if (!Emergency.hasData(ctx) || !Api.hasSession()) return 0
        val snapshot = synchronized(lock) { JSONArray(prefs(ctx).getString(QUEUE_KEY, "[]")) }
        if (snapshot.length() == 0) return 0
        val replay = HazardQueue.replay(
            snapshot, Api.userId,
            statusOf = { e -> (e as? ApiException)?.status },
        ) { body -> Api.post("/v1/raksha/report", body) }
        if (replay.done.isNotEmpty()) {
            synchronized(lock) {
                val p = prefs(ctx)
                // Re-read: a report saved while the posts were in flight stays.
                val current = JSONArray(p.getString(QUEUE_KEY, "[]"))
                p.edit {
                    putString(QUEUE_KEY, SosQueue.remaining(current, replay.done).toString())
                    if (replay.dropped.isNotEmpty()) {
                        val dead = JSONArray(p.getString(DEAD_KEY, "[]"))
                        putString(DEAD_KEY, HazardQueue.withDead(dead, replay.dropped).toString())
                    }
                }
            }
        }
        return replay.sent.size
    }
}
