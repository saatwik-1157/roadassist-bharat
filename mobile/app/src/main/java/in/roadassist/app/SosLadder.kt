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

    /**
     * Crockford base32 minus the glyphs that read as digits on a cracked
     * screen. The same alphabet the web engine mints from and the same one
     * `POST /v1/sos` validates against — all three move together or not at all.
     */
    private const val REF_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"
    private const val REF_LENGTH = 6
    private val refRandom = java.security.SecureRandom()

    /**
     * A client-minted reference for one emergency: `RA-XXXXXX`.
     *
     * This is the idempotency key for a queued SOS, and the ONLY thing that
     * stops a replay becoming a second emergency. A queue entry replayed after
     * a lost response — the server committed, the answer never arrived — raises
     * a second incident without it, which alerts the family twice and occupies
     * a second responder for one breakdown.
     *
     * Rejection-sampled rather than `% 30`: 256 is not a multiple of 30, so a
     * bare modulo makes the first 16 letters 12.5% likelier and quietly shrinks
     * the keyspace. Uniqueness is still the server's unique index to guarantee;
     * this only has to supply enough entropy that it never has to.
     */
    fun newIncidentRef(): String = newIncidentRef(refRandom)

    /**
     * The same mapping over an injected byte source. Production always goes
     * through the SecureRandom overload above; this exists so SosLadderTest
     * can check the alphabet mapping and rejection sampling against a seeded
     * [java.util.Random] and get the same answer on every run.
     */
    internal fun newIncidentRef(random: java.util.Random): String {
        val limit = 256 - (256 % REF_ALPHABET.length)   // 240
        val sb = StringBuilder(REF_LENGTH)
        val buf = ByteArray(REF_LENGTH)
        while (sb.length < REF_LENGTH) {
            random.nextBytes(buf)
            for (b in buf) {
                val v = b.toInt() and 0xFF
                if (v >= limit) continue                // would skew the alphabet
                sb.append(REF_ALPHABET[v % REF_ALPHABET.length])
                if (sb.length == REF_LENGTH) break
            }
        }
        return "RA-$sb"
    }

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
     * What an SMS attempt settles: nothing, whatever the radio said.
     *
     * A SENT text used to settle the ladder, skipping 112 and the queue, on the
     * argument that the telecom webhook would raise the incident. But the
     * number it went to was a placeholder (+919999900000) that no RoadAssist
     * server answers, so a "sent" SOS reached nobody, or a stranger, and the
     * person was told help was on the way. Even with a real short code, "the
     * message left the phone" is not "somebody is coming". So the SMS rung is
     * now an extra channel only: the ladder always goes on to the 112 handoff
     * and the queue, and accepts the rare duplicate incident, because a
     * duplicate is an annoyance and an emergency nobody hears is the failure
     * this product exists to prevent.
     */
    @Suppress("UNUSED_PARAMETER")
    fun afterSms(outcome: SmsOutcome): SmsVerdict = SmsVerdict(settles = false, queueBackup = false)

    /** The line added to the result for an SMS attempt, or null when nothing went out. */
    fun smsNoteRes(outcome: SmsOutcome): Int? = when (outcome) {
        SmsOutcome.SENT -> R.string.sos_sms_sent
        SmsOutcome.UNCONFIRMED -> R.string.sos_sms_unconfirmed
        SmsOutcome.FAILED -> null
    }

    /**
     * The last two rungs. Both have already queued the SOS before this is
     * called — reaching here at all means no RoadAssist channel carried the
     * report, so the local copy is the only record that exists.
     */
    fun afterDialer(opened: Boolean): Rung = if (opened) Rung.DIALER else Rung.QUEUED

    /** How the 112 handoff went. */
    enum class Handoff {
        /** The dialer opened with 112 in it. */
        OPENED,

        /** Android blocked opening it from the background; a tap-to-call notification is up instead. */
        NOTIFIED,

        /** Neither: no dialer, or no permission to notify. */
        FAILED,
    }

    /**
     * Since Android 10 an app in the background may not start an activity, and
     * the platform drops the start SILENTLY: no exception, so `startActivity`
     * returning was taken as "112 is open" while nothing appeared. A dialer
     * counts as opened only when the start was allowed and did not throw.
     */
    fun handoff(startAllowed: Boolean, started: Boolean, notified: Boolean): Handoff = when {
        startAllowed && started -> Handoff.OPENED
        notified -> Handoff.NOTIFIED
        else -> Handoff.FAILED
    }

    /** The rung a handoff reports: a notification still hands off to 112, on the person's tap. */
    fun rungOf(handoff: Handoff): Rung = afterDialer(opened = handoff != Handoff.FAILED)

    /** The result line for a handoff. */
    fun handoffRes(handoff: Handoff): Int = when (handoff) {
        Handoff.OPENED -> R.string.sos_dialer
        Handoff.NOTIFIED -> R.string.sos_dialer_notified
        Handoff.FAILED -> R.string.sos_queued
    }

    /**
     * Is the SMS rung switched on at all?
     *
     * Only with a real inbound number, set at build time
     * (RaBuildConfig.RA_SMS_NUMBER, empty by default). With none, the rung is
     * skipped entirely: texting a number nobody provisioned could put
     * someone's emergency and location on a stranger's phone.
     */
    fun smsRungEnabled(number: String): Boolean = number.isNotBlank()

    /**
     * Whether the SMS rung should even be attempted.
     *
     * Every condition matters and for different reasons: with no provisioned
     * number there is nobody to text (see [smsRungEnabled]), without the
     * permission the send throws, and attempting it when the data path already
     * succeeded would bill the user for a message nobody reads.
     */
    fun shouldTrySms(dataSettledIt: Boolean, hasSmsPermission: Boolean, number: String): Boolean =
        !dataSettledIt && hasSmsPermission && smsRungEnabled(number)

    /**
     * Whether the data rung runs. It needs a session: signed out (the SOS on
     * the sign-in screen) there is no account to raise it under, so the ladder
     * starts at the next rung rather than spending seconds on a sure 401.
     */
    fun shouldTryData(hasData: Boolean, hasSession: Boolean): Boolean = hasData && hasSession

    /**
     * The grace dialog's text, as the sentences that are true for this phone.
     *
     * It used to promise that RoadAssist "texts your emergency contacts" on
     * every build. Signed out, nothing reaches RoadAssist online; with the SMS
     * rung off there is no text from this phone at all; and contacts are texted
     * only when the server's SMS is live. So the dialog is built from parts.
     */
    fun graceParts(hasSession: Boolean, smsEnabled: Boolean): List<Int> = buildList {
        if (hasSession) {
            add(R.string.sos_grace_online)
            if (smsEnabled) add(R.string.sos_grace_contacts)
        } else {
            add(R.string.sos_grace_signed_out)
        }
        if (smsEnabled) add(R.string.sos_grace_sms)
        add(if (hasSession) R.string.sos_grace_handoff else R.string.sos_grace_handoff_signed_out)
        add(R.string.sos_grace_cancel)
    }

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

