package `in`.roadassist.app

import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.Collections

/**
 * Sign in with email, and the phone path's refusal that sends people to it.
 *
 * Three things matter here and each is pinned against the server's real
 * response bodies rather than a paraphrase of them:
 *  · a phone number moved behind email comes back 403 `email_signin_required`,
 *    and the screen must get both the server's sentence and that code, or it
 *    cannot open the email option for the user;
 *  · the code is never taken from a response, even from a local server that
 *    echoes one in `meta.devOtp`;
 *  · the email verify answer is adopted exactly as a phone one is.
 *
 * A real socket, as in ApiRefreshTest, because what is asserted is what
 * actually crosses the wire.
 */
class EmailSignInTest {

    private lateinit var server: ServerSocket
    private val original = Api.base

    /** Every request the stub saw, as "METHOD /path body". */
    private val seen: MutableList<String> = Collections.synchronizedList(mutableListOf())

    /** path -> (status, body). Anything not listed is a 404. */
    private val routes = mutableMapOf<String, Pair<Int, String>>()

    private fun handle(client: Socket): Unit = client.use {
        val input = client.getInputStream().bufferedReader()
        val requestLine = input.readLine() ?: return
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
        val method = requestLine.substringBefore(' ')
        val path = requestLine.substringAfter(' ').substringBefore(' ')
        seen += "$method $path $body"

        val (status, payload) = routes[path]
            ?: (404 to "{\"error\":{\"code\":\"not_found\",\"title\":\"Not found\"}}")
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
        Api.clear()
    }

    @After
    fun stop() {
        runCatching { server.close() }
        Api.base = original
        Api.clear()
    }

    // ── the phone path's refusal ─────────────────────────────────────────────

    @Test
    fun `a phone number behind email sign-in surfaces the server's title and code`() {
        // Verbatim from routes/auth.ts, curly quotes included.
        val title = "This account signs in with its email address. Choose “Sign in with email”."
        routes["/v1/auth/otp/request"] = 403 to JSONObject().put("error",
            JSONObject().put("code", "email_signin_required").put("title", title).put("retryable", false),
        ).toString()

        try {
            runBlocking { Api.post("/v1/auth/otp/request", JSONObject().put("msisdn", "+919000011111")) }
            fail("a 403 must not read as a sent code")
        } catch (e: ApiException) {
            assertEquals(title, e.message)
            assertEquals(EmailSignIn.PHONE_REFUSED, e.code)
            assertEquals(403, e.status)
        }
    }

    @Test
    fun `an error with no code still carries its title`() {
        routes["/v1/auth/otp/request"] = 429 to
            "{\"error\":{\"title\":\"Too many codes requested. Try again in 15 minutes.\"}}"
        try {
            runBlocking { Api.post("/v1/auth/otp/request", JSONObject().put("msisdn", "+919000022222")) }
            fail("a 429 must throw")
        } catch (e: ApiException) {
            assertEquals("Too many codes requested. Try again in 15 minutes.", e.message)
            assertEquals(null, e.code)
            assertEquals(429, e.status)
        }
    }

    // ── requesting a code ──────────────────────────────────────────────────

    @Test
    fun `asking for a code posts only the address, trimmed`() {
        routes["/v1/auth/email/request"] = 200 to
            "{\"data\":{\"sent\":true,\"expiresInSeconds\":300,\"channel\":\"email\"},\"meta\":{}}"
        val challenge = runBlocking { EmailSignIn.request("  someone@example.in  ") }
        assertEquals(EmailSignIn.Challenge(300), challenge)
        val req = seen.single()
        assertTrue(req, req.startsWith("POST /v1/auth/email/request "))
        assertEquals("someone@example.in", JSONObject(req.substringAfter("request ")).getString("email"))
    }

    @Test
    fun `a code the server echoes is never handed to the screen`() {
        // What a local server with EMAIL_PROVIDER=console and EXPOSE_DEV_OTP on
        // sends. The live one never does; either way the screen must only ever
        // be filled from the inbox.
        val echoed = JSONObject(
            "{\"data\":{\"sent\":true,\"expiresInSeconds\":300,\"channel\":\"email\"}," +
                "\"meta\":{\"devOtp\":\"482913\",\"note\":\"console\"}}",
        )
        routes["/v1/auth/email/request"] = 200 to echoed.toString()

        val fromWire = runBlocking { EmailSignIn.request("someone@example.in") }
        val fromBody = EmailSignIn.challengeFrom(echoed)
        for (c in listOf(fromWire, fromBody)) {
            assertEquals(EmailSignIn.Challenge(300), c)
            assertFalse(c.toString(), c.toString().contains("482913"))
        }
        // And the type has nowhere to put one: its only property is the expiry.
        assertEquals(listOf("expiresInSeconds"),
            EmailSignIn.Challenge::class.java.declaredFields.map { it.name }.filter { !it.startsWith("$") })
    }

