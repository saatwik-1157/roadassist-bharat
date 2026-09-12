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
class ApiException(message: String) : Exception(message)

object Api {
    /** 10.0.2.2 is the emulator's alias for the dev machine's localhost. */
    @Volatile var base: String = "http://10.0.2.2:4000"
    @Volatile var token: String? = null
    @Volatile var refreshToken: String? = null

    /**
     * Only one rotation at a time, across coroutines AND the WebView's binder
     * threads. See [refresh] for why this is not merely an optimisation.
     */
    private val rotating = Mutex()

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
                throw ApiException(errorTitle(json2) ?: "Request failed ($code2)")
            }
        }
        if (code !in 200..299) throw ApiException(errorTitle(json) ?: "Request failed ($code)")
        return json
    }

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
