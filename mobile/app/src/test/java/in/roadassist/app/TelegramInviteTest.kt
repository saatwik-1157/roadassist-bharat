package `in`.roadassist.app

import java.io.File
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The contacts card's Telegram invite and the SOS result's Telegram count
 * (TelegramInvite.kt), against the shapes the server answers with.
 */
class TelegramInviteTest {

    private fun list(meta: JSONObject?) = JSONObject().put("data", org.json.JSONArray())
        .apply { if (meta != null) put("meta", meta) }

    @Test
    fun `the invite is offered only when the server says telegram is on`() {
        assertTrue(TelegramInvite.enabled(list(JSONObject().put("telegram", JSONObject().put("enabled", true)))))
        assertFalse(TelegramInvite.enabled(list(JSONObject().put("telegram", JSONObject().put("enabled", false)))))
        assertFalse("an older server says nothing", TelegramInvite.enabled(list(JSONObject())))
        assertFalse(TelegramInvite.enabled(list(null)))
        assertFalse("a string is not a yes", TelegramInvite.enabled(list(JSONObject().put("telegram", JSONObject().put("enabled", "true")))))
        assertFalse(TelegramInvite.enabled(null))
    }

    @Test
    fun `a contact is linked only on a real true`() {
        assertTrue(TelegramInvite.linked(JSONObject().put("telegramLinked", true)))
        assertFalse(TelegramInvite.linked(JSONObject().put("telegramLinked", false)))
        assertFalse(TelegramInvite.linked(JSONObject().put("telegramLinked", "true")))
        assertFalse(TelegramInvite.linked(JSONObject()))
    }

    private fun invite(link: Any?) = JSONObject().put("data", JSONObject().put("link", link ?: JSONObject.NULL))

    @Test
    fun `only a t me start link is shown or copied`() {
        val good = "https://t.me/RoadAssistAlertsBot?start=AbCdEfGhIjKlMnOpQrStUv_-"
        assertEquals(good, TelegramInvite.link(invite(good)))
        for (bad in listOf(
            "http://t.me/RoadAssistAlertsBot?start=AbCdEfGhIjKlMnOpQrStUv_-",     // not https
            "https://t.me.evil.example/x?start=AbCdEfGhIjKlMnOpQrStUv_-",        // look-alike host
            "https://t.me/RoadAssistAlertsBot?start=short",                      // not a code
            "https://t.me/RoadAssistAlertsBot",                                  // no code
            "javascript:alert(1)", "", null,
        )) assertNull(bad.toString(), TelegramInvite.link(invite(bad)))
        assertNull(TelegramInvite.link(JSONObject()))
        assertNull(TelegramInvite.link(null))
    }

    @Test
    fun `the telegram count is the server's, never negative or guessed`() {
        assertEquals(2, TelegramInvite.alerted(JSONObject().put("contactsAlertedTelegram", 2)))
        assertEquals(0, TelegramInvite.alerted(JSONObject().put("contactsAlertedTelegram", -1)))
        assertEquals(0, TelegramInvite.alerted(JSONObject().put("contactsAlertedTelegram", "3")))
        assertEquals("an older server sends nothing", 0, TelegramInvite.alerted(JSONObject()))
        assertEquals(0, TelegramInvite.alerted(null))
    }

    @Test
    fun `every telegram string exists in all eight languages`() {
        val res = File("src/main/res")
        val keys = listOf("tg_invite", "tg_linked", "tg_copy", "tg_copied", "tg_hint", "tg_invite_failed",
            "sos_contacts_telegram")
        for (dir in listOf("values", "values-hi", "values-ta", "values-te", "values-bn", "values-mr", "values-kn", "values-gu")) {
            val xml = File(res, "$dir/strings.xml").readText()
            for (k in keys) assertTrue("$dir has no $k", Regex("<string name=\"$k\"[^>]*>[^<]+</string>").containsMatchIn(xml))
        }
    }
}
