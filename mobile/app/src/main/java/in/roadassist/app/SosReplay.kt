package `in`.roadassist.app

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.launch

/**
 * Runs the offline-queue replay whenever it might now succeed, single-flight.
 *
 * Pure apart from the coroutine scope it is given, so ReplayTriggerTest drives
 * it with plain lambdas. [poke] is safe from any thread and any number of
 * times: a poke while a replay is running asks for exactly one more pass after
 * it (the network may have come back during the first), never a second
 * concurrent replay, which would post the same queued SOS twice at once.
 */
class ReplayTrigger(
    private val scope: CoroutineScope,
    private val ready: () -> Boolean,
    private val flush: suspend () -> Int,
    private val onSent: (Int) -> Unit,
) {
    private val running = AtomicBoolean(false)
    private val again = AtomicBoolean(false)

    fun poke(): Job? {
        again.set(true)
        if (!running.compareAndSet(false, true)) return null
        return scope.launch {
            try {
                while (again.getAndSet(false)) {
                    if (!ready()) continue
                    val n = try { flush() } catch (e: kotlinx.coroutines.CancellationException) {
                        throw e
                    } catch (_: Exception) { 0 }
                    if (n > 0) onSent(n)
                }
            } finally {
                running.set(false)
            }
            // A poke that landed between the last check and the release.
            if (again.get()) poke()
        }
    }
}

/**
 * The queue replay for the whole app, independent of which screen is up.
 *
 * Emergency.flush used to be called from one place: a LaunchedEffect on Home,
 * once, when Home was composed. A person who queued an SOS in a dead zone and
 * stayed on Home while the signal came back was told "it will send the moment
 * connectivity returns", and it did not, until they left Home and came back.
 *
 * Now a ConnectivityManager default-network callback, registered once per
 * process with the application context, pokes the replay when a network
 * becomes available or validated; the session flow pokes it at sign-in (the
 * replay needs a session); and [start] pokes it once at launch, which covers a
 * queue left by a process that has since died. No WorkManager: that would be
 * the app's first new dependency in a long while, and the callback is what
 * "while the app is running" needs. The SOS strings say exactly that.
 */
object SosReplay {
    private val started = AtomicBoolean(false)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /** How many queued SOS each replay sent, for a toast on whatever screen is showing. */
    private val sentFlow = MutableSharedFlow<Int>(extraBufferCapacity = 4)
    val sent: SharedFlow<Int> = sentFlow

    @Volatile private var trigger: ReplayTrigger? = null

    /** How many queued hazard reports each replay sent (Hazards), for their own toast. */
    private val hazardsSentFlow = MutableSharedFlow<Int>(extraBufferCapacity = 4)
    val hazardsSent: SharedFlow<Int> = hazardsSentFlow

    /**
     * The hazard queue's replay: the same callbacks poke it, but it is a
     * separate trigger with its own single-flight flag, so a slow photo upload
     * never makes an SOS replay wait behind it.
     */
    @Volatile private var hazardTrigger: ReplayTrigger? = null

    fun start(ctx: Context) {
        if (!started.compareAndSet(false, true)) return
        val app = ctx.applicationContext
        val t = ReplayTrigger(
            scope,
            ready = { Api.hasSession() && Emergency.queueDepth(app) > 0 },
            flush = { Emergency.flush(app) },
            onSent = { sentFlow.tryEmit(it) },
        )
        trigger = t
        val h = ReplayTrigger(
            scope,
            ready = { Api.hasSession() && Hazards.depth(app) > 0 },
            flush = { Hazards.flush(app) },
            onSent = { hazardsSentFlow.tryEmit(it) },
        )
        hazardTrigger = h
        val cm = app.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        try {
            cm.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
                // SOS first, always; the hazard replay runs beside it, never ahead.
                override fun onAvailable(network: Network) { t.poke(); h.poke() }
                override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
                    if (caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)) { t.poke(); h.poke() }
                }
            })
        } catch (_: Exception) {
            // Out of callbacks (the platform caps them per app): the launch
            // and sign-in pokes below still run.
        }
        scope.launch { Api.sessionLive.filter { it }.collect { t.poke(); h.poke() } }
        t.poke()
        h.poke()
    }

    /** Ask for a replay now (for example right after an SOS was queued). */
    fun poke() { trigger?.poke() }

    /** Ask for a hazard-queue replay now (for example right after a report was saved). */
    fun pokeHazards() { hazardTrigger?.poke() }
}
