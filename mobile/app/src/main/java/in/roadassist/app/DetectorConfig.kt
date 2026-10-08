package `in`.roadassist.app

import org.json.JSONException
import org.json.JSONObject

/**
 * Which road-damage model the scanner runs, read from assets/detector/detector.json.
 *
 * Everything that changes when the model is swapped lives in that one file:
 * the asset name, its class list (in the model's index order), the input size,
 * the thresholds serve.py uses, and the measured mAP50 the screen quotes. A new
 * export is dropped into assets/detector/ and named here; no Kotlin changes.
 *
 * Parsing is strict. A config that is wrong does not crash the app and is not
 * guessed at: [parse] throws [IllegalArgumentException] with the reason, and
 * the scanner shows that reason instead of boxes. An assumed class order is how
 * `pothole` becomes `manhole` on an authority's map (onnx_detector.py says the
 * same of the Python side), so the class list is also checked against the
 * model's own metadata when the model loads (see [Detector.parseNames]).
 */
data class DetectorConfig(
    /** Path under assets/, e.g. "detector/raksha-yolo11n-multi-edge.onnx". */
    val modelAsset: String,
    /** Short name shown on screen and written into a report note. */
    val modelName: String,
    val inputWidth: Int,
    val inputHeight: Int,
    /** Class names in the model's output order (index 0 first). */
    val classes: List<String>,
    /** serve.py's --min-conf default. */
    val minConfidence: Double,
    /** serve.py's --iou default. */
    val iouThreshold: Double,
    /**
     * Model class -> the hazard `type` POST /v1/raksha/report accepts. A class
     * missing here is shown but cannot be reported (onnx_detector.INGESTABLE).
     */
    val reportAs: Map<String, String>,
    /** Measured mAP50 on held-out validation (ai/README.md), quoted on screen. */
    val map50: Double,
) {
    companion object {
        /** The server's hazard enum (raksha.ts, POST /v1/raksha/report). */
        val SERVER_TYPES = setOf("pothole", "road_damage", "obstruction")

        const val ASSET = "detector/detector.json"

        fun parse(json: String): DetectorConfig {
            val o = try {
                JSONObject(json)
            } catch (e: JSONException) {
                throw IllegalArgumentException("detector.json is not valid JSON: ${e.message}")
            }
            fun str(key: String): String {
                val v = o.opt(key)
                require(v is String && v.isNotBlank()) { "detector.json: \"$key\" must be a non-empty string" }
                return v.trim()
            }
            fun num(key: String): Double {
                val v = o.opt(key)
                require(v is Number) { "detector.json: \"$key\" must be a number" }
                val d = v.toDouble()
                require(!d.isNaN() && !d.isInfinite()) { "detector.json: \"$key\" must be finite" }
                return d
            }
            fun size(key: String): Int {
                val d = num(key)
                require(d == Math.floor(d) && d >= 32 && d <= 2048 && d.toInt() % 32 == 0) {
                    "detector.json: \"$key\" must be a whole multiple of 32 between 32 and 2048 (YOLO stride)"
                }
                return d.toInt()
            }

            val asset = str("model")
            require(!asset.startsWith("/") && ".." !in asset.split('/') && asset.endsWith(".onnx")) {
                "detector.json: \"model\" must be a relative .onnx path inside assets/"
            }

            val arr = o.optJSONArray("classes")
            require(arr != null && arr.length() > 0) { "detector.json: \"classes\" must be a non-empty array" }
            val classes = (0 until arr.length()).map { i ->
                val c = arr.opt(i)
                require(c is String && c.isNotBlank()) { "detector.json: class $i must be a non-empty string" }
                c.trim()
            }
            require(classes.toSet().size == classes.size) { "detector.json: class names must be unique" }

            val minConf = num("minConfidence")
            require(minConf > 0.0 && minConf < 1.0) { "detector.json: \"minConfidence\" must be between 0 and 1" }
            val iou = num("iouThreshold")
            require(iou > 0.0 && iou < 1.0) { "detector.json: \"iouThreshold\" must be between 0 and 1" }
            val map50 = num("map50")
            require(map50 >= 0.0 && map50 <= 1.0) { "detector.json: \"map50\" must be between 0 and 1" }

            val reportAs = LinkedHashMap<String, String>()
            o.optJSONObject("reportAs")?.let { r ->
                for (k in r.keys()) {
                    val v = r.opt(k)
                    require(k in classes) { "detector.json: reportAs names \"$k\", which is not in classes" }
                    require(v is String && v in SERVER_TYPES) {
                        "detector.json: reportAs.$k must be one of ${SERVER_TYPES.sorted()}"
                    }
                    reportAs[k] = v
                }
            }

            return DetectorConfig(
                modelAsset = asset,
                modelName = str("modelName"),
                inputWidth = size("inputWidth"),
                inputHeight = size("inputHeight"),
                classes = classes,
                minConfidence = minConf,
                iouThreshold = iou,
                reportAs = reportAs,
                map50 = map50,
            )
        }
    }

    /** "0.293": the figure as ai/README.md prints it, never a locale's "0,293". */
    fun map50Text(): String = java.math.BigDecimal.valueOf(map50).setScale(3, java.math.RoundingMode.HALF_UP).toPlainString()
}
