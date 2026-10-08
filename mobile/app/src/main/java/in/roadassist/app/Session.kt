package `in`.roadassist.app

import org.json.JSONObject

/**
 * The signed-in session as it is kept across a restart, and the rules for
 * keeping it, separated from the Keystore plumbing (SessionStore.kt).
 *
 * Tokens used to live in [Api]'s memory only. After a cold start or a process
 * death the app opened on the sign-in screen, and an SOS raised from there had
 * no data rung at all. Now the session is written, encrypted, to this phone
 * and restored at launch. What is stored, and when a stored or refreshed
 * session counts as ended, are pure decisions, so they are pinned off-device
 * the way SosLadder's are.
 */
data class StoredSession(
    val access: String?,
    val refresh: String,
    val userId: String? = null,
    val msisdn: String? = null,
    val vehicleId: String? = null,
    val vehicleLabel: String? = null,
)

object SessionCodec {

    /** The session as JSON, ready to be encrypted. Absent fields are left out. */
    fun encode(s: StoredSession): String {
        val o = JSONObject().put("refresh", s.refresh)
        s.access?.let { o.put("access", it) }
        s.userId?.let { o.put("userId", it) }
        s.msisdn?.let { o.put("msisdn", it) }
        s.vehicleId?.let { o.put("vehicleId", it) }
        s.vehicleLabel?.let { o.put("vehicleLabel", it) }
        return o.toString()
    }

    /**
     * Read a stored session back. Anything unreadable, or with no refresh
     * token, is no session at all: a half-restored one 401s every call and
     * looks broken rather than signed out.
     */
    fun decode(text: String?): StoredSession? {
        if (text.isNullOrBlank()) return null
        val o = try { JSONObject(text) } catch (_: Exception) { return null }
        val refresh = o.optString("refresh", "").takeIf { it.isNotBlank() } ?: return null
        fun opt(k: String) = o.optString(k, "").takeIf { it.isNotBlank() }
        return StoredSession(
            access = opt("access"), refresh = refresh, userId = opt("userId"),
            msisdn = opt("msisdn"), vehicleId = opt("vehicleId"), vehicleLabel = opt("vehicleLabel"),
        )
    }

    /** iv and ciphertext as one preferences string. java.util.Base64: API 26, the minSdk. */
    fun pack(iv: ByteArray, cipherText: ByteArray): String {
        val b64 = java.util.Base64.getEncoder()
        return b64.encodeToString(iv) + ":" + b64.encodeToString(cipherText)
    }

    /** The inverse of [pack], or null for anything that is not one. */
    fun unpack(blob: String?): Pair<ByteArray, ByteArray>? {
        if (blob.isNullOrBlank() || ':' !in blob) return null
        return try {
            val b64 = java.util.Base64.getDecoder()
            b64.decode(blob.substringBefore(':')) to b64.decode(blob.substringAfter(':'))
        } catch (_: IllegalArgumentException) { null }
    }
}

object SessionRules {

    /**
     * The refresh endpoint's own reasons for a session that is gone. The
     * server answers each with 401 today; they are named so a change of status
     * code on its side cannot turn a dead session back into a live one here.
     */
    private val DEAD_SESSION_CODES = setOf(
        "reuse_detected", "signed_out", "expired", "unknown_token", "no_session",
    )

    /**
     * Does this refresh answer END the session?
     *
     * Only a rejection does: 400, 401 or 403, or one of the server's reasons
     * for a dead token. A 5xx, a 429 or a proxy's 502 while the host wakes up
     * says nothing about the token, and clearing on those signed the user out
     * locally while the UI stayed on the signed-in screens: every call then
     * 401'd with no session to refresh, a zombie app.
     */
    fun refreshEndsSession(status: Int, code: String?): Boolean =
        status == 400 || status == 401 || status == 403 || (code != null && code in DEAD_SESSION_CODES)

    /**
     * May a refresh answer be adopted?
     *
     * Only into the session that asked for it. A sign-out while the rotation
     * was in flight bumps the generation and drops the refresh token; adopting
     * the answer afterwards signed the user straight back in. A sign-in to
     * another account in that window changes the refresh token instead.
     */
    fun mayAdopt(startedGeneration: Long, currentGeneration: Long, presented: String, currentRefresh: String?): Boolean =
        startedGeneration == currentGeneration && presented == currentRefresh

    /** What to do with a stored session at launch. */
    enum class Launch { SIGNED_OUT, TRUST, VERIFY }

    /**
     * Offline, the stored session is trusted as it is: the person may be in a
     * dead zone and needs the signed-in app, and the SOS data rung will use it
     * the moment a bar returns. Online, it is checked once with /v1/me.
     */
    fun atLaunch(saved: StoredSession?, online: Boolean): Launch = when {
        saved == null -> Launch.SIGNED_OUT
        online -> Launch.VERIFY
        else -> Launch.TRUST
    }

    /**
     * After that check. Only the server saying no ends the session (the 401
     * that survived a refresh, or a 403); no answer at all, or a 5xx, keeps it,
     * for the same reason as [refreshEndsSession].
     */
    fun verifyEndsSession(status: Int): Boolean = status == 401 || status == 403
}
