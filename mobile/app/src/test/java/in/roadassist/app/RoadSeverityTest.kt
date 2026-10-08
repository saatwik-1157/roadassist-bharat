package `in`.roadassist.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The same cases ai/tests/test_pipeline.py pins for ai/road_damage/severity.py,
 * so the phone and the server cannot drift apart on what a 4 means.
 */
class RoadSeverityTest {

    @Test fun `bands follow the documented thresholds`() {
        for ((frac, want) in listOf(0.005 to 1, 0.02 to 2, 0.05 to 3, 0.10 to 4, 0.50 to 5)) {
            assertEquals("frac=$frac", want, RoadSeverity.of("road_damage", frac))
        }
    }

    @Test fun `a pothole is one band worse than a crack of equal size`() {
        for (frac in listOf(0.005, 0.02, 0.05, 0.10)) {
            assertEquals("frac=$frac", RoadSeverity.of("road_damage", frac) + 1, RoadSeverity.of("pothole", frac))
        }
    }

    @Test fun `severity never leaves the range the database accepts`() {
        for (i in 0..100) {
            for (name in listOf("pothole", "road_damage", "faded_marking", "manhole")) {
                val s = RoadSeverity.of(name, i / 100.0)
                assertTrue("$name ${i / 100.0} -> $s", s in 1..5)
            }
        }
    }

    @Test fun `the largest pothole is capped not wrapped`() {
        assertEquals(5, RoadSeverity.of("pothole", 0.99))
    }

    @Test fun `band edges are exclusive upper bounds, as in the Python`() {
        // `box_frac < upper`: exactly 0.01 is already band 2.
        assertEquals(1, RoadSeverity.of("road_damage", 0.0099999))
        assertEquals(2, RoadSeverity.of("road_damage", 0.01))
        assertEquals(3, RoadSeverity.of("road_damage", 0.03))
        assertEquals(4, RoadSeverity.of("road_damage", 0.07))
        assertEquals(5, RoadSeverity.of("road_damage", 0.15))
    }

    @Test fun `classes other than pothole are not aggravated`() {
        assertEquals(RoadSeverity.of("road_damage", 0.02), RoadSeverity.of("manhole", 0.02))
        assertEquals(RoadSeverity.of("road_damage", 0.02), RoadSeverity.of("faded_marking", 0.02))
    }

    @Test fun `an empty or negative box is the lowest band`() {
        assertEquals(1, RoadSeverity.of("road_damage", 0.0))
        assertEquals(2, RoadSeverity.of("pothole", -1.0))
    }
}
