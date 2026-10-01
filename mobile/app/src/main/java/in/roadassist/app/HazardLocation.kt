package `in`.roadassist.app

/**
 * Where a citizen hazard report is placed — or that it is not sent at all.
 *
 * RAKSHA shows a citizen report on the authority's map as a position the
 * phone measured. The dialog used to fall back to the NH-48 demo point
 * (28.4595, 77.0266) when there was no fix, so a report made indoors or
 * before GPS had locked went to the server as a pothole in Gurugram. The web
 * app refuses in that case, and app/docs/OFFLINE.md promises the app reports
 * "Unknown", never a fallback coordinate.
 *
 * So the rule is the web's: no fix, no report. The person keeps their draft
 * and tries again. Pure Kotlin, so HazardLocationTest pins it off-device.
 */
object HazardLocation {

    sealed interface ReportPosition {
        data class Send(val lat: Double, val lng: Double) : ReportPosition
        data object NoFix : ReportPosition
    }

    /**
     * [fix] is what [Emergency.currentLocation] returned. Only a real,
     * in-range coordinate is sent; anything else is [ReportPosition.NoFix].
     * There is deliberately no fallback parameter.
     */
    fun reportPosition(fix: Pair<Double, Double>?): ReportPosition {
        if (fix == null) return ReportPosition.NoFix
        val (lat, lng) = fix
        if (!lat.isFinite() || !lng.isFinite()) return ReportPosition.NoFix
        if (lat !in -90.0..90.0 || lng !in -180.0..180.0) return ReportPosition.NoFix
        return ReportPosition.Send(lat, lng)
    }
}
