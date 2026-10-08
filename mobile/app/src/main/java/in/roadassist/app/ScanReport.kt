package `in`.roadassist.app

import java.util.Locale

/**
 * The scanner's decisions that are not pixels: what a detection becomes when
 * it is reported, and where a box lands on screen. Pure, so ScanReportTest
 * runs them off-device.
 */
object ScanReport {

    /** The server's cap on a report note (POST /v1/raksha/report, note max 280). */
    const val NOTE_MAX = 280

    /** What the existing hazard dialog is opened with. */
    data class Draft(val type: String, val severity: Int, val note: String)

    /**
     * The draft for [d], or null when its class is not one the server takes.
     *
     * POST /v1/raksha/report has no confidence or model field (a citizen
     * report is stored with confidence 1 and model "citizen-report"), so the
     * prediction travels in the note, where the authority reviewing it reads
     * it: class, confidence, the severity rule, and the model with its
     * measured mAP50. It says "model prediction" in so many words.
     */
    fun draft(d: Detector.Detection, config: DetectorConfig): Draft? {
        val type = config.reportAs[d.label] ?: return null
        return Draft(type, d.severity.coerceIn(RoadSeverity.MIN, RoadSeverity.MAX), note(d, config))
    }

    fun note(d: Detector.Detection, config: DetectorConfig): String {
        val pct = percent(d.confidence)
        val area = String.format(Locale.ROOT, "%.1f", d.boxFraction * 100)
        val text = "On-device model prediction, not verified: ${d.label}, $pct% confidence, " +
            "severity ${d.severity}/5 by the box-area rule (box $area% of the frame). " +
            "Model ${config.modelName}, mAP50 ${config.map50Text()}."
        return if (text.length <= NOTE_MAX) text else text.take(NOTE_MAX - 1) + "…"
    }

    /** Confidence as a whole percentage, rounded half up, 0-100. */
    fun percent(confidence: Double): Int = Math.round(confidence.coerceIn(0.0, 1.0) * 100).toInt()

    /** Frames per second for display, always with a dot ("4.2"). */
    fun fpsText(fps: Double): String = String.format(Locale.ROOT, "%.1f", fps.coerceAtLeast(0.0))

    /** Image-to-view mapping: view = image * scale + (dx, dy). */
    data class Fit(val scale: Float, val dx: Float, val dy: Float)

    /**
     * How an [imgW] x [imgH] picture sits in a [viewW] x [viewH] view.
     * [crop] is PreviewView's FILL_CENTER (scale up until both sides are
     * covered, centre, crop the overflow); otherwise ContentScale.Fit
     * (scale until it fits, centre, letterbox).
     */
    fun fit(imgW: Int, imgH: Int, viewW: Float, viewH: Float, crop: Boolean): Fit {
        if (imgW <= 0 || imgH <= 0 || viewW <= 0f || viewH <= 0f) return Fit(1f, 0f, 0f)
        val sx = viewW / imgW
        val sy = viewH / imgH
        val s = if (crop) maxOf(sx, sy) else minOf(sx, sy)
        return Fit(s, (viewW - imgW * s) / 2f, (viewH - imgH * s) / 2f)
    }

    /** Smoothed frames per second from the gap between two finished frames. */
    fun nextFps(previous: Double, gapMs: Long): Double {
        if (gapMs <= 0) return previous
        val now = 1000.0 / gapMs
        return if (previous <= 0.0) now else previous * 0.8 + now * 0.2
    }
}
