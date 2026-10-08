package `in`.roadassist.app

import org.json.JSONArray
import org.json.JSONObject

/**
 * The body of POST /v1/raksha/report, built in one place.
 *
 * The dialog used to assemble it inline, so nothing pinned which fields a
 * report carries. A scan report now also carries the model's own `confidence`
 * (0..1) and a `modelVersion` (1-40 chars of [A-Za-z0-9._-]), both optional on
 * the server; a report made by hand carries neither, because no model made it.
 */
object HazardReport {

    /** The server's limit on `modelVersion`. */
    const val MODEL_VERSION_MAX = 40

    private val MODEL_VERSION_OK = Regex("^[A-Za-z0-9._-]{1,40}$")
    private val NOT_ALLOWED = Regex("[^A-Za-z0-9._-]+")

    /**
     * [raw] cut down to the server's charset and length, or null when nothing
     * usable is left. Runs of other characters become one "-", and leading or
     * trailing separators go: "RAKSHA YOLO11n (india-ft-gpu, 416)" becomes
     * "RAKSHA-YOLO11n-india-ft-gpu-416".
     */
    fun sanitizeModelVersion(raw: String?): String? {
        if (raw.isNullOrBlank()) return null
        val s = raw.trim().replace(NOT_ALLOWED, "-").trim('-', '.', '_')
            .take(MODEL_VERSION_MAX).trimEnd('-', '.', '_')
        return s.takeIf { MODEL_VERSION_OK.matches(it) }
    }

    /** The model version a scan report names: detector.json's modelName, else its sha. */
    fun modelVersion(config: DetectorConfig): String? =
        sanitizeModelVersion(config.modelName) ?: sanitizeModelVersion(config.modelSha256)

    /** A confidence the server takes (0..1, 4 decimals), or null for none or junk. */
    fun confidence(c: Double?): Double? {
        if (c == null || c.isNaN() || c.isInfinite()) return null
        return Math.round(c.coerceIn(0.0, 1.0) * 10_000) / 10_000.0
    }

    fun payload(
        type: String,
        severity: Int,
        lat: Double,
        lng: Double,
        note: String?,
        photoBase64: String?,
        /** The detection's confidence; null for a report made by hand. */
        confidence: Double? = null,
        /** The detector's version; null for a report made by hand. */
        modelVersion: String? = null,
    ): JSONObject {
        val o = JSONObject()
            .put("type", type)
            .put("severity", severity.coerceIn(RoadSeverity.MIN, RoadSeverity.MAX))
            .put("lat", lat).put("lng", lng)
        note?.trim()?.takeIf { it.isNotEmpty() }?.let { o.put("note", it.take(ScanReport.NOTE_MAX)) }
        photoBase64?.takeIf { it.isNotEmpty() }?.let { o.put("photoBase64", it); o.put("photoMime", "image/jpeg") }
        confidence(confidence)?.let { o.put("confidence", it) }
        sanitizeModelVersion(modelVersion)?.let { o.put("modelVersion", it) }
        return o
    }
}

/**
 * The offline hazard-report queue's ALGEBRA, separated from its storage
 * ([Hazards]) so a JVM test pins it.
 *
 * It deliberately reuses [SosQueue] for identity, ownership and what a failure
 * means (a 4xx is terminal and goes to the dead-letter list; no answer, a 5xx,
 * 401, 408, 425 and 429 keep it for the next try), but it is a separate queue
 * in a separate preferences file with its own lock and its own replay trigger
 * ([SosReplay]), so a stuck or slow hazard upload can never sit in front of an
 * SOS.
 */
object HazardQueue {

    /** At most this many unsent reports wait on the phone; past it, a report is refused, not queued. */
    const val MAX_ENTRIES = 20

    /** The byte budget for a queued photo (the live upload allows 600 KB). */
    const val PHOTO_MAX_BYTES = 120 * 1024

    /** The (longest side, JPEG quality) ladder a queued photo is re-encoded down. */
    val PHOTO_LADDER = listOf(960 to 60, 800 to 55, 640 to 50, 480 to 45)

    /** One queued report: the exact body to post, a stable key, when, and whose. */
    fun entry(body: JSONObject, ref: String, at: Long, owner: String?): JSONObject =
        SosQueue.withOwner(JSONObject().put("ref", ref).put("at", at).put("body", body), owner)

    fun bodyOf(entry: JSONObject): JSONObject = entry.getJSONObject("body")

    fun canQueue(depth: Int): Boolean = depth < MAX_ENTRIES

    /** What a failed LIVE submit means for the report in the dialog. */
    enum class Live {
        /** No answer, or a failure that says nothing about this report: save it to send later. */
        QUEUE,

        /** The server refused this report: show its reason and keep the dialog open. */
        REFUSED,
    }

    /** [status] is the HTTP status, or null/0 when there was no answer at all. */
    fun afterLiveFailure(status: Int?): Live =
        if (SosQueue.afterFailure(status) == SosQueue.Next.DROP) Live.REFUSED else Live.QUEUE

    /** Replay [snapshot] under [SosQueue]'s rules, posting each entry's stored body. */
    suspend fun replay(
        snapshot: JSONArray,
        userId: String?,
        statusOf: (Exception) -> Int?,
        send: suspend (JSONObject) -> Unit,
    ): SosQueue.Replay = SosQueue.replay(snapshot, userId, statusOf) { send(bodyOf(it)) }

    /** A refused entry as kept for support: everything but the photo, which only costs storage. */
    fun deadLetter(entry: JSONObject): JSONObject {
        val copy = JSONObject(entry.toString())
        copy.optJSONObject("body")?.let { b ->
            if (b.has("photoBase64")) {
                b.remove("photoBase64"); b.remove("photoMime"); b.put("photoDropped", true)
            }
        }
        return copy
    }

    /** The dead-letter list with [dropped] appended, keeping the most recent [keep]. */
    fun withDead(dead: JSONArray, dropped: List<JSONObject>, keep: Int = 20): JSONArray {
        var all = dead
        for (d in dropped) all = SosQueue.append(all, deadLetter(d))
        val out = JSONArray()
        for (i in maxOf(0, all.length() - keep) until all.length()) out.put(all.get(i))
        return out
    }
}
