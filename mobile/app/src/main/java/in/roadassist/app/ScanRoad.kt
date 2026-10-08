package `in`.roadassist.app

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.provider.Settings
import android.util.Log
import android.util.Size
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size as GeoSize
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** What "Report hazard" hands the existing hazard dialog. */
class ScanHazard(val draft: ScanReport.Draft, val photo: Bitmap)

/**
 * Loads detector.json and the model it names from assets, once per screen
 * visit, off the main thread. Every failure becomes a sentence, never a crash:
 * a bad config (IllegalArgumentException), a model the runtime refuses
 * (OrtException), no native library for this CPU (UnsatisfiedLinkError) or no
 * memory for it (OutOfMemoryError).
 */
private sealed interface ModelState {
    data object Loading : ModelState
    class Ready(val detector: OrtRoadDetector) : ModelState
    class Failed(val reason: String) : ModelState
}

private suspend fun loadDetector(ctx: Context): ModelState = try {
    // buildOwned: leaving the screen mid-load closes the detector it built,
    // rather than dropping a live session (see buildOwned for why the old
    // isActive check never ran).
    ModelState.Ready(buildOwned(Dispatchers.IO) {
        val config = DetectorConfig.parse(ctx.assets.open(DetectorConfig.ASSET).use { it.readBytes().decodeToString() })
        val model = ctx.assets.open(config.modelAsset).use { it.readBytes() }
        // Half the cores: the camera, the UI and the renderer need the rest.
        val threads = (Runtime.getRuntime().availableProcessors() / 2).coerceIn(1, 4)
        OrtRoadDetector(model, config, threads)
    })
} catch (e: kotlinx.coroutines.CancellationException) {
    throw e
} catch (t: Throwable) {
    Log.w("ScanRoad", "detector did not load", t)
    ModelState.Failed(t.message ?: t.javaClass.simpleName)
}

/** One analysed picture and what was found in it. */
private class Scan(val image: Detector.Image, val result: OrtRoadDetector.Result, val mirrored: Boolean = false)

/**
 * A picked photo, upright and at most [maxSide] on its long side: decoded at a
 * power-of-two reduction (a 48 MP photo is ~190 MB at full size, and an
 * OutOfMemoryError is an Error), then turned by its EXIF orientation, as
 * serve.py does with ImageOps.exif_transpose. Null if it cannot be read.
 */
private fun decodePicked(ctx: Context, uri: Uri, maxSide: Int = 2048): Detector.Image? = try {
    val bytes = ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() }
    if (bytes == null) null else {
        val bounds = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
        android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) null else {
            var sample = 1
            while (maxOf(bounds.outWidth, bounds.outHeight) / sample > maxSide) sample *= 2
            val opts = android.graphics.BitmapFactory.Options().apply {
                inSampleSize = sample
                inPreferredConfig = Bitmap.Config.ARGB_8888
            }
            val bmp = android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts)
            if (bmp == null) null else {
                val px = IntArray(bmp.width * bmp.height)
                bmp.getPixels(px, 0, bmp.width, 0, 0, bmp.width, bmp.height)
                val img = Detector.Image(px, bmp.width, bmp.height)
                bmp.recycle()
                val orientation = try {
                    androidx.exifinterface.media.ExifInterface(bytes.inputStream())
                        .getAttributeInt(androidx.exifinterface.media.ExifInterface.TAG_ORIENTATION, 1)
                } catch (_: Exception) { 1 }
                Detector.applyExifOrientation(img, orientation)
            }
        }
    }
} catch (_: Throwable) { null }

private fun Detector.Image.toBitmap(): Bitmap = Bitmap.createBitmap(argb, width, height, Bitmap.Config.ARGB_8888)

private fun classColor(label: String): Color = when (label) {
    "pothole" -> Color(0xFFFF4D3D)
    "road_damage" -> Color(0xFFFFB020)
    "faded_marking" -> Color(0xFF3DC2FF)
    else -> Color(0xFFB98CFF)
}

@Composable
private fun className(label: String): String = when (label) {
    "pothole" -> stringResource(R.string.scan_class_pothole)
    "road_damage" -> stringResource(R.string.scan_class_road_damage)
    "faded_marking" -> stringResource(R.string.scan_class_faded_marking)
    "manhole" -> stringResource(R.string.scan_class_manhole)
    else -> label
}

private const val MODE_NONE = ScanReport.MODE_NONE
private const val MODE_CAMERA = ScanReport.MODE_CAMERA
private const val MODE_PHOTO = ScanReport.MODE_PHOTO