    @Test
    fun `a rate-limited request says when to try again`() {
        routes["/v1/auth/email/request"] = 429 to JSONObject().put("error", JSONObject()
            .put("code", "too_many_requests")
            .put("title", "Too many codes requested. Try again in 15 minutes.")
            .put("retryable", true)).toString()
        try {
            runBlocking { EmailSignIn.request("someone@example.in") }
            fail("a 429 must not read as a sent code")
        } catch (e: ApiException) {
            assertEquals("Too many codes requested. Try again in 15 minutes.", e.message)
        }
    }

    // ── verifying ─────────────────────────────────────────────────────────

    @Test
    fun `a verified email code yields a session the phone path's adoptSession accepts`() {
        routes["/v1/auth/email/verify"] = 200 to JSONObject().put("data", JSONObject()
            .put("accessToken", "AT-email").put("refreshToken", "RT-email")
            .put("roles", org.json.JSONArray().put("citizen"))
            .put("user", JSONObject().put("id", "u1").put("msisdn", "+919000011111")),
        ).put("meta", JSONObject().put("channel", "email")).toString()

        val data = runBlocking { EmailSignIn.verify(" someone@example.in ", "123456") }
        val sent = JSONObject(seen.single().substringAfter("verify "))
        assertEquals("someone@example.in", sent.getString("email"))
        assertEquals("123456", sent.getString("code"))

        Api.adoptSession(data)
        assertEquals("AT-email", Api.token)
        assertEquals("RT-email", Api.refreshToken)
        assertEquals("+919000011111", data.getJSONObject("user").getString("msisdn"))
    }

    @Test
    fun `a wrong code is the server's sentence and no session`() {
        routes["/v1/auth/email/verify"] = 401 to JSONObject().put("error", JSONObject()
            .put("code", "otp_invalid")
            .put("title", "That code is not right. Check it and try again.")).toString()
        try {
            runBlocking { EmailSignIn.verify("someone@example.in", "000000") }
            fail("a 401 must not sign anyone in")
        } catch (e: ApiException) {
            assertEquals("That code is not right. Check it and try again.", e.message)
        }
        assertEquals(null, Api.token)
    }

    // ── what is worth sending at all ─────────────────────────────────────

    @Test
    fun `addresses are checked for shape before a request is spent`() {
        for (ok in listOf("a@b.in", "  someone@example.in ", "first.last+tag@mail.example.co.in")) {
            assertTrue(ok, EmailSignIn.isAddress(ok))
        }
        for (bad in listOf("", "someone", "someone@", "@example.in", "some one@example.in", "someone@example")) {
            assertFalse(bad, EmailSignIn.isAddress(bad))
        }
    }

    @Test
    fun `only a six-digit code is accepted`() {
        assertTrue(EmailSignIn.isCode("012345"))
        assertTrue(EmailSignIn.isCode(" 012345 "))
        for (bad in listOf("", "12345", "1234567", "12a456", "12 456")) {
            assertFalse(bad, EmailSignIn.isCode(bad))
        }
    }

    @Test
    fun `a missing expiry falls back to the server's five minutes`() {
        assertEquals(300, EmailSignIn.challengeFrom(JSONObject("{\"data\":{\"sent\":true}}")).expiresInSeconds)
        assertEquals(300, EmailSignIn.challengeFrom(JSONObject("{}")).expiresInSeconds)
        assertEquals(300, EmailSignIn.challengeFrom(JSONObject("{\"data\":{\"expiresInSeconds\":0}}")).expiresInSeconds)
        assertEquals(120, EmailSignIn.challengeFrom(JSONObject("{\"data\":{\"expiresInSeconds\":120}}")).expiresInSeconds)
    }

    private companion object {
        const val CRLF = "\r\n"
    }
}
