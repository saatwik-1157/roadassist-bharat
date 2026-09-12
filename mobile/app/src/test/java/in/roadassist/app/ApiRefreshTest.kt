package `in`.roadassist.app

import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Token rotation must be single-flight.
 *
 * The server rotates refresh tokens and treats a SECOND presentation of an
 * already-rotated one as theft: `rotateSession` burns every session in the
 * family and answers "For your security every session has been signed out."
 * Two concurrent refreshes are therefore not a wasted round-trip — the first
 * succeeds and the second signs the user out of everything, and records a theft
 * that never happened.
 *
 * It is reachable. `AndroidAuth.refresh()` is a @JavascriptInterface the map
 * WebView can call on a binder thread while a Compose coroutine is already
 * rotating, and any two screens whose access token expires together both 401.
 *
 * A real socket rather than a mock, because what is being asserted is how many
 * requests actually leave the client. Hand-rolled rather than
 * com.sun.net.httpserver, which is not on the Android unit-test classpath.
 */
class ApiRefreshTest {

    private lateinit var server: ServerSocket
    private val rotations = AtomicInteger(0)
    private val reuseDetected = AtomicInteger(0)

    /** What the stub currently considers live. Anything else is reuse. */
    private var liveToken = "RT-0"
    private val lock = Object()

    private fun handle(client: Socket): Unit = client.use {
        val input = client.getInputStream().bufferedReader()
        var contentLength = 0
        while (true) {
            val line = input.readLine() ?: return
            if (line.isEmpty()) break
            if (line.startsWith("content-length:", ignoreCase = true)) {
                contentLength = line.substringAfter(":").trim().toInt()
            }
        }
        val body = CharArray(contentLength)
            .also { if (contentLength > 0) input.read(it) }
            .concatToString()

        // The token is quoted JSON; pull it out without a regex so this test
        // needs nothing on the classpath but the JDK.
        val marker = QUOTE + "refreshToken" + QUOTE + ":" + QUOTE
        val presented = body.substringAfter(marker, "").substringBefore(QUOTE, "")

        val (status, payload) = synchronized(lock) {
            if (presented != liveToken) {
                reuseDetected.incrementAndGet()
                401 to reuseBody()
            } else {
                val n = rotations.incrementAndGet()
                liveToken = "RT-$n"
                200 to sessionBody("AT-$n", liveToken)
            }
        }

        val bytes = payload.toByteArray()
        val head = "HTTP/1.1 $status X" + CRLF +
            "content-type: application/json" + CRLF +
            "content-length: " + bytes.size + CRLF +
            "connection: close" + CRLF + CRLF
        client.getOutputStream().apply {
            write(head.toByteArray())
            write(bytes)
            flush()
        }
    }

    @Before
    fun start() {
        server = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
        Thread {
            while (!server.isClosed) {
                val client = try { server.accept() } catch (_: Exception) { return@Thread }
                Thread { runCatching { handle(client) } }.start()
            }
        }.also { it.isDaemon = true; it.start() }

        Api.base = "http://127.0.0.1:" + server.localPort
        Api.token = "AT-0"
        Api.refreshToken = "RT-0"
    }

    @After
    fun stop() {
        runCatching { server.close() }
        Api.clear()
    }

    @Test
    fun `eight concurrent refreshes rotate the token exactly once`() = runBlocking {
        val results = (1..8).map { async { Api.refresh() } }.awaitAll()

        // Before the mutex this sent eight requests: one rotated and seven
        // presented the burnt token, so the real server would have burnt the
        // whole session family and signed the user out mid-use.
        assertEquals("the client rotated more than once", 1, rotations.get())
        assertEquals("a burnt token was presented", 0, reuseDetected.get())

        // Every caller must be told the session is usable, not only the winner.
        assertTrue("a queued caller was told refresh failed", results.all { it })
        assertEquals("AT-1", Api.token)
        assertEquals("RT-1", Api.refreshToken)
    }

    @Test
    fun `a genuinely rejected refresh clears the session and is not retried`() = runBlocking {
        Api.refreshToken = "RT-stale"          // never live: the stub calls it reuse
        val results = (1..4).map { async { Api.refresh() } }.awaitAll()

        assertTrue("a rejected refresh must not report success", results.none { it })
        assertEquals("the stale token was presented more than once", 1, reuseDetected.get())
        assertNull("the session should be gone", Api.refreshToken)
    }

    private companion object {
        val QUOTE = 34.toChar().toString()
        val CRLF = 13.toChar().toString() + 10.toChar().toString()

        /** `{"error":{"code":"reuse_detected","title":"Signed out.","retryable":false}}` */
        fun reuseBody(): String = buildString {
            append("{").append(q("error")).append(":{")
            append(q("code")).append(":").append(q("reuse_detected")).append(",")
            append(q("title")).append(":").append(q("Signed out.")).append(",")
            append(q("retryable")).append(":false}}")
        }

        /** `{"data":{"accessToken":"…","refreshToken":"…"},"meta":{}}` */
        fun sessionBody(access: String, refresh: String): String = buildString {
            append("{").append(q("data")).append(":{")
            append(q("accessToken")).append(":").append(q(access)).append(",")
            append(q("refreshToken")).append(":").append(q(refresh)).append("},")
            append(q("meta")).append(":{}}")
        }

        private fun q(v: String) = QUOTE + v + QUOTE
    }
}
