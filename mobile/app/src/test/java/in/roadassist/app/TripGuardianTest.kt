package `in`.roadassist.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What the app is allowed to claim about the map it holds offline.
 *
 * Two pure pieces of Trip Guardian, separated from the Context and the network
 * so they can be pinned off-device — the same split [SosLadder] and [SosQueue]
 * use. Both existed as bugs before they existed as functions.
 */
class TripGuardianTest {

    /* ── naming ────────────────────────────────────────────────────────────── */

    @Test
    fun `two different tiles never share a filename`() {
        // The original derivation deleted every non-alphanumeric character, so
        // /tiles/13/102/34.png and /tiles/13/10/234.png both became
        // "tiles1310234png" — one tile silently overwriting the other, and the
        // offline map drawing the wrong square.
        val a = TripGuardian.tileName("/tiles/13/102/34.png")
        val b = TripGuardian.tileName("/tiles/13/10/234.png")
        assertFalse("two distinct tiles collided on $a", a == b)
    }

    @Test
    fun `every tile along a realistic route gets a distinct filename`() {
        // z13 over India: x and y are both four digits, which is why the
        // collision above never fired in production. Pin the whole neighbourhood
        // anyway, since the zoom level is a constant somebody may change.
        val urls = mutableListOf<String>()
        for (x in 5640..5645) for (y in 3186..3191) urls.add("/tiles/13/$x/$y.png")
        val names = urls.map { TripGuardian.tileName(it) }
        assertEquals("distinct tiles produced duplicate filenames", urls.size, names.toSet().size)
    }

    @Test
    fun `a filename carries no path separator`() {
        val name = TripGuardian.tileName("/tiles/13/5643/3189.png")
        assertFalse("a separator would escape the tile directory", name.contains('/'))
        assertFalse(name.contains('\\'))
        assertTrue(name.endsWith(".png"))
    }

    @Test
    fun `the same url always names the same file`() {
        val url = "/tiles/13/5643/3189.png"
        assertEquals(TripGuardian.tileName(url), TripGuardian.tileName(url))
    }

    /* ── counting ──────────────────────────────────────────────────────────── */

    @Test
    fun `only this route's tiles count towards this route`() {
        // `cachedSummary` used to count every file in the tile directory — every
        // tile ever downloaded for any route. After a second trip the app said
        // "240/120 map tiles on this device · shows offline", which is not a
        // number, it is an overclaim about what will work when the signal goes.
        val route = listOf("/tiles/13/5643/3189.png", "/tiles/13/5643/3190.png")
        val leftOverFromAnEarlierTrip = TripGuardian.tileName("/tiles/13/1111/2222.png")

        val onDisk = setOf(
            TripGuardian.tileName(route[0]),
            leftOverFromAnEarlierTrip,
        )

        assertEquals(
            "a tile from another route was counted as covering this one",
            1, TripGuardian.cachedCount(route, onDisk::contains),
        )
    }

    @Test
    fun `a route with nothing downloaded counts zero`() {
        val route = listOf("/tiles/13/5643/3189.png", "/tiles/13/5643/3190.png")
        assertEquals(0, TripGuardian.cachedCount(route) { false })
    }

    @Test
    fun `a fully downloaded route counts every tile exactly once`() {
        val route = listOf(
            "/tiles/13/5643/3189.png", "/tiles/13/5643/3190.png", "/tiles/13/5644/3189.png",
        )
        assertEquals(route.size, TripGuardian.cachedCount(route) { true })
    }
}
