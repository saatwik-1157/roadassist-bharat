package `in`.roadassist.app

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Where a fresh install talks to.
 *
 * The default used to be `http://10.0.2.2:4000`, the emulator's name for the
 * dev machine. On a real handset that is nothing at all, so the app's first
 * screen asked for a phone number and then failed to send it anywhere. The
 * live platform has a valid certificate, so a phone out of the box now signs
 * in against it over HTTPS, and a developer's LAN or emulator server is an
 * explicit, persisted choice (ApiBaseTest covers how those are typed).
 */
class ApiDefaultTest {

    private val original = Api.base

    @After
    fun restore() { Api.base = original }

    @Test
    fun `the default server is the live platform over HTTPS`() {
        assertEquals("https://app.roadassistbharat.online", Api.DEFAULT_BASE)
    }

    @Test
    fun `a fresh process starts on the live platform`() {
        // Every test in this suite that moves Api.base puts it back, so what is
        // here is the initialiser's value: the address a new install uses.
        assertEquals(Api.DEFAULT_BASE, Api.base)
    }

    @Test
    fun `the first request of a fresh install is an HTTPS URL to the live host`() {
        // The same concatenation raw() performs.
        val url = java.net.URL(Api.base + "/v1/auth/otp/request")
        assertEquals("https", url.protocol)
        assertEquals("app.roadassistbharat.online", url.host)
        assertEquals(-1, url.port)
    }

    @Test
    fun `the live host typed without a scheme is reached over HTTPS, not cleartext`() {
        // A bare host is guessed to be http:// because that is right for a
        // laptop on the LAN. For the live host it would send a phone number and
        // a sign-in code over plain HTTP, so it is the default address exactly.
        Api.base = "http://192.168.1.8:4000"
        for (typed in listOf(
            "app.roadassistbharat.online",
            "  app.roadassistbharat.online/  ",
            "APP.RoadAssistBharat.online",
            "http://app.roadassistbharat.online",
            "HTTP://app.roadassistbharat.online/",
            "https://app.roadassistbharat.online",
        )) {
            assertEquals(typed, Api.DEFAULT_BASE, Api.normalizeBase(typed))
        }
    }

    @Test
    fun `switching back to the live platform from a LAN server is a change`() {
        // The Server card enables its switch on isCurrentBase; a developer on a
        // laptop server must be able to go back by typing the live host.
        Api.base = "http://192.168.1.8:4000"
        assertTrue(!Api.isCurrentBase("app.roadassistbharat.online"))
        Api.base = Api.DEFAULT_BASE
        assertTrue(Api.isCurrentBase("app.roadassistbharat.online"))
    }

    @Test
    fun `a look-alike host is not mistaken for the live one`() {
        // Only the exact live host is upgraded. Anything else is somebody's own
        // server and keeps the scheme it was typed with, as before.
        assertEquals("http://app.roadassistbharat.online.example:4000",
            Api.normalizeBase("app.roadassistbharat.online.example:4000"))
        assertEquals("http://192.168.1.8:4000", Api.normalizeBase("192.168.1.8:4000"))
    }
}
