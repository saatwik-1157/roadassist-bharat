package `in`.roadassist.app

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Trip Guardian on the device — "prepare before signal dies".
 *
 * While online it pulls the route plan from GET /v1/trip/prepare (per-segment
 * dead-zone risk + live weather + an offline-map tile manifest), caches the
 * plan to local storage, and downloads every tile into the app's files dir.
 * Then the plan renders and the map mosaic draws entirely from the device —
 * proven to work with the network off.
 */
object TripGuardian {
    private const val KEY = "ra.trip"

    data class Summary(
        val weatherRisk: String?,
        val weatherFactors: String,
        val segments: List<Triple<String, String, Double?>>, // code, risk, offlineRatio
        val tilesCached: Int,
        val tilesTotal: Int,
        val preparedAt: Long,
    )

    fun cached(ctx: Context): JSONObject? =
        ctx.getSharedPreferences("roadassist", Context.MODE_PRIVATE)
            .getString(KEY, null)?.let { runCatching { JSONObject(it) }.getOrNull() }

    private fun tileDir(ctx: Context) = File(ctx.filesDir, "tiles").apply { mkdirs() }

    private fun tileFile(ctx: Context, relUrl: String): File =
        File(tileDir(ctx), relUrl.filter { it.isLetterOrDigit() } + ".png")

    /** Fetch the plan, cache it, and pull every tile onto the device. */
    suspend fun prepare(ctx: Context): Summary = withContext(Dispatchers.IO) {
        val data = Api.get("/v1/trip/prepare").getJSONObject("data")
        ctx.getSharedPreferences("roadassist", Context.MODE_PRIVATE)
            .edit().putString(KEY, data.toString()).apply()

        val tiles = data.optJSONArray("tiles")
        var cached = 0
        if (tiles != null) {
            for (i in 0 until tiles.length()) {
                val rel = tiles.getString(i)
                try {
                    val bytes = URL(Api.base.trimEnd('/') + rel).openStream().use { it.readBytes() }
                    tileFile(ctx, rel).writeBytes(bytes)
                    cached++
                } catch (_: Exception) { /* skip a tile, keep going */ }
            }
        }
        summarize(ctx, data, cached, tiles?.length() ?: 0)
    }

    /** Build a summary from a cached (or fresh) plan without any network. */
    fun summarize(ctx: Context, data: JSONObject, cached: Int, total: Int): Summary {
        val w = data.optJSONObject("weather")
        val factors = w?.optJSONArray("factors")?.let { arr ->
            (0 until arr.length()).joinToString(" · ") { arr.getString(it) }
        } ?: "Forecast unavailable offline"
        val segs = data.optJSONArray("segments")
        val segList = mutableListOf<Triple<String, String, Double?>>()
        if (segs != null) for (i in 0 until segs.length()) {
            val s = segs.getJSONObject(i)
            val ratio = if (s.isNull("offlineRatio")) null else s.getDouble("offlineRatio")
            segList.add(Triple(s.getString("code"), s.getString("coverageRisk"), ratio))
        }
        return Summary(
            weatherRisk = w?.optString("risk")?.takeIf { it.isNotBlank() },
            weatherFactors = factors,
            segments = segList,
            tilesCached = cached,
            tilesTotal = total,
            preparedAt = runCatching {
                java.time.Instant.parse(data.optString("preparedAt")).toEpochMilli()
            }.getOrDefault(System.currentTimeMillis()),
        )
    }

    fun cachedSummary(ctx: Context): Summary? {
        val data = cached(ctx) ?: return null
        val total = data.optJSONArray("tiles")?.length() ?: 0
        val onDisk = tileDir(ctx).listFiles()?.size ?: 0
        return summarize(ctx, data, onDisk, total)
    }

    /** A map preview built ONLY from tiles already on the device (works offline). */
    fun mosaic(ctx: Context): Bitmap? {
        val data = cached(ctx) ?: return null
        val tiles = data.optJSONArray("tiles") ?: return null
        val out = Bitmap.createBitmap(768, 512, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(out)
        var drawn = 0
        var i = 0
        while (i < tiles.length() && drawn < 6) {
            val f = tileFile(ctx, tiles.getString(i))
            i++
            if (!f.exists()) continue
            val bmp = BitmapFactory.decodeFile(f.absolutePath) ?: continue
            val col = drawn % 3; val row = drawn / 3
            canvas.drawBitmap(bmp, (col * 256).toFloat(), (row * 256).toFloat(), null)
            drawn++
        }
        return if (drawn > 0) out else null
    }
}
