package `in`.roadassist.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The live map's JavaScript bridges hand out the user's access token. They
 * must answer the configured server's own page and nothing else, and only
 * that origin may be granted the device's location.
 */
class MapWebGuardTest {

    private val live = Api.DEFAULT_BASE
    private val dev = "http://10.0.2.2:4000"

    @Test
    fun `the map page on the configured server gets the token`() {
        assertEquals("tok", MapWebGuard.bridgeToken(live, "$live/map.html#theme=dark", "tok"))
        assertEquals("tok", MapWebGuard.bridgeToken(dev, "$dev/map.html", "tok"))
    }

    @Test
    fun `any other page gets an empty token`() {
        assertEquals("", MapWebGuard.bridgeToken(live, "https://evil.example/map.html", "tok"))
        assertEquals("", MapWebGuard.bridgeToken(live, "https://app.roadassistbharat.online.evil.example/", "tok"))
        assertEquals("", MapWebGuard.bridgeToken(live, "http://app.roadassistbharat.online/map.html", "tok"))
        assertEquals("", MapWebGuard.bridgeToken(dev, "http://10.0.2.2:4001/map.html", "tok"))
    }

    @Test
    fun `no page yet, or an unparseable one, gets nothing`() {
        assertEquals("", MapWebGuard.bridgeToken(live, null, "tok"))
        assertEquals("", MapWebGuard.bridgeToken(live, "about:blank", "tok"))
        assertEquals("", MapWebGuard.bridgeToken(live, "file:///android_asset/map.html", "tok"))
        assertEquals("", MapWebGuard.bridgeToken(live, "data:text/html,<p>x", "tok"))
        assertFalse(MapWebGuard.bridgeAllowed(live, null))
    }

    @Test
    fun `refresh and booking follow the same rule as the token`() {
        assertTrue(MapWebGuard.bridgeAllowed(live, "$live/map.html"))
        assertFalse(MapWebGuard.bridgeAllowed(live, "https://evil.example/"))
    }

    @Test
    fun `location is granted only to the configured origin`() {
        assertTrue(MapWebGuard.mayUseLocation(live, "https://app.roadassistbharat.online/"))
        assertTrue(MapWebGuard.mayUseLocation(live, "https://app.roadassistbharat.online"))
        assertTrue(MapWebGuard.mayUseLocation(dev, "http://10.0.2.2:4000/"))
        assertFalse(MapWebGuard.mayUseLocation(live, "https://tile.openstreetmap.org/"))
        assertFalse(MapWebGuard.mayUseLocation(live, null))
        assertFalse(MapWebGuard.mayUseLocation(live, ""))
    }

    @Test
    fun `a trailing slash on the base changes nothing`() {
        assertTrue(MapWebGuard.sameOrigin("$live/", "$live/map.html"))
    }
}
