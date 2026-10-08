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
import android.telephony.SmsManager
import androidx.core.content.ContextCompat
import androidx.core.content.edit
import androidx.core.net.toUri
import androidx.core.location.LocationManagerCompat
import androidx.core.os.CancellationSignal
import kotlin.coroutines.resume
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
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
 *   1. DATA        → the RoadAssist API (full features, instant). Needs a
 *                    session; signed out, the ladder starts at rung 2.
 *   2. SMS         → text "SOS <lat> <lng>" ("SOS location unknown" with no
 *                    fix — see SosPosition) to the RoadAssist number. ONLY when
 *                    a real number is provisioned (RaBuildConfig.RA_SMS_NUMBER,
 *                    empty by default, in which case this rung is skipped), and
 *                    it never settles the ladder: a text that left the phone is
 *                    not confirmed help (SosLadder.afterSms).
 *   3. 112 DIALER  → hand off to the national emergency number, which connects
 *                    through ANY carrier's tower regardless of the SIM's plan.
 *                    From the background (Android 10+ blocks the start) it is
 *                    a tap-to-call notification instead, and the result says so.
 *   4. QUEUE       → store the SOS on the device. SosReplay sends it when a
 *                    network returns while the app is running and signed in
 *                    (and at the next launch otherwise); moving ~500 m along a
 *                    highway usually crosses a coverage boundary.
 *
 * Nothing here is faked: each rung either genuinely transmits or genuinely
 * hands off to the OS, and the result names exactly which rung fired.
 */
object Emergency {

    /**
     * The RoadAssist inbound SMS number, or "" when none is provisioned. Set at
     * build time with -PraSmsNumber=+91…; empty by default, which switches the
     * SMS rung off (SosLadder.smsRungEnabled). It used to be a placeholder,
     * +919999900000, that the ladder really texted.
     */
    val smsNumber: String get() = RaBuildConfig.RA_SMS_NUMBER

    /** The one SOS in flight, and the last outcome, for every screen (SosGate). */
    val gate = SosGate()

    private const val SOS_CHANNEL = "sos"
    private const val SOS_NOTIFICATION_ID = 112
    /** The ladder's dialer rung. A const for the SOS path; EmergencyNumbersTest
     *  pins it to the primary entry of [EmergencyNumbers.ALL] so they cannot drift. */
    const val NATIONAL_EMERGENCY = "112"
    private const val QUEUE_KEY = "ra.sos.queue"
    /** Queued SOS the server refused for good (SosQueue.afterFailure). Never replayed. */
    private const val DEAD_KEY = "ra.sos.dead"

    /** Guards the read-modify-write of [QUEUE_KEY]. Never held across I/O. */
    private val queueLock = Any()

    /** The ladder's vocabulary and its decisions live in [SosLadder], which is
     *  pure Kotlin and therefore testable without a device. */
    data class Result(
        val rung: SosLadder.Rung,
        val detail: String,
        /** How the 112 handoff went, or null when the data rung settled it. */
        val handoff: SosLadder.Handoff? = null,
    )

    fun hasData(ctx: Context): Boolean {
        val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val net = cm.activeNetwork ?: return false
        val caps = cm.getNetworkCapabilities(net) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }

