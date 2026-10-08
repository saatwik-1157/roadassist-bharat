package `in`.roadassist.app

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import java.io.Closeable
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicReference
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext

/**
 * Build something that must be closed, on [context], without leaking it when
 * the caller is cancelled while it is being built.
 *
 * The scanner used to load its detector with
 * `withContext(Dispatchers.IO + NonCancellable) { ... }` and then check
 * `isActive` to close a detector nobody would use. That check never ran:
 * withContext hands its result back to a cancelled caller by throwing
 * CancellationException (its prompt-cancellation guarantee), so leaving the
 * screen during the load dropped a live OrtSession, the model's native memory
 * included, with nobody to close it. Here the built object is remembered and
 * closed on exactly that path.
 */
suspend fun <T : Closeable> buildOwned(context: CoroutineContext, build: () -> T): T {
    val built = AtomicReference<T?>(null)
    try {
        return withContext(context + NonCancellable) { build().also { built.set(it) } }
    } catch (e: kotlinx.coroutines.CancellationException) {
        built.getAndSet(null)?.let { runCatching { it.close() } }
        throw e
    }
}

/**
 * The detector itself: one ONNX Runtime session plus [Detector]'s pre- and
 * post-processing. No Android types, so the JVM parity test drives this same
 * class (on ONNX Runtime's desktop build) that the phone runs.
 *
 * CPU only, deliberately. NNAPI and GPU delegates vary by phone and are a
 * common source of wrong answers and native crashes on cheap hardware; the
 * nano model is small enough for the CPU, and it is what the parity test holds
 * to the server's numbers.
 *
 * Refuses to start, with a sentence, when the model and detector.json
 * disagree: different class names (from the ONNX metadata "names"), a
 * different input size (metadata "imgsz"), or an output that is not
 * 4 + classes rows. Guessing in any of those cases mislabels or misplaces
 * every box without crashing, which is worse than not detecting at all.
 *
 * Thread-safe: [detect] and [close] are serialised, so the camera's analyser
 * thread can never run a session the screen has just closed.
 */
class OrtRoadDetector(model: ByteArray, val config: DetectorConfig, threads: Int = 2) : Closeable {

    /** What one call found, and how long it took. */
    class Result(
        val detections: List<Detector.Detection>,
        val width: Int,
        val height: Int,
        val preprocessMs: Long,
        val inferenceMs: Long,
    )

    private val env: OrtEnvironment = OrtEnvironment.getEnvironment()
    private val session: OrtSession
    private val inputName: String
    private val lock = Any()
    private var closed = false
    private val plane = config.inputWidth * config.inputHeight
    private val tensor = FloatArray(3 * plane)
    private val inputBuffer = ByteBuffer.allocateDirect(4 * 3 * plane).order(ByteOrder.nativeOrder())

    init {
        // ONNX Runtime 1.30 collects usage telemetry. Off: nothing about this
        // phone or its use leaves it on the runtime's account (the Android
        // package's telemetry provider is also removed in AndroidManifest.xml).
        try { env.setTelemetry(false) } catch (_: Exception) { /* nothing to turn off */ }
        val opts = OrtSession.SessionOptions()
        try {
            opts.setIntraOpNumThreads(threads.coerceIn(1, 4))
            // Worker threads sleep between frames instead of spinning. Spinning
            // wins a few ms on an idle desktop; on a phone it burns battery
            // between camera frames and fights the UI and camera threads for
            // the same cores, which made a single photo take seconds.
            opts.addConfigEntry("session.intra_op.allow_spinning", "0")
            opts.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
            session = env.createSession(model, opts)
        } finally {
            opts.close()
        }
        try {
            val meta = session.metadata.customMetadata
            val names = Detector.parseNames(meta["names"])
            require(names == null || names == config.classes) {
                "the model's classes $names do not match detector.json ${config.classes}"
            }
            Detector.parseImgsz(meta["imgsz"])?.let { (h, w) ->
                require(h == config.inputHeight && w == config.inputWidth) {
                    "the model was exported at ${w}x$h but detector.json says ${config.inputWidth}x${config.inputHeight}"
                }
            }
            inputName = session.inputNames.first()
            val out = session.outputInfo.values.first().info as? ai.onnxruntime.TensorInfo
            val rows = out?.shape?.getOrNull(1) ?: -1L
            require(rows < 0 || rows == 4L + config.classes.size) {
                "the model outputs $rows rows, but ${config.classes.size} classes need ${4 + config.classes.size}"
            }
        } catch (e: Exception) {
            session.close()
            throw e
        }
    }

    /** Run on one upright image. Throws IllegalStateException once closed. */
    fun detect(img: Detector.Image): Result = synchronized(lock) {
        check(!closed) { "detector closed" }
        val t0 = System.nanoTime()
        Detector.letterboxTensor(img, config.inputWidth, config.inputHeight, tensor)
        inputBuffer.clear()
        inputBuffer.asFloatBuffer().put(tensor)
        val t1 = System.nanoTime()
        val shape = longArrayOf(1, 3, config.inputHeight.toLong(), config.inputWidth.toLong())
        val dets = OnnxTensor.createTensor(env, inputBuffer.asFloatBuffer(), shape).use { input ->
            session.run(mapOf(inputName to input)).use { res ->
                val out = res.get(0) as OnnxTensor
                val s = out.info.shape            // [1, 4 + classes, anchors]
                require(s.size == 3 && s[0] == 1L) { "unexpected output shape ${s.contentToString()}" }
                val rows = s[1].toInt()
                val anchors = s[2].toInt()
                val fb = out.floatBuffer
                val flat = FloatArray(fb.remaining())
                fb.get(flat)
                Detector.decode(
                    flat, rows, anchors, config.classes, img.width, img.height,
                    config.inputWidth, config.inputHeight, config.minConfidence, config.iouThreshold,
                )
            }
        }
        val t2 = System.nanoTime()
        Result(dets, img.width, img.height, (t1 - t0) / 1_000_000, (t2 - t1) / 1_000_000)
    }

    override fun close() = synchronized(lock) {
        if (closed) return
        closed = true
        session.close()
    }
}
