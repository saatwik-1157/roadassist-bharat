package `in`.roadassist.app

import org.json.JSONObject

/**
 * Where an SOS says the person is — or that nobody knows.
 *
 * With no GPS fix the SOS used to be raised at the NH-48 demo point
 * (28.4595, 77.0266): on the data rung to `POST /v1/sos`, in the SMS body and
 * in the offline queue. That sends a responder somewhere confidently, which is
 * worse than no location at all. Now a missing fix is said out loud on every
 * channel and the person is told to give 112 their position:
 *
 *  - data:  `POST /v1/sos` with `locationUnknown: true` and no lat/lng (the
 *           server refuses an SOS that has neither and does not say so);
 *  - SMS:   `SOS location unknown RoadAssist`. The verb is still the first
 *           word, and the server's parseSmsCoordinates reads no fix from
 *           tokens that are not numbers, so the incident is raised unlocated;
 *  - queue: lat/lng stored as JSON null, replayed as `locationUnknown`.
 *
 * Pure (org.json is the only dependency, and the JVM tests have a real one),
 * so SosPositionTest pins every branch off-device.
 */
sealed interface SosPosition {
    data class Located(val lat: Double, val lng: Double) : SosPosition
    data object Unknown : SosPosition

    companion object {
        /**
         * [fix] is what [Emergency.currentLocation] returned. Only a real,
         * in-range coordinate is Located. 0,0 is refused as well, the same as
         * the server's SMS parser: it is what a broken GPS chip or an
         * uninitialised variable produces, and no road in India is near it.
         * There is deliberately no fallback parameter.
         */
        fun from(fix: Pair<Double, Double>?): SosPosition {
            if (fix == null) return Unknown
            val (lat, lng) = fix
            if (!lat.isFinite() || !lng.isFinite()) return Unknown
            if (lat !in -90.0..90.0 || lng !in -180.0..180.0) return Unknown
            if (lat == 0.0 && lng == 0.0) return Unknown
            return Located(lat, lng)
        }

        /**
         * What the person is told when their SOS has no position, or null when
         * it has one. Every rung gets it, because 112 is then the only way a
         * responder learns where they are. QUEUED raised nothing yet, so it
         * says "saved" rather than "raised".
         */
        fun unknownNoticeRes(pos: SosPosition, rung: SosLadder.Rung): Int? = when {
            pos is Located -> null
            rung == SosLadder.Rung.QUEUED -> R.string.sos_location_unknown_saved
            else -> R.string.sos_location_unknown
        }

        /** The text of the SMS rung. Located keeps [SosLadder.smsBody]'s exact format. */
        fun smsBody(pos: SosPosition): String = when (pos) {
            is Located -> SosLadder.smsBody(pos.lat, pos.lng)
            Unknown -> "SOS location unknown RoadAssist"
        }

        /** The body of `POST /v1/sos`, for the live data rung and the queue replay alike. */
        fun apiBody(pos: SosPosition, ref: String): JSONObject {
            val body = JSONObject().put("source", "manual").put("clientIncidentId", ref)
            when (pos) {
                is Located -> body.put("lat", pos.lat).put("lng", pos.lng)
                Unknown -> body.put("locationUnknown", true)
            }
            return body
        }

        /** One offline-queue entry. An unknown position is stored as JSON null, never a number. */
        fun queueEntry(pos: SosPosition, ref: String, at: Long): JSONObject {
            val entry = JSONObject()
            when (pos) {
                is Located -> entry.put("lat", pos.lat).put("lng", pos.lng)
                Unknown -> entry.put("lat", JSONObject.NULL).put("lng", JSONObject.NULL)
            }
            return entry.put("ref", ref).put("at", at)
        }

        /** Read a queued entry back. Missing or null coordinates are Unknown. */
        fun ofQueueEntry(entry: JSONObject): SosPosition {
            if (entry.isNull("lat") || entry.isNull("lng")) return Unknown
            val lat = entry.optDouble("lat", Double.NaN)
            val lng = entry.optDouble("lng", Double.NaN)
            return from(lat to lng)
        }
    }
}
