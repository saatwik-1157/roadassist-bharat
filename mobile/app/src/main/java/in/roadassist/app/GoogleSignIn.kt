package `in`.roadassist.app

import android.content.Context
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException
import org.json.JSONArray
import org.json.JSONObject

/**
 * "Continue with Google" and "Link Google" (server: app/apps/api/src/routes/google-auth.ts).
 *
 * Credential Manager shows Google's own account sheet and hands back an ID
 * token. The app never verifies that token itself and never keeps it: it is
 * posted once to the server, which checks the signature against Google's
 * keys, that it was issued to OUR web client (aud) from THIS app (azp), and
 * that it carries the single-use nonce the server issued a moment before.
 * The server then answers exactly as a phone sign-in does - so the session is
 * adopted by the same path (Api.adoptSession) - plus whether the account
 * still needs a phone number.
 *
 * Which Google client to ask for comes from the server too (/health's
 * features.googleSignin.serverClientId): the web client id is public, and
 * reading it at run time means no client id is built into the APK and the
 * button simply is not drawn when a server has Google sign-in off.
 *
 * The decisions below are pure, so a JVM test pins them (GoogleSignInTest):
 *  - the button exists only when the server says android === true AND names a
 *    plausible client id;
 *  - a nonce is used only if it has the exact shape the server issues;
 *  - "needs a phone" is only a real boolean true, never a string;
 *  - a JSON null number is no number (org.json's optString would say "null");
 *  - Link Google is offered to a citizen-only account, which is all the server allows.
 */
object GoogleSignIn {
    private val CLIENT_ID = Regex("^[0-9]{6,32}-[a-z0-9]{8,64}\\.apps\\.googleusercontent\\.com$")
    private val NONCE = Regex("^[A-Za-z0-9_-]{43}$")

    /** What the server says about Google sign-in, for this app. */
    data class Feature(val enabled: Boolean, val serverClientId: String?)

    /** GET /health → data.features.googleSignin. An older server, or any oddity, is off. */
    fun feature(health: JSONObject?): Feature {
        val g = health?.optJSONObject("data")?.optJSONObject("features")?.optJSONObject("googleSignin")
            ?: return Feature(false, null)
        val id = g.opt("serverClientId") as? String
        val on = g.opt("android") == true && id != null && CLIENT_ID.matches(id)
        return if (on) Feature(true, id) else Feature(false, null)
    }

    /** POST /v1/auth/google/nonce → data.nonce, only in the shape the server issues. */
    fun nonce(response: JSONObject?): String? =
        (response?.optJSONObject("data")?.opt("nonce") as? String)?.takeIf { NONCE.matches(it) }

    /** POST /v1/auth/google/token → meta.phoneRequired, strictly. */
    fun phoneRequired(response: JSONObject?): Boolean =
        response?.optJSONObject("meta")?.opt("phoneRequired") == true

    /** A user object's msisdn, or null - including for JSON null, which optString turns into "null". */
    fun msisdnOf(user: JSONObject?): String? {
        val v = user?.opt("msisdn")
        return (v as? String)?.takeIf { it.isNotBlank() && it != "null" }
    }

    /** GET /v1/me → data.hasPhone. Absent (an older server) means it has one, as every account then did. */
    fun hasPhone(me: JSONObject?): Boolean = me?.opt("hasPhone") != false

    /** GET /v1/me → the Google address shown as linked, or null when none is linked. */
    fun linkedEmail(me: JSONObject?): String? {
        val g = me?.optJSONObject("google") ?: return null
        if (g.opt("linked") != true) return null
        return (g.opt("email") as? String)?.takeIf { it.isNotBlank() }
    }

    /** Whether Link Google may be offered: the server refuses every account but a citizen-only one. */
    fun canLink(roles: JSONArray?): Boolean {
        if (roles == null || roles.length() == 0) return false
        return (0 until roles.length()).all { roles.opt(it) == "citizen" }
    }

    /** Why a Google sign-in or link did not happen, for a sentence in the person's language. */
    enum class Refusal { CANCELLED, NO_ACCOUNT, PRIVILEGED, IN_USE, UNVERIFIED, PHONE_IN_USE, FAILED }

