package `in`.roadassist.app

import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.Collections
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

/**
 * Api.openIncidents / resolveIncident / cancelIncident against a real socket,
 * because what matters is what actually leaves the phone: the path, the
 * method, the bearer token and the body — and that an older server without
 * the endpoint (404) means "no card", not a crash.
 */
class ApiIncidentsTest {

    private data class Seen(val method: String, val path: String, val auth: String?, val body: String)

    private lateinit var server: ServerSocket
    private val seen: MutableList<Seen> = Collections.synchronizedList(mutableListOf())

    /** (status, body) for a request; replaced per test. */
    @Volatile private var respond: (Seen) -> Pair<Int, String> = { 404 to "" }

    private fun handle(client: Socket): Unit = client.use {
        val input = client.getInputStream().bufferedReader()
        val requestLine = input.readLine() ?: return
        var contentLength = 0
        var auth: String? = null
        while (true) {
            val line = input.readLine() ?: return
            if (line.isEmpty()) break
            val name = line.substringBefore(":").trim()
            val value = line.substringAfter(":").trim()
            if (name.equals("content-length", ignoreCase = true)) contentLength = value.toInt()
            if (name.equals("authorization", ignoreCase = true)) auth = value
        }
        val body = CharArray(contentLength).also { if (contentLength > 0) input.read(it) }.concatToString()
        val parts = requestLine.split(" ")
        val req = Seen(parts[0], parts[1], auth, body)
        seen += req

        val (status, payload) = respond(req)
        val bytes = payload.toByteArray()
        val head = "HTTP/1.1 $status X\r\n" +
            "content-type: application/json\r\n" +
            "content-length: ${bytes.size}\r\n" +
            "connection: close\r\n\r\n"
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
        Api.token = "AT-1"
        Api.refreshToken = null
    }

    @After
    fun stop() {
        runCatching { server.close() }
        Api.clear()
    }

    private fun ok(data: Any) = 200 to JSONObject().put("data", data).put("meta", JSONObject()).toString()

    private fun error(title: String, code: String) =
        JSONObject().put("error", JSONObject().put("code", code).put("title", title).put("retryable", false)).toString()

    @Test
    fun `lists open incidents with the bearer token`() = runBlocking {
        respond = {
            ok(JSONArray().put(
                JSONObject().put("id", "3f2a9c1e-0000-0000-0000-000000000000").put("status", "RESPONDING")
                    .put("stage", "RESPONDING").put("reference", JSONObject.NULL)
                    .put("raisedAt", "2026-09-27T07:10:00.000Z").put("severity", "HIGH")
                    .put("canResolve", true).put("canCancel", true),
            ))
        }
        val list = Api.openIncidents()
        assertEquals(1, list.size)
        assertEquals("3F2A9C1E", OpenIncidents.label(list[0]))
        val req = seen.single()
        assertEquals("GET", req.method)
        assertEquals("/v1/me/incidents", req.path)
        assertEquals("Bearer AT-1", req.auth)
    }

    @Test
    fun `an older server without the endpoint means no cards, not a crash`() = runBlocking {
        respond = { 404 to error("Route GET:/v1/me/incidents not found", "not_found") }
        assertTrue(Api.openIncidents().isEmpty())
    }

    @Test
    fun `any other failure still surfaces the server's title`() = runBlocking {
        respond = { 503 to error("The platform is having trouble", "unavailable") }
        try {
            Api.openIncidents()
            fail("a 503 must not read as no open emergencies")
        } catch (e: ApiException) {
            assertEquals("The platform is having trouble", e.message)
            assertEquals(503, e.status)
        }
    }

    @Test
    fun `resolve posts self_resolved and cancel posts an empty body`() = runBlocking {
        respond = { ok(JSONObject().put("id", "x").put("status", "RESOLVED")) }
        Api.resolveIncident("abc-123")
        Api.cancelIncident("abc-123")

        val (resolve, cancel) = seen.toList()
        assertEquals("POST", resolve.method)
        assertEquals("/v1/sos/abc-123/resolve", resolve.path)
        assertEquals("self_resolved", JSONObject(resolve.body).getString("outcome"))
        assertEquals("POST", cancel.method)
        assertEquals("/v1/sos/abc-123/cancel", cancel.path)
        assertEquals(0, JSONObject(cancel.body).length())
    }

    @Test
    fun `a refused close carries the server's title for the toast`() = runBlocking {
        respond = { 409 to error("This emergency is closed — raise a new one.", "invalid_state") }
        try {
            Api.resolveIncident("abc-123")
            fail("a 409 must throw")
        } catch (e: ApiException) {
            assertEquals("This emergency is closed — raise a new one.", e.message)
            assertEquals("invalid_state", e.code)
        }
    }
}
