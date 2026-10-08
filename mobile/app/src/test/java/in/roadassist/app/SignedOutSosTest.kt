package `in`.roadassist.app

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * After a cold start, a process death or a sign-out, the app opens on the
 * sign-in screen. That screen had no SOS control and no emergency numbers, so
 * with no network there was no way to raise an SOS at all. It now shows the
 * same SosPanel as Home (signed out: no data rung) and the numbers card.
 *
 * Composables do not run on the JVM, so this pins the wiring in the source;
 * the ladder decisions it relies on are pinned in SosLadderTest.
 */
class SignedOutSosTest {

    private val src = File("src/main/java/in/roadassist/app/MainActivity.kt").readText()
    private val signIn = src.substringAfter("private fun SignInScreen(").substringBefore("// ── home: SOS + vehicle")

    @Test
    fun `the sign-in screen carries the sos control, signed out`() {
        assertTrue("no SOS on the signed-out screen", "SosPanel(hasSession = false" in signIn)
    }

    @Test
    fun `the sign-in screen carries the emergency numbers`() {
        assertTrue("no 112 card on the signed-out screen", "EmergencyNumbersCard()" in signIn)
    }

    @Test
    fun `a restored session starts the app signed in`() {
        assertTrue("signedIn ignores a restored session",
            "var signedIn by rememberSaveable { mutableStateOf(Api.hasSession()) }" in src)
        assertTrue("onCreate does not restore the stored session", "SessionStore.load(app)?.let { Api.restoreSession(it) }" in src)
    }
}
