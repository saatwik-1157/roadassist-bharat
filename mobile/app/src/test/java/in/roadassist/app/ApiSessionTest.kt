package `in`.roadassist.app

import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * The session's life cycle through the real client, against a real socket.
 *
 *  - fix 1: every change of session reaches the persistence hook (so it
 *    survives a restart), and a restored session is usable as it is;
 *  - fix 6: a 5xx or 429 on refresh keeps the session, a rejection ends it
 *    and drops [Api.sessionLive], which is what flips the UI back to sign-in;
 *  - fix 8: a sign-out while a rotation is in flight stays a sign-out.
 */
class ApiSessionTest {

    private lateinit var server: ServerSocket

    /** What the stub answers to POST /v1/auth/refresh. */
    @Volatile private var status = 200
    @Volatile private var body = ""

    /** When set, the stub waits on [release] before answering, after counting down [arrived]. */
    @Volatile private var hold = false
    private val arrived = CountDownLatch(1)
    private val release = CountDownLatch(1)

    private val persisted = mutableListOf<StoredSession?>()

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
        if (contentLength > 0) input.read(CharArray(contentLength))
        if (hold) {
            arrived.countDown()
            release.await(10, TimeUnit.SECONDS)
        }
        val bytes = body.toByteArray()
        val head = "HTTP/1.1 $status X" + CRLF +
            "content-type: application/json" + CRLF +
            "content-length: " + bytes.size + CRLF +
            "connection: close" + CRLF + CRLF
        client.getOutputStream().apply { write(head.toByteArray()); write(bytes); flush() }
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
        Api.onSessionChanged = { synchronized(persisted) { persisted.add(it) } }
        Api.restoreSession(StoredSession(access = "AT-0", refresh = "RT-0", userId = "u-1"))
    }

    @After
    fun stop() {
        runCatching { server.close() }
        Api.onSessionChanged = {}
        Api.clear()
    }

    private fun session(access: String, refresh: String) =
        JSONObject().put("data", JSONObject().put("accessToken", access).put("refreshToken", refresh)).toString()

    private fun error(code: String) =
        JSONObject().put("error", JSONObject().put("code", code).put("title", "x").put("retryable", false)).toString()

    // ── fix 6 ────────────────────────────────────────────────────────────────

    @Test
    fun `a 503 on refresh keeps the session`() = runBlocking {
        status = 503; body = ""
        assertFalse(Api.refresh())
        assertEquals("the refresh token was thrown away on a server error", "RT-0", Api.refreshToken)
        assertTrue("the UI would have been signed out", Api.sessionLive.value)
    }

    @Test
    fun `a 429 on refresh keeps the session`() = runBlocking {
        status = 429; body = error("rate_limited")
        assertFalse(Api.refresh())
        assertEquals("RT-0", Api.refreshToken)
        assertTrue(Api.sessionLive.value)
    }

    @Test
    fun `a rejected refresh ends the session and tells the UI`() = runBlocking {
        status = 401; body = error("expired")
        assertFalse(Api.refresh())
        assertNull(Api.refreshToken)
        assertFalse("sessionLive must drop so signedIn flips", Api.sessionLive.value)
        assertNull("the stored copy must be wiped too", synchronized(persisted) { persisted.last() })
    }

    // ── fix 1 ────────────────────────────────────────────────────────────────

    @Test
    fun `a rotated session is persisted, and a restored one is live`() = runBlocking {
        assertTrue(Api.sessionLive.value)
        assertTrue(Api.hasSession())
        status = 200; body = session("AT-1", "RT-1")
        assertTrue(Api.refresh())
        val last = synchronized(persisted) { persisted.last() }!!
        assertEquals("RT-1", last.refresh)
        assertEquals("AT-1", last.access)
        assertEquals("the owner survives a rotation", "u-1", last.userId)
    }

    @Test
    fun `a sign-in is persisted with its owner`() {
        Api.adoptSession(
            JSONObject().put("accessToken", "AT-9").put("refreshToken", "RT-9")
                .put("user", JSONObject().put("id", "u-9")),
        )
        val last = synchronized(persisted) { persisted.last() }!!
        assertEquals("RT-9", last.refresh)
        assertEquals("u-9", last.userId)
        assertEquals("u-9", Api.userId)
    }

    // ── fix 8 ────────────────────────────────────────────────────────────────

    @Test
    fun `signing out during an in-flight refresh stays signed out`() = runBlocking {
        status = 200; body = session("AT-1", "RT-1"); hold = true
        val rotation = async(Dispatchers.IO) { Api.refresh() }
        assertTrue("the refresh never reached the server", arrived.await(10, TimeUnit.SECONDS))
        Api.clear()                      // the user taps Sign out now
        release.countDown()              // and then the rotation answers
        assertFalse("the late answer was reported as a success", rotation.await())
        assertNull("the session came back after sign-out", Api.refreshToken)
        assertNull(Api.token)
        assertFalse(Api.sessionLive.value)
    }

    private companion object {
        val CRLF = 13.toChar().toString() + 10.toChar().toString()
    }
}
