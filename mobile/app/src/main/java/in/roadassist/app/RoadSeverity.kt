package `in`.roadassist.app

/**
 * The severity heuristic, ported line for line from ai/road_damage/severity.py.
 *
 * The server, detect.py, serve.py and now this phone all score a detection the
 * same way, so a pothole the scanner calls 4 is a 4 on the authority's map too.
 * If the Python changes, this must change with it; RoadSeverityTest pins the
 * same cases as ai/tests/test_pipeline.py so a drift shows up as a failure.
 *
 * ENGINEERING ASSUMPTION, documented, not a safety claim: bounding-box area as
 * a fraction of the frame is a crude proxy for how much of the carriageway a
 * defect occupies. A pothole of equal size is worse than a surface crack, so it
 * gets +1. The 1-5 range is load-bearing: raksha_detections carries
 * CHECK (severity BETWEEN 1 AND 5), and POST /v1/raksha/report validates it.
 */
object RoadSeverity {
    /** Upper bound of each band, as a fraction of frame area (BANDS in severity.py). */
    val BANDS: List<Pair<Double, Int>> = listOf(0.01 to 1, 0.03 to 2, 0.07 to 3, 0.15 to 4)

    /** Classes judged worse than their size alone suggests (AGGRAVATED). */
    val AGGRAVATED: Set<String> = setOf("pothole")

    const val MIN = 1
    const val MAX = 5

    /** Severity 1-5 for a detection of [cls] covering [boxFrac] of the frame. */
    fun of(cls: String, boxFrac: Double): Int {
        var s = MAX
        for ((upper, band) in BANDS) {
            if (boxFrac < upper) {
                s = band
                break
            }
        }
        if (cls in AGGRAVATED) s = minOf(MAX, s + 1)
        return maxOf(MIN, s)
    }
}
