package `in`.roadassist.app

/**
 * The SOS ladder's DECISIONS, separated from the Android plumbing that carries
 * them out.
 *
 * `Emergency.raise` needs a Context, a live radio, a SmsManager, a broadcast
 * receiver and a real dialer, so none of it can be exercised on a JVM — which
 * meant the rules below, which decide whether a person in trouble is actually
 * reached, had no test of any kind. Non-negotiable #1 says emergency paths never
 * regress; a path with no tests cannot make that promise.
 *
 * So the rules live here as pure functions over plain values, `Emergency` calls
 * them rather than restating them, and `SosLadderTest` pins every branch. This
 * is deliberately NOT a parallel copy of the logic: if these two ever disagree,
 * the behaviour changes, which is exactly the divergence the schema conventions
 * test guards against on the server side.
 *
 * The ladder itself (see `Emergency` for the full argument):
 *   1. DATA   2. SMS   3. 112 DIALER   4. QUEUE
 */
object SosLadder {

    enum class Rung { DATA, SMS, DIALER, QUEUED }

    enum class SmsOutcome {
        /** The platform confirmed the message left the device. */
        SENT,

        /** The radio rejected it outright. */
        FAILED,

        /** Send did not fail, but no confirmation arrived before the timeout. */
        UNCONFIRMED,
    }

    /**
     * The body of the SOS text message.
     *
     * This is a CONTRACT with `POST /v1/telecom/sms`, which lowercases the text,
     * splits on whitespace and routes on the first word. The two numbers after
     * the verb are the fix, read by `parseSmsCoordinates` on the server; the
     * trailing word is for the human who might see the message in their sent
     * folder. Changing the order or dropping the verb breaks an emergency path
     * silently — the SMS still sends, and nothing ever arrives.
     *
     * Stays well inside the endpoint's 160-character limit even at full double
     * precision; `sms-coordinates.test.ts` asserts that from the other side.
     */
    fun smsBody(lat: Double, lng: Double): String = "SOS $lat $lng RoadAssist"

    /**
     * What an SMS attempt settles.
     *
     * @param settles     this rung owns the report; stop descending the ladder.
     * @param queueBackup also store it locally to replay when data returns.
     */
    data class SmsVerdict(val settles: Boolean, val queueBackup: Boolean)

    /**
     * The duplicate-versus-silence trade, which is the single most consequential
     * judgement in this file.
     *
     * SENT: the message reached the network, the telecom webhook will raise the
     * incident, and queueing an API replay as well would raise a SECOND one —
     * two responders dispatched, the family alerted twice. Exactly one channel
     * owns the report.
     *
     * UNCONFIRMED: the send did not fail, but nothing confirmed it either. Now
     * the asymmetry flips. A duplicate incident is an annoyance; an emergency
     * nobody hears is the failure the whole product exists to prevent. So we
     * queue a backup and accept the rare double.
     *
     * FAILED: nothing was transmitted, so this rung settles nothing and owns
     * nothing — descend, and let the dialer rung do the queueing.
     */
    fun afterSms(outcome: SmsOutcome): SmsVerdict = when (outcome) {
        SmsOutcome.SENT -> SmsVerdict(settles = true, queueBackup = false)
        SmsOutcome.UNCONFIRMED -> SmsVerdict(settles = true, queueBackup = true)
        SmsOutcome.FAILED -> SmsVerdict(settles = false, queueBackup = false)
    }

    /**
     * The last two rungs. Both have already queued the SOS before this is
     * called — reaching here at all means no RoadAssist channel carried the
     * report, so the local copy is the only record that exists.
     */
    fun afterDialer(opened: Boolean): Rung = if (opened) Rung.DIALER else Rung.QUEUED

    /**
     * Whether the SMS rung should even be attempted.
     *
     * Both conditions matter and for different reasons: without the permission
     * the send throws, and attempting it when the data path already succeeded
     * would bill the user for a message nobody reads.
     */
    fun shouldTrySms(dataSettledIt: Boolean, hasSmsPermission: Boolean): Boolean =
        !dataSettledIt && hasSmsPermission

    /**
     * Whether the data rung settled it.
     *
     * Split out because "the OS reports validated internet" and "the API
     * answered" are different facts, and conflating them is how a captive
     * portal — a highway dhaba's wifi, an airport — turns into a silent
     * emergency: the phone has internet, the API is unreachable, and an
     * implementation that trusted `hasData` alone would stop at rung 1 and
     * report success.
     */
    fun dataSettledIt(hasData: Boolean, apiSucceeded: Boolean): Boolean =
        hasData && apiSucceeded
}
