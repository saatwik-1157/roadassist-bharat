package `in`.roadassist.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.annotation.StringRes
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

// ── brand ──────────────────────────────────────────────────────────────────
// These read the active palette (see Theme.kt) rather than naming a fixed
// colour, so every existing call site below gets both themes for free.
val Gold: Color     @Composable get() = LocalRa.current.gold
val GoldFill: Color @Composable get() = LocalRa.current.goldFill
val GoldInk: Color  @Composable get() = LocalRa.current.goldInk
val Bg: Color       @Composable get() = LocalRa.current.bg
val Panel: Color    @Composable get() = LocalRa.current.panel
val Cream: Color    @Composable get() = LocalRa.current.text
val Muted: Color    @Composable get() = LocalRa.current.textDim
val Alarm: Color    @Composable get() = LocalRa.current.alarm

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // On a real handset the API address is typed by hand: 10.0.2.2 is an
        // emulator alias and means nothing there. Without this it resets to
        // that default on every launch and has to be retyped. Restored before
        // anything composes, because the map WebView reads Api.base too.
        getSharedPreferences("ra.ui", android.content.Context.MODE_PRIVATE)
            .getString("apiBase", null)
            ?.let { Api.base = Api.normalizeBase(it) }
        setContent {
            val ctx = LocalContext.current
            val prefs = remember { ctx.getSharedPreferences("ra.ui", android.content.Context.MODE_PRIVATE) }
            // "system" | "light" | "dark" — the choice survives a restart.
            var mode by remember { mutableStateOf(prefs.getString("theme", "system") ?: "system") }
            val dark = when (mode) {
                "dark" -> true
                "light" -> false
                else -> isSystemInDarkTheme()
            }
            val palette = if (dark) RaDark else RaLight

            // Paint the system bars to match, and flip the icon polarity with
            // them, so the app never sits under a mismatched status bar.
            val view = LocalView.current
            @Suppress("DEPRECATION")
            SideEffect {
                val window = (view.context as android.app.Activity).window
                // No-ops from API 35 (the app draws behind the bars there, and the
                // top bar already pads for the status-bar inset) — but still the
                // only way to colour the bars on API 26–34.
                window.statusBarColor = palette.panel.toArgb()
                window.navigationBarColor = palette.panel.toArgb()
                WindowCompat.getInsetsController(window, view).apply {
                    isAppearanceLightStatusBars = !dark
                    isAppearanceLightNavigationBars = !dark
                }
            }

            RoadAssistTheme(dark) {
                RoadAssistApp(
                    isDark = dark,
                    onToggleTheme = {
                        mode = if (dark) "light" else "dark"
                        prefs.edit().putString("theme", mode).apply()
                    },
                )
            }
        }
    }
}

// ── app state machine ──────────────────────────────────────────────────────
/** The RoadAssist mark (res/drawable/ic_mark.xml), tinted to the active gold. */
@Composable
private fun BrandMark(size: Int = 24) {
    Image(
        painter = painterResource(R.drawable.ic_mark),
        contentDescription = "RoadAssist",
        modifier = Modifier.size(size.dp),
        colorFilter = ColorFilter.tint(Gold),
    )
}

/** Mark + wordmark, used in the top bar. */
@Composable
private fun BrandLockup() {
    Row(verticalAlignment = Alignment.CenterVertically) {
        BrandMark(22)
        Spacer(Modifier.width(8.dp))
        Row {
            Text("Road", color = Cream, fontFamily = androidx.compose.ui.text.font.FontFamily.Serif,
                fontSize = 18.sp, fontWeight = FontWeight.Medium)
            Text("Assist", color = Gold, fontFamily = androidx.compose.ui.text.font.FontFamily.Serif,
                fontSize = 18.sp, fontWeight = FontWeight.Medium)
        }
    }
}

/** Bottom-nav destinations — the persistent, app-like shell every effective
 *  mobile app uses instead of full-screen page replacement. */
/**
 * A bottom-navigation destination.
 *
 * `label` is a resource id, not a String. It used to be the literal, which
 * meant the nav bar stayed in English in all eight locales — the one row that
 * is on screen no matter which screen you are on. The glyph stays a literal:
 * it is a Unicode symbol, not language.
 */
private data class Tab(@StringRes val label: Int, val glyph: String)
private val TABS = listOf(
    Tab(R.string.nav_home, "⌂"),     // house
    Tab(R.string.nav_assist, "⚑"),   // flag
    Tab(R.string.nav_map, "◈"),      // live map
    Tab(R.string.nav_track, "◉"),    // fisheye/pin
    Tab(R.string.nav_more, "☰"),     // menu
)