    /** Fine or coarse location granted — what [currentLocation] needs to try at all. */
    fun hasLocationPermission(ctx: Context): Boolean =
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun canSendSms(ctx: Context): Boolean =
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.SEND_SMS) ==
            PackageManager.PERMISSION_GRANTED

    /**
     * Where the ladder runs: the process, not a screen.
     *
     * It used to run in HomeScreen's rememberCoroutineScope, and that scope is
     * cancelled the moment Home leaves the composition. The bottom bar stays
     * live while the ladder works (up to 8 s for a GPS fix, then up to 23 s
     * per API call, then 12 s for the SMS receipt), so tapping another tab, or
     * turning the phone and recreating the activity, cancelled an emergency
     * mid-flight: no API call, no SMS, no dialer and nothing queued. An SOS the
     * person has already committed to has to finish whatever the UI does.
     */
    val ladderScope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    /**
     * Run the ladder. `apiSos` performs rungs 1's network calls and returns a
     * human summary, or throws if the API is unreachable — keeping all the
     * Compose/coroutine wiring in the caller.
     *
     * [ref] is this emergency's one client reference. The data rung must send
     * it as `clientIncidentId`, and the queue rungs store the SAME one, so a
     * data attempt that the server committed but whose answer was lost (or
     * whose confirm failed) is replayed onto that incident rather than raising
     * a second one. Minting the queue's reference separately, as before, made
     * exactly that case two emergencies.
     *
     * [pos] is [SosPosition.Unknown] when there is no fix. Every rung then says
     * so (SosPosition) instead of carrying a made-up coordinate; the ladder's
     * order and decisions are the same either way.
     */
    suspend fun raise(
        ctx: Context,
        pos: SosPosition,
        ref: String = SosLadder.newIncidentRef(),
        hasSession: Boolean = Api.hasSession(),
        apiSos: suspend (ref: String) -> String,
    ): Result {
        // Rung 1 — data path (only attempted when the OS reports validated
        // internet, and only with a session to raise it under). "Has internet"
        // and "the API answered" are separate facts: a captive portal — a
        // highway dhaba's wifi — satisfies the first and not the second, and
        // stopping at rung 1 on that basis is a silent emergency.
        var apiSummary: String? = null
        if (SosLadder.shouldTryData(hasData(ctx), hasSession)) {
            apiSummary = try { apiSos(ref) } catch (_: Exception) { null }
        }
        if (SosLadder.dataSettledIt(hasData = true, apiSucceeded = apiSummary != null)) {
            return Result(SosLadder.Rung.DATA, apiSummary!!)
        }

        // Rung 2 — SMS, only to a provisioned number, and never the end of the
        // ladder (SosLadder.afterSms): whatever the radio says, the ladder goes
        // on to 112 and the queue. Its outcome is one more line in the result.
        val number = smsNumber
        var smsNote: String? = null
        if (SosLadder.shouldTrySms(dataSettledIt = false, hasSmsPermission = canSendSms(ctx), number = number)) {
            val outcome = sendSosSms(ctx, number, SosPosition.smsBody(pos))
            smsNote = SosLadder.smsNoteRes(outcome)?.let { ctx.getString(it, number) }
        }

        // Rungs 3 and 4 — hand off to 112, which connects through any carrier's
        // tower. Reaching here means no RoadAssist channel confirmed the report,
        // so the local copy is the only record that exists: queue BEFORE the
        // handoff, because startActivity can throw and the queue is the last resort.
        queue(ctx, pos, ref)
        val handoff = handOffTo112(ctx)
        val detail = listOfNotNull(ctx.getString(SosLadder.handoffRes(handoff)), smsNote).joinToString("\n")
        return Result(SosLadder.rungOf(handoff), detail, handoff)
    }

    /**
     * Open the dialer with 112, or say why it did not open.
     *
     * Android 10+ silently drops an activity start from an app in the
     * background (the ladder survives leaving the app, so this happens), and
     * the old code reported "opening 112" regardless. Now: in the foreground
     * the dialer opens; otherwise a high-priority notification with a
     * tap-to-call action goes up, since a notification tap IS allowed to open
     * an activity; and the result names which of the two happened, or neither.
     */
    private fun handOffTo112(ctx: Context): SosLadder.Handoff {
        val dial = Intent(Intent.ACTION_DIAL, "tel:$NATIONAL_EMERGENCY".toUri())
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val allowed = android.os.Build.VERSION.SDK_INT < 29 || inForeground()
        val started = allowed && try { ctx.startActivity(dial); true } catch (_: Exception) { false }
        val notified = if (allowed && started) false else notify112(ctx, dial)
        return SosLadder.handoff(allowed, started, notified)
    }

    private fun inForeground(): Boolean {
        val info = android.app.ActivityManager.RunningAppProcessInfo()
        android.app.ActivityManager.getMyMemoryState(info)
        return info.importance <= android.app.ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
    }

    /** The tap-to-call notification. False when notifications are off or not permitted. */
    private fun notify112(ctx: Context, dial: Intent): Boolean {
        if (android.os.Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) return false
        val nm = androidx.core.app.NotificationManagerCompat.from(ctx)
        if (!nm.areNotificationsEnabled()) return false
        return try {
            nm.createNotificationChannel(
                androidx.core.app.NotificationChannelCompat.Builder(
                    SOS_CHANNEL, androidx.core.app.NotificationManagerCompat.IMPORTANCE_HIGH,
                ).setName(ctx.getString(R.string.sos_notify_channel)).build(),
            )
            val tap = PendingIntent.getActivity(
                ctx, 0, dial, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val n = androidx.core.app.NotificationCompat.Builder(ctx, SOS_CHANNEL)
                .setSmallIcon(android.R.drawable.ic_menu_call)
                .setContentTitle(ctx.getString(R.string.sos_notify_title))
                .setContentText(ctx.getString(R.string.sos_notify_body))
                .setPriority(androidx.core.app.NotificationCompat.PRIORITY_MAX)
                .setCategory(androidx.core.app.NotificationCompat.CATEGORY_CALL)
                .setContentIntent(tap)
                .addAction(android.R.drawable.ic_menu_call, ctx.getString(R.string.sos_notify_action), tap)
                .setAutoCancel(true)
                .build()
            nm.notify(SOS_NOTIFICATION_ID, n)
            true
        } catch (_: SecurityException) { false }
    }

    /** Sends the SOS SMS and waits (briefly) for the platform's sent-result
     *  broadcast, so the ladder can distinguish delivered from failed. */
    private suspend fun sendSosSms(ctx: Context, number: String, body: String): SosLadder.SmsOutcome {
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
                    sms.sendTextMessage(number, null, body, pi, null)
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
     * then null. Null is an honest answer: the SOS then goes out as
     * [SosPosition.Unknown], never at a stand-in coordinate.
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
     *  the caller then raises the SOS as location unknown. Prefer
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
     * A queued SOS carries a client reference minted when it was RAISED (the
     * one [raise] already sent on the data rung), not at replay time.
     *
     * The reference is what makes the replay idempotent, so it has to be the
     * same on every attempt: minting it in [flush] would produce a fresh one
     * per try and defeat the whole point. See [SosLadder.newIncidentRef].
     */
    fun queue(
        ctx: Context,
        pos: SosPosition,
        ref: String = SosLadder.newIncidentRef(),
        owner: String? = Api.userId,
    ) {
        // An unknown position is stored as null, never as a stand-in coordinate.
        // The owner decides whose session may replay it (SosQueue.isMine).
        val entry = SosQueue.withOwner(SosPosition.queueEntry(pos, ref, System.currentTimeMillis()), owner)
        // Read-modify-write on one preferences key, so it has to be atomic
        // against a concurrent flush rewriting the same key. Nothing slow
        // happens inside the lock.
        synchronized(queueLock) {
            val prefs = prefs(ctx)
            val current = JSONArray(prefs.getString(QUEUE_KEY, "[]"))
            prefs.edit { putString(QUEUE_KEY, SosQueue.append(current, entry).toString()) }
        }
    }

    private fun prefs(ctx: Context) =
        ctx.getSharedPreferences("roadassist", Context.MODE_PRIVATE)

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
        // The replay posts as the signed-in account, so it needs a session; the
        // entries wait for one (SosReplay pokes again at sign-in).
        if (!hasData(ctx) || !Api.hasSession()) return 0
        val snapshot = synchronized(queueLock) {
            JSONArray(prefs(ctx).getString(QUEUE_KEY, "[]"))
        }
        // Keys, not indices. The queue is rewritten at the END against whatever
        // it holds THEN, so an SOS raised while this flush is in the air is not
        // erased by it — see SosQueue for the bug that argument comes from.
        // Only this account's entries (and unowned ones) are sent, and a 4xx
        // drops one entry rather than blocking every one behind it
        // (SosQueue.afterFailure).
        val replay = SosQueue.replay(
            snapshot, Api.userId,
            statusOf = { e -> (e as? ApiException)?.status },
        ) { o ->
            // Entries queued by an older build have no reference. Mint one
            // so at least THIS flush's own retries converge, rather than
            // dropping back to the duplicate-raising behaviour entirely.
            val ref = o.optString("ref", "").ifEmpty { SosLadder.newIncidentRef() }
            // A null position replays as locationUnknown, not as 0,0 or a demo point.
            val raised = Api.post(
                "/v1/sos",
                SosPosition.apiBody(SosPosition.ofQueueEntry(o), ref),
            ).getJSONObject("data")
            Api.post("/v1/sos/${raised.getString("id")}/confirm")
        }
        if (replay.done.isNotEmpty()) {
            synchronized(queueLock) {
                val prefs = prefs(ctx)
                // Re-read: the queue now may hold an SOS raised while the posts
                // above were in flight, and that one has not been sent.
                val current = JSONArray(prefs.getString(QUEUE_KEY, "[]"))
                prefs.edit {
                    putString(QUEUE_KEY, SosQueue.remaining(current, replay.done).toString())
                    // Refused entries are kept aside, not destroyed: the most
                    // recent 20, for a support look, never replayed.
                    if (replay.dropped.isNotEmpty()) {
                        var dead = JSONArray(prefs.getString(DEAD_KEY, "[]"))
                        for (d in replay.dropped) dead = SosQueue.append(dead, d)
                        val keep = JSONArray()
                        for (i in maxOf(0, dead.length() - 20) until dead.length()) keep.put(dead.get(i))
                        putString(DEAD_KEY, keep.toString())
                    }
                }
            }
        }
        return replay.sent.size
    }
}
