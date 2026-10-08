package `in`.roadassist.app

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The SOS text says what the ladder does, in every language.
 *
 * The grace dialog, the result lines, the "SOS via DATA" toast, the hazard
 * dialog and Track's empty state were hardcoded English in MainActivity.kt,
 * and partly untrue: the dialog promised that contacts are texted on every
 * build, and the offline note named a placeholder SMS number. This reads the
 * real resources and the real source.
 */
class SosStringsTest {

    private val res = File("src/main/res")
    private val locales = listOf("values", "values-hi", "values-ta", "values-te", "values-bn",
        "values-mr", "values-kn", "values-gu")

    private fun strings(dir: String): Map<String, String> {
        val xml = File(res, "$dir/strings.xml").readText()
        return Regex("<string name=\"([^\"]+)\"[^>]*>(.*?)</string>", RegexOption.DOT_MATCHES_ALL)
            .findAll(xml).associate { it.groupValues[1] to it.groupValues[2] }
    }

    private fun name(id: Int): String =
        R.string::class.java.fields.first { it.getInt(null) == id }.name

    @Test
    fun `every new sos string exists in all eight languages`() {
        val keys = SosLadder.graceParts(true, true).map(::name) +
            SosLadder.graceParts(false, true).map(::name) +
            listOf("sos_dialer_notified", "sos_offline_note_sms", "sos_toast_data", "sos_escalated",
                "sos_signed_out_note", "toast_session_lost", "action_submit_report", "rescues_empty_title")
        for (dir in locales) {
            val s = strings(dir)
            for (k in keys) assertTrue("$dir has no $k", !s[k].isNullOrBlank())
        }
    }

    @Test
    fun `with the sms rung off nothing on the sos path mentions sms`() {
        val en = strings("values")
        for (session in listOf(true, false)) {
            for (id in SosLadder.graceParts(session, smsEnabled = false)) {
                assertFalse("${name(id)} claims SMS", "SMS" in en.getValue(name(id)))
            }
        }
        assertFalse("the offline note names SMS", "SMS" in en.getValue("sos_offline_note"))
        assertFalse("a placeholder number is still shown", "9999900000" in File(res, "values/strings.xml").readText())
    }

    @Test
    fun `the queue strings no longer promise a send the moment signal returns`() {
        val en = strings("values")
        for (k in listOf("sos_dialer", "sos_queued", "sos_offline_note")) {
            assertTrue("$k must say a session is needed", "signed in" in en.getValue(k))
        }
    }

    @Test
    fun `the sos and hazard text is no longer hardcoded`() {
        val src = File("src/main/java/in/roadassist/app/MainActivity.kt").readText()
        for (literal in listOf("\"SOS via ", "At zero, RoadAssist texts", "\"Submit report\"",
                "\"Reporting…\"", "\"No rescues yet\"", "\"Escalated (", "✓ NO DATA → SMS",
                "\"Hazard reported at your location")) {
            assertFalse("still hardcoded: $literal", literal in src)
        }
    }
}
