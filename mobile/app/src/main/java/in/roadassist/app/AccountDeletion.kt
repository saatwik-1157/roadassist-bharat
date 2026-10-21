package `in`.roadassist.app

import org.json.JSONObject

/**
 * More -> Account: "Unlink Google" and "Delete my account" (server: DELETE
 * /v1/me/google and POST /v1/me/delete).
 *
 * Deleting removes the account's contacts, Telegram links, Google link,
 * vehicles, devices and profile; SOS history, bookings and payments with
 * mechanics and the audit log are kept but no longer point at the person.
 * The server only lets a plain citizen do it themselves, only with the exact
 * phrase, and only within ten minutes of signing in.
 *
 * The decisions the screen makes about it, pulled out of MainActivity so a JVM
 * test pins them (AccountDeletionTest):
 *  - the phrase is English in every locale and compared exactly, after trim;
 *  - Unlink is offered only on a real boolean true from GET /v1/me;
 *  - selfDelete missing (an older server) is a yes; only a real false hides it;
 *  - "deleted" is only a real true in a 200, or a 401 AUTH_REVOKED on the
 *    delete itself (the sessions were already revoked: it went through);
 *  - every refusal the server names has its own sentence; an unknown one shows
 *    the server's own title.
 */
object AccountDeletion {
    /** Typed by the person to confirm. Never translated: the server compares it byte for byte. */
    const val PHRASE = "DELETE MY ACCOUNT"

    const val DELETE_PATH = "/v1/me/delete"
    const val GOOGLE_PATH = "/v1/me/google"

    /** The Delete button is enabled only for the exact phrase, spaces around it forgiven. */
    fun phraseMatches(typed: String?): Boolean = typed?.trim() == PHRASE

    /** POST /v1/me/delete's body. */
    fun body(): JSONObject = JSONObject().put("confirm", PHRASE)

    /** GET /v1/me → google.linked, strictly: Unlink Google is shown only then. */
    fun showUnlink(me: JSONObject?): Boolean = me?.optJSONObject("google")?.opt("linked") == true

    /** GET /v1/me → selfDelete. Absent (an older server) is true; only a real false hides Delete. */
    fun selfDelete(me: JSONObject?): Boolean = me?.opt("selfDelete") != false

    /** A 200 from POST /v1/me/delete that says it was done. */
    fun deleted(response: JSONObject?): Boolean = response?.optJSONObject("data")?.opt("deleted") == true

    /** What came back from the delete, as the screen has to act on it. */
    enum class Outcome { DELETED, PHRASE_WRONG, REAUTH, BY_REQUEST, ACTIVE_BOOKING, ACTIVE_SOS, OTHER }

    /** A refused delete: the HTTP status and error.code. */
    fun outcome(status: Int, code: String?): Outcome = when {
        // The delete revoked every session; a retry (or a lost answer
        // replayed) meets a token that is already signed out.
        status == 401 && code == "AUTH_REVOKED" -> Outcome.DELETED
        code == "confirmation_required" -> Outcome.PHRASE_WRONG
        code == "reauth_required" -> Outcome.REAUTH
        code == "privileged_account" || code == "email_signin_account" -> Outcome.BY_REQUEST
        code == "active_booking" -> Outcome.ACTIVE_BOOKING
        code == "active_sos" -> Outcome.ACTIVE_SOS
        else -> Outcome.OTHER
    }

    /** The sentence for an outcome; null for OTHER, which shows the server's title. */
    fun message(o: Outcome): Int? = when (o) {
        Outcome.DELETED -> R.string.account_deleted
        Outcome.PHRASE_WRONG -> R.string.account_delete_phrase_wrong
        Outcome.REAUTH -> R.string.account_delete_reauth
        Outcome.BY_REQUEST -> R.string.account_delete_by_request
        Outcome.ACTIVE_BOOKING -> R.string.account_delete_active_booking
        Outcome.ACTIVE_SOS -> R.string.account_delete_active_sos
        Outcome.OTHER -> null
    }

    /** REAUTH is answered by signing out and in again: the dialog offers Sign out. */
    fun offersSignOut(o: Outcome): Boolean = o == Outcome.REAUTH

    /** BY_REQUEST points at the Privacy policy, where the contact is. */
    fun offersPrivacy(o: Outcome): Boolean = o == Outcome.BY_REQUEST

    /** A refused unlink's sentence; null shows the server's title. */
    fun unlinkMessage(code: String?): Int? = when (code) {
        "phone_required" -> R.string.google_unlink_phone_required
        else -> null
    }
}
