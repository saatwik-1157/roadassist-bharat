package `in`.roadassist.app

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The decisions behind Home's "Near you" card: what the two /v1/geo answers
 * parse into, the order the card lists them in, how a distance reads, when a
 * Call button exists, and what a failed lookup says.
 *
 * The card sits on Home next to SOS, so a bad row must cost nothing but
 * itself, and nothing here may show a place, a distance or a number the
 * server did not send.
 */
class NearYouTest {

    private fun place(
        name: Any? = "AIIMS Trauma Centre",
        kind: String = "hospital",
        distanceKm: Any? = 1.24,
        phone: Any? = null,
        hours: Any? = null,
        lat: Any? = 28.56,
        lng: Any? = 77.2,
    ): JSONObject = JSONObject()
        .put("name", name ?: JSONObject.NULL).put("kind", kind)
        .put("lat", lat ?: JSONObject.NULL).put("lng", lng ?: JSONObject.NULL)
        .put("distanceKm", distanceKm ?: JSONObject.NULL)
        .put("phone", phone ?: JSONObject.NULL).put("hours", hours ?: JSONObject.NULL)

    private fun nearby(groups: JSONObject): JSONObject =
        JSONObject()
            .put("data", JSONObject().put("origin", JSONObject().put("lat", 28.46).put("lng", 77.03))
                .put("radiusKm", 5).put("groups", groups))
            .put("meta", JSONObject().put("source", "OpenStreetMap Overpass · © OpenStreetMap contributors, ODbL"))

    private fun arr(vararg items: Any): JSONArray = JSONArray().apply { items.forEach { put(it) } }

    // ── distance text ───────────────────────────────────────────────────────

    @Test
    fun `under a kilometre reads in whole metres`() {
        assertEquals("0 m", NearYou.distance(0.0))
        assertEquals("80 m", NearYou.distance(0.08))
        assertEquals("650 m", NearYou.distance(0.65))
        assertEquals("999 m", NearYou.distance(0.999))
    }

    @Test
    fun `a kilometre and over reads to one decimal`() {
        assertEquals("1.0 km", NearYou.distance(1.0))
        assertEquals("1.2 km", NearYou.distance(1.24))
        assertEquals("4.9 km", NearYou.distance(4.93))
        assertEquals("12.0 km", NearYou.distance(12.0))
    }

    @Test
    fun `a distance that rounds to 1000 m is shown as 1 km, not 1000 m`() {
        assertEquals("1.0 km", NearYou.distance(0.9996))
    }

    // ── nearby: grouping and ordering ───────────────────────────────────────

    @Test
    fun `every kind is present, in the card's order, whatever the JSON order`() {
        val groups = JSONObject()
            .put("repair", arr(place(name = "Tyre Point", kind = "repair")))
            .put("fuel", arr(place(name = "IOCL", kind = "fuel")))
        val rows = NearYou.rows(NearYou.parseGroups(nearby(groups)))
        assertEquals(
            listOf(NearYou.Kind.HOSPITAL, NearYou.Kind.POLICE, NearYou.Kind.FUEL, NearYou.Kind.CHARGING, NearYou.Kind.REPAIR),
            rows.map { it.kind },
        )
        assertEquals("IOCL", rows[2].nearest?.name)
        assertEquals("Tyre Point", rows[4].nearest?.name)
    }

    @Test
    fun `an empty or missing group is a row with nothing mapped, not an invented place`() {
        val rows = NearYou.rows(NearYou.parseGroups(nearby(JSONObject().put("police", JSONArray()))))
        rows.forEach {
            assertNull(it.nearest)
            assertEquals(0, it.more)
        }
        // No groups at all, and no data at all, read the same way.
        assertTrue(NearYou.rows(NearYou.parseGroups(JSONObject())).all { it.nearest == null })
    }

    @Test
    fun `the nearest place leads its row even if the server's order slips`() {
        val groups = JSONObject().put(
            "hospital",
            arr(place(name = "Far", distanceKm = 3.1), place(name = "Near", distanceKm = 0.4), place(name = "Mid", distanceKm = 1.9)),
        )
        val parsed = NearYou.parseGroups(nearby(groups))
        assertEquals(listOf("Near", "Mid", "Far"), parsed.getValue(NearYou.Kind.HOSPITAL).map { it.name })
        val row = NearYou.rows(parsed)[0]
        assertEquals("Near", row.nearest?.name)
        assertEquals(2, row.more)
    }

    @Test
    fun `a full place parses every field`() {
        val groups = JSONObject().put(
            "police",
            arr(place(name = "Sector 29 Police Station", kind = "police", distanceKm = 0.82, phone = "+91 124 222 1100", hours = "24/7")),
        )
        val p = NearYou.parseGroups(nearby(groups)).getValue(NearYou.Kind.POLICE).single()
        assertEquals("Sector 29 Police Station", p.name)
        assertEquals(NearYou.Kind.POLICE, p.kind)
        assertEquals(0.82, p.distanceKm, 0.0)
        assertEquals(28.56, p.lat, 0.0)
        assertEquals(77.2, p.lng, 0.0)
        assertEquals("+91 124 222 1100", p.phone)
        assertEquals("24/7", p.hours)
    }

    @Test
    fun `malformed places are skipped, not fatal, and the good ones survive`() {
        val groups = JSONObject().put(
            "fuel",
            arr(
                "not an object",
                7,
                JSONObject(),                                  // nothing at all
                place(distanceKm = null),                      // no distance
                place(distanceKm = "near"),                    // a distance that is not a number
                place(distanceKm = -1.0),                      // an impossible distance
                place(lat = null),                             // no position
                place(name = "HPCL", kind = "fuel", distanceKm = 2.2),
            ),
        )
        assertEquals(listOf("HPCL"), NearYou.parseGroups(nearby(groups)).getValue(NearYou.Kind.FUEL).map { it.name })
    }

