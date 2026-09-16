package `in`.roadassist.app

import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket

/**
 * Is there an API at this address?
 *
 * The settings card lets the address be changed while signed in, and applying
 * one SIGNS THE USER OUT — the tokens in memory were issued by the server being
 * left. That makes an unchecked address expensive: a single mistyped digit ends
 * a session, possibly while somebody is tracking a rescue, and drops them on a
 * sign-in screen pointed at nothing.
 *
 * So [Api.reachable] is tried before anything is adopted, and these pin what it
 * must answer. A real socket rather than a stubbed client, because the failures
 * that matter here — refused connection, unparseable address — are the ones a
 * stub is most likely to get wrong.
 */
class ApiReachableTest {

    private lateinit var server: ServerSocket
    private val original = Api.base

    /** Answers /v1/ping the way the platform does, and nothing else. */
    private fun handle(client: Socket) {
        val request = client.getInputStream().bufferedReader().readLine() ?: ""
        val body = "{\"data\":{\"t\":1},\"meta\":{}}"
        val status = if (request.contains("/v1/ping")) "200 OK" else "404 Not Found"
        val bytes = body.toByteArray()
        val head = "HTTP/1.1 " + status + CRLF +
            "content-type: application/json" + CRLF +
            "content-length: " + bytes.size + CRLF +
            "connection: close" + CRLF + CRLF
        client.getOutputStream().apply {
            write(head.toByteArray())
            write(bytes)
            flush()
        }
        client.close()
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
    }

    @After
    fun stop() {
        runCatching { server.close() }
        Api.base = original
    }

    private fun live() = "127.0.0.1:" + server.localPort

    @Test
    fun `an address where the API answers is reachable`() = runBlocking {
        assertTrue(Api.reachable(live()))
    }

    @Test
    fun `the same address typed the way a person types it is still reachable`() {
        // Spaces and a trailing slash arrive from a phone keyboard; the probe
        // normalises exactly as the client does, or it would reject addresses
        // that work.
        runBlocking { assertTrue(Api.reachable("  " + live() + "/  ")) }
    }

    @Test
    fun `a port with nothing behind it is not reachable`() {
        val dead = ServerSocket(0).let { val p = it.localPort; it.close(); p }
        runBlocking { assertFalse(Api.reachable("127.0.0.1:" + dead)) }
    }

    @Test
    fun `an address that cannot be a URL is refused rather than thrown`() {
        // A bare IPv6 cannot be resolved into host and port by anything, so the
        // URL constructor throws. That must reach the user as "nothing answered",
        // not as a crash on the settings screen.
        runBlocking { assertFalse(Api.reachable("2405:201:a:1::5:4000")) }
    }

    @Test
    fun `probing does not adopt the address it tried`() {
        // The whole point is to test an address BEFORE committing to it. If the
        // probe mutated base, a failed switch would leave the app pointed at the
        // server that just failed.
        Api.base = "http://10.0.2.2:4000"
        runBlocking { Api.reachable(live()) }
        assertEquals("http://10.0.2.2:4000", Api.base)
    }

    private companion object {
        const val CRLF = "\r\n"
    }
}
