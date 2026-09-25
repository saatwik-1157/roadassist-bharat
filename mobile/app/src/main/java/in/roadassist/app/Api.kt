package `in`.roadassist.app

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Minimal client for the RoadAssist API — HttpURLConnection + org.json only,
 * so the app carries zero third-party networking dependencies.
 *
 * Every response uses the platform envelope: { data, meta } on success and
 * { error: { code, title, retryable } } on failure; failures surface as
 * ApiException carrying the human-readable title.
 *
 * Access tokens are short-lived. When a call comes back 401 the client rotates
 * the refresh token once, transparently, and replays the request — so screens
 * never flash "session expired" mid-use. The map WebView shares the same fresh
 * token through [currentToken] / [refreshBlocking].
 */
class ApiException(
    message: String,
    /**
     * The envelope's machine-readable `error.code`, when the server sent one.
     *
     * The title is for people and may be reworded or translated; the code is
     * what a screen can branch on. The sign-in screen needs exactly that: a
     * phone number whose owner moved it behind email sign-in comes back 403
     * `email_signin_required`, and the useful response is to open the email
     * option, not merely to print the sentence and leave the user to find it.
     */
    val code: String? = null,
    /** The HTTP status, or 0 when no response was read. */
    val status: Int = 0,
) : Exception(message)

object Api {
    /**
     * The live platform, and the address a fresh install talks to.
     *
     * It used to be `http://10.0.2.2:4000`, the emulator's alias for the dev
     * machine's localhost. That made every first run on a real handset a dead
     * end: the app opened on a sign-in screen pointed at nothing, and the only
     * way out was a long-press nobody would guess. The live API has a valid
     * certificate, so the default is HTTPS and a phone's first request is the
     * same one the web makes.
     *
     * A developer still points the app at a laptop or an emulator host through
     * the hidden field on the sign-in screen (long-press the wordmark) or the
     * Server card in More. That choice is persisted and restored in
     * MainActivity.onCreate, so it outranks this default until changed back.
     */
    const val DEFAULT_BASE = "https://app.roadassistbharat.online"

    /** The live host on its own, for recognising it when it is typed by hand. */
    private const val LIVE_HOST = "app.roadassistbharat.online"

    /**
     * The address every request goes to. See [DEFAULT_BASE] for why it starts
     * at the live platform, and [normalizeBase] for what a hand-typed address
     * needs before it can replace it.
     */
    @Volatile var base: String = DEFAULT_BASE
    @Volatile var token: String? = null
    @Volatile var refreshToken: String? = null

    /**
     * Only one rotation at a time, across coroutines AND the WebView's binder
     * threads. See [refresh] for why this is not merely an optimisation.
     */
    private val rotating = Mutex()

    /**
     * Make a hand-typed API address usable.
     *
     * This field is filled in on a phone keyboard, so it arrives with what
     * that produces: surrounding space, a trailing slash, and above all no
     * scheme — "192.168.1.8:4000" is what somebody reads off the server's
     * boot banner and types. `URL()` throws MalformedURLException on a string
     * with no scheme, and [raw] surfaces that as a bare "Failed" with nothing
     * the user can act on.
     *
     * Pure, so it is tested off-device rather than by retyping addresses into
     * a running app.
     */
    fun normalizeBase(input: String): String {
        val typed = input.trim()
        if (typed.isEmpty()) return base
        val schemed =
            if (typed.startsWith("http://", ignoreCase = true) ||
                typed.startsWith("https://", ignoreCase = true)) typed
            else "http://$typed"
        val trimmed = schemed.trimEnd('/')
        // A scheme and nothing else is not an address; keep what already works.
        if (trimmed.endsWith(":")) return base
        // The live platform is only ever reached over HTTPS. The bare-host rule
        // above guesses http:// because that is right for a laptop on the LAN,
        // but for the live host it would send a phone number, a sign-in code
        // and then a bearer token in cleartext to a server that is meant to be
        // spoken to on 443. So the live host, typed any way at all, becomes
        // the default address exactly.
        val host = trimmed.substringAfter("://").substringBefore('/')
        return if (host.equals(LIVE_HOST, ignoreCase = true)) DEFAULT_BASE else trimmed
    }

    /**
     * Does a typed address resolve to the one already in use?
     *
     * The settings screen offers a switch that SIGNS THE USER OUT, so it must
     * not be offered for a no-op. "http://192.168.1.8:4000/" and
     * "  192.168.1.8:4000  " are the address already in use, typed differently;
     * treating either as a change ends a session for nothing, and on this app
     * that can mean ending it while somebody is tracking a rescue.
     *
     * Pure, and compares NORMALISED forms rather than raw text, for the same
     * reason [normalizeBase] exists at all.
     */
    fun isCurrentBase(input: String): Boolean = normalizeBase(input) == base

