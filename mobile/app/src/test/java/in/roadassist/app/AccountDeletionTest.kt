package `in`.roadassist.app

import java.io.File
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.Collections
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

/**
 * More -> Account: Unlink Google and Delete my account (AccountDeletion.kt),
 * against the shapes the server answers with (DELETE /v1/me/google,
 * POST /v1/me/delete, GET /v1/me). The last two cases go through the real
 * client and a real socket, because what they pin is which requests leave it.
 */
class AccountDeletionTest {

    @Test
    fun `the phrase is the exact english words, spaces around them forgiven`() {
        assertEquals("DELETE MY ACCOUNT", AccountDeletion.PHRASE)
        assertTrue(AccountDeletion.phraseMatches("DELETE MY ACCOUNT"))
        assertTrue(AccountDeletion.phraseMatches("  DELETE MY ACCOUNT \n"))
        for (bad in listOf(
            "delete my account",          // case matters: the server compares exactly
            "DELETE  MY ACCOUNT",         // inner spacing is not trimmed
            "DELETE MY ACCOUNT.",
            "DELETE MY",
            "मेरा खाता हटाएँ",               // a translation is not the phrase
            "", "   ", null,
        )) assertFalse(bad.toString(), AccountDeletion.phraseMatches(bad))
    }

    @Test
    fun `the request body carries the phrase and nothing else`() {
        val b = AccountDeletion.body()
        assertEquals(setOf("confirm"), b.keySet())
        assertEquals("DELETE MY ACCOUNT", b.getString("confirm"))
        assertEquals("/v1/me/delete", AccountDeletion.DELETE_PATH)
        assertEquals("/v1/me/google", AccountDeletion.GOOGLE_PATH)
    }

    private fun me(google: Any? = null, selfDelete: Any? = null) = JSONObject().apply {
        if (google != null) put("google", google)
        if (selfDelete != null) put("selfDelete", selfDelete)
    }

    @Test
    fun `unlink is offered only on a real true`() {
        assertTrue(AccountDeletion.showUnlink(me(JSONObject().put("linked", true).put("email", "a@example.com"))))
        assertTrue("linked with no address is still linked", AccountDeletion.showUnlink(me(JSONObject().put("linked", true))))
        assertFalse(AccountDeletion.showUnlink(me(JSONObject().put("linked", false))))
        assertFalse("a string is not a yes", AccountDeletion.showUnlink(me(JSONObject().put("linked", "true"))))
        assertFalse(AccountDeletion.showUnlink(me(JSONObject())))
        assertFalse("an older server says nothing", AccountDeletion.showUnlink(me()))
        assertFalse(AccountDeletion.showUnlink(me(google = true)))
        assertFalse(AccountDeletion.showUnlink(null))
    }

    @Test
    fun `delete is hidden only on a real false, and an older server keeps it`() {
        assertTrue(AccountDeletion.selfDelete(me(selfDelete = true)))
        assertFalse(AccountDeletion.selfDelete(me(selfDelete = false)))
        assertTrue("missing is true: the server still refuses what it must", AccountDeletion.selfDelete(me()))
        assertTrue(AccountDeletion.selfDelete(null))
    }

    @Test
    fun `deleted is only a real true in the answer`() {
        assertTrue(AccountDeletion.deleted(JSONObject().put("data", JSONObject().put("deleted", true).put("userId", "u-1"))))
        assertFalse(AccountDeletion.deleted(JSONObject().put("data", JSONObject().put("deleted", false))))
        assertFalse(AccountDeletion.deleted(JSONObject().put("data", JSONObject().put("deleted", "true"))))
        assertFalse(AccountDeletion.deleted(JSONObject().put("data", JSONObject())))
        assertFalse(AccountDeletion.deleted(JSONObject()))
        assertFalse(AccountDeletion.deleted(null))
    }

    @Test
    fun `every refusal the server names has its own sentence`() {
        val o = AccountDeletion::outcome
        assertEquals(AccountDeletion.Outcome.PHRASE_WRONG, o(400, "confirmation_required"))
        assertEquals(AccountDeletion.Outcome.REAUTH, o(403, "reauth_required"))
        assertEquals(AccountDeletion.Outcome.BY_REQUEST, o(403, "privileged_account"))
        assertEquals(AccountDeletion.Outcome.BY_REQUEST, o(403, "email_signin_account"))
        assertEquals(AccountDeletion.Outcome.ACTIVE_BOOKING, o(409, "active_booking"))
        assertEquals(AccountDeletion.Outcome.ACTIVE_SOS, o(409, "active_sos"))
        assertEquals("already deleted: its sessions are gone", AccountDeletion.Outcome.DELETED, o(401, "AUTH_REVOKED"))
        assertEquals("only a 401 means revoked", AccountDeletion.Outcome.OTHER, o(403, "AUTH_REVOKED"))
        assertEquals(AccountDeletion.Outcome.OTHER, o(401, "AUTH_EXPIRED"))
        assertEquals(AccountDeletion.Outcome.OTHER, o(500, "something_new"))
        assertEquals(AccountDeletion.Outcome.OTHER, o(0, null))

        assertEquals(R.string.account_delete_phrase_wrong, AccountDeletion.message(AccountDeletion.Outcome.PHRASE_WRONG))
        assertEquals(R.string.account_delete_reauth, AccountDeletion.message(AccountDeletion.Outcome.REAUTH))
        assertEquals(R.string.account_delete_by_request, AccountDeletion.message(AccountDeletion.Outcome.BY_REQUEST))
        assertEquals(R.string.account_delete_active_booking, AccountDeletion.message(AccountDeletion.Outcome.ACTIVE_BOOKING))
        assertEquals(R.string.account_delete_active_sos, AccountDeletion.message(AccountDeletion.Outcome.ACTIVE_SOS))
        assertEquals(R.string.account_deleted, AccountDeletion.message(AccountDeletion.Outcome.DELETED))
        assertNull("an unknown code shows the server's own title", AccountDeletion.message(AccountDeletion.Outcome.OTHER))

        // The one way out each refusal has.
        assertTrue(AccountDeletion.offersSignOut(AccountDeletion.Outcome.REAUTH))
        assertTrue(AccountDeletion.offersPrivacy(AccountDeletion.Outcome.BY_REQUEST))
        for (other in AccountDeletion.Outcome.entries - AccountDeletion.Outcome.REAUTH) {
            assertFalse(other.name, AccountDeletion.offersSignOut(other))
        }
        for (other in AccountDeletion.Outcome.entries - AccountDeletion.Outcome.BY_REQUEST) {
            assertFalse(other.name, AccountDeletion.offersPrivacy(other))
        }
    }

