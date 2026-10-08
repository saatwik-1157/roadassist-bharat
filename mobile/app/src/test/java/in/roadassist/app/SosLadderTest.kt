package `in`.roadassist.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
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

    private val provisioned = "+911234500000"

    @Test
    fun `sms is skipped when the data rung already handled it`() {
        // Otherwise the user is billed for a message nobody reads, and the
        // webhook raises a second incident for the same emergency.
        assertFalse(SosLadder.shouldTrySms(dataSettledIt = true, hasSmsPermission = true, number = provisioned))
    }

    @Test
    fun `sms is skipped without the permission, because the send would throw`() {
        assertFalse(SosLadder.shouldTrySms(dataSettledIt = false, hasSmsPermission = false, number = provisioned))
    }

    @Test
    fun `sms is attempted when data failed, the permission is granted and a number is provisioned`() {
        assertTrue(SosLadder.shouldTrySms(dataSettledIt = false, hasSmsPermission = true, number = provisioned))
    }

    @Test
    fun `with no provisioned number the sms rung is skipped entirely`() {
        // The old build texted +919999900000, a placeholder nobody provisioned:
        // somebody's emergency and location on a stranger's phone, or nowhere.
        assertFalse(SosLadder.smsRungEnabled(""))
        assertFalse(SosLadder.smsRungEnabled("   "))
        assertFalse(SosLadder.shouldTrySms(dataSettledIt = false, hasSmsPermission = true, number = ""))
    }

    @Test
    fun `this build ships with the sms rung off`() {
        // RaBuildConfig.RA_SMS_NUMBER is empty unless -PraSmsNumber is given.
        assertEquals("", RaBuildConfig.RA_SMS_NUMBER)
        assertFalse(SosLadder.smsRungEnabled(RaBuildConfig.RA_SMS_NUMBER))
    }

    @Test
    fun `no sms outcome ever settles the ladder - 112 and the queue always follow`() {
        // A SENT text used to settle it and skip 112 and the queue. "The message
        // left the phone" is not "somebody is coming".
        for (outcome in SosLadder.SmsOutcome.entries) {
            assertFalse("$outcome settled the ladder", SosLadder.afterSms(outcome).settles)
        }
        assertEquals(3, SosLadder.SmsOutcome.entries.size)
    }

    @Test
    fun `an sms attempt only adds a line to the result`() {
        assertEquals(R.string.sos_sms_sent, SosLadder.smsNoteRes(SosLadder.SmsOutcome.SENT))
        assertEquals(R.string.sos_sms_unconfirmed, SosLadder.smsNoteRes(SosLadder.SmsOutcome.UNCONFIRMED))
        assertEquals(null, SosLadder.smsNoteRes(SosLadder.SmsOutcome.FAILED))
    }

    // ── rung 1 needs a session ──────────────────────────────────────────────

    @Test
    fun `signed out the data rung is skipped rather than spent on a sure 401`() {
        assertFalse(SosLadder.shouldTryData(hasData = true, hasSession = false))
        assertTrue(SosLadder.shouldTryData(hasData = true, hasSession = true))
        assertFalse(SosLadder.shouldTryData(hasData = false, hasSession = true))
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
    fun `a dialer blocked in the background is not reported as open`() {
        // Android 10+ drops a background activity start without an exception.
        assertEquals(SosLadder.Handoff.OPENED, SosLadder.handoff(startAllowed = true, started = true, notified = false))
        assertEquals(SosLadder.Handoff.NOTIFIED, SosLadder.handoff(startAllowed = false, started = false, notified = true))
        assertEquals(SosLadder.Handoff.FAILED, SosLadder.handoff(startAllowed = false, started = false, notified = false))
        assertEquals(SosLadder.Handoff.FAILED, SosLadder.handoff(startAllowed = true, started = false, notified = false))
        assertEquals(R.string.sos_dialer_notified, SosLadder.handoffRes(SosLadder.Handoff.NOTIFIED))
        assertEquals(R.string.sos_queued, SosLadder.handoffRes(SosLadder.Handoff.FAILED))
        assertEquals(SosLadder.Rung.QUEUED, SosLadder.rungOf(SosLadder.Handoff.FAILED))
    }

    // ── the grace dialog says only what is true ─────────────────────────────

    @Test
    fun `with the sms rung off the grace dialog makes no sms claim`() {
        for (session in listOf(true, false)) {
            val parts = SosLadder.graceParts(hasSession = session, smsEnabled = false)
            assertFalse(R.string.sos_grace_sms in parts)
            assertFalse(R.string.sos_grace_contacts in parts)
        }
    }

    @Test
    fun `with the sms rung on contacts are said to be texted only if the server sms is live`() {
        val parts = SosLadder.graceParts(hasSession = true, smsEnabled = true)
        assertTrue(R.string.sos_grace_contacts in parts)
        assertTrue(R.string.sos_grace_sms in parts)
    }

    @Test
    fun `signed out the grace dialog does not promise an online alert`() {
        val parts = SosLadder.graceParts(hasSession = false, smsEnabled = false)
        assertFalse(R.string.sos_grace_online in parts)
        assertEquals(R.string.sos_grace_signed_out, parts.first())
        assertEquals(R.string.sos_grace_cancel, parts.last())
    }

    // ── one SOS at a time, process-wide ─────────────────────────────────────

    @Test
    fun `a second sos cannot start while one is running`() {
        // Rotation or a tab switch mid-ladder re-enabled the button and a
        // second tap raised a second emergency.
        val gate = SosGate()
        val first = gate.tryStart("RA-AAAAAA")!!
        assertEquals(first, gate.active.value)
        assertNull("a duplicate SOS was allowed to start", gate.tryStart("RA-BBBBBB"))
        gate.finish(first, "line")
        assertNull(gate.active.value)
        assertTrue(gate.tryStart("RA-CCCCCC") != null)
    }

    @Test
    fun `the outcome outlives the screen that raised it`() {
        val gate = SosGate()
        val run = gate.tryStart("RA-AAAAAA")!!
        gate.finish(run, "→ Opening 112")
        assertEquals("→ Opening 112", gate.last.value)
        // A failure with no line still frees the ladder and keeps the last outcome.
        val again = gate.tryStart("RA-BBBBBB")!!
        gate.finish(again, null)
        assertNull(gate.active.value)
        assertEquals("→ Opening 112", gate.last.value)
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
        //
        // The bytes come from a SEEDED java.util.Random through the same
        // mapping production uses (production passes its SecureRandom), so
        // the run is reproducible: the old version drew from SecureRandom
        // against a hand-picked 8% band and failed about 1 run in 100.
        // The bounds below are still set from the statistics, not fitted to
        // the seed — any seed passes them with probability 1 - 1e-6 — so a
        // different seed is not a way to make a broken generator pass.
        val alphabet = "ABCDEFGHJKMNPQRSTVWXYZ23456789"
        val draws = 10000
        val random = java.util.Random(0x5EED_5051L)
        val seen = HashSet<String>()
        val counts = HashMap<Char, Int>()
        repeat(draws) {
            val ref = SosLadder.newIncidentRef(random)
            seen.add(ref)
            for (ch in ref.substring(3)) counts[ch] = (counts[ch] ?: 0) + 1
        }

        // A broken alphabet or a byte source stuck near zero collides hundreds
        // of times here, not a dozen. Expected is about 0.07.
        val collisions = draws - seen.size
        assertTrue("$collisions collisions in $draws draws — keyspace is not 30^6", collisions <= 12)

        // Every letter appears, and none outside the alphabet.
        assertEquals("never emitted: ${alphabet.toSet() - counts.keys}, outside the alphabet: ${counts.keys - alphabet.toSet()}",
            alphabet.toSet(), counts.keys)

        // Pearson chi-square over the 30 letters (29 degrees of freedom).
        // 80.44 is the upper 1e-6 point of chi-square(29): a uniform generator
        // lands above it once in a million runs. `byte % 30` (the first 16
        // letters 12.5% likelier) puts the expected statistic near 234 over
        // these 60,000 characters, and a missing letter alone adds 2,000.
        val expected = (draws * 6).toDouble() / alphabet.length
        val chiSquare = alphabet.sumOf { ch ->
            val d = (counts[ch] ?: 0) - expected
            d * d / expected
        }
        assertTrue("chi-square $chiSquare over 29 df exceeds 80.44 (p < 1e-6): letters are not uniform — $counts",
            chiSquare < 80.44)
    }

}
