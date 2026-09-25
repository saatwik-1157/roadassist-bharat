package `in`.roadassist.app

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
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

    // Api is an object, so `base` outlives a test method. The cases below set
    // it deliberately; putting it back keeps them from reaching whatever runs
    // next in the same JVM.
    private val original = Api.base

    @After
    fun restore() { Api.base = original }

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

    // ── is this a change at all? ─────────────────────────────────────────────
    // The settings card offers a switch that SIGNS THE USER OUT, and it is
    // enabled by isCurrentBase. Getting this wrong is not cosmetic: a button
    // that looks live for an address already in use ends a session for nothing,
    // and on this app that can mean ending it while a rescue is being tracked.

    @Test
    fun `the address already in use is not a change`() {
        Api.base = "http://192.168.1.8:4000"
        assertTrue(Api.isCurrentBase("http://192.168.1.8:4000"))
    }

    @Test
    fun `the same address typed the way a person types it is not a change`() {
        Api.base = "http://192.168.1.8:4000"
        // No scheme, a trailing slash and stray spaces all normalise to the
        // address already in use — none of them should offer a sign-out.
        assertTrue(Api.isCurrentBase("192.168.1.8:4000"))
        assertTrue(Api.isCurrentBase("http://192.168.1.8:4000/"))
        assertTrue(Api.isCurrentBase("  192.168.1.8:4000  "))
    }

    @Test
    fun `a different server is a change`() {
        Api.base = "http://192.168.1.8:4000"
        assertFalse(Api.isCurrentBase("192.168.1.9:4000"))
        assertFalse(Api.isCurrentBase("192.168.1.8:4001"))
        assertFalse(Api.isCurrentBase("https://api.example.in"))
    }

    @Test
    fun `an unusable field is not a change, because it keeps the current address`() {
        Api.base = "http://192.168.1.8:4000"
        // normalizeBase answers these with the address in use, so the switch
        // stays disabled rather than signing somebody out to go nowhere.
        assertTrue(Api.isCurrentBase("   "))
        assertTrue(Api.isCurrentBase("http://"))
    }
    // ── any address, anywhere ────────────────────────────────────────────
    // The product claim is that this runs anywhere: an emulator, a laptop on
    // college Wi-Fi, a phone hotspot, a tunnel. That rests on a string a person
    // types becoming a URL the platform can actually open, so it is pinned
    // here as a table rather than argued about — each row is an address
    // somebody is realistically handed, and the whole URL the client builds
    // from it, including the path append that raw() does.

    @Test
    fun `every address a person can be handed becomes a URL the client can open`() {
        val cases = listOf(
            // home and college LAN, which is the ordinary case
            "192.168.1.8:4000" to "http://192.168.1.8:4000/v1/ping",
            // the emulator alias: a developer's own API, no longer the default
            // (see ApiDefaultTest)
            "10.0.2.2:4000" to "http://10.0.2.2:4000/v1/ping",
            // the other private ranges — 172.16/12 is common behind campus NAT
            "172.16.0.5:4000" to "http://172.16.0.5:4000/v1/ping",
            // carrier-grade NAT, which is what a tethered phone often sits behind
            "100.64.0.1:4000" to "http://100.64.0.1:4000/v1/ping",
            // the gateway an Android hotspot hands out
            "192.168.43.1:4000" to "http://192.168.43.1:4000/v1/ping",
            // no port: port 80, which is a deployment, not a mistake
            "192.168.1.8" to "http://192.168.1.8/v1/ping",
            // what a phone keyboard adds around it
            "  192.168.1.8:4000/  " to "http://192.168.1.8:4000/v1/ping",
            // autocapitalised scheme
            "HTTP://192.168.1.8:4000" to "http://192.168.1.8:4000/v1/ping",
            // mDNS name rather than an address
            "roadassist.local:4000" to "http://roadassist.local:4000/v1/ping",
            // a real deployment, and a demo tunnel
            "https://api.example.in" to "https://api.example.in/v1/ping",
            "https://demo.trycloudflare.com" to "https://demo.trycloudflare.com/v1/ping",
            // IPv6, which the URL spec requires in brackets — see the test below
            "[::1]:4000" to "http://[::1]:4000/v1/ping",
            "[2405:201:a:1::5]:4000" to "http://[2405:201:a:1::5]:4000/v1/ping",
        )
        for ((typed, expected) in cases) {
            // The same concatenation raw() performs, so this is the URL that is
            // really opened rather than an approximation of it.
            val built = java.net.URL(Api.normalizeBase(typed) + "/v1/ping").toString()
            assertEquals(typed, expected, built)
        }
    }

    @Test
    fun `a bare IPv6 address is refused rather than silently misread`() {
        // "2405:201:a:1::5:4000" cannot be resolved by anything: the trailing
        // ":4000" is either a port or the last group of the address, and only
        // brackets say which. That is why the URL spec requires them, and why
        // guessing here would be worse than declining — a wrong guess points an
        // emergency at the wrong host. Java throws, the client catches, and the
        // settings card reports that nothing answered.
        for (bare in listOf("::1", "2405:201:a:1::5", "2405:201:a:1::5:4000")) {
            var threw = false
            try { java.net.URL(Api.normalizeBase(bare) + "/v1/ping") }
            catch (_: java.net.MalformedURLException) { threw = true }
            assertTrue(bare, threw)
        }
    }
}
