package `in`.roadassist.app

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The API address, as a person actually types it.
 *
 * The platform is meant to run anywhere: the emulator alias the field defaults
 * to is worthless on a real handset, so whoever is holding the phone reads an
 * address off the server's boot banner and types it in. That banner prints
 * "http://192.168.1.8:4000", but what gets typed is "192.168.1.8:4000" — and
 * `URL()` throws MalformedURLException on a string with no scheme, which the
 * client can only report as "Failed".
 *
 * Each case below is a thing somebody types, not a branch of the function.
 */
class ApiBaseTest {

    @Test
    fun `a LAN address typed without a scheme still reaches the server`() {
        assertEquals("http://192.168.1.8:4000", Api.normalizeBase("192.168.1.8:4000"))
    }

    @Test
    fun `a full URL is left exactly as it is`() {
        assertEquals("http://192.168.1.8:4000", Api.normalizeBase("http://192.168.1.8:4000"))
    }

    @Test
    fun `https is not downgraded`() {
        assertEquals("https://api.example.in", Api.normalizeBase("https://api.example.in"))
    }

    @Test
    fun `a scheme typed in capitals is still a scheme`() {
        assertEquals("HTTP://192.168.1.8:4000", Api.normalizeBase("HTTP://192.168.1.8:4000"))
    }

    @Test
    fun `surrounding space from a phone keyboard is dropped`() {
        assertEquals("http://192.168.1.8:4000", Api.normalizeBase("  192.168.1.8:4000  "))
    }

    @Test
    fun `a trailing slash does not become a double slash in every path`() {
        assertEquals("http://192.168.1.8:4000", Api.normalizeBase("http://192.168.1.8:4000/"))
    }

    @Test
    fun `a hostname with no port is a valid address`() {
        assertEquals("http://roadassist.local", Api.normalizeBase("roadassist.local"))
    }

    // ── refusals: keep the address that works rather than build a broken one ──

    @Test
    fun `an empty field keeps the address already in use`() {
        val before = Api.base
        assertEquals(before, Api.normalizeBase("   "))
    }

    @Test
    fun `a scheme and nothing else is not an address`() {
        val before = Api.base
        assertEquals(before, Api.normalizeBase("http://"))
    }
}
