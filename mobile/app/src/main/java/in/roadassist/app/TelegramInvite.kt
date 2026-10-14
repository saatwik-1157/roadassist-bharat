package `in`.roadassist.app

import org.json.JSONObject

/**
 * Telegram invites for emergency contacts (server: app/apps/api/src/routes/telegram.ts).
 *
 * The server makes a one-time link, t.me/<bot>?start=<code>, that the user
 * sends to a contact; when the contact presses Start in Telegram, every SOS
 * the user confirms also messages them there, free. These are the decisions
 * the contacts card and the SOS result make about it, pulled out of
 * MainActivity so a JVM test can pin them:
 *
 *  - the invite button exists only when the server says Telegram is on;
 *  - "linked" is only a real boolean true from the server, never a string;
 *  - the only link the app will show or copy is a t.me start link — nothing
 *    else a server sends in that field is handed on to the user's contact;
 *  - a Telegram count is only what the server counted, never negative.
 */
object TelegramInvite {
    private val LINK = Regex("^https://t\\.me/[A-Za-z][A-Za-z0-9_]{3,31}\\?start=[A-Za-z0-9_-]{24,64}$")

    /** GET /v1/me/emergency-contacts → meta.telegram.enabled. Absent (an older server) is off. */
    fun enabled(listResponse: JSONObject?): Boolean =
        listResponse?.optJSONObject("meta")?.optJSONObject("telegram")?.opt("enabled") == true

    /** A contact row's telegramLinked, strictly. */
    fun linked(contact: JSONObject): Boolean = contact.opt("telegramLinked") == true

    /** POST …/telegram-invite → data.link, if it is a t.me start link and nothing else. */
    fun link(inviteResponse: JSONObject?): String? =
        inviteResponse?.optJSONObject("data")?.optString("link", "")?.takeIf { LINK.matches(it) }

    /** contactsAlertedTelegram from a confirm answer: a whole count of 0 or more. */
    fun alerted(confirm: JSONObject?): Int =
        ((confirm?.opt("contactsAlertedTelegram") as? Number)?.toInt() ?: 0).coerceAtLeast(0)
}