@Composable
fun RoadAssistApp(isDark: Boolean, onToggleTheme: () -> Unit) {
    // rememberSaveable, not remember.
    //
    // The activity is recreated on every rotation — nothing in the manifest
    // declares configChanges — and plain `remember` does not survive that. It
    // cost the user the thing they most needed to keep: bookingId is the rescue
    // currently being tracked, and turning the phone sideways while waiting for
    // a mechanic dropped it, along with the signed-in flag and the open tab.
    // Somebody watching for help arriving was returned to the sign-in screen.
    //
    // Only the small durable values live here. toast is transient by
    // definition, requestedMechanic is a JSONObject with no Saver, and the
    // photo fields are a base64 string and a Bitmap — saved state is a Binder
    // transaction, and putting an image through it risks TransactionTooLarge.
    var signedIn by rememberSaveable { mutableStateOf(false) }
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var toast by remember { mutableStateOf<String?>(null) }
    var vehicleId by rememberSaveable { mutableStateOf<String?>(null) }
    var vehicleLabel by rememberSaveable { mutableStateOf<String?>(null) }
    var bookingId by rememberSaveable { mutableStateOf<String?>(null) }
    var msisdn by rememberSaveable { mutableStateOf("+919876543210") }
    // A mechanic tapped on the live map ("Request assistance"), handed to Book.
    var requestedMechanic by remember { mutableStateOf<JSONObject?>(null) }
    var showReport by rememberSaveable { mutableStateOf(false) }

    // A rotation keeps Api.token — the object lives in the process — but process
    // death does not, and Android still restores the flags above. A signed-in UI
    // with no token 401s every call and looks broken rather than signed out, so
    // the restored state is trusted only when a token came back with it.
    //
    // Everything session-scoped goes, not just the flag. bookingId surviving is
    // the whole point of saving it — but it belongs to the session that just
    // ended. Sign-in only overwrites vehicleId and vehicleLabel, so a stale
    // bookingId would outlive its owner and point the Track tab at somebody
    // else's rescue for the next person to sign in on this phone.
    LaunchedEffect(Unit) {
        if (signedIn && Api.currentToken().isBlank()) {
            signedIn = false
            tab = 0
            bookingId = null
            vehicleId = null
            vehicleLabel = null
        }
    }

    val ctx = LocalContext.current
    var online by remember { mutableStateOf(true) }
    LaunchedEffect(signedIn) {
        while (signedIn) { online = Emergency.hasData(ctx); kotlinx.coroutines.delay(4000) }
    }

    // Photo picker for hazard reports is hoisted here (not inside the dialog) so
    // it survives the external picker activity round-trip and the dialog stays put.
    val photoScope = rememberCoroutineScope()
    var reportPhotoB64 by remember { mutableStateOf<String?>(null) }
    var reportPhotoThumb by remember { mutableStateOf<android.graphics.Bitmap?>(null) }
    val reportPhotoPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.GetContent(),
    ) { uri ->
        if (uri != null) photoScope.launch {
            val r = withContext(Dispatchers.IO) { processReportImage(ctx, uri) }
            if (r != null) { reportPhotoB64 = r.first; reportPhotoThumb = r.second }
            else toast = ctx.getString(R.string.toast_image_unreadable)
        }
    }

    Box(Modifier.fillMaxSize().background(Bg)) {
        if (!signedIn) {
            SignInScreen(
                msisdn = msisdn, onMsisdn = { msisdn = it },
                onToast = { toast = it },
                onSignedIn = { vid, vlabel -> vehicleId = vid; vehicleLabel = vlabel; signedIn = true; tab = 0 },
            )
        } else {
            // Build the map WebView once and keep it alive for the whole signed-in
            // session, so switching to the Map tab is instant and never re-loads
            // Leaflet or re-flashes tiles. It self-heals its token via AndroidAuth.
            val mapWebView = remember {
                buildMapWebView(ctx, Api.base, isDark) { id, name, lat, lng ->
                    requestedMechanic = JSONObject()
                        .put("id", id).put("name", name).put("lat", lat).put("lng", lng)
                    tab = 1   // jump to the booking flow with this mechanic in focus
                }
            }
            // Pause the retained map WebView (its JS timers, polling and drawing)
            // whenever it isn't the visible tab, then resume on return — keeps the
            // instant tab switch without burning cycles in the background.
            LaunchedEffect(tab) {
                if (tab == 2) mapWebView.onResume() else mapWebView.onPause()
            }
            // The map is retained across tab switches, so a theme flip has to be
            // pushed into it rather than waiting for a reload.
            LaunchedEffect(isDark) {
                mapWebView.evaluateJavascript(
                    "window.__setTheme && window.__setTheme('" + (if (isDark) "dark" else "light") + "')",
                    null,
                )
            }
            Scaffold(
                containerColor = Bg,
                topBar = {
                    Row(
                        Modifier.fillMaxWidth()
                            .background(Panel)
                            .padding(WindowInsets.statusBars.asPaddingValues())
                            .padding(horizontal = 18.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        BrandLockup()
                        Spacer(Modifier.weight(1f))
                        Text(
                            if (online) "● online" else "● offline",
                            color = if (online) LocalRa.current.ok else LocalRa.current.warn,
                            style = RaType.eyebrow,
                        )
                        Text(
                            if (isDark) "☀" else "☾",
                            color = Muted, style = RaType.title,
                            modifier = Modifier
                                .padding(start = 14.dp)
                                .clip(CircleShape)
                                .clickable { onToggleTheme() }
                                .padding(horizontal = 7.dp, vertical = 3.dp),
                        )
                    }
                },
                bottomBar = {
                    NavigationBar(containerColor = Panel, tonalElevation = 0.dp) {
                        TABS.forEachIndexed { i, t ->
                            NavigationBarItem(
                                selected = tab == i,
                                onClick = { tab = i },
                                icon = { Text(t.glyph, fontSize = 20.sp) },
                                label = { Text(stringResource(t.label), style = RaType.eyebrow) },
                                colors = NavigationBarItemDefaults.colors(
                                    selectedIconColor = Gold, selectedTextColor = Gold,
                                    indicatorColor = Color(0x22E3B96A),
                                    unselectedIconColor = Muted, unselectedTextColor = Muted,
                                ),
                            )
                        }
                    }
                },
            ) { pad ->
                Box(Modifier.padding(pad).fillMaxSize().background(Bg)) {
                    // The map stays mounted underneath; it's only visible on the Map
                    // tab. Keeping it in the tree is what makes tab switches buttery —
                    // no WebView teardown, no Leaflet reload, no tile re-fetch.
                    //
                    // It is skipped at *draw* time rather than hidden with alpha(0f).
                    // A zero-alpha modifier still promotes the subtree to its own
                    // layer and still composites it, so a full-screen WebView texture
                    // was being blended into every frame of all five tabs — paid for
                    // on the four where the map is not even visible. Skipping
                    // drawContent leaves the WebView attached and its JS state alive
                    // (that is what makes the switch instant) while costing nothing
                    // to draw.
                    val mapVisible = tab == 2
                    Box(Modifier.fillMaxSize().drawWithContent { if (mapVisible) drawContent() }) {
                        AndroidView(modifier = Modifier.fillMaxSize(), factory = { mapWebView })
                        // Report-a-hazard FAB, only interactive on the Map tab.
                        if (tab == 2) {
                            Button(
                                onClick = { showReport = true },
                                shape = RoundedCornerShape(RaRadius.full),
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = Alarm, contentColor = Cream,
                                ),
                                modifier = Modifier
                                    .align(Alignment.BottomCenter)
                                    .padding(bottom = 22.dp)
                                    .height(46.dp),
                            ) { Text(stringResource(R.string.report_hazard_short), style = RaType.label, fontWeight = FontWeight.SemiBold) }
                        }
                    }
                    // Foreground screens paint opaquely over the map when active.
                    when (tab) {
                        0 -> Box(Modifier.fillMaxSize().background(Bg)) {
                            HomeScreen(
                                msisdn = msisdn, vehicleId = vehicleId, vehicleLabel = vehicleLabel,
                                onVehicle = { id, label -> vehicleId = id; vehicleLabel = label },
                                onBook = { tab = 1 },
                                onReport = { showReport = true },
                                onToast = { toast = it },
                            )
                        }
                        1 -> Box(Modifier.fillMaxSize().background(Bg)) {
                            BookScreen(
                                vehicleId = vehicleId,
                                requested = requestedMechanic,
                                onConsumed = { requestedMechanic = null },
                                onToast = { toast = it },
                                onTracked = { id -> bookingId = id; tab = 3 },
                                onNeedVehicle = { tab = 0 },
                            )
                        }
                        2 -> Unit  // map shown beneath
                        3 -> Box(Modifier.fillMaxSize().background(Bg)) {
                            val id = bookingId
                            if (id == null) EmptyTrack(onBook = { tab = 1 })
                            else TrackScreen(bookingId = id, onToast = { toast = it })
                        }
                        else -> Box(Modifier.fillMaxSize().background(Bg)) {
                            MoreScreen(
                                msisdn = msisdn,
                                onSignOut = { Api.clear(); signedIn = false; bookingId = null },
                            )
                        }
                    }

                    if (showReport) {
                        ReportHazardDialog(
                            photoB64 = reportPhotoB64,
                            photoThumb = reportPhotoThumb,
                            onPickPhoto = { reportPhotoPicker.launch("image/*") },
                            onClearPhoto = { reportPhotoB64 = null; reportPhotoThumb = null },
                            onClose = { showReport = false; reportPhotoB64 = null; reportPhotoThumb = null },
                            onToast = { toast = it },
                            onReported = {
                                // Force the retained map to redraw with the new report.
                                mapWebView.evaluateJavascript("window.__refresh&&window.__refresh()", null)
                            },
                        )
                    }
                }
            }
        }

        toast?.let { msg ->
            Card(
                modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 96.dp, start = 18.dp, end = 18.dp),
                shape = RoundedCornerShape(RaRadius.full),
                colors = CardDefaults.cardColors(containerColor = GoldFill),
            ) {
                Text(
                    msg, color = GoldInk, style = RaType.label,
                    modifier = Modifier.padding(horizontal = 18.dp, vertical = 11.dp),
                )
            }
        }
    }

    // Auto-dismiss. This must be a LaunchedEffect, not `remember { scope.launch }`:
    // remember runs its side effect *during* composition and never cancels it, so
    // a burst of toasts leaves a pile of live timers, each racing to null a toast
    // it no longer owns. LaunchedEffect is keyed on the message and cancels the
    // previous timer, so the visible toast always gets its full 3.2 s.
    LaunchedEffect(toast) {
        if (toast != null) {
            kotlinx.coroutines.delay(3200)
            toast = null
        }
    }
}

/** Builds the interactive Leaflet map WebView once. It plots live locations —
 *  mechanics, responder units and road detections — from the platform's seeded
 *  PostGIS datasets over a clean whole-India basemap.
 *
 *  The page reads a fresh access token through the `AndroidAuth` JS bridge on
 *  every fetch and can trigger a silent refresh on 401, so the map never shows
 *  "session expired" — and because the instance is retained across tab switches,
 *  returning to the Map tab is instant. */
@android.annotation.SuppressLint("SetJavaScriptEnabled", "JavascriptInterface", "AddJavascriptInterface")
private fun buildMapWebView(
    context: android.content.Context,
    baseRaw: String,
    isDark: Boolean,
    onBookMechanic: (id: String, name: String, lat: Double, lng: Double) -> Unit,
): android.webkit.WebView {
    val base = baseRaw.trimEnd('/')
    val main = android.os.Handler(android.os.Looper.getMainLooper())
    return android.webkit.WebView(context).apply {
        layoutParams = android.view.ViewGroup.LayoutParams(
            android.view.ViewGroup.LayoutParams.MATCH_PARENT,
            android.view.ViewGroup.LayoutParams.MATCH_PARENT,
        )
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        @Suppress("DEPRECATION") settings.setGeolocationEnabled(true)
        webChromeClient = object : android.webkit.WebChromeClient() {
            override fun onGeolocationPermissionsShowPrompt(
                origin: String?, callback: android.webkit.GeolocationPermissions.Callback?,
            ) { callback?.invoke(origin, true, false) }
        }
        // Bridge so the page always uses a current token and can self-refresh.
        addJavascriptInterface(object {
            @android.webkit.JavascriptInterface fun token(): String = Api.currentToken()
            @android.webkit.JavascriptInterface fun refresh(): Boolean = Api.refreshBlocking()
        }, "AndroidAuth")
        // Bridge for "Request assistance" tapped on a mechanic's map popup. Runs
        // on a binder thread, so hop to the main thread to touch Compose state.
        addJavascriptInterface(object {
            @android.webkit.JavascriptInterface
            fun book(id: String, name: String, lat: Double, lng: Double) {
                main.post { onBookMechanic(id, name, lat, lng) }
            }
        }, "AndroidNav")
        val theme = if (isDark) "dark" else "light"
        loadUrl("$base/map.html#base=$base&token=${Api.currentToken()}&theme=$theme")
    }
}