    @Test
    fun `a group the app does not know is ignored`() {
        val groups = JSONObject().put("pharmacy", arr(place(name = "Apollo Pharmacy")))
        assertTrue(NearYou.rows(NearYou.parseGroups(nearby(groups))).all { it.nearest == null })
    }

    @Test
    fun `a place with no name stays unnamed rather than being given one`() {
        val groups = JSONObject().put("charging", arr(place(name = null, kind = "charging"), place(name = "  ", kind = "charging")))
        val list = NearYou.parseGroups(nearby(groups)).getValue(NearYou.Kind.CHARGING)
        assertEquals(2, list.size)
        assertTrue(list.all { it.name == null })
    }

    // ── the Call button ─────────────────────────────────────────────────────

    @Test
    fun `a null phone parses as null and gets no Call button`() {
        val groups = JSONObject().put("hospital", arr(place(phone = null)))
        val p = NearYou.parseGroups(nearby(groups)).getValue(NearYou.Kind.HOSPITAL).single()
        assertNull(p.phone)
        assertNull(NearYou.dialUri(p.phone))
    }

    @Test
    fun `a blank or digit-free phone gets no Call button either`() {
        assertNull(NearYou.dialUri(""))
        assertNull(NearYou.dialUri("   "))
        assertNull(NearYou.dialUri("call us"))
        assertNull(NearYou.dialUri("+-"))
    }

    @Test
    fun `a real number becomes a tel URI with only digits and the plus`() {
        assertEquals("tel:+911242221100", NearYou.dialUri("+91 124 222 1100"))
        assertEquals("tel:01124567890", NearYou.dialUri("011-2456-7890"))
        assertEquals("tel:112", NearYou.dialUri("112"))
    }

    // ── the address ─────────────────────────────────────────────────────────

    @Test
    fun `the address parses its label and parts`() {
        val env = JSONObject().put(
            "data",
            JSONObject().put(
                "address",
                JSONObject().put("label", "NH-48, Sector 29, Gurugram, Haryana 122001").put("road", "NH-48")
                    .put("area", "Sector 29").put("city", "Gurugram").put("district", JSONObject.NULL)
                    .put("state", "Haryana").put("postcode", "122001"),
            ),
        ).put("meta", JSONObject().put("source", "OpenStreetMap Nominatim · © OpenStreetMap contributors, ODbL"))
        val a = NearYou.parseAddress(env)!!
        assertEquals("NH-48, Sector 29, Gurugram, Haryana 122001", a.label)
        assertEquals("NH-48", a.road)
        assertEquals("Gurugram", a.city)
        assertNull(a.district)
        assertEquals("122001", a.postcode)
    }

    @Test
    fun `no address on the map is null, never a made-up line`() {
        assertNull(NearYou.parseAddress(JSONObject().put("data", JSONObject().put("address", JSONObject.NULL))))
        assertNull(NearYou.parseAddress(JSONObject().put("data", JSONObject().put("address", JSONObject().put("label", "")))))
        assertNull(NearYou.parseAddress(JSONObject()))
    }

    // ── requests ────────────────────────────────────────────────────────────

    @Test
    fun `both lookups go to the platform's own geo routes, nearby within 5 km`() {
        assertEquals("/v1/geo/address?lat=28.4595&lng=77.0266", NearYou.addressPath(28.4595, 77.0266))
        assertEquals("/v1/geo/nearby?lat=28.4595&lng=77.0266&radiusKm=5", NearYou.nearbyPath(28.4595, 77.0266))
    }

    // ── errors ──────────────────────────────────────────────────────────────

    @Test
    fun `geo_disabled says the server has location services off, with no retry`() {
        val p = NearYou.problemOf(ApiException("Location services are off on this server (GEO_SERVICES).", "geo_disabled", 503))
        assertEquals(NearYou.Problem.Disabled, p)
        assertFalse(p.retry)
    }

    @Test
    fun `any other server error shows the server's own title, with a retry`() {
        val busy = NearYou.problemOf(ApiException("Location lookups are busy. Try again in a few seconds.", "geo_unavailable", 503))
        assertEquals(NearYou.Problem.Server("Location lookups are busy. Try again in a few seconds."), busy)
        assertTrue(busy.retry)
        val outside = NearYou.problemOf(ApiException("Location services cover India only.", "outside_region", 400))
        assertEquals(NearYou.Problem.Server("Location services cover India only."), outside)
        assertTrue(outside.retry)
    }

    @Test
    fun `no answer at all is unreachable, not a raw exception message`() {
        val p = NearYou.problemOf(java.net.UnknownHostException("Unable to resolve host \"app.roadassistbharat.online\""))
        assertEquals(NearYou.Problem.Unreachable, p)
        assertTrue(p.retry)
        assertEquals(NearYou.Problem.Unreachable, NearYou.problemOf(org.json.JSONException("bad")))
    }

    // ── reuse across visits ─────────────────────────────────────────────────

    @Test
    fun `a loaded card is reused for ten minutes and no longer`() {
        assertTrue(NearYou.fresh(at = 1_000, now = 1_000))
        assertTrue(NearYou.fresh(at = 1_000, now = 1_000 + NearYou.TTL_MS - 1))
        assertFalse(NearYou.fresh(at = 1_000, now = 1_000 + NearYou.TTL_MS))
        // A clock that went backwards is not "fresh".
        assertFalse(NearYou.fresh(at = 5_000, now = 1_000))
    }
}
