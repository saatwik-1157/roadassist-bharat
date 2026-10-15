package `in`.roadassist.app

import java.io.File
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * "Continue with Google" and "Link Google" (GoogleSignIn.kt), against the
 * shapes the server answers with (app/apps/api/src/routes/google-auth.ts).
 * Credential Manager itself needs a device; everything the app DECIDES is here.
 */
class GoogleSignInTest {

    private val web = "123456789012-webclientabcdefgh.apps.googleusercontent.com"

    private fun health(g: JSONObject?) = JSONObject().put("data", JSONObject()
        .put("status", "ok").apply { if (g != null) put("features", JSONObject().put("googleSignin", g)) })

    @Test
    fun `the button exists only when the server says android is on and names a client id`() {
        val on = GoogleSignIn.feature(health(JSONObject().put("web", true).put("android", true).put("serverClientId", web)))
        assertTrue(on.enabled)
        assertEquals(web, on.serverClientId)
        for (g in listOf(
            JSONObject().put("web", true).put("android", false),                                  // web only
            JSONObject().put("web", true).put("android", "true").put("serverClientId", web),       // a string is not a yes
            JSONObject().put("android", true),                                                     // no client id
            JSONObject().put("android", true).put("serverClientId", "evil.example.com"),           // not a client id
            JSONObject().put("android", true).put("serverClientId", 42),
            null,                                                                                  // an older server
        )) {
            val f = GoogleSignIn.feature(health(g))
            assertFalse(g.toString(), f.enabled)
            assertNull(f.serverClientId)
        }
        assertFalse(GoogleSignIn.feature(null).enabled)
        assertFalse(GoogleSignIn.feature(JSONObject()).enabled)
    }

    @Test
    fun `a nonce is used only in the shape the server issues`() {
        val n = "A".repeat(20) + "b_-" + "9".repeat(20)
        assertEquals(n, GoogleSignIn.nonce(JSONObject().put("data", JSONObject().put("nonce", n))))
        for (bad in listOf("short", n + "x", "A".repeat(42) + "=", "A".repeat(42) + " ", 7)) {
            assertNull(bad.toString(), GoogleSignIn.nonce(JSONObject().put("data", JSONObject().put("nonce", bad))))
        }
        assertNull(GoogleSignIn.nonce(JSONObject()))
        assertNull(GoogleSignIn.nonce(null))
    }

    @Test
    fun `needing a phone is only a real true`() {
        assertTrue(GoogleSignIn.phoneRequired(JSONObject().put("meta", JSONObject().put("phoneRequired", true))))
        assertFalse(GoogleSignIn.phoneRequired(JSONObject().put("meta", JSONObject().put("phoneRequired", false))))
        assertFalse(GoogleSignIn.phoneRequired(JSONObject().put("meta", JSONObject().put("phoneRequired", "true"))))
        assertFalse(GoogleSignIn.phoneRequired(JSONObject()))
        assertFalse(GoogleSignIn.phoneRequired(null))
    }

    @Test
    fun `a JSON null number is no number, not the word null`() {
        assertEquals("+917000001234", GoogleSignIn.msisdnOf(JSONObject().put("msisdn", "+917000001234")))
        // On a phone, org.json's optString turns JSON null into the word "null"
        // (the JVM's org.json used here says ""), which is why the app asks msisdnOf.
        assertNull(GoogleSignIn.msisdnOf(JSONObject().put("msisdn", JSONObject.NULL)))
        assertNull(GoogleSignIn.msisdnOf(JSONObject().put("msisdn", "null")))
        assertNull(GoogleSignIn.msisdnOf(JSONObject().put("msisdn", "")))
        assertNull(GoogleSignIn.msisdnOf(JSONObject()))
        assertNull(GoogleSignIn.msisdnOf(null))
    }

    @Test
    fun `hasPhone and the linked address come from me, and an older server means a phone`() {
        assertFalse(GoogleSignIn.hasPhone(JSONObject().put("hasPhone", false)))
        assertTrue(GoogleSignIn.hasPhone(JSONObject().put("hasPhone", true)))
        assertTrue("before Google sign-in every account had a number", GoogleSignIn.hasPhone(JSONObject()))
        val linked = JSONObject().put("google", JSONObject().put("linked", true).put("email", "asha@example.com"))
        assertEquals("asha@example.com", GoogleSignIn.linkedEmail(linked))
        assertNull(GoogleSignIn.linkedEmail(JSONObject().put("google", JSONObject().put("linked", false).put("email", "x@example.com"))))
        assertNull(GoogleSignIn.linkedEmail(JSONObject().put("google", JSONObject().put("linked", "true").put("email", "x@example.com"))))
        assertNull(GoogleSignIn.linkedEmail(JSONObject()))
    }

    @Test
    fun `Link Google is offered to a citizen-only account, as the server allows`() {
        assertTrue(GoogleSignIn.canLink(JSONArray().put("citizen")))
        for (r in listOf("admin", "mechanic", "gov_officer", "fleet_admin", "support")) {
            assertFalse(r, GoogleSignIn.canLink(JSONArray().put("citizen").put(r)))
        }
        assertFalse(GoogleSignIn.canLink(JSONArray()))
        assertFalse(GoogleSignIn.canLink(null))
    }

    @Test
    fun `server refusals become fixed sentences, and an unknown code is a plain failure`() {
        assertEquals(GoogleSignIn.Refusal.PRIVILEGED, GoogleSignIn.refusal("privileged_account"))
        assertEquals(GoogleSignIn.Refusal.PRIVILEGED, GoogleSignIn.refusal("email_signin_account"))
        assertEquals(GoogleSignIn.Refusal.IN_USE, GoogleSignIn.refusal("google_in_use"))
        assertEquals(GoogleSignIn.Refusal.UNVERIFIED, GoogleSignIn.refusal("email_unverified"))
        assertEquals(GoogleSignIn.Refusal.PHONE_IN_USE, GoogleSignIn.refusal("phone_in_use"))
        for (c in listOf("bad_signature", "nonce_replayed", "anything", "", null)) {
            assertEquals(c.toString(), GoogleSignIn.Refusal.FAILED, GoogleSignIn.refusal(c))
        }
        for (r in GoogleSignIn.Refusal.values()) assertTrue(GoogleSignIn.message(r) != 0)
    }

    @Test
    fun `every Google and phone string exists in all eight languages`() {
        val res = File("src/main/res")
        val keys = listOf("or_divider", "google_continue", "google_link", "google_linked_as", "google_linked",
            "google_err_cancelled", "google_err_no_account", "google_err_failed",
            "google_err_privileged", "google_err_in_use", "google_err_unverified", "phone_add_title",
            "phone_add_why", "phone_later", "phone_added", "phone_verify", "phone_in_use", "account_no_phone")
        for (dir in listOf("values", "values-hi", "values-ta", "values-te", "values-bn", "values-mr", "values-kn", "values-gu")) {
            val xml = File(res, "$dir/strings.xml").readText()
            for (k in keys) assertTrue("$dir has no $k", Regex("<string name=\"$k\"[^>]*>[^<]+</string>").containsMatchIn(xml))
            assertTrue("$dir: the linked address placeholder", Regex("<string name=\"google_linked_as\">[^<]*%1\\\$s").containsMatchIn(xml))
        }
    }

    @Test
    fun `the button carries Google's own G mark, unrecoloured`() {
        val g = File("src/main/res/drawable/ic_google_g.xml").readText()
        for (c in listOf("#EA4335", "#4285F4", "#FBBC05", "#34A853")) assertTrue(c, g.contains(c))
    }
}