/** Downscale a picked image to a sane size and JPEG-encode it as base64 —
 *  keeps the upload small and strips the original's metadata. Runs off the main
 *  thread. Returns (base64, preview bitmap) or null if it couldn't be read. */
private fun processReportImage(ctx: android.content.Context, uri: android.net.Uri): Pair<String, android.graphics.Bitmap>? {
    return try {
        val bytes = ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return null
        var bmp = android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return null
        val max = 1280
        if (bmp.width > max || bmp.height > max) {
            val scale = max.toFloat() / maxOf(bmp.width, bmp.height)
            bmp = android.graphics.Bitmap.createScaledBitmap(
                bmp, (bmp.width * scale).toInt(), (bmp.height * scale).toInt(), true)
        }
        val out = java.io.ByteArrayOutputStream()
        bmp.compress(android.graphics.Bitmap.CompressFormat.JPEG, 80, out)
        android.util.Base64.encodeToString(out.toByteArray(), android.util.Base64.NO_WRAP) to bmp
    } catch (_: Exception) { null }
}

/** Citizen road-hazard report — feeds the RAKSHA detection pipeline (source:
 *  citizen), appears on the live map and in the authority queue. Location is the
 *  device's last known fix; an optional photo (picked at app scope) is
 *  downscaled on-device. */
@Composable
private fun ReportHazardDialog(
    photoB64: String?,
    photoThumb: android.graphics.Bitmap?,
    onPickPhoto: () -> Unit,
    onClearPhoto: () -> Unit,
    onClose: () -> Unit,
    onToast: (String) -> Unit,
    onReported: () -> Unit,
) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val perms = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { /* graceful: falls back to an approximate location if denied */ }
    LaunchedEffect(Unit) { perms.launch(arrayOf(android.Manifest.permission.ACCESS_FINE_LOCATION)) }

    var type by remember { mutableStateOf("pothole") }
    var typeOpen by remember { mutableStateOf(false) }
    var severity by remember { mutableIntStateOf(3) }
    var note by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val types = listOf("pothole" to "Pothole", "road_damage" to "Road damage", "obstruction" to "Obstruction")

    AlertDialog(
        onDismissRequest = { if (!busy) onClose() },
        // Don't dismiss on an outside touch — launching the photo picker would
        // otherwise close the dialog and drop the in-progress report.
        properties = androidx.compose.ui.window.DialogProperties(dismissOnClickOutside = false),
        containerColor = Panel,
        title = { Text(stringResource(R.string.report_hazard_title), color = Cream, fontSize = 18.sp) },
        text = {
            Column {
                Text(stringResource(R.string.report_hazard_sub),
                    color = Muted, style = RaType.sub)
                Box {
                    OutlinedButton(
                        onClick = { typeOpen = true }, shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.fillMaxWidth().padding(top = 14.dp),
                    ) { Text(stringResource(R.string.label_type_prefix) + (types.find { it.first == type }?.second ?: type), color = Cream, style = RaType.label) }
                    DropdownMenu(expanded = typeOpen, onDismissRequest = { typeOpen = false }) {
                        types.forEach { (code, label) ->
                            DropdownMenuItem(text = { Text(label) }, onClick = { type = code; typeOpen = false })
                        }
                    }
                }
                Text(stringResource(R.string.label_severity, severity), color = Muted, style = RaType.caption, modifier = Modifier.padding(top = 14.dp))
                Row(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    (1..5).forEach { s ->
                        val sel = s == severity
                        Box(
                            Modifier.size(42.dp).clip(CircleShape)
                                .background(if (sel) GoldFill else Color(0x22E3B96A))
                                .clickable { severity = s },
                            contentAlignment = Alignment.Center,
                        ) { Text("$s", color = if (sel) GoldInk else Cream, fontWeight = FontWeight.Bold) }
                    }
                }
                Field(note, { note = it }, stringResource(R.string.field_note_optional))

                // Optional photo — downscaled on-device before upload.
                Row(Modifier.padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    val thumb = photoThumb
                    if (thumb != null) {
                        Image(
                            bitmap = thumb.asImageBitmap(), contentDescription = stringResource(R.string.cd_attached_photo),
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.size(48.dp).clip(RoundedCornerShape(8.dp)),
                        )
                        Spacer(Modifier.width(10.dp))
                        Text(stringResource(R.string.action_remove), color = Alarm, style = RaType.caption,
                            modifier = Modifier.clip(RoundedCornerShape(8.dp))
                                .clickable { onClearPhoto() }.padding(6.dp))
                    } else {
                        OutlinedButton(
                            onClick = onPickPhoto,
                            shape = RoundedCornerShape(RaRadius.full),
                        ) { Text(stringResource(R.string.action_attach_photo), color = Gold, style = RaType.caption) }
                    }
                }
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    busy = true
                    scope.launch {
                        val loc = Emergency.currentLocation(ctx)
                        val lat = loc?.first ?: 28.4595
                        val lng = loc?.second ?: 77.0266
                        try {
                            Api.post("/v1/raksha/report", JSONObject()
                                .put("type", type).put("severity", severity)
                                .put("lat", lat).put("lng", lng)
                                .apply { if (note.isNotBlank()) put("note", note.trim()) }
                                .apply { photoB64?.let { put("photoBase64", it); put("photoMime", "image/jpeg") } })
                            onToast(if (loc != null) "Hazard reported at your location — thank you"
                                    else "Hazard reported (approximate location)")
                            onReported(); onClose()
                        } catch (e: Exception) { onToast(e.message ?: "Failed to report") }
                        busy = false
                    }
                },
                enabled = !busy,
                colors = ButtonDefaults.buttonColors(containerColor = Alarm, contentColor = Cream),
                shape = RoundedCornerShape(RaRadius.full),
            ) { Text(if (busy) "Reporting…" else "Submit report", fontWeight = FontWeight.SemiBold) }
        },
        dismissButton = { TextButton(onClick = { if (!busy) onClose() }) { Text(stringResource(R.string.action_cancel), color = Muted) } },
    )
}

/** Status → colour. A composable so it reads whichever palette is active. */
@Composable
private fun STATUS_COLOR(s: String): Color {
    val ra = LocalRa.current
    return when (s) {
        "PAID", "COMPLETED", "VERIFIED", "REPAIRED" -> ra.ok
        "CANCELLED", "NO_SUPPLY", "REJECTED", "CLOSED" -> ra.textDim
        "ASSIGNED", "EN_ROUTE", "ON_SITE", "IN_PROGRESS", "DETECTED", "REPAIR_SCHEDULED" -> ra.gold
        else -> ra.warn
    }
}

