package `in`.roadassist.app

import java.io.Closeable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Scan road loads its detector (an OrtSession and the model's native memory)
 * off the main thread. Leaving the screen during that load must close what was
 * built: the old isActive check after withContext never ran, because
 * withContext throws to a cancelled caller instead of returning.
 */
class BuildOwnedTest {

    @Test
    fun `leaving while it is being built closes what was built`() = runBlocking {
        val closed = AtomicBoolean(false)
        val building = CountDownLatch(1)
        val finish = CountDownLatch(1)
        // Undispatched: the caller is on this test thread, as the screen is on main.
        val job = launch(start = CoroutineStart.UNDISPATCHED) {
            buildOwned(Dispatchers.IO) {
                building.countDown()
                finish.await(5, TimeUnit.SECONDS)
                Closeable { closed.set(true) }
            }
        }
        assertTrue(building.await(5, TimeUnit.SECONDS))
        job.cancel()                       // the screen left mid-load
        finish.countDown()
        job.join()
        assertTrue("the detector built after the screen left was never closed", closed.get())
    }

    @Test
    fun `a caller still there gets it open`() = runBlocking {
        val closed = AtomicBoolean(false)
        val got = buildOwned(Dispatchers.IO) { Closeable { closed.set(true) } }
        assertFalse(closed.get())
        got.close()
        assertTrue(closed.get())
    }
}