    @Test
    fun `an unlink that would lock the account out says to add a phone`() {
        assertEquals(R.string.google_unlink_phone_required, AccountDeletion.unlinkMessage("phone_required"))
        assertNull(AccountDeletion.unlinkMessage("something_else"))
        assertNull(AccountDeletion.unlinkMessage(null))
    }

    @Test
    fun `every account string exists in all eight languages, and the phrase stays english`() {
        val res = File("src/main/res")
        val keys = listOf(
            "account_title", "google_unlink", "google_unlinked", "google_unlink_failed",
            "google_unlink_phone_required", "account_delete", "account_delete_title", "account_delete_body",
            "account_delete_type", "account_delete_field", "account_delete_confirm", "account_deleted",
            "account_delete_failed", "account_delete_phrase_wrong", "account_delete_reauth",
            "account_delete_by_request", "account_delete_active_booking", "account_delete_active_sos",
            "account_delete_contact",
        )
        for (dir in listOf("values", "values-hi", "values-ta", "values-te", "values-bn", "values-mr", "values-kn", "values-gu")) {
            val xml = File(res, "$dir/strings.xml").readText()
            for (k in keys) assertTrue("$dir has no $k", Regex("<string name=\"$k\"[^>]*>[^<]+</string>").containsMatchIn(xml))
            // The phrase is passed in, never written out in a translation to drift.
            val type = Regex("<string name=\"account_delete_type\">([^<]+)</string>").find(xml)!!.groupValues[1]
            assertTrue("$dir: account_delete_type must take the phrase as %1\$s", type.contains("%1\$s"))
        }
    }

    // ── through the real client ──────────────────────────────────────────────

    private lateinit var server: ServerSocket
    /** Put back afterwards: ApiDefaultTest reads the initialiser's value. */
    private val originalBase = Api.base
    private val seen: MutableList<String> = Collections.synchronizedList(mutableListOf())

    /** Every request is answered 401 AUTH_REVOKED; a refresh is answered 401 as well. */
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
        val body = CharArray(contentLength).also { if (contentLength > 0) input.read(it) }.concatToString()
        seen.add(requestLine.split(' ').getOrElse(1) { "" } + " " + body)
        val payload = JSONObject().put("error", JSONObject()
            .put("code", "AUTH_REVOKED").put("title", "You signed out of this session. Sign in again.")
            .put("retryable", false)).toString().toByteArray()
        val head = "HTTP/1.1 401 X" + CRLF +
            "content-type: application/json" + CRLF +
            "content-length: " + payload.size + CRLF +
            "connection: close" + CRLF + CRLF
        client.getOutputStream().apply { write(head.toByteArray()); write(payload); flush() }
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
        Api.onSessionChanged = {}
        Api.restoreSession(StoredSession(access = "AT-0", refresh = "RT-0", userId = "u-1"))
    }

    @After
    fun stop() {
        runCatching { server.close() }
        Api.onSessionChanged = {}
        Api.clear()
        Api.base = originalBase
    }

    @Test
    fun `a revoked answer to the delete is not refreshed, so it reads as deleted rather than session lost`() = runBlocking {
        try {
            Api.post(AccountDeletion.DELETE_PATH, AccountDeletion.body())
            fail("a 401 must throw")
        } catch (e: ApiException) {
            assertEquals(AccountDeletion.Outcome.DELETED, AccountDeletion.outcome(e.status, e.code))
        }
        assertEquals("only the delete left the client, no refresh", 1, seen.size)
        assertTrue(seen[0], seen[0].startsWith("/v1/me/delete "))
        assertEquals("DELETE MY ACCOUNT", JSONObject(seen[0].substringAfter(' ')).getString("confirm"))
        // The screen ends the session itself and says the account was deleted;
        // the client did not end it first as a lost session.
        assertTrue(Api.sessionLive.value)
    }

    @Test
    fun `the same answer anywhere else is still a session problem and is refreshed`() = runBlocking {
        try {
            Api.get("/v1/me")
            fail("a 401 must throw")
        } catch (e: ApiException) {
            assertEquals(401, e.status)
        }
        assertEquals(listOf("/v1/me", "/v1/auth/refresh"), seen.map { it.substringBefore(' ') })
        assertFalse("a rejected refresh ends the session", Api.sessionLive.value)
    }

    private companion object {
        val CRLF = 13.toChar().toString() + 10.toChar().toString()
    }
}
