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
    /** The signed-in account's id, for tagging queued SOS with their owner. */
    @Volatile var userId: String? = null

    /**
     * Is there a session at all? False after [clear], whoever called it.
     *
     * This is the signal the UI follows. A refresh the server rejected used to
     * clear the tokens and tell nobody, so the signed-in screens stayed up with
     * nothing behind them. RoadAssistApp now collects this and returns to the
     * sign-in screen when it drops.
     */
    private val live = kotlinx.coroutines.flow.MutableStateFlow(false)
    val sessionLive: kotlinx.coroutines.flow.StateFlow<Boolean> = live

    /**
     * Bumped by every [clear]. A refresh adopts its answer only if this has not
     * moved since it started (SessionRules.mayAdopt): a sign-out during an
     * in-flight rotation otherwise brought the session straight back.
     */
    private val generation = java.util.concurrent.atomic.AtomicLong(0)

    /** Guards the check-then-adopt in [refresh] against a concurrent [clear]. */
    private val sessionLock = Any()

    /**
     * Called with the session after every change, and with null when it ends,
     * so it survives a restart. MainActivity.onCreate points it at
     * SessionStore; JVM tests leave it a no-op. Never logs.
     */
    @Volatile var onSessionChanged: (StoredSession?) -> Unit = {}

    fun hasSession(): Boolean = refreshToken != null || token != null

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
    fun normalizeBase(input: String): String = normalizeOr(input, base)

    /**
     * [normalizeBase] with the fallback made explicit. Typing into a field
     * falls back to the address in use; restoring at launch (see
     * [restoreBase]) falls back to [DEFAULT_BASE], and must not depend on
     * whatever [base] happens to hold when it runs.
     */
    private fun normalizeOr(input: String, fallback: String): String {
        val typed = input.trim()
        if (typed.isEmpty()) return fallback
        val schemed =
            if (typed.startsWith("http://", ignoreCase = true) ||
                typed.startsWith("https://", ignoreCase = true)) typed
            else "http://$typed"
        val trimmed = schemed.trimEnd('/')
        // A scheme and nothing else is not an address; keep what already works.
        if (trimmed.endsWith(":")) return fallback
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
     * May this build speak plain HTTP to a host?
     *
     * The answer belongs to the platform, not to this object: a release build's
     * network_security_config.xml refuses cleartext everywhere, and the debug
     * build's (src/debug/res/xml) allows it only to the emulator host and
     * localhost. MainActivity.onCreate points this at
     * NetworkSecurityPolicy.isCleartextTrafficPermitted, which reads whichever
     * of the two this APK was built with, so the app asks the same question
     * the connection would and never keeps a second list that could drift.
     * JVM tests have no platform policy and keep the permissive default.
     */
    @Volatile var cleartextPermitted: (host: String) -> Boolean = { true }

    /**
     * The sentence for an address this build will not speak plain HTTP to.
     * MainActivity.onCreate replaces it with the localised resource
     * (R.string.server_https_required); this object has no Context. The
     * fallback names no scheme on purpose: a URL-shaped literal here reads as
     * an outbound host to app/scripts/check-data-residency.mjs.
     */
    @Volatile var httpsRequiredMessage: String =
        "This address needs HTTPS. Plain HTTP is allowed only in a debug build, " +
            "and only to the emulator host or localhost."

    /**
     * Would the platform refuse this (normalised) address for being cleartext?
     *
     * Asked BEFORE connecting, because the refusal otherwise surfaces as the
     * platform's own exception text ("CLEARTEXT communication to … not
     * permitted by network security policy"), which tells the person holding
     * the phone nothing they can act on. Pure given [permitted].
     */
    fun needsHttps(address: String, permitted: (String) -> Boolean = cleartextPermitted): Boolean {
        val a = address.trim()
        if (!a.startsWith("http://", ignoreCase = true)) return false
        val authority = a.substring("http://".length)
            .substringBefore('/').substringBefore('?').substringBefore('#')
            .substringAfterLast('@')
        val host = if (authority.startsWith("[")) authority.substringBefore(']').removePrefix("[")
        else authority.substringBefore(':')
        return host.isEmpty() || !permitted(host)
    }

    /**
     * The address every install used before [DEFAULT_BASE] existed: the
     * emulator's alias for the dev machine.
     *
     * It was the BUILT-IN default, not a choice. But the server field on the
     * sign-in screen is pre-filled with the address in use and is saved on
     * every sign-in attempt while it is open, so an install where somebody
     * merely looked at that field carries this exact string in preferences
     * without anybody ever having picked it.
     * Restored as-is, it would keep those installs pointed at nothing on a real
     * phone for ever, and the move to the live platform would reach only fresh
     * installs.
     */
    const val LEGACY_DEFAULT_BASE = "http://10.0.2.2:4000"

    /** What to do with a saved address at launch: use [base]; clear the saved one if [forget]. */
    data class Restored(val base: String, val forget: Boolean)

    /**
     * Turn the address saved in preferences into the one to use, once.
     *
     * - Nothing saved (or nothing usable): the live default.
     * - EXACTLY the old built-in default, after the same normalisation a typed
     *   address gets: treated as nothing saved, and [Restored.forget] tells the
     *   caller to delete it, so this is decided once and not on every launch.
     *   Scheme and host compare case-insensitively, because URLs do.
     * - Anything else — a LAN address, a tunnel, the live URL, even the
     *   emulator alias on another port — is somebody's choice and is kept.
     *   It goes through the same normalisation onCreate always applied, which
     *   leaves an address commitApiBase saved exactly as it was.
     *
     * [migrated] is the one-time part. Once the old default has been cleared,
     * a developer who later types 10.0.2.2:4000 on purpose has CHOSEN it, and
     * silently moving them to production on the next launch would be the same
     * mistake in the other direction. So after the first launch of this
     * version the legacy rule no longer applies at all.
     *
     * Pure: the preferences are read and written by the caller, so every case
     * is tested off-device.
     */
    fun restoreBase(saved: String?, migrated: Boolean): Restored {
        if (saved.isNullOrBlank()) return Restored(DEFAULT_BASE, forget = false)
        val address = normalizeOr(saved, DEFAULT_BASE)
        if (!migrated && address.equals(LEGACY_DEFAULT_BASE, ignoreCase = true)) {
            return Restored(DEFAULT_BASE, forget = true)
        }
        return Restored(address, forget = false)
    }

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

    /**
     * The caller's emergencies that are still open, newest first (at most 5).
     *
     * A server from before this endpoint existed answers 404; that is "nothing
     * to show", not a failure, so Home simply has no card. Every other error
     * propagates like any other call.
     */
    suspend fun openIncidents(): List<OpenIncident> =
        try {
            OpenIncidents.parse(get("/v1/me/incidents"))
        } catch (e: ApiException) {
            if (e.status == 404) emptyList() else throw e
        }

    /** "I'm safe": close an open emergency as self-resolved. */
    suspend fun resolveIncident(id: String): JSONObject = close(id, OpenIncidents.Action.RESOLVE)

    /** "False alarm": cancel an open emergency. */
    suspend fun cancelIncident(id: String): JSONObject = close(id, OpenIncidents.Action.CANCEL)

    private suspend fun close(id: String, action: OpenIncidents.Action): JSONObject {
        val (path, body) = OpenIncidents.closeRequest(id, action)
        return post(path, body)
    }

    /** Store both tokens from an OTP-verify (or refresh) response. */
    fun adoptSession(data: JSONObject) {
        synchronized(sessionLock) {
            token = data.optString("accessToken").takeIf { it.isNotBlank() } ?: token
            refreshToken = data.optString("refreshToken").takeIf { it.isNotBlank() } ?: refreshToken
            data.optJSONObject("user")?.optString("id")?.takeIf { it.isNotBlank() }?.let { userId = it }
            live.value = hasSession()
        }
        persist()
    }

    /** Put back a session read from disk at launch. Not re-persisted: it is what is stored. */
    fun restoreSession(s: StoredSession) {
        synchronized(sessionLock) {
            token = s.access
            refreshToken = s.refresh
            userId = s.userId
            live.value = true
        }
    }

    fun clear() {
        synchronized(sessionLock) {
            generation.incrementAndGet()
            token = null; refreshToken = null; userId = null
            live.value = false
        }
        onSessionChanged(null)
    }

    private fun persist() {
        val r = refreshToken ?: return
        onSessionChanged(StoredSession(access = token, refresh = r, userId = userId))
    }

    /**
     * End the session on the server it was issued by, best effort.
     *
     * Signing out used to be [clear] alone: the tokens left this phone's memory
     * and stayed valid on the server, so a refresh token copied before sign-out
     * kept minting access for its whole lifetime. `POST /v1/auth/logout`
     * revokes the session's family. The caller snapshots the access token and
     * the address BEFORE clearing, because a server switch signs out after
     * [base] has already changed. No network is fine: the local sign-out has
     * already happened, and the session then simply expires.
     */
    suspend fun logout(access: String?, at: String) {
        if (access.isNullOrBlank()) return
        try {
            raw("POST", "/v1/auth/logout", JSONObject(), bearer = access, baseUrl = at)
        } catch (_: Exception) { /* signed out locally either way */ }
    }

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
        val started = generation.get()
        return rotating.withLock {
            // Signed out while this caller queued: there is nothing to refresh.
            if (generation.get() != started) return@withLock false
            // Somebody rotated while this caller queued. Their token is live,
            // `presented` is now the burnt one, and sending it is precisely the
            // reuse this lock exists to prevent. Report their success as ours.
            if (refreshToken != presented) return@withLock refreshToken != null

            val (code, json) = raw("POST", "/v1/auth/refresh", JSONObject().put("refreshToken", presented))
            if (code in 200..299) {
                val data = json.optJSONObject("data") ?: return@withLock false
                // Adopt only into the session that asked. A sign-out while the
                // request was in the air must stay a sign-out.
                val adopted = synchronized(sessionLock) {
                    SessionRules.mayAdopt(started, generation.get(), presented, refreshToken).also {
                        if (it) {
                            token = data.optString("accessToken").takeIf { t -> t.isNotBlank() } ?: token
                            refreshToken = data.optString("refreshToken").takeIf { t -> t.isNotBlank() } ?: refreshToken
                        }
                    }
                }
                if (adopted) persist()
                return@withLock adopted
            }
            // Genuinely rejected (expired, or a reuse from another device):
            // the session is gone. Anything else (a 5xx, a 429, a proxy's
            // 502) says nothing about the token, so it is kept and the next
            // call simply tries again.
            val errorCode = json.optJSONObject("error")?.optString("code")?.takeIf { it.isNotBlank() }
            if (SessionRules.refreshEndsSession(code, errorCode) &&
                SessionRules.mayAdopt(started, generation.get(), presented, refreshToken)
            ) clear()
            return@withLock false
        }
    }

    /** Blocking rotation for the WebView JS bridge (runs on a binder thread). */
    fun refreshBlocking(): Boolean = runBlocking { refresh() }

    private fun errorTitle(json: JSONObject): String? =
        json.optJSONObject("error")?.optString("title")?.takeIf { it.isNotBlank() }

    /** A single HTTP round-trip with no retry logic. Returns (statusCode, body). */
    private suspend fun raw(
        method: String, path: String, body: JSONObject?,
        bearer: String? = token, baseUrl: String = base,
    ): Pair<Int, JSONObject> =
        withContext(Dispatchers.IO) {
            // A saved plain-HTTP address this build refuses (one kept from a
            // build that still allowed it) fails here with a sentence the
            // person can act on, not the platform's policy exception.
            if (needsHttps(baseUrl)) throw ApiException(httpsRequiredMessage, code = "https_required")
            val conn = URL(baseUrl.trimEnd('/') + path).openConnection() as HttpURLConnection
            try {
                conn.requestMethod = method
                conn.connectTimeout = 8000
                conn.readTimeout = 15000
                conn.setRequestProperty("accept", "application/json")
                bearer?.let { conn.setRequestProperty("authorization", "Bearer $it") }
                if (body != null) {
                    conn.doOutput = true
                    conn.setRequestProperty("content-type", "application/json")
                    conn.outputStream.use { it.write(body.toString().toByteArray()) }
                }
                val stream = if (conn.responseCode in 200..299) conn.inputStream else conn.errorStream
                val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
                // A proxy's HTML error page (a 502 while the host wakes up) is
                // not an envelope. Parsed blindly it surfaced as "Value <html of
                // type java.lang.String cannot be converted to JSONObject"; as
                // an empty body it becomes "Request failed (502)". A 2xx that is
                // not JSON is still an error: nothing the caller reads is there.
                val json = if (text.isBlank()) JSONObject() else try {
                    JSONObject(text)
                } catch (_: org.json.JSONException) {
                    if (conn.responseCode in 200..299) {
                        throw ApiException("Unexpected answer from the server", status = conn.responseCode)
                    }
                    JSONObject()
                }
                conn.responseCode to json
            } finally {
                conn.disconnect()
            }
        }
}
