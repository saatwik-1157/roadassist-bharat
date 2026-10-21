package `in`.roadassist.app

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The `lang` sent with an SOS confirm and a Telegram invite (AlertLanguage.kt):
 * always one of the eight the server accepts, and the one on screen.
 */
class AlertLanguageTest {

    @Test
    fun `a locale maps to its language when the app has it`() {
        assertEquals("hi", AlertLanguage.code("hi-IN"))
        assertEquals("hi", AlertLanguage.code("hi"))
        assertEquals("ta", AlertLanguage.code("ta_IN"))
        assertEquals("te", AlertLanguage.code("te-IN"))
        assertEquals("bn", AlertLanguage.code("bn-BD"))
        assertEquals("mr", AlertLanguage.code("mr-IN"))
        assertEquals("kn", AlertLanguage.code("kn-IN"))
        assertEquals("gu", AlertLanguage.code("GU-in"))
        assertEquals("en", AlertLanguage.code("en-GB"))
        assertEquals("hi", AlertLanguage.code("hi-Latn-IN"))
    }

    @Test
    fun `anything else is english, which is what the screen shows then`() {
        for (other in listOf("fr", "fr-FR", "ur-IN", "pa-IN", "ml-IN", "", "  ", "und", "x", "hindi", null)) {
            assertEquals(other.toString(), "en", AlertLanguage.code(other))
        }
    }

    @Test
    fun `the body is one lang field the server accepts`() {
        assertEquals("""{"lang":"hi"}""", AlertLanguage.body("hi").toString())
        assertEquals("a stray code is never sent as it is", """{"lang":"en"}""", AlertLanguage.body("fr").toString())
    }

    @Test
    fun `the eight codes are exactly the app's eight locales`() {
        val res = File("src/main/res")
        val locales = res.listFiles()!!.map { it.name }.filter { Regex("^values-[a-z]{2}$").matches(it) }
            .map { it.removePrefix("values-") }.toSet()
        assertEquals(AlertLanguage.CODES.toSet() - "en", locales)
        assertEquals(8, AlertLanguage.CODES.size)
    }
}
