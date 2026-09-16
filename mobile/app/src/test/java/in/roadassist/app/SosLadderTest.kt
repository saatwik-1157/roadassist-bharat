package `in`.roadassist.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The SOS ladder, pinned.
 *
 * This is the first test in the Android client, and it is here rather than
 * somewhere easier because `Emergency.raise` decides whether a person in trouble
 * is reached. Non-negotiable #1 says emergency paths never regress; until now
 * nothing could detect a regression in this one.
 *
 * Every case below is phrased as the situation it represents, not as the
 * function it calls — a failure should read like a description of what just
 * broke for a real person.
 */
class SosLadderTest {

    // ── the SMS body: a contract with POST /v1/telecom/sms ──────────────────

    @Test
    fun `the sms body starts with the verb the server routes on`() {
        // The endpoint lowercases, splits on whitespace and switches on word 0.
        // Anything else and the SMS sends successfully and nothing ever arrives.
        val words = SosLadder.smsBody(12.971599, 77.594566).lowercase().trim().split(Regex("\\s+"))
        assertEquals("sos", words[0])
    }

    @Test
    fun `the sms body carries the fix as the next two words`() {
        val words = SosLadder.smsBody(12.971599, 77.594566).lowercase().trim().split(Regex("\\s+"))
        assertEquals("12.971599", words[1])
        assertEquals("77.594566", words[2])
    }

    @Test
    fun `negative coordinates survive the body`() {
        val words = SosLadder.smsBody(-33.8688, -151.2093).split(Regex("\\s+"))
        assertEquals("-33.8688", words[1])
        assertEquals("-151.2093", words[2])
    }

    @Test
    fun `the body fits the 160 character limit the endpoint enforces`() {
        // `text: z.string().max(160)`. Full double precision is the worst case:
        // a longer body is rejected outright and the SOS is lost.
        val worst = SosLadder.smsBody(12.971598765432109, 77.59456789012345)
        assertTrue("body was ${worst.length} chars: $worst", worst.length <= 160)
    }

    // ── rung 1: data ────────────────────────────────────────────────────────

    @Test
    fun `the data rung settles it only when the api actually answered`() {
        assertTrue(SosLadder.dataSettledIt(hasData = true, apiSucceeded = true))
    }

    @Test
    fun `a captive portal does not count as having reached anyone`() {
        // The dhaba wifi that needs a login, the airport network, the hotel
        // splash page: the OS reports validated internet and the API is
        // unreachable. Stopping here would report success and send nothing.
        assertFalse(SosLadder.dataSettledIt(hasData = true, apiSucceeded = false))
    }

    @Test
    fun `no data means the data rung settles nothing`() {
        assertFalse(SosLadder.dataSettledIt(hasData = false, apiSucceeded = false))
    }

    // ── rung 2: sms ─────────────────────────────────────────────────────────

    @Test
    fun `sms is skipped when the data rung already handled it`() {
        // Otherwise the user is billed for a message nobody reads, and the
        // webhook raises a second incident for the same emergency.
        assertFalse(SosLadder.shouldTrySms(dataSettledIt = true, hasSmsPermission = true))
    }

    @Test
    fun `sms is skipped without the permission, because the send would throw`() {
        assertFalse(SosLadder.shouldTrySms(dataSettledIt = false, hasSmsPermission = false))
    }

    @Test
    fun `sms is attempted when data failed and the permission is granted`() {
        assertTrue(SosLadder.shouldTrySms(dataSettledIt = false, hasSmsPermission = true))
    }

    @Test
    fun `a confirmed sms settles the report and must NOT also queue`() {
        // The telecom webhook raises the incident from the SMS. Queueing an API
        // replay as well means two incidents for one emergency: two responders
        // dispatched, the family alerted twice.
        val v = SosLadder.afterSms(SosLadder.SmsOutcome.SENT)
        assertTrue("a sent SMS owns the report", v.settles)
        assertFalse("queueing as well would duplicate the incident", v.queueBackup)
    }

    @Test
    fun `an unconfirmed sms settles the report AND queues a backup`() {
        // The send did not fail and nothing confirmed it. Here the asymmetry
        // flips: a duplicate incident is an annoyance, an emergency nobody hears
        // is the failure this product exists to prevent.
        val v = SosLadder.afterSms(SosLadder.SmsOutcome.UNCONFIRMED)
        assertTrue(v.settles)
        assertTrue("silence must never be mistaken for delivery", v.queueBackup)
    }

    @Test
    fun `a failed sms owns nothing and does not queue - the dialer rung does that`() {
        val v = SosLadder.afterSms(SosLadder.SmsOutcome.FAILED)
        assertFalse("nothing was transmitted", v.settles)
        assertFalse("the dialer rung queues; doing it here would double-queue", v.queueBackup)
    }

