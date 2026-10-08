package `in`.roadassist.app

import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The offline queue replays when the network returns, whatever screen is up.
 *
 * Emergency.flush used to run once, from a LaunchedEffect on Home: a person who
 * queued an SOS and stayed on Home while the signal came back was told it would
 * send "the moment connectivity returns", and it did not. SosReplay now pokes
 * this trigger from a ConnectivityManager callback, at sign-in and at launch.
 */
class ReplayTriggerTest {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    @Test
    fun `a network coming back runs the replay and reports what it sent`() = runBlocking {
        val sent = CompletableDeferred<Int>()
        val t = ReplayTrigger(scope, ready = { true }, flush = { 2 }, onSent = { sent.complete(it) })
        t.poke()                          // what onAvailable / onCapabilitiesChanged do
        assertEquals(2, withTimeout(5_000) { sent.await() })
    }

    @Test
    fun `without a session nothing is posted`() = runBlocking {
        val flushes = AtomicInteger()
        val t = ReplayTrigger(scope, ready = { false }, flush = { flushes.incrementAndGet(); 1 }, onSent = {})
        t.poke()?.join()
        assertEquals(0, flushes.get())
    }

    @Test
    fun `pokes during a replay never run two at once and are not lost`() = runBlocking {
        val inFlight = AtomicInteger()
        val maxInFlight = AtomicInteger()
        val flushes = AtomicInteger()
        val gate = CompletableDeferred<Unit>()
        val started = CompletableDeferred<Unit>()
        val t = ReplayTrigger(scope, ready = { true }, flush = {
            val now = inFlight.incrementAndGet()
            maxInFlight.updateAndGet { maxOf(it, now) }
            if (flushes.incrementAndGet() == 1) { started.complete(Unit); gate.await() }
            inFlight.decrementAndGet()
            0
        }, onSent = {})
        val job = t.poke()!!
        withTimeout(5_000) { started.await() }
        repeat(5) { t.poke() }            // the network flaps while the first replay is out
        gate.complete(Unit)
        job.join()
        assertEquals("two replays posted the same SOS at once", 1, maxInFlight.get())
        assertTrue("the pokes during the replay were dropped", flushes.get() >= 2)
    }

    @Test
    fun `a failing replay does not stop later pokes`() = runBlocking {
        val flushes = AtomicInteger()
        val t = ReplayTrigger(scope, ready = { true }, flush = {
            if (flushes.incrementAndGet() == 1) error("no route") else 1
        }, onSent = {})
        t.poke()?.join()
        t.poke()?.join()
        assertEquals(2, flushes.get())
    }

    @Test
    fun `a queue still waiting after a failed pass is retried with no network change`() = runBlocking {
        val queued = AtomicInteger(1)
        val flushes = AtomicInteger()
        val sent = CompletableDeferred<Int>()
        val t = ReplayTrigger(scope, ready = { queued.get() > 0 }, flush = {
            // The first pass fails the way a 502 from a waking host does; the API is back by the retry.
            if (flushes.incrementAndGet() == 1) 0 else { queued.set(0); 1 }
        }, onSent = { sent.complete(it) }, retryMs = 50)
        t.poke()                          // right after the SOS was queued; nothing else pokes
        assertEquals("the queued SOS was never retried", 1, withTimeout(5_000) { sent.await() })
        Thread.sleep(300)                 // nothing left: no further passes
        assertEquals(2, flushes.get())
    }
}