/**
 * "Scan road": the RAKSHA road-damage detector on the phone, over the live
 * camera or a picked photo, with no network at any point. Boxes, labels and
 * confidence are drawn over the picture; the live view shows its fps.
 *
 * "Report hazard" does not send anything itself. It opens the app's existing
 * hazard dialog (MainActivity.ReportHazardDialog: the same location rule, the
 * same POST /v1/raksha/report) filled in from the detection, with the frame
 * attached as the photo, for the person to check and send. What the dialog
 * says about the result is what the server answered.
 *
 * The camera permission is asked for when "Use camera" is tapped, not on
 * entry. Refused, the screen says why it wanted it, offers the system
 * settings, and still works on a picked photo.
 */
@Composable
fun ScanRoadScreen(
    online: Boolean,
    paused: Boolean,
    onClose: () -> Unit,
    onReport: (ScanHazard) -> Unit,
) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    BackHandler { onClose() }

    var model by remember { mutableStateOf<ModelState>(ModelState.Loading) }
    LaunchedEffect(Unit) {
        // Left before it finished loading: loadDetector closes what it built
        // and throws, so nothing is assigned here.
        model = loadDetector(ctx)
    }
    // Closed with the screen. OrtRoadDetector serialises close() against a
    // running detect(), so the analyser thread can never use a freed session.
    DisposableEffect(Unit) {
        onDispose { (model as? ModelState.Ready)?.detector?.close() }
    }

    var mode by rememberSaveable { mutableIntStateOf(MODE_NONE) }
    var cameraDenied by rememberSaveable { mutableStateOf(false) }
    var cameraError by remember { mutableStateOf<String?>(null) }
    var live by remember { mutableStateOf<Scan?>(null) }
    var fps by remember { mutableDoubleStateOf(0.0) }
    var photo by remember { mutableStateOf<Scan?>(null) }
    var photoBitmap by remember { mutableStateOf<Bitmap?>(null) }
    var busy by remember { mutableStateOf(false) }
    var photoFailed by remember { mutableStateOf(false) }

    fun hasCamera() = ContextCompat.checkSelfPermission(ctx, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

    val cameraPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        cameraDenied = !granted
        if (granted) {
            mode = MODE_CAMERA
            cameraError = null
        } else {
            // Show why, in place of whatever was on screen before.
            mode = MODE_NONE
        }
    }
    // Back from Settings with the permission now on: drop the refusal card.
    // Back with it gone (a one-time grant lapses with the process, and the
    // saved mode does not): leave the live camera rather than bind it blind.
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val obs = LifecycleEventObserver { _, e ->
            if (e == Lifecycle.Event.ON_RESUME) {
                val granted = hasCamera()
                if (cameraDenied && granted) cameraDenied = false
                mode = ScanReport.resumeMode(mode, granted)
            }
        }
        lifecycleOwner.lifecycle.addObserver(obs)
        onDispose { lifecycleOwner.lifecycle.removeObserver(obs) }
    }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        val det = (model as? ModelState.Ready)?.detector
        if (uri != null && det != null) {
            busy = true
            photoFailed = false
            scope.launch {
                val scan = withContext(Dispatchers.Default) {
                    try {
                        decodePicked(ctx, uri)?.let { img -> Scan(img, det.detect(img)) }
                    } catch (t: Throwable) {
                        Log.w("ScanRoad", "photo scan failed", t)
                        null
                    }
                }
                busy = false
                if (scan == null) {
                    photoFailed = true
                } else {
                    Log.i("ScanRoad", "photo ${scan.image.width}x${scan.image.height}: " +
                        "${scan.result.detections.size} found, prep ${scan.result.preprocessMs} ms, " +
                        "model ${scan.result.inferenceMs} ms")
                    photo = scan
                    photoBitmap = scan.image.toBitmap()
                    cameraDenied = false
                    mode = MODE_PHOTO
                }
            }
        }
    }

    fun startCamera() {
        if (hasCamera()) {
            cameraDenied = false
            cameraError = null
            mode = MODE_CAMERA
        } else {
            cameraPermission.launch(Manifest.permission.CAMERA)
        }
    }

    fun report(scan: Scan, d: Detector.Detection) {
        val config = (model as? ModelState.Ready)?.detector?.config ?: return
        val draft = ScanReport.draft(d, config) ?: return
        onReport(ScanHazard(draft, scan.image.toBitmap()))
    }

    Column(Modifier.fillMaxSize().background(Bg)) {
        // ── top bar, as on Layers in 3D ────────────────────────────────────
        val backLabel = stringResource(R.string.cd_back)
        Row(
            Modifier.fillMaxWidth()
                .background(Panel)
                .padding(WindowInsets.statusBars.asPaddingValues())
                .padding(horizontal = 8.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "←", color = Cream, fontSize = 22.sp,
                modifier = Modifier
                    .clip(CircleShape)
                    .clickable { onClose() }
                    .semantics { contentDescription = backLabel }
                    .padding(horizontal = 12.dp, vertical = 4.dp),
            )
            Spacer(Modifier.width(4.dp))
            Text(stringResource(R.string.scan_title), color = Cream, style = RaType.title, modifier = Modifier.weight(1f))
            if (mode == MODE_CAMERA && live != null) {
                Text(
                    stringResource(R.string.scan_stats_live, ScanReport.fpsText(fps), live?.result?.let { (it.preprocessMs + it.inferenceMs).toInt() } ?: 0),
                    color = Gold, style = RaType.meta, modifier = Modifier.padding(end = 8.dp),
                )
            }
        }

        // ── the picture ───────────────────────────────────────────────────
        // clipToBounds: PreviewView's TextureView scales itself past its own
        // edges to fill-centre, and unclipped it painted over the top bar.
        Box(
            Modifier.fillMaxWidth().weight(1.15f).clipToBounds().background(Color.Black),
            contentAlignment = Alignment.Center,
        ) {
            val ready = model as? ModelState.Ready
            when {
                model is ModelState.Loading -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator(color = Gold, modifier = Modifier.size(32.dp))
                    Text(stringResource(R.string.scan_loading_model), color = Color.White, style = RaType.label,
                        modifier = Modifier.padding(top = 10.dp))
                }
                model is ModelState.Failed -> Text(
                    stringResource(R.string.scan_model_failed, (model as ModelState.Failed).reason),
                    color = Color.White, style = RaType.label, modifier = Modifier.padding(24.dp),
                )
                mode == MODE_CAMERA && ready != null && cameraError == null && !cameraDenied && hasCamera() -> {
                    val cd = stringResource(R.string.cd_scan_preview)
                    Box(Modifier.fillMaxSize().semantics { contentDescription = cd }) {
                        CameraView(
                            detector = ready.detector,
                            paused = paused,
                            onScan = { scan, gapMs ->
                                live = scan
                                fps = ScanReport.nextFps(fps, gapMs)
                            },
                            onError = { cameraError = it },
                        )
                        live?.let { BoxOverlay(it, crop = true) }
                    }
                }
                mode == MODE_PHOTO && photo != null && photoBitmap != null -> {
                    val cd = stringResource(R.string.cd_scan_photo)
                    Box(Modifier.fillMaxSize().semantics { contentDescription = cd }) {
                        Image(
                            bitmap = photoBitmap!!.asImageBitmap(), contentDescription = null,
                            contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize(),
                        )
                        BoxOverlay(photo!!, crop = false)
                    }
                }
                cameraDenied -> Column(Modifier.padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(stringResource(R.string.scan_camera_denied_title), color = Color.White, style = RaType.title)
                    Text(stringResource(R.string.scan_camera_denied_body), color = Color.White.copy(alpha = 0.85f),
                        style = RaType.label, modifier = Modifier.padding(top = 8.dp))
                    RaPrimaryButton(
                        stringResource(R.string.scan_open_settings), modifier = Modifier.padding(top = 16.dp),
                        height = 48.dp, fillWidth = false,
                    ) {
                        try {
                            ctx.startActivity(
                                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", ctx.packageName, null))
                                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                            )
                        } catch (_: Exception) { /* no settings app: nothing else to open */ }
                    }
                }
                cameraError != null -> Text(
                    stringResource(R.string.scan_camera_error, cameraError ?: ""),
                    color = Color.White, style = RaType.label, modifier = Modifier.padding(24.dp),
                )
                else -> Text(
                    stringResource(R.string.scan_start_hint), color = Color.White.copy(alpha = 0.85f),
                    style = RaType.label, modifier = Modifier.padding(24.dp),
                )
            }
            if (busy) CircularProgressIndicator(color = Gold, modifier = Modifier.size(40.dp))
        }

        // ── controls, results and the honest small print ──────────────────
        Column(
            Modifier.fillMaxWidth().weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(WindowInsets.navigationBars.asPaddingValues())
                .padding(horizontal = 20.dp, vertical = 14.dp),
        ) {
            val ready = model is ModelState.Ready
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                RaChip(stringResource(R.string.scan_use_camera), selected = mode == MODE_CAMERA) {
                    if (ready) startCamera()
                }
                RaChip(stringResource(R.string.scan_pick_photo), selected = mode == MODE_PHOTO) {
                    if (ready && !busy) picker.launch("image/*")
                }
            }
            if (photoFailed) {
                Text(stringResource(R.string.toast_image_unreadable), color = Alarm, style = RaType.label,
                    modifier = Modifier.padding(top = 10.dp))
            }

            val scan = if (mode == MODE_CAMERA) live else if (mode == MODE_PHOTO) photo else null
            val config = (model as? ModelState.Ready)?.detector?.config
            if (scan != null && config != null) {
                Text(stringResource(R.string.scan_predictions_heading), color = Cream, style = RaType.title,
                    modifier = Modifier.padding(top = 16.dp))
                if (mode == MODE_PHOTO) {
                    Text(stringResource(R.string.scan_stats_photo, (scan.result.preprocessMs + scan.result.inferenceMs).toInt()),
                        color = Muted, style = RaType.meta, modifier = Modifier.padding(top = 2.dp))
                }
                if (scan.result.detections.isEmpty()) {
                    Text(stringResource(R.string.scan_no_detections), color = Muted, style = RaType.label,
                        modifier = Modifier.padding(top = 6.dp))
                }
                scan.result.detections.take(6).forEach { d ->
                    Row(Modifier.fillMaxWidth().padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(12.dp).clip(CircleShape).background(classColor(d.label)))
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(
                                stringResource(R.string.scan_detection_line, className(d.label), ScanReport.percent(d.confidence), d.severity),
                                color = Cream, style = RaType.label, fontWeight = FontWeight.SemiBold,
                            )
                            if (config.reportAs[d.label] == null) {
                                Text(stringResource(R.string.scan_not_reportable), color = Muted, style = RaType.meta)
                            }
                        }
                        if (config.reportAs[d.label] != null) {
                            RaPrimaryButton(
                                stringResource(R.string.scan_report),
                                fill = LocalRa.current.alarmFill, ink = LocalRa.current.onAlarm,
                                height = 44.dp, fillWidth = false, enabled = !paused,
                            ) { report(scan, d) }
                        }
                    }
                }
            }
            if (!online) {
                Text(stringResource(R.string.scan_offline_note), color = Alarm, style = RaType.label,
                    modifier = Modifier.padding(top = 14.dp))
            }
            config?.let {
                Text(
                    stringResource(R.string.scan_info, it.modelName, it.map50Text()),
                    color = Muted, style = RaType.meta, lineHeight = 16.sp, modifier = Modifier.padding(top = 14.dp),
                )
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}

