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
import androidx.core.location.LocationManagerCompat
import androidx.core.os.CancellationSignal
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

    /** The ladder's vocabulary and its decisions live in [SosLadder], which is
     *  pure Kotlin and therefore testable without a device. */
    data class Result(val rung: SosLadder.Rung, val detail: String)

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
        // Rung 1 — data path (only attempted when the OS reports validated
        // internet). "Has internet" and "the API answered" are separate facts: a
        // captive portal — a highway dhaba's wifi — satisfies the first and not
        // the second, and stopping at rung 1 on that basis is a silent emergency.
        var apiSummary: String? = null
        if (hasData(ctx)) {
            apiSummary = try { apiSos() } catch (_: Exception) { null }
        }
        if (SosLadder.dataSettledIt(hasData = true, apiSucceeded = apiSummary != null)) {
            return Result(SosLadder.Rung.DATA, apiSummary!!)
        }

        // Rung 2 — SMS (no data, no login needed; the SIM is the identity).
        // Whether this rung settles the report, and whether a backup is also
        // queued, is SosLadder.afterSms — see the duplicate-versus-silence
        // argument there.
        if (SosLadder.shouldTrySms(dataSettledIt = false, hasSmsPermission = canSendSms(ctx))) {
            val verdict = SosLadder.afterSms(sendSosSms(ctx, SosLadder.smsBody(lat, lng)))
            if (verdict.queueBackup) queue(ctx, lat, lng)
            if (verdict.settles) {
                return Result(
                    SosLadder.Rung.SMS,
                    if (verdict.queueBackup) {
                        ctx.getString(R.string.sos_sms_unconfirmed)
                    } else {
                        ctx.getString(R.string.sos_sms_sent, RA_SMS_NUMBER)
                    },
                )
            }
            // FAILED — the radio rejected it, so this rung owns nothing. Descend.
        }

        // Rungs 3 and 4 — hand off to 112, which connects through any carrier's
        // tower. Reaching here means no RoadAssist channel carried the report, so
        // the local copy is the only record that exists: queue BEFORE the handoff,
        // because startActivity can throw and the queue is the last resort.
        queue(ctx, lat, lng)
        val dial = Intent(Intent.ACTION_DIAL, Uri.parse("tel:$NATIONAL_EMERGENCY"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val opened = try { ctx.startActivity(dial); true } catch (_: Exception) { false }
        return if (SosLadder.afterDialer(opened) == SosLadder.Rung.DIALER) {
            Result(SosLadder.Rung.DIALER, ctx.getString(R.string.sos_dialer))
        } else {
            Result(SosLadder.Rung.QUEUED, ctx.getString(R.string.sos_queued))
        }
    }


    /** Sends the SOS SMS and waits (briefly) for the platform's sent-result
     *  broadcast, so the ladder can distinguish delivered from failed. */
    private suspend fun sendSosSms(ctx: Context, body: String): SosLadder.SmsOutcome {
        val action = "in.roadassist.SMS_SENT." + System.nanoTime()
        val outcome = withTimeoutOrNull(12_000L) {
            suspendCancellableCoroutine<SosLadder.SmsOutcome> { cont ->
                val receiver = object : BroadcastReceiver() {
                    override fun onReceive(c: Context?, i: Intent?) {
                        try { ctx.unregisterReceiver(this) } catch (_: Exception) {}
                        if (cont.isActive) cont.resume(
                            if (resultCode == Activity.RESULT_OK) SosLadder.SmsOutcome.SENT else SosLadder.SmsOutcome.FAILED,
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
                    if (cont.isActive) cont.resume(SosLadder.SmsOutcome.FAILED)
                }
            }
        }
        return outcome ?: SosLadder.SmsOutcome.UNCONFIRMED
    }

    /**
     * A real fix, actively requested — the one the SOS should use.
     *
     * [lastKnownLocation] only reads a cache that some *other* app has to have
     * filled. Nothing in this app ever requested location updates, so on a
     * phone where no other app has recently used GPS that cache is empty, the
     * provider sits at `ProviderRequest[OFF]`, and every SOS quietly fell back
     * to the demo coordinates and reported "demo location". Honest, and useless
     * to a responder who needs to know where the person actually is.
     *
     * So: ask the OS for a fix and wait a bounded time for one. GPS first
     * because it is precise and needs no network — the property the whole
     * off-grid design rests on — then the network provider, then the cache,
     * then null. The caller's demo fallback stays exactly where it was; this
     * only makes it the last resort instead of the usual outcome.
     *
     * `LocationManagerCompat` rather than the raw API: `getCurrentLocation`
     * arrived in API 30 and this app supports 26, and the compat version also
     * gets the listener teardown right on every level.
     */
    suspend fun currentLocation(ctx: Context, timeoutMs: Long = 8_000): Pair<Double, Double>? {
        val fine = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION)
        val coarse = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION)
        if (fine != PackageManager.PERMISSION_GRANTED && coarse != PackageManager.PERMISSION_GRANTED) return null

        val lm = ctx.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
            .filter { runCatching { lm.isProviderEnabled(it) }.getOrDefault(false) }

        // Split the budget across the providers so a dead GPS cannot eat the
        // whole window and leave the network provider untried.
        val per = if (providers.isEmpty()) 0L else timeoutMs / providers.size
        for (provider in providers) {
            val fix = withTimeoutOrNull(per) {
                suspendCancellableCoroutine { cont ->
                    val signal = CancellationSignal()
                    cont.invokeOnCancellation { runCatching { signal.cancel() } }
                    try {
                        LocationManagerCompat.getCurrentLocation(
                            lm, provider, signal, ContextCompat.getMainExecutor(ctx),
                        ) { loc ->
                            if (cont.isActive) cont.resume(loc?.let { it.latitude to it.longitude })
                        }
                    } catch (_: SecurityException) {
                        if (cont.isActive) cont.resume(null)
                    }
                }
            }
            if (fix != null) return fix
        }
        return lastKnownLocation(ctx)
    }

    /** Best-effort real location from the OS's last known fix (no Play Services
     *  dependency). Returns null if permission is absent or no fix exists;
     *  the caller then falls back to a labeled demo location. Prefer
     *  [currentLocation], which asks for a fix instead of hoping one is cached. */
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
    /**
     * A queued SOS carries a client reference minted HERE, not at replay time.
     *
     * The reference is what makes the replay idempotent, so it has to be the
     * same on every attempt: minting it in [flush] would produce a fresh one
     * per try and defeat the whole point. See [SosLadder.newIncidentRef].
     */
    fun queue(ctx: Context, lat: Double, lng: Double) {
        val prefs = ctx.getSharedPreferences("roadassist", Context.MODE_PRIVATE)
        val arr = JSONArray(prefs.getString(QUEUE_KEY, "[]"))
        arr.put(
            JSONObject()
                .put("lat", lat).put("lng", lng)
                .put("ref", SosLadder.newIncidentRef())
                .put("at", System.currentTimeMillis()),
        )
        prefs.edit().putString(QUEUE_KEY, arr.toString()).apply()
    }

    fun queueDepth(ctx: Context): Int {
        val prefs = ctx.getSharedPreferences("roadassist", Context.MODE_PRIVATE)
        return JSONArray(prefs.getString(QUEUE_KEY, "[]")).length()
    }

    /**
     * Replay queued SOS through the API once data is back; clears on success.
     *
     * Every post carries the entry's `clientIncidentId`, which is the only
     * thing standing between a retry and a second ambulance. Without it, an
     * attempt that the server COMMITTED but whose response was lost looks
     * identical to one that never arrived: the entry stays queued, the next
     * flush posts it again, and one breakdown becomes two incidents and two
     * responders. With it, the server converges on the incident that already
     * exists (`onConflictDoNothing` behind a unique index) and the replay is
     * free. That also makes the confirm step safe to retry, which is why a
     * failure there can simply leave the entry queued.
     */
    suspend fun flush(ctx: Context): Int {
        if (!hasData(ctx)) return 0
        val prefs = ctx.getSharedPreferences("roadassist", Context.MODE_PRIVATE)
        val arr = JSONArray(prefs.getString(QUEUE_KEY, "[]"))
        var sent = 0
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            try {
                // Entries queued by an older build have no reference. Mint one
                // so at least THIS flush's own retries converge, rather than
                // dropping back to the duplicate-raising behaviour entirely.
                val ref = o.optString("ref", "").ifEmpty { SosLadder.newIncidentRef() }
                val raised = Api.post(
                    "/v1/sos",
                    JSONObject().put("lat", o.getDouble("lat")).put("lng", o.getDouble("lng"))
                        .put("source", "manual")
                        .put("clientIncidentId", ref),
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
