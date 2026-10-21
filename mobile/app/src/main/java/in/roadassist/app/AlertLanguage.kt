package `in`.roadassist.app

import android.content.Context
import java.util.Locale
import org.json.JSONObject

/**
 * The language Telegram alerts go out in: the one this app is showing.
 *
 * The server accepts `lang` (one of the eight below) on POST /v1/sos/:id/confirm,
 * so a contact's alert reads in the language of the person who raised it, and
 * on POST /v1/me/emergency-contacts/:id/telegram-invite, where the bot keeps
 * it for its replies. A server from before `lang` ignores the body.
 *
 * The app has no language setting of its own: Android picks res/values-xx
 * from the phone's language list. On API 24+ the Resources' configuration
 * carries the locale it actually resolved FIRST (a list of [fr, hi] resolves
 * to hi, with English assumed supported), so its first locale is the language
 * on screen. Anything outside the eight is English, which is what the screen
 * falls back to as well.
 */
object AlertLanguage {
    /** The eight the app and the server both have. English first: the fallback. */
    val CODES = listOf("en", "hi", "ta", "te", "bn", "mr", "kn", "gu")

    /** A BCP 47 tag ("hi-IN") or a Java locale string ("ta_IN") as one of [CODES]; anything else is "en". */
    fun code(tag: String?): String {
        val lang = tag?.trim()?.split('-', '_')?.firstOrNull()?.lowercase(Locale.ROOT).orEmpty()
        return if (lang in CODES) lang else "en"
    }

    /** The language the UI is showing right now. */
    fun current(ctx: Context): String =
        code(ctx.resources.configuration.locales.takeIf { !it.isEmpty }?.get(0)?.toLanguageTag())

    /** `{"lang": code}`, for the two requests above. */
    fun body(code: String): JSONObject = JSONObject().put("lang", code(code))
}