/** Boxes, labels and confidence over the picture, mapped the way it is shown. */
@Composable
private fun BoxOverlay(scan: Scan, crop: Boolean) {
    val measurer = rememberTextMeasurer()
    val labels = scan.result.detections.map { it.label }.distinct().associateWith { className(it) }
    Canvas(Modifier.fillMaxSize()) {
            val f = ScanReport.fit(scan.result.width, scan.result.height, size.width, size.height, crop)
            for (d in scan.result.detections) {
                val c = classColor(d.label)
                // A front camera's preview is mirrored; the analysed frame is not.
                val x1 = if (scan.mirrored) scan.result.width - d.x2 else d.x1
                val x2 = if (scan.mirrored) scan.result.width - d.x1 else d.x2
                val left = (x1 * f.scale + f.dx).toFloat()
                val top = (d.y1 * f.scale + f.dy).toFloat()
                val w = ((x2 - x1) * f.scale).toFloat()
                val h = ((d.y2 - d.y1) * f.scale).toFloat()
                drawRect(c, Offset(left, top), GeoSize(w, h), style = Stroke(width = 3.dp.toPx()))
                val text = "${labels[d.label] ?: d.label} ${ScanReport.percent(d.confidence)}%"
                val layout = measurer.measure(text, TextStyle(color = Color.Black, fontSize = 12.sp, fontWeight = FontWeight.SemiBold))
                val ty = (top - layout.size.height).coerceAtLeast(0f)
                drawRect(c, Offset(left, ty), GeoSize(layout.size.width + 8.dp.toPx(), layout.size.height.toFloat()))
                drawText(layout, topLeft = Offset(left + 4.dp.toPx(), ty))
            }
    }
}