@Composable
private fun EmptyTrack(onBook: () -> Unit) {
    val scope = rememberCoroutineScope()
    var history by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var loaded by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        try {
            val arr = Api.get("/v1/bookings?limit=20").getJSONArray("data")
            history = (0 until arr.length()).map { arr.getJSONObject(it) }
        } catch (_: Exception) {}
        loaded = true
    }

    ScreenColumn {
        Spacer(Modifier.height(16.dp))
        Heading(R.string.head_rescues_plain, R.string.head_rescues_italic)
        if (history.isEmpty()) {
            Column(
                Modifier.fillMaxWidth().padding(top = 60.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text("◉", fontSize = 48.sp, color = Muted)
                Text(if (loaded) "No rescues yet" else "Loading…", color = Cream, fontSize = 18.sp,
                    modifier = Modifier.padding(top = 12.dp))
                Text(stringResource(R.string.bookings_empty), color = Muted, style = RaType.label,
                    modifier = Modifier.padding(top = 4.dp))
                OutlinedButton(onClick = onBook, shape = RoundedCornerShape(RaRadius.full),
                    modifier = Modifier.padding(top = 18.dp)) { Text(stringResource(R.string.action_request_assistance), color = Gold) }
            }
        } else {
            Sub(stringResource(R.string.bookings_sub))
            history.forEach { b ->
                val status = b.optString("status")
                Card(
                    shape = RoundedCornerShape(16.dp),
                    colors = CardDefaults.cardColors(containerColor = Panel),
                    modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                ) {
                    Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(b.optString("reference"), color = Cream, style = RaType.body)
                            b.optString("highwayMarker").takeIf { it.isNotBlank() && it != "null" }?.let {
                                Text(it, color = Muted, style = RaType.caption, modifier = Modifier.padding(top = 2.dp))
                            }
                        }
                        Text(status, color = STATUS_COLOR(status), style = RaType.meta,
                            fontWeight = FontWeight.Bold, letterSpacing = 0.5.sp)
                    }
                }
            }
        }
        Spacer(Modifier.height(8.dp))
    }
}

@Composable
private fun MoreScreen(msisdn: String, onSignOut: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var summary by remember { mutableStateOf(TripGuardian.cachedSummary(ctx)) }
    var mosaic by remember { mutableStateOf(TripGuardian.mosaic(ctx)?.asImageBitmap()) }
    var contacts by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var reports by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    LaunchedEffect(Unit) {
        try {
            val arr = Api.get("/v1/me/reports").getJSONArray("data")
            reports = (0 until arr.length()).map { arr.getJSONObject(it) }
        } catch (_: Exception) {}
    }
    var cName by remember { mutableStateOf("") }
    var cPhone by remember { mutableStateOf("+91") }
    var cBusy by remember { mutableStateOf(false) }
    // The address this phone talks to, editable here as well as at sign-in.
    // Read once on entry: queueDepth touches disk, and this is a warning line,
    // not a live counter.
    var serverUrl by remember { mutableStateOf(Api.base) }
    val queuedSos = remember { Emergency.queueDepth(ctx) }
    var serverBusy by remember { mutableStateOf(false) }
    var serverUnreachable by remember { mutableStateOf(false) }
    suspend fun loadContacts() {
        try {
            val arr = Api.get("/v1/me/emergency-contacts").getJSONArray("data")
            contacts = (0 until arr.length()).map { arr.getJSONObject(it) }
        } catch (_: Exception) {}
    }
    LaunchedEffect(Unit) { loadContacts() }

    val ra = LocalRa.current
    val riskColor = { r: String -> when (r) {
        "LOW", "GOOD" -> ra.ok; "MEDIUM", "FAIR" -> ra.warn
        "HIGH", "POOR" -> ra.warn; "CRITICAL" -> ra.alarm; else -> ra.textDim
    } }

    ScreenColumn {
        Spacer(Modifier.height(16.dp))
        Heading(R.string.head_more_plain, R.string.head_more_italic)
        Sub("$msisdn " + stringResource(R.string.signed_in_suffix))

        Card(
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = Panel),
            modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
        ) {
            Column(Modifier.padding(17.dp)) {
                Text(stringResource(R.string.trip_guardian), color = Cream, style = RaType.title)
                Text(stringResource(R.string.trip_guardian_sub),
                    color = Muted, style = RaType.sub, modifier = Modifier.padding(top = 4.dp))

                summary?.let { s ->
                    s.weatherRisk?.let { risk ->
                        Row(Modifier.padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(stringResource(R.string.label_weather), color = Muted, style = RaType.caption)
                            Text(risk, color = riskColor(risk), style = RaType.label, fontWeight = FontWeight.Bold)
                        }
                        Text(s.weatherFactors, color = Muted, fontSize = 11.5.sp, lineHeight = 16.sp)
                    }
                    Text(stringResource(R.string.label_deadzone_risk), color = Muted, style = RaType.caption, modifier = Modifier.padding(top = 10.dp))
                    s.segments.forEach { (code, risk, ratio) ->
                        Row(Modifier.padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text("●", color = riskColor(risk), style = RaType.caption)
                            Text("  ${code.removePrefix("NH48-")} — $risk" +
                                (ratio?.let { " (${(it * 100).toInt()}% offline)" } ?: ""),
                                color = Cream, style = RaType.caption)
                        }
                    }
                    mosaic?.let { bmp ->
                        Image(
                            bitmap = bmp, contentDescription = stringResource(R.string.cd_offline_route_map),
                            contentScale = ContentScale.FillWidth,
                            modifier = Modifier.fillMaxWidth().padding(top = 12.dp)
                                .clip(RoundedCornerShape(12.dp)),
                        )
                        Text(stringResource(R.string.map_tiles_cached, s.tilesCached, s.tilesTotal),
                            color = Muted, fontSize = 10.5.sp, modifier = Modifier.padding(top = 6.dp))
                    }
                }

                Button(
                    onClick = {
                        busy = true
                        scope.launch {
                            try {
                                summary = TripGuardian.prepare(ctx)
                                mosaic = TripGuardian.mosaic(ctx)?.asImageBitmap()
                            } catch (_: Exception) { /* offline — cached view stays */ }
                            busy = false
                        }
                    },
                    enabled = !busy,
                    shape = RoundedCornerShape(RaRadius.full),
                    colors = ButtonDefaults.buttonColors(containerColor = GoldFill, contentColor = GoldInk),
                    modifier = Modifier.fillMaxWidth().padding(top = 14.dp).height(48.dp),
                ) { Text(if (summary == null) "Prepare my route" else "Refresh route",
                    fontWeight = FontWeight.SemiBold, letterSpacing = 1.5.sp, style = RaType.caption) }
                if (busy) Loading()
            }
        }

        // Your hazard reports and where each one is in the review pipeline.
        if (reports.isNotEmpty()) {
            Card(
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = Panel),
                modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
            ) {
                Column(Modifier.padding(17.dp)) {
                    Text(stringResource(R.string.my_reports), color = Cream, style = RaType.title)
                    Text(stringResource(R.string.my_reports_sub),
                        color = Muted, style = RaType.caption, modifier = Modifier.padding(top = 4.dp))
                    reports.forEach { r ->
                        val st = r.optString("status")
                        Row(Modifier.fillMaxWidth().padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(
                                    r.optString("detection_type").replace("_", " ")
                                        .replaceFirstChar { it.uppercase() } + " · severity ${r.optInt("severity")}",
                                    color = Cream, fontSize = 14.sp,
                                )
                                r.optString("notes").takeIf { it.isNotBlank() && it != "null" }?.let {
                                    Text(it, color = Muted, fontSize = 11.5.sp, lineHeight = 15.sp,
                                        modifier = Modifier.padding(top = 2.dp))
                                }
                                if (r.optBoolean("has_photo")) {
                                    Text(stringResource(R.string.photo_attached), color = Gold, style = RaType.meta,
                                        modifier = Modifier.padding(top = 2.dp))
                                }
                            }
                            Text(st, color = STATUS_COLOR(st), style = RaType.meta,
                                fontWeight = FontWeight.Bold, letterSpacing = 0.5.sp)
                        }
                    }
                }
            }
        }

        // Emergency contacts — who gets alerted when you confirm an SOS.
        Card(
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = Panel),
            modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
        ) {
            Column(Modifier.padding(17.dp)) {
                Text(stringResource(R.string.emergency_contacts), color = Cream, style = RaType.title)
                Text(stringResource(R.string.emergency_contacts_sub),
                    color = Muted, style = RaType.sub, modifier = Modifier.padding(top = 4.dp))

                if (contacts.isEmpty()) {
                    Text(stringResource(R.string.emergency_contacts_empty), color = Color(0xFFE3C451),
                        style = RaType.caption, modifier = Modifier.padding(top = 10.dp))
                } else contacts.forEach { c ->
                    Row(Modifier.fillMaxWidth().padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(c.optString("name"), color = Cream, fontSize = 14.sp)
                            Text(c.optString("msisdn"), color = Muted, style = RaType.caption)
                        }
                        Text(stringResource(R.string.action_remove), color = Alarm, style = RaType.caption,
                            modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable(enabled = !cBusy) {
                                cBusy = true
                                scope.launch {
                                    try { Api.delete("/v1/me/emergency-contacts/${c.getString("id")}"); loadContacts() }
                                    catch (e: Exception) {}
                                    cBusy = false
                                }
                            }.padding(6.dp))
                    }
                }

                Field(cName, { cName = it }, stringResource(R.string.field_contact_name))
                Field(cPhone, { cPhone = it }, stringResource(R.string.field_contact_phone))
                Button(
                    onClick = {
                        cBusy = true
                        scope.launch {
                            try {
                                Api.post("/v1/me/emergency-contacts",
                                    JSONObject().put("name", cName.trim()).put("msisdn", cPhone.trim()))
                                cName = ""; cPhone = "+91"; loadContacts()
                            } catch (e: Exception) {}
                            cBusy = false
                        }
                    },
                    enabled = !cBusy && cName.length >= 2 && cPhone.length >= 13,
                    shape = RoundedCornerShape(RaRadius.full),
                    colors = ButtonDefaults.buttonColors(containerColor = GoldFill, contentColor = GoldInk),
                    modifier = Modifier.fillMaxWidth().padding(top = 12.dp).height(46.dp),
                ) { Text(stringResource(R.string.action_add_contact), fontWeight = FontWeight.SemiBold, letterSpacing = 1.5.sp, style = RaType.caption) }
            }
        }

        // Server — the same address the sign-in screen offers, reachable once
        // signed in. Switching servers ends the session on purpose: the tokens
        // in memory were issued by the server being left, and carrying them to
        // another one produces 401s that look like a broken app rather than a
        // deliberate change. Signing out also drops the retained map WebView,
        // which captured the OLD base when it was built.
        Card(
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = Panel),
            modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
        ) {
            Column(Modifier.padding(17.dp)) {
                Text(stringResource(R.string.server), color = Cream, style = RaType.title)
                Text(stringResource(R.string.server_sub),
                    color = Muted, style = RaType.sub, modifier = Modifier.padding(top = 4.dp))

                Field(serverUrl, { serverUrl = it; serverUnreachable = false },
                    stringResource(R.string.field_api_base_url))

                // Unsent emergencies belong to the phone, not to a server, so they
                // would be replayed to whichever one is set when the link returns.
                // Said plainly rather than blocking the switch: a wrong address is
                // exactly why they are still queued, so refusing here would strand
                // the person who most needs to fix it.
                if (queuedSos > 0) {
                    Text(stringResource(R.string.server_queued_warning, queuedSos),
                        color = Color(0xFFE3C451), style = RaType.caption,
                        modifier = Modifier.padding(top = 10.dp))
                }

                // The address is TRIED before it is adopted. Switching signs the
                // user out, so committing an unchecked address means a typo ends
                // a session and lands them on a sign-in screen pointed at nothing.
                // On failure nothing changes at all — still signed in, still on
                // the old server.
                if (serverUnreachable) {
                    Text(stringResource(R.string.server_unreachable), color = Alarm,
                        style = RaType.caption, modifier = Modifier.padding(top = 10.dp))
                }
                if (serverBusy) Loading()

                Button(
                    onClick = {
                        serverBusy = true
                        serverUnreachable = false
                        scope.launch {
                            if (Api.reachable(serverUrl)) {
                                commitApiBase(ctx, serverUrl)
                                onSignOut()
                            } else {
                                serverUnreachable = true
                                serverBusy = false
                            }
                        }
                    },
                    enabled = !serverBusy && !Api.isCurrentBase(serverUrl),
                    shape = RoundedCornerShape(RaRadius.full),
                    colors = ButtonDefaults.buttonColors(containerColor = GoldFill, contentColor = GoldInk),
                    modifier = Modifier.fillMaxWidth().padding(top = 12.dp).height(46.dp),
                ) { Text(stringResource(R.string.action_use_server),
                    fontWeight = FontWeight.SemiBold, letterSpacing = 1.5.sp, style = RaType.caption) }
            }
        }
        Card(
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = Panel),
            modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
        ) {
            Column(Modifier.padding(17.dp)) {
                Text(stringResource(R.string.about), color = Cream, style = RaType.title)
                Text(stringResource(R.string.about_body),
                    color = Muted, style = RaType.sub, modifier = Modifier.padding(top = 4.dp))
            }
        }
        LineButton(stringResource(R.string.action_sign_out)) { onSignOut() }
    }
}