/**
 * The one SOS in flight, process-wide.
 *
 * Whether a ladder was running used to be HomeScreen's own `busy` flag, in a
 * plain `remember`. Rotating the phone or switching tabs mid-ladder (which
 * Emergency.ladderScope deliberately survives) dropped it, so the SOS button
 * came back enabled while the first emergency was still being raised, and a
 * second tap raised a second one. The result line was lost the same way.
 *
 * Now the state lives here, held by Emergency for the life of the process:
 * [active] is non-null while a ladder runs and every SOS control is disabled
 * then; [last] keeps the outcome for whichever screen is showing.
 */
class SosGate {
    data class Running(val ref: String)

    private val activeFlow = kotlinx.coroutines.flow.MutableStateFlow<Running?>(null)
    val active: kotlinx.coroutines.flow.StateFlow<Running?> = activeFlow

    private val lastFlow = kotlinx.coroutines.flow.MutableStateFlow<String?>(null)
    val last: kotlinx.coroutines.flow.StateFlow<String?> = lastFlow

    /** Claim the ladder, or null when one is already running. */
    fun tryStart(ref: String): Running? {
        val run = Running(ref)
        return if (activeFlow.compareAndSet(null, run)) run else null
    }

    /** Record the outcome line (if any) and free the ladder. Call from a finally. */
    fun finish(run: Running, outcome: String?) {
        if (outcome != null) lastFlow.value = outcome
        activeFlow.compareAndSet(run, null)
    }
}