    /**
     * Does a RoadAssist API answer at this address?
     *
     * Switching servers from the settings card signs the user out, and doing
     * that on an address nobody checked is how a typo costs somebody their
     * session — possibly while they are tracking a rescue. So the address is
     * tried FIRST and the switch only happens if something answered.
     *
     * /v1/ping is the right probe and the only one that would be: it needs no
     * token, and it answers even when the platform's database is down, which
     * is precisely the difference this is asking about — can this phone reach
     * that address at all.
     *
     * Takes the candidate rather than reading [base], because the whole point
     * is to test an address that has NOT been adopted yet. Everything is
     * caught: a malformed address throws from the URL constructor rather than
     * from the connection, and both mean the same thing to the caller.
     */
    suspend fun reachable(candidate: String): Boolean = withContext(Dispatchers.IO) {
        val address = normalizeBase(candidate)
        try {
            val conn = URL(address + "/v1/ping").openConnection() as HttpURLConnection
            try {
                conn.requestMethod = "GET"
                // Short, because a person is watching this button. A wrong
                // address on a LAN usually fails fast; a routable-but-dead one
                // hits this ceiling.
                conn.connectTimeout = 4000
                conn.readTimeout = 4000
                conn.setRequestProperty("accept", "application/json")
                conn.responseCode in 200..299
            } finally {
                conn.disconnect()
            }
        } catch (_: Exception) {
            false
        }
    }

    /** The access token the WebView bridge should use right now. */
    fun currentToken(): String = token ?: ""

    suspend fun get(path: String): JSONObject = request("GET", path, null)

    suspend fun post(path: String, body: JSONObject? = null): JSONObject =
        request("POST", path, body ?: JSONObject())

    suspend fun delete(path: String): JSONObject = request("DELETE", path, null)

    /** Store both tokens from an OTP-verify (or refresh) response. */
    fun adoptSession(data: JSONObject) {
        token = data.optString("accessToken").takeIf { it.isNotBlank() } ?: token
        refreshToken = data.optString("refreshToken").takeIf { it.isNotBlank() } ?: refreshToken
    }

    fun clear() { token = null; refreshToken = null }

    private suspend fun request(method: String, path: String, body: JSONObject?): JSONObject {
        val (code, json) = raw(method, path, body)
        if (code == 401 && refreshToken != null && !path.startsWith("/v1/auth/")) {
            // One transparent rotation, then replay the original request.
            if (refresh()) {
                val (code2, json2) = raw(method, path, body)
                if (code2 in 200..299) return json2
                throw failure(code2, json2)
            }
        }
        if (code !in 200..299) throw failure(code, json)
        return json
    }

    /**
     * The exception for a non-2xx answer: the server's own title, which is the
     * sentence written for the person holding the phone, and its error code for
     * a screen that has to act on it rather than only show it.
     */
    private fun failure(status: Int, json: JSONObject): ApiException =
        ApiException(
            errorTitle(json) ?: "Request failed ($status)",
            code = json.optJSONObject("error")?.optString("code")?.takeIf { it.isNotBlank() },
            status = status,
        )

    /**
     * Rotate the refresh token; returns true if a fresh access token was obtained.
     *
     * Single-flight, and that is a correctness requirement rather than a saved
     * round-trip. The server rotates refresh tokens and treats a SECOND
     * presentation of an already-rotated one as theft: `rotateSession` burns
     * every session in the family and answers "For your security every session
     * has been signed out." Two callers refreshing the same token concurrently
     * therefore do not merely duplicate work — the first succeeds and the
     * second signs the user out of everything and raises a false theft signal.
     *
     * It is reachable: the map WebView's `AndroidAuth.refresh()` bridge runs on
     * a binder thread and can land while a Compose coroutine is already
     * rotating, and any two screens whose access token expires together will
     * both 401 and both try.
     *
     * So the token is re-read INSIDE the lock: a caller that queued behind a
     * successful rotation finds it already changed and reports success without
     * presenting the burnt one.
     */
    suspend fun refresh(): Boolean {
        // Captured BEFORE the lock: this is the token this caller actually saw
        // fail. Re-reading inside would pick up a rotation that already
        // happened and present the fresh token for a second, pointless spin.
        val presented = refreshToken ?: return false
        return rotating.withLock {
            // Somebody rotated while this caller queued. Their token is live,
            // `presented` is now the burnt one, and sending it is precisely the
            // reuse this lock exists to prevent. Report their success as ours.
            if (refreshToken != presented) return@withLock refreshToken != null

            val (code, json) = raw("POST", "/v1/auth/refresh", JSONObject().put("refreshToken", presented))
            if (code in 200..299) {
                adoptSession(json.optJSONObject("data") ?: return@withLock false)
                return@withLock true
            }
            // Genuinely rejected (expired, or a reuse from another device) —
            // the session is gone.
            clear()
            return@withLock false
        }
    }

    /** Blocking rotation for the WebView JS bridge (runs on a binder thread). */
    fun refreshBlocking(): Boolean = runBlocking { refresh() }

    private fun errorTitle(json: JSONObject): String? =
        json.optJSONObject("error")?.optString("title")?.takeIf { it.isNotBlank() }

    /** A single HTTP round-trip with no retry logic. Returns (statusCode, body). */
    private suspend fun raw(method: String, path: String, body: JSONObject?): Pair<Int, JSONObject> =
        withContext(Dispatchers.IO) {
            val conn = URL(base.trimEnd('/') + path).openConnection() as HttpURLConnection
            try {
                conn.requestMethod = method
                conn.connectTimeout = 8000
                conn.readTimeout = 15000
                conn.setRequestProperty("accept", "application/json")
                token?.let { conn.setRequestProperty("authorization", "Bearer $it") }
                if (body != null) {
                    conn.doOutput = true
                    conn.setRequestProperty("content-type", "application/json")
                    conn.outputStream.use { it.write(body.toString().toByteArray()) }
                }
                val stream = if (conn.responseCode in 200..299) conn.inputStream else conn.errorStream
                val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
                val json = if (text.isBlank()) JSONObject() else JSONObject(text)
                conn.responseCode to json
            } finally {
                conn.disconnect()
            }
        }
}
