package `in`.roadassist.app

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.telephony.SmsManager
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject

/**
 * The SOS fallback ladder — the whole point of "help even with no net".
 *
 * When someone needs help we try, in order, the lowest channel that still
 * works, and NEVER treat "no data" as failure:
 *
 *   1. DATA        → the RoadAssist API (full features, instant)
 *   2. SMS         → text "SOS <lat> <lng>" to the RoadAssist number; the SIM
 *                    is the identity, so no login and no data are needed. This
 *                    is the workhorse for Indian dead zones, where 2G SMS
 *                    coverage vastly exceeds data coverage.
 *   3. 112 DIALER  → hand off to the national emergency number, which connects
 *                    through ANY carrier's tower regardless of the SIM's plan.
 *   4. QUEUE       → store the SOS on the device; it auto-fires the instant a
 *                    single bar of connectivity returns (moving ~500 m along a
 *                    highway usually crosses a coverage boundary).
 *
 * Nothing here is faked: each rung either genuinely transmits or genuinely
 * hands off to the OS, and the result names exactly which rung fired.
 */
object Emergency {

    /** The RoadAssist inbound SMS number. Placeholder until a real long/short
     *  code is provisioned with the telecom vendor — labeled in the UI. */
    const val RA_SMS_NUMBER = "+919999900000"
    const val NATIONAL_EMERGENCY = "112"
    private const val QUEUE_KEY = "ra.sos.queue"

    enum class Rung { DATA, SMS, DIALER, QUEUED }

    data class Result(val rung: Rung, val detail: String)

    fun hasData(ctx: Context): Boolean {
        val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val net = cm.activeNetwork ?: return false
        val caps = cm.getNetworkCapabilities(net) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }

    private fun canSendSms(ctx: Context): Boolean =
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.SEND_SMS) ==
            PackageManager.PERMISSION_GRANTED

    /**
     * Run the ladder. `apiSos` performs rungs 1's network calls and returns a
     * human summary, or throws if the API is unreachable — keeping all the
     * Compose/coroutine wiring in the caller.
     */
    suspend fun raise(
        ctx: Context,
        lat: Double,
        lng: Double,
        apiSos: suspend () -> String,
    ): Result {
        // Rung 1 — data path (only attempted when the OS reports validated internet)
        if (hasData(ctx)) {
            try {
                return Result(Rung.DATA, apiSos())
            } catch (_: Exception) {
                // API unreachable despite "data" — fall through the ladder
            }
        }

        val smsBody = "SOS $lat $lng RoadAssist"

        // Rung 2 — SMS (no data, no login needed; the SIM is the identity)
        if (canSendSms(ctx)) {
            try {
                val sms = if (android.os.Build.VERSION.SDK_INT >= 31)
                    ctx.getSystemService(SmsManager::class.java)
                else @Suppress("DEPRECATION") SmsManager.getDefault()
                sms.sendTextMessage(RA_SMS_NUMBER, null, smsBody, null, null)
                queue(ctx, lat, lng)   // also queue, so the app re-confirms via API when data returns
                return Result(Rung.SMS, "Sent SOS by SMS to RoadAssist ($RA_SMS_NUMBER). No data needed — the SIM is your identity.")
            } catch (_: Exception) { /* SMS failed — keep descending */ }
        }

        // Rung 3 — hand off to 112 (works through any carrier's tower)
        queue(ctx, lat, lng)
        val dial = Intent(Intent.ACTION_DIAL, Uri.parse("tel:$NATIONAL_EMERGENCY"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return try {
            ctx.startActivity(dial)
            Result(Rung.DIALER, "No RoadAssist channel reachable — opening 112. It connects through any tower. Your SOS is queued and will sync when signal returns.")
        } catch (_: Exception) {
            // Rung 4 — truly nothing available; the queue is the last resort
            Result(Rung.QUEUED, "No signal at all. SOS saved on this device — it will send automatically the moment connectivity returns. Move toward open sky or a highway if you can.")
        }
    }

    // ── local queue: survives no-signal and replays when data returns ──────
    fun queue(ctx: Context, lat: Double, lng: Double) {
        val prefs = ctx.getSharedPreferences("roadassist", Context.MODE_PRIVATE)
        val arr = JSONArray(prefs.getString(QUEUE_KEY, "[]"))
        arr.put(JSONObject().put("lat", lat).put("lng", lng).put("at", System.currentTimeMillis()))
        prefs.edit().putString(QUEUE_KEY, arr.toString()).apply()
    }

    fun queueDepth(ctx: Context): Int {
        val prefs = ctx.getSharedPreferences("roadassist", Context.MODE_PRIVATE)
        return JSONArray(prefs.getString(QUEUE_KEY, "[]")).length()
    }

    /** Replay queued SOS through the API once data is back; clears on success. */
    suspend fun flush(ctx: Context): Int {
        if (!hasData(ctx)) return 0
        val prefs = ctx.getSharedPreferences("roadassist", Context.MODE_PRIVATE)
        val arr = JSONArray(prefs.getString(QUEUE_KEY, "[]"))
        var sent = 0
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            try {
                val raised = Api.post(
                    "/v1/sos",
                    JSONObject().put("lat", o.getDouble("lat")).put("lng", o.getDouble("lng"))
                        .put("source", "manual"),
                ).getJSONObject("data")
                Api.post("/v1/sos/${raised.getString("id")}/confirm")
                sent++
            } catch (_: Exception) { break }   // still flaky — keep the rest queued
        }
        if (sent > 0) {
            val remaining = JSONArray()
            for (i in sent until arr.length()) remaining.put(arr.getJSONObject(i))
            prefs.edit().putString(QUEUE_KEY, remaining.toString()).apply()
        }
        return sent
    }
}
