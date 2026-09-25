package `in`.roadassist.app

import org.json.JSONObject

/**
 * "Sign in with email" — the second way in, under the phone flow, matching
 * the web's email-signin.js.
 *
 * Some accounts are put behind email by the project owner (the server's
 * EMAIL_SIGNIN list). For those, a phone sign-in that prints its code on the
 * screen would make the email pointless, so the phone path answers 403
 * `email_signin_required` and this is the way in instead.
 *
 * This only collects an address and a code and talks to the two /v1/auth/email routes. The
 * verify answer has the same shape as the phone verify's — accessToken,
 * refreshToken, roles, user.msisdn — so the screen hands it to exactly the
 * session-saving path the phone flow already uses. A second copy of that path
 * is how the two would drift, and the one that drifted would be the one nobody
 * tests on a Tuesday.
 *
 * The code is NEVER taken from the response. In production the email endpoint
 * does not return it at all; a local server with EMAIL_PROVIDER=console may put
 * one in `meta.devOtp`, and [request] deliberately drops it. A code that can be
 * read off the screen is a code that proves nothing about owning the inbox,
 * which is the only thing this path is for.
 */
object EmailSignIn {

    /** Why the phone path refused: the account signs in by email instead. */
    const val PHONE_REFUSED = "email_signin_required"

    /**
     * What the screen learns from asking for a code: how long it lives. That is
     * all. There is no field for the code on purpose — see the class comment —
     * so no later edit can wire a server-echoed code into the text box by
     * accident.
     */
    data class Challenge(val expiresInSeconds: Int)

    // The same test the web applies before it spends a request: something, an
    // @, something, a dot, something. The server does the real validation; this
    // only saves a round-trip and a rate-limit slot on an obvious typo.
    private val ADDRESS = Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$")
    private val CODE = Regex("^\\d{6}$")

    /** Is this worth sending to the server as an email address? */
    fun isAddress(input: String): Boolean = ADDRESS.matches(input.trim())

    /** Is this a six-digit code, the only shape the server accepts? */
    fun isCode(input: String): Boolean = CODE.matches(input.trim())

    /**
     * Read a request answer into a [Challenge], and nothing else.
     *
     * Pure, so the rule that a server-echoed code never reaches the screen is
     * tested off-device against the exact body a console-mode server sends.
     * A missing or odd `expiresInSeconds` falls back to the five minutes the
     * server actually uses rather than failing a request that succeeded.
     */
    fun challengeFrom(response: JSONObject): Challenge {
        val seconds = response.optJSONObject("data")?.optInt("expiresInSeconds", 300) ?: 300
        return Challenge(if (seconds > 0) seconds else 300)
    }

    /**
     * Ask for a code. The answer is the same whether or not the address has an
     * account — the server says "sent" either way and only emails a listed one
     * — so the screen must word its confirmation as "if that address has an
     * account", never "sent to you". A 429 arrives as an [ApiException]
     * carrying the server's own "try again in N minutes" title.
     */
    suspend fun request(email: String): Challenge =
        challengeFrom(Api.post("/v1/auth/email/request", JSONObject().put("email", email.trim())))

    /**
     * Trade the emailed code for a session. Returns the response's `data`,
     * which is shaped like the phone verify's and goes to the same place.
     */
    suspend fun verify(email: String, code: String): JSONObject =
        Api.post(
            "/v1/auth/email/verify",
            JSONObject().put("email", email.trim()).put("code", code.trim()),
        ).getJSONObject("data")
}
