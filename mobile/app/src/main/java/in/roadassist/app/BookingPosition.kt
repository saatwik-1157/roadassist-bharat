package `in`.roadassist.app

/**
 * Where a booking says the stranded person is — or that it is not sent.
 *
 * The booking screen used to create every booking at the selected mechanic's
 * position, or at the NH-48 demo point (28.4595, 77.0266) when none was
 * selected, and always labelled it "NH-48, KM 212". A real mechanic would have
 * been sent to the wrong place. The selected mechanic says WHO to request,
 * never WHERE the person is, so it is not an input here at all.
 *
 * The rule is the same as the hazard report and SOS: only a position the phone
 * measured is sent. With no fix the request is not sent, unless the person
 * explicitly taps the clearly-labelled demo button, and then the booking says
 * "(demo point)" so nobody mistakes it for a real location. Pure Kotlin, so
 * BookingPositionTest pins every branch off-device.
 */
object BookingPosition {

    /** The classroom demo point on NH-48, Gurugram — sent only on an explicit demo tap. */
    const val DEMO_LAT = 28.4595
    const val DEMO_LNG = 77.0266
    const val DEMO_MARKER = "NH-48, KM 212 (demo point)"

    enum class Reason {
        /** Location permission is off: ask for it again. */
        PERMISSION_OFF,
        /** Permission is on but no usable fix came back. */
        NO_FIX,
    }

    sealed interface Decision {
        /** [marker] is the `highwayMarker` to send, or null to send none. */
        data class Send(val lat: Double, val lng: Double, val marker: String?) : Decision
        data class NotSent(val reason: Reason) : Decision
    }

    /**
     * [fix] is what [Emergency.currentLocation] returned. Validity is
     * [SosPosition.from]'s: NaN, infinite, out-of-range and 0,0 are no fix.
     * A real fix always wins, even when [demoChosen]; it is sent with no
     * highway marker, because nothing on the phone knows the road's KM post.
     * The demo point is used only when there is no fix AND the person tapped
     * the demo button.
     */
    fun decide(
        fix: Pair<Double, Double>?,
        demoChosen: Boolean,
        locationPermitted: Boolean = true,
    ): Decision {
        val pos = SosPosition.from(fix)
        if (pos is SosPosition.Located) return Decision.Send(pos.lat, pos.lng, null)
        if (demoChosen) return Decision.Send(DEMO_LAT, DEMO_LNG, DEMO_MARKER)
        return Decision.NotSent(if (locationPermitted) Reason.NO_FIX else Reason.PERMISSION_OFF)
    }

    /** The second line of the refusal, under "No location yet — the request was not sent." */
    fun reasonRes(reason: Reason): Int = when (reason) {
        Reason.PERMISSION_OFF -> R.string.booking_reason_permission
        Reason.NO_FIX -> R.string.booking_reason_no_fix
    }

    /** Where the "nearby mechanics" list was searched. [isDemo] must be said on screen. */
    data class NearbyCentre(val lat: Double, val lng: Double, val isDemo: Boolean)

    /**
     * The nearby list is only a list — nothing is sent anywhere — so with no
     * fix it may be searched around the demo point, but [NearbyCentre.isDemo]
     * is then true and the screen says so.
     */
    fun nearbyCentre(fix: Pair<Double, Double>?): NearbyCentre =
        when (val pos = SosPosition.from(fix)) {
            is SosPosition.Located -> NearbyCentre(pos.lat, pos.lng, isDemo = false)
            SosPosition.Unknown -> NearbyCentre(DEMO_LAT, DEMO_LNG, isDemo = true)
        }

    fun nearbyPath(c: NearbyCentre): String = "/v1/map/live?lat=${c.lat}&lng=${c.lng}&radiusKm=30"

    fun nearbyNoteRes(c: NearbyCentre): Int =
        if (c.isDemo) R.string.mechanics_nearby_around_demo else R.string.mechanics_nearby_around_you
}
