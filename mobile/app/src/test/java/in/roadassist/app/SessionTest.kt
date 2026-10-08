package `in`.roadassist.app

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The stored session and the rules for ending one, pinned off-device.
 *
 * The session used to live in memory only, so a cold start opened on the
 * sign-in screen with no data rung for an SOS; and a transient 5xx on refresh
 * signed the user out locally. Both rules are here.
 */
class SessionTest {

    @Test
    fun `a stored session reads back exactly as written`() {
        val s = StoredSession("AT", "RT", "u-1", "+917000009876", "v-1", "KA01AB1234")
        assertEquals(s, SessionCodec.decode(SessionCodec.encode(s)))
    }

    @Test
    fun `a session with no refresh token is no session at all`() {
        // A half-restored session 401s every call and looks broken, not signed out.
        assertNull(SessionCodec.decode("""{"access":"AT"}"""))
        assertNull(SessionCodec.decode("not json"))
        assertNull(SessionCodec.decode(null))
    }

    @Test
    fun `the encrypted blob round-trips and rejects garbage`() {
        val iv = byteArrayOf(1, 2, 3)
        val ct = byteArrayOf(9, 8, 7, 6)
        val (iv2, ct2) = SessionCodec.unpack(SessionCodec.pack(iv, ct))!!
        assertArrayEquals(iv, iv2)
        assertArrayEquals(ct, ct2)
        assertNull(SessionCodec.unpack("no separator"))
        assertNull(SessionCodec.unpack("%%%:%%%"))
    }

    // ── fix 6: only a rejection ends the session ────────────────────────────

    @Test
    fun `a server error or a rate limit on refresh does not end the session`() {
        for (status in listOf(500, 502, 503, 504, 429, 408)) {
            assertFalse("$status signed the user out", SessionRules.refreshEndsSession(status, null))
        }
    }

    @Test
    fun `a rejected refresh ends the session`() {
        for (status in listOf(400, 401, 403)) {
            assertTrue("$status kept a dead session", SessionRules.refreshEndsSession(status, null))
        }
        // The server's own reasons count whatever status they come with.
        assertTrue(SessionRules.refreshEndsSession(500, "reuse_detected"))
        assertTrue(SessionRules.refreshEndsSession(500, "expired"))
    }

    // ── fix 8: a refresh answer is adopted only into the session that asked ──

    @Test
    fun `a refresh that outlived a sign-out is not adopted`() {
        assertTrue(SessionRules.mayAdopt(3, 3, "RT", "RT"))
        assertFalse("sign-out bumped the generation", SessionRules.mayAdopt(3, 4, "RT", null))
        assertFalse("someone else signed in meanwhile", SessionRules.mayAdopt(3, 3, "RT", "RT-other"))
    }

    // ── fix 1: restore at launch ─────────────────────────────────────────────

    @Test
    fun `offline a stored session is trusted, online it is checked`() {
        val s = StoredSession("AT", "RT")
        assertEquals(SessionRules.Launch.TRUST, SessionRules.atLaunch(s, online = false))
        assertEquals(SessionRules.Launch.VERIFY, SessionRules.atLaunch(s, online = true))
        assertEquals(SessionRules.Launch.SIGNED_OUT, SessionRules.atLaunch(null, online = true))
    }

    @Test
    fun `only the server saying no ends a restored session`() {
        assertTrue(SessionRules.verifyEndsSession(401))
        assertTrue(SessionRules.verifyEndsSession(403))
        assertFalse(SessionRules.verifyEndsSession(503))
        assertFalse(SessionRules.verifyEndsSession(0))
    }
}
