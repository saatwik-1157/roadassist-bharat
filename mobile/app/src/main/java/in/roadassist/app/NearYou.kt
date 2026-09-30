package `in`.roadassist.app

import java.util.Locale
import org.json.JSONArray
import org.json.JSONObject

/**
 * The decisions behind Home's "Near you" card, kept pure so they are tested
 * off-device (NearYouTest), the same way OpenIncidents.kt keeps its own.
 *
 * The card is the Android side of the web's near.js: the nearest hospital,
 * police station, fuel, EV charger and repair shop around the phone, with the
 * nearest address, from GET /v1/geo/address and GET /v1/geo/nearby. Those talk
 * to OpenStreetMap on the server, so no third party sees this phone.
 *
 * It says what it knows and no more: a fallback position is labelled as one, a
 * phone number is offered only when the map has one, an empty kind reads
 * "none mapped within 5 km", and a failed lookup says it failed. Nothing here
 * is ever on the SOS ladder.
 */
object NearYou {

    /** The search radius, in km. The empty-group sentence names it. */
    const val RADIUS_KM = 5

    /**
     * The demo point on NH-48, Gurugram: the same fallback HomeScreen's SOS
     * uses when there is no fix. The card says so whenever it is used.
     */
    const val DEMO_LAT = 28.4595
    const val DEMO_LNG = 77.0266

    /** How long a loaded card is reused across visits to Home, like near.js's HOME_TTL. */
    const val TTL_MS = 10 * 60 * 1000L

    /** The kinds, in the order the card lists them. [key] is the server's group name. */
    enum class Kind(val key: String) {
        HOSPITAL("hospital"), POLICE("police"), FUEL("fuel"), CHARGING("charging"), REPAIR("repair"),
    }

    /** Where the search point came from. Anything but [GPS] is the demo point, and is labelled. */
    enum class Fix { GPS, NO_PERMISSION, NO_FIX }

    data class Address(
        val label: String,
        val road: String?, val area: String?, val city: String?,
        val district: String?, val state: String?, val postcode: String?,
    )

    data class Place(
        /** Null when the server sent no name; the card then says "unnamed" rather than inventing one. */
        val name: String?,
        val kind: Kind,
        val lat: Double,
        val lng: Double,
        val distanceKm: Double,
        val phone: String?,
        val hours: String?,
    )

    /** One line of the card: the nearest place of a kind (null = none mapped), and how many more. */
    data class Row(val kind: Kind, val nearest: Place?, val more: Int)

    /** Why a lookup failed, as the card needs to say it. */
    sealed interface Problem {
        /** Whether the card offers "Try again". */
        val retry: Boolean

        /** 503 geo_disabled: the server has location services off. Retrying changes nothing. */
        data object Disabled : Problem { override val retry = false }

        /** Any other answer from the server: its own title, written for the person reading it. */
        data class Server(val title: String) : Problem { override val retry = true }

        /** No usable answer at all (no connection, a timeout, a proxy page). */
        data object Unreachable : Problem { override val retry = true }
    }

    /** What the card shows. */
    sealed interface State {
        /** Permission not granted yet: a "Find help near me" button and nothing else. */
        data object Idle : State
        data object Offline : State
        data object Loading : State
        data class Loaded(val fix: Fix, val address: Address?, val rows: List<Row>) : State
        data class Failed(val problem: Problem) : State
    }

    fun addressPath(lat: Double, lng: Double): String = "/v1/geo/address?lat=$lat&lng=$lng"

    fun nearbyPath(lat: Double, lng: Double): String = "/v1/geo/nearby?lat=$lat&lng=$lng&radiusKm=$RADIUS_KM"

    /** `data.address` of the address envelope, or null when the map has no address for the spot. */
    fun parseAddress(envelope: JSONObject): Address? {
        val a = envelope.optJSONObject("data")?.optJSONObject("address") ?: return null
        val label = a.str("label") ?: return null
        return Address(
            label = label,
            road = a.str("road"), area = a.str("area"), city = a.str("city"),
            district = a.str("district"), state = a.str("state"), postcode = a.str("postcode"),
        )
    }

    /**
     * `data.groups` of the nearby envelope, one list per [Kind], nearest first.
     *
     * Every kind is present, empty when the server sent nothing for it. A place
     * with no position or no readable distance is skipped: one bad row must
     * never cost the card the rest, or crash Home, which is where SOS lives.
     * Groups the app does not know are ignored.
     */
    fun parseGroups(envelope: JSONObject): Map<Kind, List<Place>> {
        val groups = envelope.optJSONObject("data")?.optJSONObject("groups")
        return Kind.entries.associateWith { kind -> parsePlaces(groups?.optJSONArray(kind.key), kind) }
    }

    private fun parsePlaces(arr: JSONArray?, kind: Kind): List<Place> {
        if (arr == null) return emptyList()
        val out = ArrayList<Place>(arr.length())
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            val d = o.num("distanceKm") ?: continue
            if (d < 0) continue
            val lat = o.num("lat") ?: continue
            val lng = o.num("lng") ?: continue
            out += Place(
                name = o.str("name"), kind = kind, lat = lat, lng = lng, distanceKm = d,
                phone = o.str("phone"), hours = o.str("hours"),
            )
        }
        // The server already sorts; sorting again (stably) keeps "nearest" true
        // even if it ever stops.
        return out.sortedBy { it.distanceKm }
    }

    /** The card's rows, in [Kind] order whatever order the JSON used. */
    fun rows(groups: Map<Kind, List<Place>>): List<Row> = Kind.entries.map { kind ->
        val list = groups[kind].orEmpty()
        Row(kind, list.firstOrNull(), (list.size - 1).coerceAtLeast(0))
    }

    /**
     * "650 m" under 1 km, otherwise one decimal: "1.4 km". A distance that
     * rounds to 1000 m is shown as "1.0 km" rather than "1000 m". The decimal
     * point is always a point, whatever the phone's locale.
     */
    fun distance(km: Double): String {
        val m = Math.round(km * 1000)
        return if (m < 1000) "$m m" else String.format(Locale.ROOT, "%.1f km", km)
    }

    /**
     * The `tel:` URI for a Call button, or null when there is no number to dial,
     * in which case the card shows no button at all. It is only ever used with
     * ACTION_DIAL: the dialer opens with the number and the person decides.
     */
    fun dialUri(phone: String?): String? {
        val digits = phone?.filter { it.isDigit() || it == '+' } ?: return null
        return if (digits.count { it.isDigit() } >= 3) "tel:$digits" else null
    }

    /** Map a failed lookup to what the card says. */
    fun problemOf(e: Throwable): Problem = when {
        e is ApiException && e.code == "geo_disabled" -> Problem.Disabled
        e is ApiException && e.status > 0 && !e.message.isNullOrBlank() -> Problem.Server(e.message!!)
        else -> Problem.Unreachable
    }

    /** Is a card loaded at [at] still fresh at [now]? */
    fun fresh(at: Long, now: Long): Boolean = now >= at && now - at < TTL_MS

    /** A non-blank string field, or null — org.json's optString turns JSON null into "null". */
    private fun JSONObject.str(key: String): String? =
        if (isNull(key)) null else optString(key).trim().takeIf { it.isNotEmpty() }

    /** A finite number field, or null. */
    private fun JSONObject.num(key: String): Double? {
        if (isNull(key)) return null
        val v = opt(key) as? Number ?: return null
        return v.toDouble().takeIf { it.isFinite() }
    }
}
