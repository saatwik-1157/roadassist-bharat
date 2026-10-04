package `in`.roadassist.app

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The Track screen's first read of a booking can fail (no signal, the server
 * asleep). It used to show a shimmer for as long as the status was unread,
 * which after a failure meant forever. Compose UI is not run off-device here,
 * so this reads TrackScreen's source, the way BookingPositionTest does.
 */
class TrackScreenTest {

    private fun trackScreen(): String {
        val src = listOf(
            File("src/main/java/in/roadassist/app/MainActivity.kt"),
            File("app/src/main/java/in/roadassist/app/MainActivity.kt"),
        ).first { it.isFile }.readText().replace("\r\n", "\n")   // autocrlf checkouts
        val start = src.indexOf("private fun TrackScreen(")
        assertTrue("TrackScreen not found in MainActivity.kt", start >= 0)
        val end = src.indexOf("\n}\n", start)
        assertTrue("end of TrackScreen not found", end > start)
        return src.substring(start, end)
    }

    @Test
    fun `a failed first read shows a sentence and a retry, not an endless shimmer`() {
        val body = trackScreen()
        assertTrue("the failed read no longer says so",
            body.contains("R.string.track_status_unavailable"))
        assertTrue("the failed read no longer offers Retry",
            body.contains("R.string.action_retry"))
        assertTrue("Retry no longer re-runs the read (the effect must be keyed on the attempt)",
            body.contains("LaunchedEffect(bookingId, attempt)"))
        // The failed branch is decided before the shimmer's, so a failure can
        // never fall through to the loading state.
        val failed = body.indexOf("statusFailed) {")
        val shimmer = body.indexOf("Shimmer(")
        assertTrue("the failed state must be checked before the shimmer", failed in 0 until shimmer)
    }
}