/**
 * Adopt an API address and keep it for the next launch.
 *
 * Two screens set this now — sign-in, and the server card in More — and each
 * has to normalise, assign and persist, in that order, to the same
 * preferences key that MainActivity.onCreate reads back. Written out twice
 * they drift; the second copy is how a screen ends up setting Api.base
 * without saving it, which works until the app is restarted.
 *
 * Returns the address actually adopted, so the caller can show the cleaned-up
 * form in its own field rather than leaving what was typed.
 */
private fun commitApiBase(ctx: android.content.Context, input: String): String {
    val address = Api.normalizeBase(input)
    Api.base = address
    ctx.getSharedPreferences("ra.ui", android.content.Context.MODE_PRIVATE)
        .edit().putString("apiBase", address).apply()
    return address
}

// ── shared pieces ──────────────────────────────────────────────────────────
@Composable
private fun ScreenColumn(content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(RaSpace.s5),
        content = content,
    )
}

@Composable
private fun Heading(@StringRes plain: Int, @StringRes italic: Int) {
    Row {
        Text(stringResource(plain), style = RaType.heading, color = Cream)
        Text(
            " " + stringResource(italic), style = RaType.heading, color = Gold,
            fontStyle = FontStyle.Italic,
        )
    }
}

@Composable
private fun Sub(text: String) {
    Text(text, style = RaType.label, color = Muted, lineHeight = 19.sp, modifier = Modifier.padding(top = 6.dp))
}

@Composable
private fun Field(value: String, onChange: (String) -> Unit, label: String, enabled: Boolean = true) {
    OutlinedTextField(
        value = value, onValueChange = onChange, enabled = enabled,
        label = { Text(label, color = Muted, style = RaType.caption) },
        singleLine = true,
        shape = RoundedCornerShape(12.dp),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = Gold, unfocusedBorderColor = Color(0x33E3B96A),
            focusedTextColor = Cream, unfocusedTextColor = Cream,
            cursorColor = Gold,
        ),
        modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
    )
}

@Composable
private fun GoldButton(text: String, enabled: Boolean = true, onClick: () -> Unit) {
    Button(
        onClick = onClick, enabled = enabled,
        shape = RoundedCornerShape(RaRadius.full),
        colors = ButtonDefaults.buttonColors(containerColor = GoldFill, contentColor = GoldInk),
        modifier = Modifier.fillMaxWidth().padding(top = 16.dp).height(52.dp),
    ) { Text(text, fontWeight = FontWeight.SemiBold, letterSpacing = 2.sp, style = RaType.caption) }
}

@Composable
private fun LineButton(text: String, onClick: () -> Unit) {
    OutlinedButton(
        onClick = onClick,
        shape = RoundedCornerShape(RaRadius.full),
        modifier = Modifier.fillMaxWidth().padding(top = 10.dp).height(48.dp),
    ) { Text(text, color = Muted, style = RaType.caption, letterSpacing = 1.5.sp) }
}

