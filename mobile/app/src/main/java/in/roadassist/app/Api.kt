package `in`.roadassist.app

import kotlinx.coroutines.Dispatchers
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
 */
class ApiException(message: String) : Exception(message)

object Api {
    /** 10.0.2.2 is the emulator's alias for the dev machine's localhost. */
    @Volatile var base: String = "http://10.0.2.2:4000"
    @Volatile var token: String? = null

    suspend fun get(path: String): JSONObject = request("GET", path, null)

    suspend fun post(path: String, body: JSONObject? = null): JSONObject =
        request("POST", path, body ?: JSONObject())

    private suspend fun request(method: String, path: String, body: JSONObject?): JSONObject =
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
                if (conn.responseCode !in 200..299) {
                    val title = json.optJSONObject("error")?.optString("title")
                        ?.takeIf { it.isNotBlank() }
                    throw ApiException(title ?: "Request failed (${conn.responseCode})")
                }
                json
            } finally {
                conn.disconnect()
            }
        }
}