/**
 * CameraX preview plus frame analysis. Frames arrive as RGBA, are turned
 * upright by their rotationDegrees ([Detector.rotate]) and run through the
 * detector on one background thread; a frame that arrives while the last is
 * still being analysed is dropped (KEEP_ONLY_LATEST), so the preview never
 * lags behind the model. Preview and analysis both ask for 4:3, so the
 * analysed frame is the picture PreviewView shows, centre-cropped.
 */
@Composable
private fun CameraView(
    detector: OrtRoadDetector,
    paused: Boolean,
    onScan: (Scan, Long) -> Unit,
    onError: (String) -> Unit,
) {
    val ctx = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val previewView = remember {
        PreviewView(ctx).apply {
            scaleType = PreviewView.ScaleType.FILL_CENTER
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
        }
    }
    val pausedFlag = remember { AtomicBoolean(false) }
    SideEffect { pausedFlag.set(paused) }

    DisposableEffect(lifecycleOwner, detector) {
        val executor = Executors.newSingleThreadExecutor()
        val main = ContextCompat.getMainExecutor(ctx)
        val disposed = AtomicBoolean(false)
        var provider: ProcessCameraProvider? = null
        var lastDone = 0L
        val future = ProcessCameraProvider.getInstance(ctx)
        future.addListener({
            if (disposed.get()) return@addListener
            try {
                val p = future.get()
                provider = p
                val selector = when {
                    p.hasCamera(CameraSelector.DEFAULT_BACK_CAMERA) -> CameraSelector.DEFAULT_BACK_CAMERA
                    p.hasCamera(CameraSelector.DEFAULT_FRONT_CAMERA) -> CameraSelector.DEFAULT_FRONT_CAMERA
                    else -> throw IllegalStateException("no camera on this device")
                }
                val resolution = ResolutionSelector.Builder()
                    .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
                    .setResolutionStrategy(
                        ResolutionStrategy(Size(640, 480), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER),
                    )
                    .build()
                val preview = Preview.Builder().setResolutionSelector(
                    ResolutionSelector.Builder().setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY).build(),
                ).build()
                preview.setSurfaceProvider(previewView.surfaceProvider)
                val analysis = ImageAnalysis.Builder()
                    .setResolutionSelector(resolution)
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
                    .build()
                val mirrored = selector == CameraSelector.DEFAULT_FRONT_CAMERA
                analysis.setAnalyzer(executor) { proxy -> analyse(proxy, detector, pausedFlag, mirrored) { scan ->
                    val now = android.os.SystemClock.elapsedRealtime()
                    val gap = if (lastDone == 0L) 0L else now - lastDone
                    lastDone = now
                    Log.d("ScanRoad", "frame ${scan.image.width}x${scan.image.height}: prep ${scan.result.preprocessMs} ms, " +
                        "model ${scan.result.inferenceMs} ms, gap $gap ms")
                    main.execute { if (!disposed.get()) onScan(scan, gap) }
                } }
                p.unbindAll()
                p.bindToLifecycle(lifecycleOwner, selector, preview, analysis)
            } catch (t: Throwable) {
                Log.w("ScanRoad", "camera did not start", t)
                onError(t.message ?: t.javaClass.simpleName)
            }
        }, main)
        onDispose {
            disposed.set(true)
            try { provider?.unbindAll() } catch (_: Exception) { }
            executor.shutdown()
        }
    }
    AndroidView(factory = { previewView }, modifier = Modifier.fillMaxSize())
}

/** One frame: upright it, detect, hand it on. Never throws; always closes the frame. */
private fun analyse(proxy: ImageProxy, detector: OrtRoadDetector, paused: AtomicBoolean, mirrored: Boolean, done: (Scan) -> Unit) {
    try {
        if (paused.get()) return
        val bmp = proxy.toBitmap()
        val px = IntArray(bmp.width * bmp.height)
        bmp.getPixels(px, 0, bmp.width, 0, 0, bmp.width, bmp.height)
        val img = Detector.rotate(Detector.Image(px, bmp.width, bmp.height), proxy.imageInfo.rotationDegrees)
        done(Scan(img, detector.detect(img), mirrored))
    } catch (_: IllegalStateException) {
        // The detector was closed as the screen left; the frame is simply dropped.
    } catch (t: Throwable) {
        Log.w("ScanRoad", "frame analysis failed", t)
    } finally {
        proxy.close()
    }
}