    @Test
    fun `every sms outcome is handled - no silent fallthrough`() {
        // If someone adds a fourth outcome, `when` stops being exhaustive and
        // this fails rather than the ladder quietly taking a default branch.
        for (outcome in SosLadder.SmsOutcome.entries) {
            val v = SosLadder.afterSms(outcome)
            // A rung that does not settle must not claim a backup either.
            if (!v.settles) assertFalse("$outcome settles nothing but queues", v.queueBackup)
        }
        assertEquals(3, SosLadder.SmsOutcome.entries.size)
    }

    // ── rungs 3 and 4: dialer, then the queue ───────────────────────────────

    @Test
    fun `a dialer that opens reports the dialer rung`() {
        assertEquals(SosLadder.Rung.DIALER, SosLadder.afterDialer(opened = true))
    }

    @Test
    fun `a device with no dialer falls to the queue rather than failing`() {
        // A tablet with no telephony, or a locked-down device. The SOS is
        // already stored locally by this point, so the honest answer is QUEUED,
        // never an error the person has to interpret while in trouble.
        assertEquals(SosLadder.Rung.QUEUED, SosLadder.afterDialer(opened = false))
    }

    // ── the ladder as a whole ───────────────────────────────────────────────

    @Test
    fun `exactly one channel ever owns the report`() {
        // The invariant behind every rule above: no combination of outcomes may
        // produce two live reports of one emergency. SENT is the only outcome
        // that both settles and declines a backup; UNCONFIRMED deliberately
        // accepts the rare double, and nothing else settles at all.
        val settling = SosLadder.SmsOutcome.entries.filter { SosLadder.afterSms(it).settles }
        assertEquals(
            listOf(SosLadder.SmsOutcome.SENT, SosLadder.SmsOutcome.UNCONFIRMED),
            settling,
        )
        val duplicating = settling.filter { SosLadder.afterSms(it).queueBackup }
        assertEquals(
            "only an UNCONFIRMED send may risk a duplicate",
            listOf(SosLadder.SmsOutcome.UNCONFIRMED),
            duplicating,
        )
    }

    @Test
    fun `the ladder descends in order and never skips a rung`() {
        // DATA -> SMS -> DIALER -> QUEUED, as declared. The order is the design:
        // each rung is cheaper in connectivity than the one before it.
        assertEquals(
            listOf(
                SosLadder.Rung.DATA,
                SosLadder.Rung.SMS,
                SosLadder.Rung.DIALER,
                SosLadder.Rung.QUEUED,
            ),
            SosLadder.Rung.entries.toList(),
        )
    }
    /* ── the client reference: the only thing between a replay and a second
          ambulance ────────────────────────────────────────────────────────── */

    @Test
    fun `a client reference matches exactly what POST v1 sos accepts`() {
        // The same expression apps/api/src/routes/emergency.ts validates with.
        // If one moves, this fails — which is the point of writing it out.
        val serverPattern = Regex("^RA-[ABCDEFGHJKMNPQRSTVWXYZ23456789]{6}$")
        repeat(500) {
            val ref = SosLadder.newIncidentRef()
            assertTrue("server would reject $ref", serverPattern.matches(ref))
        }
    }

    @Test
    fun `a client reference avoids the glyphs that misread on a cracked screen`() {
        // This id may be read aloud over a borrowed phone or a police radio.
        repeat(500) {
            val body = SosLadder.newIncidentRef().substring(3)
            assertTrue("0/1/I/L/O/U are misread: $body", !body.any { it in "01ILOU" })
        }
    }

    @Test
    fun `client references carry the entropy their length claims`() {
        // Two assertions, one property: the keyspace is 30^6 as the reference
        // length claims, and every letter is equally likely to fill it.
        //
        // Uniqueness itself is the server's unique index to guarantee, so this
        // deliberately does NOT assert zero collisions — at 30^6 that is the
        // birthday paradox and would fail honestly about 1 run in 60.
        val alphabet = "ABCDEFGHJKMNPQRSTVWXYZ23456789"
        val draws = 10000
        val seen = HashSet<String>()
        val counts = HashMap<Char, Int>()
        repeat(draws) {
            val ref = SosLadder.newIncidentRef()
            seen.add(ref)
            for (ch in ref.substring(3)) counts[ch] = (counts[ch] ?: 0) + 1
        }

        // A broken alphabet or a byte source stuck near zero collides hundreds
        // of times here, not a dozen. Expected is about 0.07.
        val collisions = draws - seen.size
        assertTrue("$collisions collisions in $draws draws — keyspace is not 30^6", collisions <= 12)

        // `byte % 30` would make the first 16 letters 12.5% likelier, far
        // outside sampling noise over 60,000 characters.
        val expected = (draws * 6).toDouble() / alphabet.length
        for (ch in alphabet) {
            val n = counts[ch] ?: 0
            val drift = kotlin.math.abs(n - expected) / expected
            assertTrue("'$ch' appeared $n times, expected about $expected", drift < 0.08)
        }
    }

}
