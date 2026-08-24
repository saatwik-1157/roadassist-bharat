package `in`.roadassist.app

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
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

    /** Rotate the refresh token; returns true if a fresh access token was obtained. */
    suspend fun refresh(): Boolean {
        val rt = refreshToken ?: return false
        val (code, json) = raw("POST", "/v1/auth/refresh", JSONObject().put("refreshToken", rt))
        if (code in 200..299) {
            adoptSession(json.optJSONObject("data") ?: return false)
            return true
        }
        // Refresh failed (expired / reuse) — the session is truly gone.
        clear()
        return false
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