    /** The server's error code (or a Credential Manager outcome) as a [Refusal]. Unknown codes are FAILED. */
    fun refusal(code: String?): Refusal = when (code) {
        "google_cancelled" -> Refusal.CANCELLED
        "google_no_account" -> Refusal.NO_ACCOUNT
        "privileged_account", "email_signin_account" -> Refusal.PRIVILEGED
        "google_in_use", "other_google_linked" -> Refusal.IN_USE
        "email_unverified" -> Refusal.UNVERIFIED
        "phone_in_use" -> Refusal.PHONE_IN_USE
        else -> Refusal.FAILED
    }

    fun message(r: Refusal): Int = when (r) {
        Refusal.CANCELLED -> R.string.google_err_cancelled
        Refusal.NO_ACCOUNT -> R.string.google_err_no_account
        Refusal.PRIVILEGED -> R.string.google_err_privileged
        Refusal.IN_USE -> R.string.google_err_in_use
        Refusal.UNVERIFIED -> R.string.google_err_unverified
        Refusal.PHONE_IN_USE -> R.string.phone_in_use
        Refusal.FAILED -> R.string.google_err_failed
    }

    /** A Google step that did not complete, carrying why. */
    class Failure(val refusal: Refusal, message: String? = null) : Exception(message ?: refusal.name)

    /**
     * Google's account sheet, for an ID token bound to [nonce] and addressed to
     * [serverClientId] (our WEB client: Android tokens are verified against it,
     * with azp naming the Android client). The "Sign in with Google" option is
     * the button flow: it always shows the sheet, including "add an account".
     */
    private suspend fun idToken(context: Context, serverClientId: String, nonce: String): String {
        val option = GetSignInWithGoogleOption.Builder(serverClientId).setNonce(nonce).build()
        val request = GetCredentialRequest.Builder().addCredentialOption(option).build()
        val credential = try {
            CredentialManager.create(context).getCredential(context, request).credential
        } catch (e: GetCredentialCancellationException) {
            throw Failure(Refusal.CANCELLED, e.message)
        } catch (e: NoCredentialException) {
            throw Failure(Refusal.NO_ACCOUNT, e.message)
        } catch (e: GetCredentialException) {
            throw Failure(Refusal.FAILED, e.message)
        }
        if (credential is CustomCredential && credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
            try {
                return GoogleIdTokenCredential.createFrom(credential.data).idToken
            } catch (e: GoogleIdTokenParsingException) {
                throw Failure(Refusal.FAILED, e.message)
            }
        }
        throw Failure(Refusal.FAILED, "unexpected credential type")
    }

    /** A nonce from the server, for sign-in or (signed in) for linking. */
    private suspend fun serverNonce(purpose: String): String =
        nonce(Api.post("/v1/auth/google/nonce", JSONObject().put("purpose", purpose)))
            ?: throw Failure(Refusal.FAILED, "no nonce")

    /**
     * Sign in. Returns the server's whole answer: `data` is shaped like the
     * phone verify's (tokens, roles, user) and goes to the same session path;
     * `meta.phoneRequired` says whether to ask for a number.
     */
    suspend fun signIn(context: Context, feature: Feature): JSONObject {
        val clientId = feature.serverClientId ?: throw Failure(Refusal.FAILED, "off")
        val nonce = serverNonce("signin")
        val token = idToken(context, clientId, nonce)
        return try {
            Api.post("/v1/auth/google/token", JSONObject().put("idToken", token).put("nonce", nonce))
        } catch (e: ApiException) {
            throw Failure(refusal(e.code), e.message)
        }
    }

    /** Link Google to the signed-in account. Returns the linked address. */
    suspend fun link(context: Context, feature: Feature): String? {
        val clientId = feature.serverClientId ?: throw Failure(Refusal.FAILED, "off")
        val nonce = try { serverNonce("link") } catch (e: ApiException) { throw Failure(refusal(e.code), e.message) }
        val token = idToken(context, clientId, nonce)
        val r = try {
            Api.post("/v1/me/google", JSONObject().put("idToken", token).put("nonce", nonce))
        } catch (e: ApiException) {
            throw Failure(refusal(e.code), e.message)
        }
        return r.optJSONObject("data")?.optString("email")?.takeIf { it.isNotBlank() }
    }
}