// ── sign in ────────────────────────────────────────────────────────────────
@Composable
private fun SignInScreen(
    msisdn: String, onMsisdn: (String) -> Unit,
    onToast: (String) -> Unit,
    onSignedIn: (vehicleId: String?, vehicleLabel: String?) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val ctx = LocalContext.current
    var code by remember { mutableStateOf("") }
    var otpSent by remember { mutableStateOf(false) }
    // The server address, hidden until somebody asks for it. See the long-press
    // on the wordmark below.
    var showServer by remember { mutableStateOf(false) }
    var baseUrl by remember { mutableStateOf(Api.base) }
    var busy by remember { mutableStateOf(false) }

    // Signing in is a phone number and a six-digit code. The address this app
    // talks to is not a thing a person signing in should be asked about: it is
    // restored from preferences in onCreate, so whatever was last used is already
    // in force by the time this composes, and it is changed from the Server card
    // in More once signed in.
    //
    // But a handset that has NEVER signed in cannot reach that card, and the
    // built-in default (10.0.2.2) is an emulator alias that means nothing on real
    // hardware — so without some way in, the app is emulator-only on first run.
    // Long-pressing the wordmark is that way in. It is deliberately not a button:
    // the first screen stays a phone number and a code, and the escape hatch is
    // written down in CLAUDE.md rather than drawn on the screen.
    fun commitBase() { baseUrl = commitApiBase(ctx, baseUrl) }

    ScreenColumn {
        Spacer(Modifier.height(40.dp))
        Row(
            Modifier.fillMaxWidth()
                .pointerInput(Unit) {
                    detectTapGestures(onLongPress = { showServer = !showServer })
                },
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            BrandMark(40)
            Spacer(Modifier.width(12.dp))
            Row {
                Text("Road", color = Cream, style = RaType.display)
                Text("Assist", color = Gold, style = RaType.display)
            }
        }
        Text(stringResource(R.string.tagline),
            color = Muted, style = RaType.caption, letterSpacing = 1.sp,
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        Spacer(Modifier.height(34.dp))
        Heading(R.string.head_signin_plain, R.string.head_signin_italic)
        Sub(stringResource(R.string.signin_sub))

        if (showServer) {
            Field(baseUrl, { baseUrl = it }, stringResource(R.string.field_api_base_url))
        }
        Field(msisdn, onMsisdn, stringResource(R.string.field_mobile_number))

        if (!otpSent) {
            GoldButton(stringResource(R.string.action_send_otp), enabled = !busy) {
                busy = true
                if (showServer) commitBase()
                scope.launch {
                    try {
                        val r = Api.post("/v1/auth/otp/request", JSONObject().put("msisdn", msisdn.trim()))
                        val dev = r.optJSONObject("meta")?.optString("devOtp").orEmpty()
                        if (dev.isNotBlank()) { code = dev; onToast("Dev OTP auto-filled ($dev)") }
                        else onToast(ctx.getString(R.string.toast_otp_sent))
                        otpSent = true
                    } catch (e: Exception) { onToast(e.message ?: "Failed") }
                    busy = false
                }
            }
        } else {
            Field(code, { code = it }, stringResource(R.string.field_otp_code))
            GoldButton(stringResource(R.string.action_verify_sign_in), enabled = !busy && code.length == 6) {
                busy = true
                if (showServer) commitBase()
                scope.launch {
                    try {
                        val r = Api.post(
                            "/v1/auth/otp/verify",
                            JSONObject().put("msisdn", msisdn.trim()).put("code", code.trim()),
                        )
                        Api.adoptSession(r.getJSONObject("data"))
                        val me = Api.get("/v1/me").getJSONObject("data")
                        val vehicles = me.optJSONArray("vehicles") ?: JSONArray()
                        if (vehicles.length() > 0) {
                            val v = vehicles.getJSONObject(0)
                            onSignedIn(v.getString("id"), v.getString("registrationNo"))
                        } else onSignedIn(null, null)
                        onToast(ctx.getString(R.string.toast_signed_in))
                    } catch (e: Exception) { onToast(e.message ?: "Failed") }
                    busy = false
                }
            }
        }
        if (busy) Loading()
    }
}

// ── home: SOS + vehicle ────────────────────────────────────────────────────
/** Seconds between arming SOS and the fallback ladder actually running. */
private const val SOS_GRACE_S = 5
@Composable
private fun HomeScreen(
    msisdn: String, vehicleId: String?, vehicleLabel: String?,
    onVehicle: (String, String) -> Unit,
    onBook: () -> Unit, onReport: () -> Unit, onToast: (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var reg by remember { mutableStateOf("") }
    var vClass by remember { mutableStateOf("car") }
    var classOpen by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var sosResult by remember { mutableStateOf<String?>(null) }
    val classes = listOf("car", "motorcycle", "scooter", "auto_rickshaw", "truck", "bus", "tractor", "ev")

    ScreenColumn {
        Spacer(Modifier.height(16.dp))
        Heading(R.string.head_home_plain, R.string.head_home_italic)
        Sub("$msisdn " + stringResource(R.string.signed_in_suffix))

        // SOS — the fallback ladder: data → SMS → 112 → queue. Works with no net.
        val ctx = LocalContext.current
        val DEMO_LAT = 28.4595; val DEMO_LNG = 77.0266   // fallback if no GPS fix yet
        // Arm the no-data (SMS) and real-location rungs by requesting both perms.
        val perms = rememberLauncherForActivityResult(
            ActivityResultContracts.RequestMultiplePermissions(),
        ) { /* granted or not, the ladder degrades gracefully per rung */ }

        var sosArmed by remember { mutableStateOf(false) }
        var sosLeft by remember { mutableIntStateOf(SOS_GRACE_S) }

        // Any queued SOS flushes automatically when data returns.
        LaunchedEffect(Unit) {
            val flushed = Emergency.flush(ctx)
            if (flushed > 0) onToast(ctx.getString(R.string.toast_sos_synced, flushed))
        }

        // ── SOS grace window ────────────────────────────────────────────────
        // A pocket press costs a responder a real journey, so the button arms a
        // short countdown instead of escalating on contact. This wraps the
        // fallback ladder rather than reaching into it. (The web app raises first
        // and cancels server-side; here the window sits before the ladder,
        // because the SMS and dialer rungs have no server incident to cancel.)
        //
        // The ladder's DECISIONS now live in SosLadder.kt as pure functions, and
        // Emergency.raise calls them rather than restating them. An earlier note
        // here said the ladder was deliberately left unrestructured because it is
        // the most safety-critical code in the app. That instinct was right about
        // the stakes and wrong about the remedy: being untestable is not the same
        // as being safe, and none of it could run off a device. The rearrangement
        // is behaviour-preserving — every branch traced — and SosLadderTest now
        // pins all of them, which is what non-negotiable #1 actually asks for.
        val fireSos: () -> Unit = {
            busy = true
            scope.launch {
                // Ask for a fix rather than hoping one is cached: an emergency
                // is exactly when nothing else has recently used GPS.
                val loc = Emergency.currentLocation(ctx)
                val lat = loc?.first ?: DEMO_LAT
                val lng = loc?.second ?: DEMO_LNG
                val result = Emergency.raise(ctx, lat, lng) {
                    val raised = Api.post(
                        "/v1/sos",
                        JSONObject().put("lat", lat).put("lng", lng).put("source", "manual"),
                    ).getJSONObject("data")
                    val c = Api.post("/v1/sos/${raised.getString("id")}/confirm").getJSONObject("data")
                    val responder = c.optJSONObject("nearestResponder")?.optString("name") ?: "—"
                    val where = if (loc != null) "real GPS" else "demo location"
                    "Escalated ($where) · contacts ${c.optInt("contactsAlerted")} · $responder · ${c.optInt("elapsedMs")} ms"
                }
                sosResult = when (result.rung) {
                    SosLadder.Rung.DATA -> "✓ ONLINE — ${result.detail}"
                    SosLadder.Rung.SMS -> "✓ NO DATA → SMS — ${result.detail}"
                    SosLadder.Rung.DIALER -> "→ ${result.detail}"
                    SosLadder.Rung.QUEUED -> "◷ ${result.detail}"
                }
                onToast("SOS via ${result.rung}")
                busy = false
            }
        }

        LaunchedEffect(sosArmed) {
            if (!sosArmed) return@LaunchedEffect
            while (sosLeft > 0 && sosArmed) {
                kotlinx.coroutines.delay(1000)
                sosLeft -= 1
            }
            if (sosArmed) { sosArmed = false; fireSos() }
        }

        if (sosArmed) {
            AlertDialog(
                // Modal on purpose: an emergency is dismissed by an explicit
                // choice, never by a stray tap outside the dialog.
                onDismissRequest = { },
                containerColor = Panel,
                title = { Text(stringResource(R.string.sos_alerting_in, sosLeft), color = Alarm, fontSize = 19.sp) },
                text = {
                    Text(
                        "Your emergency contacts and the nearest responder will be alerted with " +
                            "your location. Cancel now if this was a mistake — a false alarm costs " +
                            "a responder a real journey.",
                        color = Muted, style = RaType.label, lineHeight = 18.sp,
                    )
                },
                confirmButton = {
                    Button(
                        onClick = { sosArmed = false; fireSos() },
                        colors = ButtonDefaults.buttonColors(containerColor = Alarm, contentColor = Color.White),
                    ) { Text(stringResource(R.string.sos_alert_now), style = RaType.label, fontWeight = FontWeight.SemiBold) }
                },
                dismissButton = {
                    TextButton(onClick = {
                        sosArmed = false
                        onToast(ctx.getString(R.string.toast_sos_cancelled))
                    }) { Text(stringResource(R.string.action_cancel), color = Muted, style = RaType.label) }
                },
            )
        }

        Box(Modifier.fillMaxWidth().padding(vertical = 26.dp), contentAlignment = Alignment.Center) {
            // Soft red glow behind the SOS ring — draws the eye to the one
            // control that matters most in an emergency. Remembered because the
            // gradient is constant: rebuilding the Brush (and its colour list) on
            // every recomposition allocates on the countdown's per-second tick.
            // Alarm is a @Composable theme accessor, so it is read here and used
            // as the key — the brush is rebuilt only when the light/dark toggle
            // actually changes the colour, not on every recomposition.
            val alarm = Alarm
            val glow = remember(alarm) {
                Brush.radialGradient(
                    listOf(alarm.copy(alpha = 0.28f), alarm.copy(alpha = 0.06f), Color.Transparent),
                )
            }
            Box(Modifier.size(230.dp).background(glow, CircleShape))
            Button(
                onClick = {
                    // Arm the no-data + real-location rungs up front, so the
                    // permission dialogs are out of the way before the window ends.
                    perms.launch(arrayOf(
                        android.Manifest.permission.SEND_SMS,
                        android.Manifest.permission.ACCESS_FINE_LOCATION,
                    ))
                    sosLeft = SOS_GRACE_S
                    sosArmed = true
                },
                enabled = !busy && !sosArmed,
                shape = CircleShape,
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1A0B08), contentColor = Cream),
                modifier = Modifier.size(150.dp).border(1.dp, Alarm.copy(alpha = 0.7f), CircleShape),
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("SOS", fontSize = 20.sp, letterSpacing = 6.sp, fontWeight = FontWeight.SemiBold)
                    Text(stringResource(R.string.sos_5s_to_cancel), fontSize = 9.sp, letterSpacing = 1.sp, color = Muted)
                }
            }
        }
        sosResult?.let {
            Text(it, color = Alarm, style = RaType.sub,
                modifier = Modifier.align(Alignment.CenterHorizontally))
        }
        Text(
            stringResource(R.string.sos_offline_note),
            color = Muted, style = RaType.meta, lineHeight = 16.sp,
            modifier = Modifier.padding(top = 8.dp).align(Alignment.CenterHorizontally),
        )

        Spacer(Modifier.height(18.dp))
        Card(
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = Panel),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(Modifier.padding(17.dp)) {
                if (vehicleId == null) {
                    Text(stringResource(R.string.vehicle_add_title), color = Cream, style = RaType.title)
                    Field(reg, { reg = it.uppercase() }, stringResource(R.string.field_registration_number))
                    Box {
                        OutlinedButton(
                            onClick = { classOpen = true },
                            shape = RoundedCornerShape(12.dp),
                            modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                        ) { Text(stringResource(R.string.label_vehicle_type, vClass), color = Cream, style = RaType.label) }
                        DropdownMenu(expanded = classOpen, onDismissRequest = { classOpen = false }) {
                            classes.forEach { c ->
                                DropdownMenuItem(
                                    text = { Text(c) },
                                    onClick = { vClass = c; classOpen = false },
                                )
                            }
                        }
                    }
                    GoldButton(stringResource(R.string.action_add_vehicle), enabled = !busy && reg.length >= 4) {
                        busy = true
                        scope.launch {
                            try {
                                val v = Api.post(
                                    "/v1/vehicles",
                                    JSONObject().put("registrationNo", reg.trim()).put("vehicleClass", vClass),
                                ).getJSONObject("data")
                                onVehicle(v.getString("id"), v.getString("registrationNo"))
                                onToast(ctx.getString(R.string.toast_vehicle_added))
                            } catch (e: Exception) { onToast(e.message ?: "Failed") }
                            busy = false
                        }
                    }
                } else {
                    Text(stringResource(R.string.vehicle_yours), color = Cream, style = RaType.title)
                    Text(vehicleLabel ?: "", color = Muted, style = RaType.label, modifier = Modifier.padding(top = 4.dp))
                    GoldButton(stringResource(R.string.action_request_assistance)) { onBook() }
                }
            }
        }

        // Crowdsourced road-safety: flag a hazard for the RAKSHA network.
        Card(
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = Panel),
            modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
        ) {
            Column(Modifier.padding(17.dp)) {
                Text(stringResource(R.string.hazard_prompt_title), color = Cream, style = RaType.title)
                Text(stringResource(R.string.hazard_prompt_sub),
                    color = Muted, style = RaType.sub, modifier = Modifier.padding(top = 4.dp))
                OutlinedButton(
                    onClick = onReport,
                    shape = RoundedCornerShape(RaRadius.full),
                    modifier = Modifier.fillMaxWidth().padding(top = 12.dp).height(46.dp),
                ) { Text(stringResource(R.string.hazard_prompt_action), color = Alarm, style = RaType.caption, letterSpacing = 1.sp) }
            }
        }

        Spacer(Modifier.height(8.dp))
        if (busy) Loading()
    }
}

