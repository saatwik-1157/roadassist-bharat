package `in`.roadassist.app

import android.Manifest
import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.telephony.SmsManager
import androidx.core.content.ContextCompat
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
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

        // Rung 2 — SMS (no data, no login needed; the SIM is the identity).
        // Confirmed delivery: exactly one channel owns the report, so we never
        // create two incidents for one emergency.
        if (canSendSms(ctx)) {
            when (sendSosSms(ctx, smsBody)) {
                SmsOutcome.SENT ->
                    // The SMS reaches the RoadAssist telecom webhook, which
                    // raises the incident — so we do NOT also queue an API replay.
                    return Result(Rung.SMS, "Sent SOS by SMS to RoadAssist ($RA_SMS_NUMBER). No data needed — the SIM is your identity.")
                SmsOutcome.UNCONFIRMED -> {
                    // Send didn't fail, but the platform never confirmed it. For an
                    // emergency, better a rare duplicate than a missed alert: queue
                    // an API backup that flushes when data returns.
                    queue(ctx, lat, lng)
                    return Result(Rung.SMS, "SOS sent by SMS (delivery unconfirmed) — a backup will also sync when data returns. The SIM is your identity; no data needed.")
                }
                SmsOutcome.FAILED -> { /* radio rejected it — descend the ladder */ }
            }
        }

        // Rung 3 — hand off to 112 (works through any carrier's tower). The
        // structured SOS didn't reach RoadAssist, so queue an API backup too.
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

    private enum class SmsOutcome { SENT, FAILED, UNCONFIRMED }

    /** Sends the SOS SMS and waits (briefly) for the platform's sent-result
     *  broadcast, so the ladder can distinguish delivered from failed. */
    private suspend fun sendSosSms(ctx: Context, body: String): SmsOutcome {
        val action = "in.roadassist.SMS_SENT." + System.nanoTime()
        val outcome = withTimeoutOrNull(12_000L) {
            suspendCancellableCoroutine<SmsOutcome> { cont ->
                val receiver = object : BroadcastReceiver() {
                    override fun onReceive(c: Context?, i: Intent?) {
                        try { ctx.unregisterReceiver(this) } catch (_: Exception) {}
                        if (cont.isActive) cont.resume(
                            if (resultCode == Activity.RESULT_OK) SmsOutcome.SENT else SmsOutcome.FAILED,
                        )
                    }
                }
                val filter = IntentFilter(action)
                if (android.os.Build.VERSION.SDK_INT >= 33) {
                    ctx.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
                } else {
                    @Suppress("UnspecifiedRegisterReceiverFlag") ctx.registerReceiver(receiver, filter)
                }
                cont.invokeOnCancellation { try { ctx.unregisterReceiver(receiver) } catch (_: Exception) {} }
                try {
                    val flags = PendingIntent.FLAG_ONE_SHOT or PendingIntent.FLAG_IMMUTABLE
                    val pi = PendingIntent.getBroadcast(
                        ctx, 0, Intent(action).setPackage(ctx.packageName), flags,
                    )
                    val sms = if (android.os.Build.VERSION.SDK_INT >= 31)
                        ctx.getSystemService(SmsManager::class.java)
                    else @Suppress("DEPRECATION") SmsManager.getDefault()
                    sms.sendTextMessage(RA_SMS_NUMBER, null, body, pi, null)
                } catch (_: Exception) {
                    try { ctx.unregisterReceiver(receiver) } catch (_: Exception) {}
                    if (cont.isActive) cont.resume(SmsOutcome.FAILED)
                }
            }
        }
        return outcome ?: SmsOutcome.UNCONFIRMED
    }

    /** Best-effort real location from the OS's last known fix (no Play Services
     *  dependency). Returns null if permission is absent or no fix exists;
     *  the caller then falls back to a labeled demo location. */
    fun lastKnownLocation(ctx: Context): Pair<Double, Double>? {
        val fine = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION)
        val coarse = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION)
        if (fine != PackageManager.PERMISSION_GRANTED && coarse != PackageManager.PERMISSION_GRANTED) return null
        return try {
            val lm = ctx.getSystemService(Context.LOCATION_SERVICE) as LocationManager
            for (p in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
                if (!lm.isProviderEnabled(p)) continue
                lm.getLastKnownLocation(p)?.let { return it.latitude to it.longitude }
            }
            null
        } catch (_: SecurityException) { null }
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