// ── booking + dispatch offers ──────────────────────────────────────────────
@Composable
private fun BookScreen(
    vehicleId: String?,
    requested: JSONObject?,
    onConsumed: () -> Unit,
    onToast: (String) -> Unit,
    onTracked: (String) -> Unit,
    onNeedVehicle: () -> Unit,
) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var services by remember { mutableStateOf<List<Pair<String, String>>>(emptyList()) }
    var service by remember { mutableStateOf<Pair<String, String>?>(null) }
    var svcOpen by remember { mutableStateOf(false) }
    var symptoms by remember { mutableStateOf("") }
    var offers by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var bookingId by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var loadError by remember { mutableStateOf(false) }
    var reloadKey by remember { mutableIntStateOf(0) }
    // The mechanic this booking is oriented around — tapped on the map or in the
    // nearby list. Its coordinates become the booking location so it's the
    // top-ranked offer. Held as {id,name,lat,lng}.
    var target by remember { mutableStateOf<JSONObject?>(null) }
    var nearby by remember { mutableStateOf<List<JSONObject>>(emptyList()) }

    // A mechanic handed over from the live map: focus it and clear the handoff.
    LaunchedEffect(requested) {
        requested?.let {
            target = it
            symptoms = ""
            onToast("Requesting assistance near ${it.optString("name")}")
            onConsumed()
        }
    }

    // Load service types. The API returns {code,label}; retryable on failure.
    LaunchedEffect(reloadKey) {
        loadError = false
        try {
            val arr = Api.get("/v1/service-types").getJSONArray("data")
            services = (0 until arr.length()).map {
                val s = arr.getJSONObject(it)
                s.getString("code") to s.getString("label")
            }
            service = services.firstOrNull()
        } catch (e: Exception) {
            loadError = true
            onToast(e.message ?: "Failed to load services")
        }
    }

    // Nearest verified mechanics for the "nearby" list (real PostGIS query).
    LaunchedEffect(Unit) {
        try {
            val d = Api.get("/v1/map/live?lat=28.4595&lng=77.0266&radiusKm=30").getJSONObject("data")
            val arr = d.getJSONArray("mechanics")
            nearby = (0 until arr.length()).map { arr.getJSONObject(it) }.take(6)
        } catch (_: Exception) {}
    }

    val bookLat = target?.optDouble("lat", 28.4595) ?: 28.4595
    val bookLng = target?.optDouble("lng", 77.0266) ?: 77.0266

    fun bookAndDispatch() {
        busy = true
        scope.launch {
            try {
                val note = symptoms.ifBlank {
                    target?.let { "Requested ${it.optString("name")} from the live map" } ?: "reported from the Android app"
                }
                val b = Api.post(
                    "/v1/bookings",
                    JSONObject()
                        .put("vehicleId", vehicleId)
                        .put("serviceTypeCode", service!!.first)
                        .put("lat", bookLat).put("lng", bookLng)
                        .put("symptoms", note)
                        .put("highwayMarker", "NH-48, KM 212")
                        .put("idempotencyKey", "and-" + System.nanoTime()),
                ).getJSONObject("data")
                bookingId = b.getString("id")
                onToast("Booking ${b.getString("reference")} — dispatching…")
                val d = Api.post("/v1/bookings/${bookingId}/dispatch",
                    JSONObject().put("radiusKm", 30).put("limit", 5)).getJSONObject("data")
                val arr = d.optJSONArray("offers") ?: JSONArray()
                offers = (0 until arr.length()).map { arr.getJSONObject(it) }
                if (offers.isEmpty()) onToast(ctx.getString(R.string.toast_no_mechanic))
            } catch (e: Exception) { onToast(e.message ?: "Failed") }
            busy = false
        }
    }

    ScreenColumn {
        Spacer(Modifier.height(16.dp))
        Heading(R.string.head_book_plain, R.string.head_book_italic)
        Sub(stringResource(R.string.mechanics_nearby_sub))

        // Focused-mechanic banner (from the map or nearby list).
        target?.let { t ->
            Card(
                shape = RoundedCornerShape(14.dp),
                colors = CardDefaults.cardColors(containerColor = Color(0x1FE3B96A)),
                modifier = Modifier.fillMaxWidth().padding(top = 14.dp),
            ) {
                Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(stringResource(R.string.dispatch_requesting_near), color = Muted, style = RaType.meta)
                        Text(t.optString("name"), color = Gold, style = RaType.body, fontWeight = FontWeight.SemiBold)
                    }
                    Text(stringResource(R.string.action_clear), color = Muted, style = RaType.caption,
                        modifier = Modifier.clip(RoundedCornerShape(8.dp))
                            .clickable { target = null }.padding(6.dp))
                }
            }
        }

        Box {
            OutlinedButton(
                onClick = { if (loadError) reloadKey++ else if (services.isNotEmpty()) svcOpen = true },
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth().padding(top = 14.dp),
            ) {
                Text(
                    "Service: " + when {
                        service != null -> service!!.second
                        loadError -> "couldn't load — tap to retry"
                        else -> "loading…"
                    },
                    color = if (loadError) Alarm else Cream, style = RaType.label,
                )
            }
            DropdownMenu(expanded = svcOpen, onDismissRequest = { svcOpen = false }) {
                services.forEach { s ->
                    DropdownMenuItem(text = { Text(s.second) }, onClick = { service = s; svcOpen = false })
                }
            }
        }
        Field(symptoms, { symptoms = it }, stringResource(R.string.field_what_happened))

        GoldButton(stringResource(R.string.action_book_dispatch), enabled = !busy && vehicleId != null && service != null) { bookAndDispatch() }

        // Offers from the dispatch broadcast; the focused mechanic is tagged.
        offers.forEach { o ->
            val m = o.getJSONObject("mechanic")
            val isTarget = target?.optString("id")?.let { it == m.optString("id") } ?: false
            Card(
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = Panel),
                modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
            ) {
                Row(
                    Modifier.padding(15.dp), verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Column(Modifier.weight(1f)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(m.getString("displayName"), color = Cream, style = RaType.body)
                            if (isTarget) Text(stringResource(R.string.from_map), color = Gold, fontSize = 10.sp)
                        }
                        Text(
                            "★ ${m.getDouble("rating")} · ${m.getDouble("distanceKm")} km · ETA ${o.getInt("etaMinutes")} min",
                            color = Muted, style = RaType.caption,
                        )
                    }
                    Button(
                        onClick = {
                            busy = true
                            scope.launch {
                                try {
                                    Api.post("/v1/offers/${o.getString("id")}/accept")
                                    onToast("Assigned to ${m.getString("displayName")}")
                                    onTracked(bookingId!!)
                                } catch (e: Exception) { onToast(e.message ?: "Failed") }
                                busy = false
                            }
                        },
                        enabled = !busy,
                        shape = RoundedCornerShape(RaRadius.full),
                        colors = ButtonDefaults.buttonColors(containerColor = GoldFill, contentColor = GoldInk),
                    ) { Text(stringResource(R.string.action_accept), style = RaType.meta, fontWeight = FontWeight.Bold) }
                }
            }
        }

        // Nearby verified mechanics — tap "Request" to focus one for this booking.
        if (offers.isEmpty() && nearby.isNotEmpty()) {
            Text(stringResource(R.string.mechanics_nearby), color = Cream, style = RaType.body,
                modifier = Modifier.padding(top = 22.dp))
            nearby.forEach { m ->
                Card(
                    shape = RoundedCornerShape(16.dp),
                    colors = CardDefaults.cardColors(containerColor = Panel),
                    modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
                ) {
                    Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(m.optString("display_name"), color = Cream, fontSize = 14.sp)
                            Text("★ ${m.optDouble("rating", 0.0)} · ${m.optDouble("km", 0.0)} km away",
                                color = Muted, style = RaType.caption)
                        }
                        OutlinedButton(
                            onClick = {
                                target = JSONObject()
                                    .put("id", m.optString("id")).put("name", m.optString("display_name"))
                                    .put("lat", m.optDouble("lat")).put("lng", m.optDouble("lng"))
                                onToast("Focused ${m.optString("display_name")}")
                            },
                            shape = RoundedCornerShape(RaRadius.full),
                        ) { Text(stringResource(R.string.action_request), color = Gold, style = RaType.meta) }
                    }
                }
            }
        }

        if (vehicleId == null) LineButton(stringResource(R.string.action_add_vehicle_first)) { onNeedVehicle() }
        Spacer(Modifier.height(8.dp))
        if (busy) Loading()
    }
}

// ── live tracking through the state machine ────────────────────────────────
private val CommandLabels = mapOf(
    "mechanic.start_travel" to "Mechanic departs",
    "arrive" to "Mechanic arrives",
    "work.start" to "Work starts",
    "work.complete" to "Work complete",
    "payment.settled" to "Pay invoice",
    "cancel" to "Cancel booking",
    "parts.required" to "Parts needed",
    "parts.received" to "Parts received",
    "tow.required" to "Needs tow",
    "tow.assigned" to "Tow assigned",
    "retry.widen" to "Widen search",
)

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TrackScreen(bookingId: String, onToast: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    var status by remember { mutableStateOf("…") }
    var commands by remember { mutableStateOf<List<String>>(emptyList()) }
    var invoice by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    remember {
        scope.launch {
            try {
                val r = Api.get("/v1/bookings/$bookingId")
                status = r.getJSONObject("data").getString("status")
                val next = r.optJSONObject("meta")?.optJSONArray("nextCommands") ?: JSONArray()
                commands = (0 until next.length()).map { next.getString(it) }
            } catch (e: Exception) { onToast(e.message ?: "Failed") }
        }
        true
    }

    ScreenColumn {
        Spacer(Modifier.height(16.dp))
        Heading(R.string.head_track_plain, R.string.head_track_italic)
        Sub("Booking $bookingId")

        Card(
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = Panel),
            modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
        ) {
            Column(Modifier.padding(17.dp)) {
                Text(stringResource(R.string.label_status), color = Muted,
                    fontSize = 10.sp, letterSpacing = 3.sp)
                Text(status, color = Gold, fontSize = 24.sp, modifier = Modifier.padding(top = 4.dp))
                invoice?.let {
                    Text(it, color = Muted, style = RaType.caption, modifier = Modifier.padding(top = 8.dp))
                }
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.padding(top = 14.dp),
                ) {
                    commands.forEach { cmd ->
                        OutlinedButton(
                            onClick = {
                                busy = true
                                scope.launch {
                                    try {
                                        // PAID is settled through the payments
                                        // endpoint, never asserted as a bare
                                        // transition; the envelope is identical.
                                        val r = if (cmd == "payment.settled") {
                                            Api.post(
                                                "/v1/bookings/$bookingId/pay",
                                                JSONObject().put("method", "upi"),
                                            )
                                        } else {
                                            Api.post(
                                                "/v1/bookings/$bookingId/transition",
                                                JSONObject().put("command", cmd),
                                            )
                                        }
                                        val d = r.getJSONObject("data")
                                        status = d.getString("status")
                                        val next = r.optJSONObject("meta")?.optJSONArray("nextCommands") ?: JSONArray()
                                        commands = (0 until next.length()).map { next.getString(it) }
                                        d.optJSONObject("invoice")?.let { inv ->
                                            invoice = "Invoice ${inv.getString("number")} · " +
                                                "₹${"%.2f".format(inv.getInt("totalPaise") / 100.0)} (incl. GST)"
                                        }
                                        onToast("→ $status")
                                    } catch (e: Exception) { onToast(e.message ?: "Failed") }
                                    busy = false
                                }
                            },
                            enabled = !busy,
                            shape = RoundedCornerShape(RaRadius.full),
                        ) { Text(CommandLabels[cmd] ?: cmd, style = RaType.meta, color = Cream) }
                    }
                }
            }
        }

        Spacer(Modifier.height(8.dp))
        if (busy) Loading()
    }
}

@Composable
private fun Loading() {
    Box(Modifier.fillMaxWidth().padding(top = 14.dp), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = Gold, modifier = Modifier.size(26.dp))
    }
}
