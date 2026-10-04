package `in`.roadassist.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
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
import androidx.compose.foundation.layout.heightIn
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
import androidx.compose.runtime.DisposableEffect
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
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.List
import androidx.compose.material.icons.rounded.Build
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.LocationOn
import androidx.compose.material.icons.rounded.Menu
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.Icon
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowCompat
import androidx.core.content.edit
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
        // A developer's server address (a LAN IP, the emulator alias) is typed
        // by hand and kept, so it is not retyped on every launch. Restored
        // before anything composes, because the map WebView reads Api.base too.
        //
        // Api.restoreBase also moves installs that only ever saved the OLD
        // built-in default (http://10.0.2.2:4000) to the live platform, once:
        // the stale value is deleted and the migration is recorded, so a
        // developer who picks 10.0.2.2:4000 deliberately afterwards keeps it.
        val uiPrefs = getSharedPreferences("ra.ui", android.content.Context.MODE_PRIVATE)
        val migrated = uiPrefs.getBoolean("apiBaseMigrated", false)
        val restored = Api.restoreBase(uiPrefs.getString("apiBase", null), migrated)
        Api.base = restored.base
        if (!migrated) {
            // core-ktx's edit {}, which applies on exit (already a dependency).
            uiPrefs.edit {
                if (restored.forget) remove("apiBase")
                putBoolean("apiBaseMigrated", true)
            }
        }
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
/**
 * The RoadAssist mark (res/drawable/ic_mark.xml), in its own colours.
 *
 * It used to be a white silhouette tinted to the active gold here. The brand
 * mark is now a gradient shield with a dark road and a green signal, and a
 * tint would flatten all of that back into one colour, so it is drawn as it
 * is. It carries its own dark road, so it holds up on both the dark and the
 * paper theme without a per-theme variant.
 */
@Composable
private fun BrandMark(size: Int = 24) {
    Image(
        painter = painterResource(R.drawable.ic_mark),
        contentDescription = "RoadAssist",
        modifier = Modifier.size(size.dp),
    )
}

/**
 * The sign-in beacon: the brand shield hovering over a patch of road, sending
 * out the same signal the logo draws. The Compose twin of `.emblem3d` in the
 * web's ds.css, with the same numbers: a 6 s float that bobs 8dp and sways
 * ±16° about the vertical axis (with a little counter-tilt about the
 * horizontal one), over three rings that grow from 18% to 120% and fade, a
 * second apart, on a 3 s cycle.
 *
 * Cheap on purpose, because it sits on the first screen of an app meant for
 * old phones on bad days:
 *  · ONE infinite transition drives everything. The shield's phase and each
 *    ring's phase are derived from that single number.
 *  · The phase is read only inside `graphicsLayer {}` and the Canvas draw
 *    lambda. Those are deferred reads, so a frame of animation is a redraw of
 *    two small layers — nothing recomposes, nothing re-measures.
 *  · The rings are ellipses on a Canvas, not three animated composables.
 *
 * "Remove animations" in the system settings sets ANIMATOR_DURATION_SCALE to
 * 0. Compose's own animations would then jump straight to their end values,
 * which for an infinite transition can mean a loop that spins every frame to
 * no visible effect. So that setting is read directly and the scene is drawn
 * once, still, at a pose that shows all three rings and a front-facing shield.
 */
@Composable
private fun SignInBeacon(modifier: Modifier = Modifier) {
    val ctx = LocalContext.current
    val animate = remember {
        android.provider.Settings.Global.getFloat(
            ctx.contentResolver, android.provider.Settings.Global.ANIMATOR_DURATION_SCALE, 1f,
        ) != 0f
    }
    // 0.25 of the float cycle is the midpoint of the sway: the shield faces
    // forward, raised half its bob, and the rings sit at three different sizes.
    val phase: androidx.compose.runtime.State<Float> = if (animate) {
        androidx.compose.animation.core.rememberInfiniteTransition(label = "beacon").animateFloat(
            initialValue = 0f, targetValue = 1f,
            animationSpec = androidx.compose.animation.core.infiniteRepeatable(
                androidx.compose.animation.core.tween(6000, easing = androidx.compose.animation.core.LinearEasing),
            ),
            label = "beacon-phase",
        )
    } else remember { androidx.compose.runtime.mutableFloatStateOf(0.25f) }

    val ring = LocalRa.current.ok.copy(alpha = 0.7f)
    Box(modifier.size(width = 150.dp, height = 138.dp), contentAlignment = Alignment.TopCenter) {
        // The floor: a soft shadow under the shield and the signal rings. The
        // web lays a circle flat with rotateX(76deg); flattening a circle by
        // cos(76°) ≈ 0.24 is the same ellipse without a second 3D layer.
        androidx.compose.foundation.Canvas(
            Modifier.align(Alignment.BottomCenter).padding(bottom = 4.dp).size(150.dp, 36.dp),
        ) {
            val cx = size.width / 2f
            val cy = size.height / 2f
            val rx = size.width / 2f
            val ry = size.height / 2f
            drawOval(
                brush = Brush.radialGradient(
                    listOf(Color.Black.copy(alpha = 0.45f), Color.Transparent),
                    center = androidx.compose.ui.geometry.Offset(cx, cy), radius = rx * 0.28f,
                ),
                topLeft = androidx.compose.ui.geometry.Offset(cx - rx * 0.56f, cy - ry * 0.56f),
                size = androidx.compose.ui.geometry.Size(rx * 1.12f, ry * 1.12f),
            )
            val t = phase.value
            for (i in 0 until 3) {
                // Rings run twice per float cycle (3 s), a third of that apart.
                val p = ((t * 2f) + i / 3f) % 1f
                // cubic-bezier(.2,.7,.3,1) on the web: fast out, long settle.
                // An ease-out cubic is the same shape to the eye.
                val e = 1f - (1f - p) * (1f - p) * (1f - p)
                val s = 0.18f + (1.2f - 0.18f) * e
                val a = 0.95f * (1f - e)
                if (a <= 0.01f) continue
                drawOval(
                    color = ring.copy(alpha = ring.alpha * a),
                    topLeft = androidx.compose.ui.geometry.Offset(cx - rx * s, cy - ry * s),
                    size = androidx.compose.ui.geometry.Size(2f * rx * s, 2f * ry * s),
                    style = androidx.compose.ui.graphics.drawscope.Stroke(width = 2.dp.toPx()),
                )
            }
        }
        Image(
            painter = painterResource(R.drawable.ic_mark),
            contentDescription = "RoadAssist",
            modifier = Modifier
                .size(92.dp)
                .graphicsLayer {
                    // A sine, not a triangle: it eases in and out at both ends
                    // the way the web's ease-in-out keyframes do.
                    val sway = (1f - kotlin.math.cos(2f * Math.PI.toFloat() * phase.value)) / 2f
                    rotationY = -16f + 32f * sway
                    rotationX = 4f - 6f * sway
                    translationY = -8.dp.toPx() * sway
                    // Roughly the web's perspective(520px) on a 92px mark. The
                    // default camera is close enough that ±16° looks warped.
                    cameraDistance = 12f * density
                },
        )
    }
}

/** Mark + wordmark, used in the top bar. */
@Composable
private fun BrandLockup() {
    Row(verticalAlignment = Alignment.CenterVertically) {
        BrandMark(22)
        Spacer(Modifier.width(8.dp))
        // The wordmark in the display face at bar size, tracked in slightly.
        Row {
            Text("Road", color = Cream, style = RaType.display, fontSize = 19.sp, letterSpacing = (-0.4).sp)
            Text("Assist", color = Gold, style = RaType.display, fontSize = 19.sp, letterSpacing = (-0.4).sp)
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
 * is on screen no matter which screen you are on.
 *
 * The icon is a vector, not the Unicode symbol it used to be. The symbols came
 * from whichever fallback font the phone had, so they changed weight and size
 * from one handset to the next and none of them matched the type.
 */
private data class Tab(@StringRes val label: Int, val icon: ImageVector)
private val TABS = listOf(
    Tab(R.string.nav_home, Icons.Rounded.Home),
    Tab(R.string.nav_assist, Icons.Rounded.Build),           // a wrench: roadside help
    Tab(R.string.nav_map, Icons.Rounded.LocationOn),
    Tab(R.string.nav_track, Icons.AutoMirrored.Rounded.List), // your rescues
    Tab(R.string.nav_more, Icons.Rounded.Menu),
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
    // "Layers in 3D" (layers.html in a WebView), opened from a Home card. It
    // covers the whole shell and back returns here. Saveable so a rotation
    // while looking at the model does not drop the user back on Home.
    var showLayers by rememberSaveable { mutableStateOf(false) }

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
    // Outlives the signed-in screens, so the server-side sign-out is not
    // cancelled by the very recomposition that sign-out causes.
    val sessionScope = rememberCoroutineScope()
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
            // Retained for the session, and destroyed with it. Signing out drops
            // this branch, and a WebView that is merely detached keeps running
            // its page: every sign-out/sign-in cycle left another map.html alive,
            // still polling through AndroidAuth, which by then answered with the
            // NEXT user's token. LayersScreen destroys its WebView the same way.
            DisposableEffect(mapWebView) {
                onDispose {
                    mapWebView.stopLoading()
                    mapWebView.destroy()
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
                    // The bar is the panel colour with a hairline under it, so
                    // the content scrolls beneath an edge rather than a seam.
                    val ra = LocalRa.current
                    Row(
                        Modifier.fillMaxWidth()
                            .background(Panel)
                            .drawWithContent {
                                drawContent()
                                drawLine(
                                    ra.line, androidx.compose.ui.geometry.Offset(0f, size.height - 0.5f),
                                    androidx.compose.ui.geometry.Offset(size.width, size.height - 0.5f), 1f,
                                )
                            }
                            .padding(WindowInsets.statusBars.asPaddingValues())
                            .padding(start = RaSpace.s4 + RaSpace.s1, end = RaSpace.s2, top = RaSpace.s1, bottom = RaSpace.s1),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        BrandLockup()
                        Spacer(Modifier.weight(1f))
                        LinkChip(online)
                        // A 48dp target. It used to be the glyph plus 3dp of
                        // padding, about 26dp tall — half a thumb.
                        Box(
                            Modifier
                                .padding(start = RaSpace.s1)
                                .size(48.dp)
                                .clip(CircleShape)
                                .clickable(role = androidx.compose.ui.semantics.Role.Button) { onToggleTheme() },
                            contentAlignment = Alignment.Center,
                        ) {
                            // U+FE0E asks for the text form of the symbol, so the
                            // sun is drawn in the theme's ink instead of as a
                            // yellow emoji.
                            Text(
                                if (isDark) "☀︎" else "☾︎",
                                color = Muted, fontSize = 19.sp,
                            )
                        }
                    }
                },
                bottomBar = {
                    val ra = LocalRa.current
                    NavigationBar(
                        containerColor = Panel, tonalElevation = 0.dp,
                        modifier = Modifier.drawWithContent {
                            drawContent()
                            drawLine(ra.line, androidx.compose.ui.geometry.Offset(0f, 0.5f),
                                androidx.compose.ui.geometry.Offset(size.width, 0.5f), 1f)
                        },
                    ) {
                        TABS.forEachIndexed { i, t ->
                            val selected = tab == i
                            NavigationBarItem(
                                selected = selected,
                                onClick = { tab = i },
                                icon = {
                                    // The selected icon lifts a little as the
                                    // indicator pill grows under it.
                                    val lift by androidx.compose.animation.core.animateFloatAsState(
                                        if (selected && !LocalReduceMotion.current) 1f else 0f,
                                        RaMotion.sheet(), label = "nav-lift",
                                    )
                                    Icon(
                                        t.icon, contentDescription = null,
                                        modifier = Modifier.size(24.dp).graphicsLayer {
                                            val s = 1f + 0.08f * lift
                                            scaleX = s; scaleY = s
                                            translationY = -1.5.dp.toPx() * lift
                                        },
                                    )
                                },
                                label = {
                                    Text(
                                        stringResource(t.label),
                                        style = RaType.meta.copy(fontWeight = FontWeight.SemiBold, letterSpacing = 0.2.sp),
                                    )
                                },
                                colors = NavigationBarItemDefaults.colors(
                                    selectedIconColor = Gold, selectedTextColor = Gold,
                                    indicatorColor = GoldFill.copy(alpha = if (isDark) 0.14f else 0.30f),
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
                        // Report-a-hazard FAB, only interactive on the Map tab:
                        // a red pill seated in a frosted dock, so it reads over
                        // any tiles. Bottom-end, above the page's locate button
                        // and clear of its legend (it used to sit on the legend).
                        if (tab == 2) {
                            val ra = LocalRa.current
                            GlassPanel(
                                modifier = Modifier
                                    .align(Alignment.BottomEnd)
                                    .padding(end = RaSpace.s3, bottom = 132.dp),
                            ) {
                                RaPrimaryButton(
                                    stringResource(R.string.report_hazard_short),
                                    fill = ra.alarmFill, ink = ra.onAlarm, height = 48.dp,
                                    fillWidth = false,
                                ) { showReport = true }
                            }
                        }
                    }
                    // Foreground screens paint opaquely over the map when active.
                    // A short crossfade with a 12dp rise between tabs; nothing
                    // at all with "Remove animations" on.
                    val reduceMotion = LocalReduceMotion.current
                    AnimatedContent(
                        targetState = tab,
                        transitionSpec = {
                            if (reduceMotion) EnterTransition.None togetherWith ExitTransition.None
                            else (fadeIn(RaMotion.med()) + slideInVertically(RaMotion.slow()) { it / 60 })
                                .togetherWith(fadeOut(RaMotion.fast()))
                        },
                        label = "tabs",
                        modifier = Modifier.fillMaxSize(),
                    ) { shown -> when (shown) {
                        0 -> Box(Modifier.fillMaxSize().background(Bg)) {
                            HomeScreen(
                                msisdn = msisdn, vehicleId = vehicleId, vehicleLabel = vehicleLabel,
                                online = online,
                                onVehicle = { id, label -> vehicleId = id; vehicleLabel = label },
                                onBook = { tab = 1 },
                                onReport = { showReport = true },
                                onLayers = { showLayers = true },
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
                                onSignOut = {
                                    // Snapshot first: a server switch has already
                                    // moved Api.base, and clear() drops the token.
                                    val access = Api.token
                                    val at = Api.base
                                    Api.clear(); signedIn = false; bookingId = null
                                    sessionScope.launch { Api.logout(access, at) }
                                },
                            )
                        }
                    } }

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
            if (showLayers) LayersScreen(onClose = { showLayers = false })
        }

        // The toast rises on a spring and fades out. The last message is kept
        // through the exit, so the pill does not empty itself as it leaves.
        val lastToast = remember { mutableStateOf("") }
        SideEffect { toast?.let { lastToast.value = it } }
        val reduceToast = LocalReduceMotion.current
        AnimatedVisibility(
            visible = toast != null,
            enter = if (reduceToast) EnterTransition.None
            else fadeIn(RaMotion.med()) + slideInVertically(RaMotion.sheet()) { it / 2 } +
                scaleIn(RaMotion.sheet(), initialScale = 0.96f),
            exit = if (reduceToast) ExitTransition.None
            else fadeOut(RaMotion.med()) + slideOutVertically(RaMotion.med()) { it / 3 },
            modifier = Modifier.align(Alignment.BottomCenter)
                .padding(bottom = 96.dp, start = RaSpace.s4 + RaSpace.s1, end = RaSpace.s4 + RaSpace.s1),
        ) {
            val pill = RoundedCornerShape(RaRadius.full)
            Box(
                Modifier
                    .shadow(12.dp, pill, ambientColor = Color.Black.copy(alpha = 0.45f), spotColor = Color.Black.copy(alpha = 0.45f))
                    .clip(pill)
                    .background(GoldFill)
                    .background(Brush.verticalGradient(listOf(Color.White.copy(alpha = 0.18f), Color.Transparent)))
                    .padding(horizontal = RaSpace.s4 + RaSpace.s1, vertical = RaSpace.s3),
            ) {
                Text(toast ?: lastToast.value, color = GoldInk, style = RaType.label, fontWeight = FontWeight.SemiBold)
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
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
        @Suppress("DEPRECATION") settings.setGeolocationEnabled(true)
        // The page now showing, for the bridges below. They run on a binder
        // thread and may not call webView.url, so the UI thread records it here.
        val page = java.util.concurrent.atomic.AtomicReference<String?>(null)
        webViewClient = object : android.webkit.WebViewClient() {
            // Only the configured server stays in the WebView (and so near the
            // bridges); every other link opens in the system browser.
            override fun shouldOverrideUrlLoading(
                view: android.webkit.WebView, request: android.webkit.WebResourceRequest,
            ): Boolean {
                if (!request.isForMainFrame || MapWebGuard.sameOrigin(base, request.url.toString())) return false
                try {
                    view.context.startActivity(
                        android.content.Intent(android.content.Intent.ACTION_VIEW, request.url)
                            .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK),
                    )
                } catch (_: android.content.ActivityNotFoundException) { /* nothing can open it */ }
                return true
            }
            override fun onPageStarted(view: android.webkit.WebView, url: String?, favicon: android.graphics.Bitmap?) {
                page.set(url)
            }
            override fun onPageFinished(view: android.webkit.WebView, url: String?) {
                page.set(view.url ?: url)
            }
        }
        webChromeClient = object : android.webkit.WebChromeClient() {
            override fun onGeolocationPermissionsShowPrompt(
                origin: String?, callback: android.webkit.GeolocationPermissions.Callback?,
            ) { callback?.invoke(origin, MapWebGuard.mayUseLocation(base, origin), false) }
        }
        // Bridge so the page always uses a current token and can self-refresh -
        // answered only while the page is on the configured server.
        addJavascriptInterface(object {
            @android.webkit.JavascriptInterface
            fun token(): String = MapWebGuard.bridgeToken(base, page.get(), Api.currentToken())
            @android.webkit.JavascriptInterface
            fun refresh(): Boolean = MapWebGuard.bridgeAllowed(base, page.get()) &&
                // No network is "not refreshed", not an exception thrown back
                // across the bridge from a binder thread.
                runCatching { Api.refreshBlocking() }.getOrDefault(false)
        }, "AndroidAuth")
        // Bridge for "Request assistance" tapped on a mechanic's map popup. Runs
        // on a binder thread, so hop to the main thread to touch Compose state.
        addJavascriptInterface(object {
            @android.webkit.JavascriptInterface
            fun book(id: String, name: String, lat: Double, lng: Double) {
                if (!MapWebGuard.bridgeAllowed(base, page.get())) return
                main.post { onBookMechanic(id, name, lat, lng) }
            }
        }, "AndroidNav")
        val theme = if (isDark) "dark" else "light"
        loadUrl("$base/map.html#base=$base&token=${Api.currentToken()}&theme=$theme")
    }
}

/** The server's cap on one stored report photo: 600 KiB (DB_PHOTO_MAX_BYTES in
 *  apps/api/src/domain/photo-store.ts, ADR-0013). The web app aims at the same. */
private const val REPORT_PHOTO_MAX_BYTES = 600 * 1024

/** Downscale a picked image to a sane size and JPEG-encode it as base64 —
 *  keeps the upload small and strips the original's metadata. Runs off the main
 *  thread. Returns (base64, preview bitmap) or null if it couldn't be read. */
private fun processReportImage(ctx: android.content.Context, uri: android.net.Uri): Pair<String, android.graphics.Bitmap>? {
    return try {
        val bytes = ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return null
        val max = 1280
        // Decode at a power-of-two reduction close to the target, not at full
        // size. A 48 MP camera photo is ~190 MB as a full ARGB bitmap, and that
        // OutOfMemoryError is an Error, which the catch below never sees.
        val bounds = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
        android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= max) sample *= 2
        var bmp = android.graphics.BitmapFactory.decodeByteArray(
            bytes, 0, bytes.size, android.graphics.BitmapFactory.Options().apply { inSampleSize = sample },
        ) ?: return null
        if (bmp.width > max || bmp.height > max) {
            val scale = max.toFloat() / maxOf(bmp.width, bmp.height)
            bmp = android.graphics.Bitmap.createScaledBitmap(
                bmp, (bmp.width * scale).toInt(), (bmp.height * scale).toInt(), true)
        }
        // 1280 px at quality 80 fits the cap for any ordinary photo; the rougher
        // rungs (the same ladder as apps/web/photo-shrink.js) are for a frame
        // that does not. If even the last is over, it is sent anyway and the
        // server's 413 names the limit, rather than this saying "unreadable".
        var jpeg = ByteArray(0)
        for ((side, quality) in listOf(1280 to 80, 1280 to 70, 1024 to 70, 1024 to 60, 800 to 60)) {
            val s = if (maxOf(bmp.width, bmp.height) <= side) bmp else {
                val k = side.toFloat() / maxOf(bmp.width, bmp.height)
                android.graphics.Bitmap.createScaledBitmap(
                    bmp, maxOf(1, (bmp.width * k).toInt()), maxOf(1, (bmp.height * k).toInt()), true)
            }
            val out = java.io.ByteArrayOutputStream()
            s.compress(android.graphics.Bitmap.CompressFormat.JPEG, quality, out)
            jpeg = out.toByteArray()
            if (jpeg.size <= REPORT_PHOTO_MAX_BYTES) break
        }
        android.util.Base64.encodeToString(jpeg, android.util.Base64.NO_WRAP) to bmp
    } catch (_: Exception) { null }
}

/** Citizen road-hazard report — feeds the RAKSHA detection pipeline (source:
 *  citizen), appears on the live map and in the authority queue. Location is a
 *  fix requested at submit time; with none the report is NOT sent and the draft
 *  stays open for a retry (HazardLocation). An optional photo (picked at app
 *  scope) is downscaled on-device. */
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
    ) { /* if denied, a submit is refused with a message rather than sent somewhere made up */ }
    LaunchedEffect(Unit) { perms.launch(arrayOf(android.Manifest.permission.ACCESS_FINE_LOCATION)) }

    var type by remember { mutableStateOf("pothole") }
    var typeOpen by remember { mutableStateOf(false) }
    var severity by remember { mutableIntStateOf(3) }
    var note by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    // Why the last submit was not sent, shown in the dialog until the next try.
    var noFix by remember { mutableStateOf<String?>(null) }
    val types = listOf("pothole" to "Pothole", "road_damage" to "Road damage", "obstruction" to "Obstruction")

    AlertDialog(
        onDismissRequest = { if (!busy) onClose() },
        // Don't dismiss on an outside touch — launching the photo picker would
        // otherwise close the dialog and drop the in-progress report.
        properties = androidx.compose.ui.window.DialogProperties(dismissOnClickOutside = false),
        containerColor = Panel,
        shape = RoundedCornerShape(RaRadius.xl),
        title = { Text(stringResource(R.string.report_hazard_title), color = Cream, style = RaType.title, fontSize = 20.sp) },
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
                // 48dp targets (they were 42), selected one filled and lifted.
                Row(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    (1..5).forEach { s ->
                        val sel = s == severity
                        val lift by androidx.compose.animation.core.animateFloatAsState(
                            if (sel && !LocalReduceMotion.current) 1f else 0f, RaMotion.sheet(), label = "sev",
                        )
                        Box(
                            Modifier.size(48.dp)
                                .graphicsLayer { val k = 1f + 0.06f * lift; scaleX = k; scaleY = k }
                                .shadow((6 * lift).dp, CircleShape)
                                .clip(CircleShape)
                                .background(if (sel) GoldFill else GoldFill.copy(alpha = 0.14f))
                                .clickable(role = androidx.compose.ui.semantics.Role.RadioButton) { severity = s },
                            contentAlignment = Alignment.Center,
                        ) { Text("$s", color = if (sel) GoldInk else Cream, style = RaType.figures, fontSize = 16.sp) }
                    }
                }
                // The server takes at most 280 characters (POST /v1/raksha/report) and
                // refuses the whole report past that, so the field stops there.
                Field(note, { note = it.take(280) }, stringResource(R.string.field_note_optional))

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
                noFix?.let {
                    Text(it, color = Alarm, style = RaType.label, lineHeight = 18.sp,
                        modifier = Modifier.padding(top = 12.dp))
                }
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    busy = true
                    noFix = null
                    scope.launch {
                        // Actively asks for a fresh fix (GPS, then network, then
                        // the OS cache). No fix means no report: a borrowed
                        // coordinate would put a citizen pin on the authority's
                        // map where nobody stood (HazardLocation).
                        when (val at = HazardLocation.reportPosition(Emergency.currentLocation(ctx))) {
                            HazardLocation.ReportPosition.NoFix -> {
                                // The dialog stays open, so type, severity, note and
                                // photo are all still there for the retry.
                                val permitted = Emergency.hasLocationPermission(ctx)
                                val msg = ctx.getString(
                                    if (permitted) R.string.report_no_fix else R.string.report_no_location_permission,
                                )
                                noFix = msg
                                onToast(msg)
                                if (!permitted) perms.launch(arrayOf(android.Manifest.permission.ACCESS_FINE_LOCATION))
                            }
                            is HazardLocation.ReportPosition.Send -> try {
                                Api.post("/v1/raksha/report", JSONObject()
                                    .put("type", type).put("severity", severity)
                                    .put("lat", at.lat).put("lng", at.lng)
                                    .apply { if (note.isNotBlank()) put("note", note.trim()) }
                                    .apply { photoB64?.let { put("photoBase64", it); put("photoMime", "image/jpeg") } })
                                onToast("Hazard reported at your location — thank you")
                                onReported(); onClose()
                            } catch (e: Exception) { onToast(e.message ?: "Failed to report") }
                        }
                        busy = false
                    }
                },
                enabled = !busy,
                colors = ButtonDefaults.buttonColors(
                    containerColor = LocalRa.current.alarmFill, contentColor = LocalRa.current.onAlarm,
                ),
                shape = RoundedCornerShape(RaRadius.full),
                modifier = Modifier.heightIn(min = 48.dp),
            ) { Text(if (busy) "Reporting…" else "Submit report", style = RaType.button) }
        },
        dismissButton = {
            TextButton(onClick = { if (!busy) onClose() }, modifier = Modifier.heightIn(min = 48.dp)) {
                Text(stringResource(R.string.action_cancel), color = Muted, style = RaType.button)
            }
        },
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
        if (!loaded) {
            // Placeholders in the shape of the rows that are coming, under the
            // same word the screen always said while it waited.
            Text("Loading…", color = Muted, style = RaType.label, modifier = Modifier.padding(top = RaSpace.s2))
            repeat(3) { i ->
                Reveal(i) {
                    RaCard(Modifier.fillMaxWidth().padding(top = RaSpace.s3)) {
                        Row(Modifier.padding(CardPad), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Shimmer(Modifier.fillMaxWidth(0.5f), height = 14.dp)
                                Shimmer(Modifier.fillMaxWidth(0.32f).padding(top = RaSpace.s2), height = 10.dp)
                            }
                            Shimmer(Modifier.width(72.dp), height = 20.dp)
                        }
                    }
                }
            }
        } else if (history.isEmpty()) {
            Column(
                Modifier.fillMaxWidth().padding(top = 60.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                // An empty state with a little depth: the tab's own icon, set in
                // a lit disc, rather than a bare symbol.
                Reveal(0) {
                    Box(
                        Modifier.size(88.dp)
                            .shadow(10.dp, CircleShape, ambientColor = Color.Black.copy(alpha = 0.5f), spotColor = Color.Black.copy(alpha = 0.5f))
                            .clip(CircleShape)
                            .background(Panel)
                            .background(Brush.verticalGradient(listOf(GoldFill.copy(alpha = 0.16f), Color.Transparent)))
                            .border(1.dp, GoldFill.copy(alpha = 0.30f), CircleShape),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(Icons.AutoMirrored.Rounded.List, contentDescription = null, tint = Gold, modifier = Modifier.size(36.dp))
                    }
                }
                Text("No rescues yet", color = Cream, style = RaType.title, fontSize = 20.sp,
                    modifier = Modifier.padding(top = RaSpace.s4))
                Text(stringResource(R.string.bookings_empty), color = Muted, style = RaType.label,
                    modifier = Modifier.padding(top = RaSpace.s1))
                RaOutlineButton(stringResource(R.string.action_request_assistance),
                    modifier = Modifier.padding(top = RaSpace.s5)) { onBook() }
            }
        } else {
            Sub(stringResource(R.string.bookings_sub))
            history.forEachIndexed { i, b ->
                val status = b.optString("status")
                Reveal(i) {
                    RaCard(Modifier.fillMaxWidth().padding(top = RaSpace.s3)) {
                        Row(Modifier.padding(CardPad), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(b.optString("reference"), color = Cream, style = RaType.figures, fontSize = 15.sp)
                                b.optString("highwayMarker").takeIf { it.isNotBlank() && it != "null" }?.let {
                                    Text(it, color = Muted, style = RaType.caption, modifier = Modifier.padding(top = 2.dp))
                                }
                            }
                            StatusChip(status, STATUS_COLOR(status))
                        }
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

        RaCard(modifier = Modifier.fillMaxWidth().padding(top = RaSpace.s5)) {
            Column(Modifier.padding(CardPad)) {
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
                    modifier = Modifier.fillMaxWidth().padding(top = RaSpace.s4).height(52.dp),
                ) { Text(if (summary == null) "Prepare my route" else "Refresh route", style = RaType.button) }
                if (busy) Loading()
            }
        }

        // Your hazard reports and where each one is in the review pipeline.
        if (reports.isNotEmpty()) {
            RaCard(modifier = Modifier.fillMaxWidth().padding(top = RaSpace.s4)) {
                Column(Modifier.padding(CardPad)) {
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
                            StatusChip(st, STATUS_COLOR(st))
                        }
                    }
                }
            }
        }

        // Emergency contacts — who gets alerted when you confirm an SOS.
        RaCard(modifier = Modifier.fillMaxWidth().padding(top = RaSpace.s4)) {
            Column(Modifier.padding(CardPad)) {
                Text(stringResource(R.string.emergency_contacts), color = Cream, style = RaType.title)
                Text(stringResource(R.string.emergency_contacts_sub),
                    color = Muted, style = RaType.sub, modifier = Modifier.padding(top = 4.dp))

                if (contacts.isEmpty()) {
                    Text(stringResource(R.string.emergency_contacts_empty), color = LocalRa.current.warn,
                        style = RaType.caption, modifier = Modifier.padding(top = 10.dp))
                } else contacts.forEach { c ->
                    Row(Modifier.fillMaxWidth().padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(c.optString("name"), color = Cream, fontSize = 14.sp)
                            Text(c.optString("msisdn"), color = Muted, style = RaType.caption)
                        }
                        TextButton(
                            enabled = !cBusy,
                            modifier = Modifier.heightIn(min = 48.dp),
                            onClick = {
                                cBusy = true
                                scope.launch {
                                    try { Api.delete("/v1/me/emergency-contacts/${c.getString("id")}"); loadContacts() }
                                    catch (e: Exception) {}
                                    cBusy = false
                                }
                            },
                        ) { Text(stringResource(R.string.action_remove), color = Alarm, style = RaType.button) }
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
                    modifier = Modifier.fillMaxWidth().padding(top = RaSpace.s3).height(52.dp),
                ) { Text(stringResource(R.string.action_add_contact), style = RaType.button) }
            }
        }

        // Server — the same address the sign-in screen offers, reachable once
        // signed in. Switching servers ends the session on purpose: the tokens
        // in memory were issued by the server being left, and carrying them to
        // another one produces 401s that look like a broken app rather than a
        // deliberate change. Signing out also drops the retained map WebView,
        // which captured the OLD base when it was built.
        RaCard(modifier = Modifier.fillMaxWidth().padding(top = RaSpace.s4)) {
            Column(Modifier.padding(CardPad)) {
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
                        color = LocalRa.current.warn, style = RaType.caption,
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
                                // Sign out FIRST, while Api.base is still the
                                // server that issued the session, so the
                                // revocation goes there and not to the new one.
                                onSignOut()
                                commitApiBase(ctx, serverUrl)
                            } else {
                                serverUnreachable = true
                                serverBusy = false
                            }
                        }
                    },
                    enabled = !serverBusy && !Api.isCurrentBase(serverUrl),
                    shape = RoundedCornerShape(RaRadius.full),
                    colors = ButtonDefaults.buttonColors(containerColor = GoldFill, contentColor = GoldInk),
                    modifier = Modifier.fillMaxWidth().padding(top = RaSpace.s3).height(52.dp),
                ) { Text(stringResource(R.string.action_use_server), style = RaType.button) }
            }
        }
        RaCard(modifier = Modifier.fillMaxWidth().padding(top = RaSpace.s4)) {
            Column(Modifier.padding(CardPad)) {
                Text(stringResource(R.string.about), color = Cream, style = RaType.title)
                Text(stringResource(R.string.about_body),
                    color = Muted, style = RaType.sub, modifier = Modifier.padding(top = 4.dp))
                FontLicences()
            }
        }
        LineButton(stringResource(R.string.action_sign_out)) { onSignOut() }
    }
}

/**
 * The bundled fonts' credit, and their licence on a tap.
 *
 * The SIL OFL lets the fonts ship inside the app on condition that the licence
 * travels with them. The two texts are in assets/licenses, copied unchanged
 * from app/apps/web/vendor/fonts, and this shows them on the device.
 */
@Composable
private fun FontLicences() {
    val ctx = LocalContext.current
    var open by remember { mutableStateOf(false) }
    var text by remember { mutableStateOf<String?>(null) }
    TextButton(
        onClick = { open = true },
        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 0.dp, vertical = RaSpace.s2),
        modifier = Modifier.padding(top = RaSpace.s1).heightIn(min = 48.dp),
    ) { Text(stringResource(R.string.font_credit), color = Gold, style = RaType.caption, fontWeight = FontWeight.SemiBold) }
    if (open) {
        LaunchedEffect(Unit) {
            text = withContext(Dispatchers.IO) {
                runCatching {
                    listOf("OFL-SpaceGrotesk.txt", "OFL-Inter.txt", "OFL-JetBrainsMono.txt").joinToString("\n\n— — —\n\n") { name ->
                        ctx.assets.open("licenses/$name").bufferedReader().use { it.readText() }.trim()
                    }
                }.getOrNull()
            }
        }
        AlertDialog(
            onDismissRequest = { open = false },
            containerColor = Panel,
            shape = RoundedCornerShape(RaRadius.xl),
            title = { Text(stringResource(R.string.font_credit), color = Cream, style = RaType.title) },
            text = {
                val body = text
                if (body == null) ShimmerLines(lines = 6)
                else Text(
                    body, color = Muted, style = RaType.meta, lineHeight = 15.sp,
                    modifier = Modifier.height(380.dp).verticalScroll(rememberScrollState()),
                )
            },
            confirmButton = {
                TextButton(onClick = { open = false }, modifier = Modifier.heightIn(min = 48.dp)) {
                    Text(stringResource(R.string.cd_back), color = Gold, style = RaType.button)
                }
            },
        )
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
private fun ScreenColumn(
    scroll: androidx.compose.foundation.ScrollState = rememberScrollState(),
    content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit,
) {
    // 20dp sides (the card padding) and 24dp top/bottom, on the 4dp ladder.
    Column(
        Modifier.fillMaxSize().verticalScroll(scroll)
            .padding(horizontal = RaSpace.s4 + RaSpace.s1, vertical = RaSpace.s5),
        content = content,
    )
}

@Composable
private fun Heading(@StringRes plain: Int, @StringRes italic: Int) {
    // One Text, not two in a Row, so a long heading in Tamil or Malayalam
    // wraps as a sentence instead of pushing its second half off the screen.
    val gold = Gold
    val plainText = stringResource(plain)
    val italicText = stringResource(italic)
    val styled = remember(plainText, italicText, gold) {
        androidx.compose.ui.text.buildAnnotatedString {
            append(plainText)
            append(" ")
            // Gold, upright: the display face has no italic, and a slant
            // synthesised by the platform is not one.
            pushStyle(androidx.compose.ui.text.SpanStyle(color = gold))
            append(italicText)
            pop()
        }
    }
    Text(styled, style = RaType.heading, color = Cream)
}

@Composable
private fun Sub(text: String) {
    Text(text, style = RaType.label, color = Muted, lineHeight = 19.sp, modifier = Modifier.padding(top = RaSpace.s2))
}

@Composable
private fun Field(
    value: String, onChange: (String) -> Unit, label: String, enabled: Boolean = true,
    // The keyboard to raise. Text by default, which is what every existing
    // field had; the email sign-in asks for the @ keyboard and the number pad.
    keyboard: androidx.compose.ui.text.input.KeyboardType = androidx.compose.ui.text.input.KeyboardType.Text,
) {
    OutlinedTextField(
        value = value, onValueChange = onChange, enabled = enabled,
        label = { Text(label, style = RaType.caption) },
        singleLine = true,
        textStyle = RaType.body,
        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = keyboard),
        shape = RoundedCornerShape(RaRadius.sm),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = Gold, unfocusedBorderColor = LocalRa.current.line,
            focusedTextColor = Cream, unfocusedTextColor = Cream,
            focusedLabelColor = Gold, unfocusedLabelColor = Muted,
            cursorColor = Gold,
        ),
        modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
    )
}

@Composable
private fun GoldButton(text: String, enabled: Boolean = true, onClick: () -> Unit) {
    RaPrimaryButton(text, enabled = enabled, modifier = Modifier.padding(top = RaSpace.s4), onClick = onClick)
}

@Composable
private fun LineButton(text: String, onClick: () -> Unit) {
    RaOutlineButton(text, color = Muted, modifier = Modifier.fillMaxWidth().padding(top = RaSpace.s3), onClick = onClick)
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
    // The last refusal on the phone path, shown under the form rather than only
    // in a toast. A toast lasts 3.2 s; "this account signs in with its email
    // address" is an instruction the user has to act on, so it stays put.
    var phoneError by remember { mutableStateOf<String?>(null) }

    // Sign in with email: a second, quieter path under the phone one. Saveable
    // so a rotation between "email me a code" and typing the code does not
    // close the form and lose the address. The code itself is not saved — it
    // is a credential, and saved state is written into the activity's bundle.
    var emailOpen by rememberSaveable { mutableStateOf(false) }
    var email by rememberSaveable { mutableStateOf("") }
    var emailSent by rememberSaveable { mutableStateOf(false) }
    var emailCode by remember { mutableStateOf("") }
    var emailError by remember { mutableStateOf<String?>(null) }

    // Signing in is a phone number and a six-digit code. The address this app
    // talks to is not a thing a person signing in should be asked about: it is
    // restored from preferences in onCreate, so whatever was last used is already
    // in force by the time this composes, and it is changed from the Server card
    // in More once signed in.
    //
    // The built-in default is now the live platform (Api.DEFAULT_BASE), so a
    // real handset signs in on first run with nothing to configure. A developer
    // running the API on a laptop or behind the emulator still needs a way to
    // point a never-signed-in handset at it, and cannot reach the Server card
    // yet. Long-pressing the wordmark is that way in. It is deliberately not a
    // button: the first screen stays a phone number and a code, and the escape
    // hatch is written down in ENGINEERING-NOTES.md rather than drawn on the screen.
    fun commitBase() { baseUrl = commitApiBase(ctx, baseUrl) }

    // THE session-saving path, shared by both ways in. The email verify answers
    // in the same shape as the phone verify — tokens, roles, user.msisdn — so
    // it is adopted here, exactly as a phone sign-in is, rather than through a
    // second copy that would drift from this one.
    //
    // The phone number shown once signed in is taken from the SERVER's answer.
    // For a phone sign-in that is the number typed; for an email sign-in it is
    // the number the account belongs to, which the user never typed at all.
    suspend fun completeSignIn(session: JSONObject) {
        Api.adoptSession(session)
        session.optJSONObject("user")?.optString("msisdn")
            ?.takeIf { it.isNotBlank() }?.let(onMsisdn)
        val me = Api.get("/v1/me").getJSONObject("data")
        val vehicles = me.optJSONArray("vehicles") ?: JSONArray()
        if (vehicles.length() > 0) {
            val v = vehicles.getJSONObject(0)
            onSignedIn(v.getString("id"), v.getString("registrationNo"))
        } else onSignedIn(null, null)
        onToast(ctx.getString(R.string.toast_signed_in))
    }

    ScreenColumn {
        Spacer(Modifier.height(12.dp))
        Column(
            Modifier.fillMaxWidth()
                .pointerInput(Unit) {
                    detectTapGestures(onLongPress = { showServer = !showServer })
                },
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            SignInBeacon()
            Row(Modifier.padding(top = 6.dp)) {
                Text("Road", color = Cream, style = RaType.display)
                Text("Assist", color = Gold, style = RaType.display)
            }
        }
        Text(stringResource(R.string.tagline),
            color = Muted, style = RaType.caption, letterSpacing = 1.sp,
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        Spacer(Modifier.height(28.dp))
        Heading(R.string.head_signin_plain, R.string.head_signin_italic)
        Sub(stringResource(R.string.signin_sub))

        if (showServer) {
            Field(baseUrl, { baseUrl = it }, stringResource(R.string.field_api_base_url))
        }
        Field(msisdn, { onMsisdn(it); phoneError = null }, stringResource(R.string.field_mobile_number),
            keyboard = androidx.compose.ui.text.input.KeyboardType.Phone)

        if (!otpSent) {
            GoldButton(stringResource(R.string.action_send_otp), enabled = !busy) {
                busy = true
                phoneError = null
                if (showServer) commitBase()
                scope.launch {
                    try {
                        val r = Api.post("/v1/auth/otp/request", JSONObject().put("msisdn", msisdn.trim()))
                        val dev = r.optJSONObject("meta")?.optString("devOtp").orEmpty()
                        if (dev.isNotBlank()) { code = dev; onToast("Dev OTP auto-filled ($dev)") }
                        else onToast(ctx.getString(R.string.toast_otp_sent))
                        otpSent = true
                    } catch (e: ApiException) {
                        // The server's own sentence, always. For a number whose
                        // owner moved it behind email sign-in it is a 403 that
                        // says to choose "Sign in with email" — so the option is
                        // opened for them as well as named.
                        phoneError = e.message
                        if (e.code == EmailSignIn.PHONE_REFUSED) emailOpen = true
                        onToast(e.message ?: "Failed")
                    } catch (e: Exception) { onToast(e.message ?: "Failed") }
                    busy = false
                }
            }
        } else {
            Field(code, { code = it }, stringResource(R.string.field_otp_code),
                keyboard = androidx.compose.ui.text.input.KeyboardType.NumberPassword)
            GoldButton(stringResource(R.string.action_verify_sign_in), enabled = !busy && code.length == 6) {
                busy = true
                phoneError = null
                if (showServer) commitBase()
                scope.launch {
                    try {
                        val r = Api.post(
                            "/v1/auth/otp/verify",
                            JSONObject().put("msisdn", msisdn.trim()).put("code", code.trim()),
                        )
                        completeSignIn(r.getJSONObject("data"))
                    } catch (e: ApiException) {
                        phoneError = e.message
                        onToast(e.message ?: "Failed")
                    } catch (e: Exception) { onToast(e.message ?: "Failed") }
                    busy = false
                }
            }
        }
        phoneError?.let {
            Text(it, color = Alarm, style = RaType.caption, modifier = Modifier.padding(top = 10.dp))
        }

        // ── sign in with email ────────────────────────────────────────────
        LineButton(stringResource(R.string.action_email_signin)) { emailOpen = !emailOpen }
        if (emailOpen) {
            Field(
                email,
                {
                    // A code belongs to the address it was sent to. Editing the
                    // address after asking puts the form back to step one rather
                    // than verifying one inbox's code against another address.
                    email = it; emailSent = false; emailCode = ""; emailError = null
                },
                stringResource(R.string.field_email),
                keyboard = androidx.compose.ui.text.input.KeyboardType.Email,
            )
            if (!emailSent) {
                GoldButton(
                    stringResource(R.string.action_email_code),
                    enabled = !busy && EmailSignIn.isAddress(email),
                ) {
                    busy = true
                    emailError = null
                    if (showServer) commitBase()
                    scope.launch {
                        try {
                            // Only the expiry comes back. Whatever the server put
                            // in meta — a console-mode server may echo the code —
                            // is dropped inside EmailSignIn.request, so the field
                            // below is only ever filled from the inbox.
                            EmailSignIn.request(email)
                            emailSent = true
                            onToast(ctx.getString(R.string.toast_email_code_requested))
                        } catch (e: Exception) {
                            emailError = e.message
                            onToast(e.message ?: "Failed")
                        }
                        busy = false
                    }
                }
            } else {
                Field(emailCode, { emailCode = it.filter(Char::isDigit).take(6); emailError = null },
                    stringResource(R.string.field_email_code),
                    keyboard = androidx.compose.ui.text.input.KeyboardType.NumberPassword)
                GoldButton(
                    stringResource(R.string.action_verify_sign_in),
                    enabled = !busy && EmailSignIn.isCode(emailCode),
                ) {
                    busy = true
                    emailError = null
                    if (showServer) commitBase()
                    scope.launch {
                        try {
                            completeSignIn(EmailSignIn.verify(email, emailCode))
                        } catch (e: Exception) {
                            emailError = e.message
                            onToast(e.message ?: "Failed")
                        }
                        busy = false
                    }
                }
            }
            emailError?.let {
                Text(it, color = Alarm, style = RaType.caption, modifier = Modifier.padding(top = 10.dp))
            }
            Text(stringResource(R.string.email_signin_note),
                color = Muted, style = RaType.sub, modifier = Modifier.padding(top = 10.dp))
        }
        if (busy) Loading()
        Spacer(Modifier.height(24.dp))
    }
}

// ── home: SOS + vehicle ────────────────────────────────────────────────────
/** Seconds between arming SOS and the fallback ladder actually running. */
private const val SOS_GRACE_S = 5
@Composable
private fun HomeScreen(
    msisdn: String, vehicleId: String?, vehicleLabel: String?,
    online: Boolean,
    onVehicle: (String, String) -> Unit,
    onBook: () -> Unit, onReport: () -> Unit, onLayers: () -> Unit, onToast: (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var reg by remember { mutableStateOf("") }
    var vClass by remember { mutableStateOf("car") }
    var classOpen by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var sosResult by remember { mutableStateOf<String?>(null) }
    val classes = listOf("car", "motorcycle", "scooter", "auto_rickshaw", "truck", "bus", "tractor", "ev")
    val ctx = LocalContext.current

    // ── open emergencies ────────────────────────────────────────────────
    // The SOS UI used to exist only while raising one, so an emergency raised
    // before the app was closed, killed or reinstalled could no longer be seen
    // or closed from the phone. Home now asks the server which are still open
    // on entry, whenever the phone comes back online, and after the SOS flow
    // finishes (bumping incidentsKey), and shows a card for each at the top.
    var incidents by remember { mutableStateOf<List<OpenIncident>>(emptyList()) }
    var incidentsKey by remember { mutableIntStateOf(0) }
    // The card action waiting on its confirm dialog, and whether one is in flight.
    var pendingClose by remember { mutableStateOf<Pair<OpenIncident, OpenIncidents.Action>?>(null) }
    var closing by remember { mutableStateOf(false) }
    LaunchedEffect(incidentsKey, online) {
        if (!online || !Emergency.hasData(ctx)) return@LaunchedEffect
        // A failed lookup keeps whatever was shown. It must never toast on every
        // visit to Home, and never stand between the person and the SOS button.
        incidents = try {
            Api.openIncidents()
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (_: Exception) {
            return@LaunchedEffect
        }
    }

    pendingClose?.let { (incident, action) ->
        val resolve = action == OpenIncidents.Action.RESOLVE
        AlertDialog(
            // Dismissing is the safe answer here: the emergency stays open.
            onDismissRequest = { if (!closing) pendingClose = null },
            containerColor = Panel,
            title = {
                Text(
                    stringResource(if (resolve) R.string.incident_confirm_resolve_title else R.string.incident_confirm_cancel_title),
                    color = Alarm, fontSize = 19.sp,
                )
            },
            text = {
                Text(
                    stringResource(if (resolve) R.string.incident_confirm_resolve_body else R.string.incident_confirm_cancel_body),
                    color = Muted, style = RaType.label, lineHeight = 18.sp,
                )
            },
            confirmButton = {
                Button(
                    enabled = !closing,
                    onClick = {
                        closing = true
                        scope.launch {
                            try {
                                if (resolve) Api.resolveIncident(incident.id) else Api.cancelIncident(incident.id)
                                incidents = OpenIncidents.without(incidents, incident.id)
                                onToast(ctx.getString(if (resolve) R.string.toast_incident_closed else R.string.toast_incident_false_alarm))
                            } catch (e: kotlinx.coroutines.CancellationException) {
                                throw e
                            } catch (e: Exception) {
                                // The server's own title (e.g. it was already closed
                                // elsewhere), then re-read so a stale card goes.
                                onToast(e.message ?: "Failed")
                                incidentsKey++
                            } finally {
                                closing = false
                                pendingClose = null
                            }
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = Alarm, contentColor = Color.White),
                ) {
                    Text(
                        stringResource(if (resolve) R.string.incident_action_resolve else R.string.incident_action_cancel),
                        style = RaType.label, fontWeight = FontWeight.SemiBold,
                    )
                }
            },
            dismissButton = {
                TextButton(enabled = !closing, onClick = { pendingClose = null }) {
                    Text(stringResource(R.string.incident_keep_open), color = Muted, style = RaType.label)
                }
            },
        )
    }

    val homeScroll = rememberScrollState()
    ScreenColumn(scroll = homeScroll) {
        Spacer(Modifier.height(RaSpace.s2))
        // No entrance animation here, on purpose: an emergency that is still
        // open is shown the instant it is known, never faded in behind a
        // delay. The same goes for the SOS control and the emergency numbers.
        incidents.forEach { incident ->
            OpenIncidentCard(
                incident = incident,
                enabled = !closing,
                onAction = { action -> pendingClose = incident to action },
            )
        }
        // The greeting, in a hero panel that leans under a finger and tips
        // back as the page scrolls (HomeHero). Decoration only: the SOS
        // control below is a separate element and never moves.
        Reveal(0) {
            HomeHero(homeScroll) {
                Heading(R.string.head_home_plain, R.string.head_home_italic)
                Sub("$msisdn " + stringResource(R.string.signed_in_suffix))
                vehicleLabel?.let {
                    StatusChip(it, Gold, Modifier.padding(top = RaSpace.s3))
                }
            }
        }

        // SOS — the fallback ladder: data → SMS → 112 → queue. Works with no net.
        // Arm the no-data (SMS) and real-location rungs by requesting both perms.
        val perms = rememberLauncherForActivityResult(
            ActivityResultContracts.RequestMultiplePermissions(),
        ) { /* granted or not, the ladder degrades gracefully per rung */ }

        // Saveable: an armed SOS is a decision the person has already made, and
        // turning the phone during the countdown used to disarm it silently.
        var sosArmed by rememberSaveable { mutableStateOf(false) }
        var sosLeft by rememberSaveable { mutableIntStateOf(SOS_GRACE_S) }

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
            // The process-wide ladder scope and the application context, not
            // this screen's: leaving Home or rotating the phone must never
            // cancel an emergency already committed to (see Emergency.ladderScope).
            val app = ctx.applicationContext
            Emergency.ladderScope.launch {
                // Ask for a fix rather than hoping one is cached: an emergency
                // is exactly when nothing else has recently used GPS.
                // No fix is Unknown, said out loud on every rung — never a
                // stand-in coordinate that would send a responder elsewhere.
                val pos = SosPosition.from(Emergency.currentLocation(app))
                val result = Emergency.raise(app, pos) { ref ->
                    val raised = Api.post("/v1/sos", SosPosition.apiBody(pos, ref)).getJSONObject("data")
                    val c = Api.post("/v1/sos/${raised.getString("id")}/confirm").getJSONObject("data")
                    val responder = c.optJSONObject("nearestResponder")?.optString("name") ?: "—"
                    val where = if (raised.optBoolean("locationKnown", pos is SosPosition.Located)) "real GPS" else "location unknown"
                    "Escalated ($where) · contacts ${c.optInt("contactsAlerted")} · $responder · ${c.optInt("elapsedMs")} ms"
                }
                val line = when (result.rung) {
                    SosLadder.Rung.DATA -> "✓ ONLINE — ${result.detail}"
                    SosLadder.Rung.SMS -> "✓ NO DATA → SMS — ${result.detail}"
                    SosLadder.Rung.DIALER -> "→ ${result.detail}"
                    SosLadder.Rung.QUEUED -> "◷ ${result.detail}"
                }
                // With no position, the person has to give it to 112 themselves.
                val notice = SosPosition.unknownNoticeRes(pos, result.rung)?.let { app.getString(it) }
                sosResult = if (notice != null) "$notice\n$line" else line
                onToast("SOS via ${result.rung}")
                busy = false
                // Show (or refresh) the open-emergency card for what was just raised.
                incidentsKey++
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
                shape = RoundedCornerShape(RaRadius.xl),
                title = {
                    // The countdown as a draining ring around its number, as
                    // well as the sentence: the ring is what a glance catches.
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        SosCountdownBadge(sosLeft, SOS_GRACE_S)
                        Spacer(Modifier.width(RaSpace.s3))
                        Text(stringResource(R.string.sos_alerting_in, sosLeft), color = Alarm,
                            style = RaType.title, fontSize = 20.sp)
                    }
                },
                text = {
                    Text(
                        "Your emergency contacts and the nearest responder will be alerted with " +
                            "your location. Cancel now if this was a mistake — a false alarm costs " +
                            "a responder a real journey.",
                        color = Muted, style = RaType.label, lineHeight = 19.sp,
                    )
                },
                confirmButton = {
                    Button(
                        onClick = { sosArmed = false; fireSos() },
                        colors = ButtonDefaults.buttonColors(
                            containerColor = LocalRa.current.alarmFill, contentColor = LocalRa.current.onAlarm,
                        ),
                        modifier = Modifier.heightIn(min = 48.dp),
                    ) { Text(stringResource(R.string.sos_alert_now), style = RaType.button) }
                },
                dismissButton = {
                    TextButton(onClick = {
                        sosArmed = false
                        onToast(ctx.getString(R.string.toast_sos_cancelled))
                    }, modifier = Modifier.heightIn(min = 48.dp)) {
                        Text(stringResource(R.string.action_cancel), color = Muted, style = RaType.button)
                    }
                },
            )
        }

        // The SOS control (Ui.kt): depth, a slow breathing glow while it
        // waits, and a ring that drains over the grace window once armed. The
        // tap still only arms the countdown; nothing escalates on contact.
        Box(Modifier.fillMaxWidth().padding(vertical = RaSpace.s2), contentAlignment = Alignment.Center) {
            SosControl(
                armed = sosArmed,
                secondsLeft = sosLeft,
                totalSeconds = SOS_GRACE_S,
                enabled = !busy && !sosArmed,
                hint = stringResource(R.string.sos_5s_to_cancel),
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
            )
        }
        sosResult?.let {
            Text(it, color = Alarm, style = RaType.sub, textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                modifier = Modifier.align(Alignment.CenterHorizontally))
        }
        Text(
            stringResource(R.string.sos_offline_note),
            color = Muted, style = RaType.meta, lineHeight = 16.sp,
            modifier = Modifier.padding(top = 8.dp).align(Alignment.CenterHorizontally),
        )

        // 112 first, then 1033 (NHAI), 108/102, 100, 101 — tap opens the dialer.
        // Static (EmergencyNumbers.kt), so it is here with no network at all.
        Spacer(Modifier.height(RaSpace.s5))
        EmergencyNumbersCard()

        // Nearest hospital, police, fuel, charger and repair shop (NearYouCard.kt).
        // Below the SOS area and in its own composable scope: it pauses while an
        // SOS is armed or being raised, and never touches Emergency.ladderScope.
        Spacer(Modifier.height(RaSpace.s4))
        Reveal(1) { NearYouSection(online = online, sosActive = sosArmed || busy) }

        Spacer(Modifier.height(RaSpace.s4))
        Reveal(2) {
        RaCard(modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(CardPad)) {
                if (vehicleId == null) {
                    Text(stringResource(R.string.vehicle_add_title), color = Cream, style = RaType.title)
                    Field(reg, { reg = it.uppercase() }, stringResource(R.string.field_registration_number))
                    Box {
                        OutlinedButton(
                            onClick = { classOpen = true },
                            shape = RoundedCornerShape(RaRadius.sm),
                            modifier = Modifier.fillMaxWidth().padding(top = 12.dp).heightIn(min = 52.dp),
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
        }

        // Crowdsourced road-safety: flag a hazard for the RAKSHA network.
        Reveal(3) {
        RaCard(modifier = Modifier.fillMaxWidth().padding(top = RaSpace.s4)) {
            Column(Modifier.padding(CardPad)) {
                Text(stringResource(R.string.hazard_prompt_title), color = Cream, style = RaType.title)
                Text(stringResource(R.string.hazard_prompt_sub),
                    color = Muted, style = RaType.sub, modifier = Modifier.padding(top = 4.dp))
                RaOutlineButton(
                    stringResource(R.string.hazard_prompt_action), color = Alarm,
                    modifier = Modifier.fillMaxWidth().padding(top = RaSpace.s3),
                ) { onReport() }
            }
        }
        }

        // The platform in live 3D: layers.html from the configured server,
        // shown in a WebView the way the Map tab shows map.html.
        Reveal(4) {
        RaCard(modifier = Modifier.fillMaxWidth().padding(top = RaSpace.s4)) {
            Column(Modifier.padding(CardPad)) {
                Text(stringResource(R.string.layers_title), color = Cream, style = RaType.title)
                Text(stringResource(R.string.layers_sub),
                    color = Muted, style = RaType.sub, modifier = Modifier.padding(top = 4.dp))
                RaOutlineButton(
                    stringResource(R.string.layers_open),
                    modifier = Modifier.fillMaxWidth().padding(top = RaSpace.s3),
                ) { onLayers() }
            }
        }
        }

        Spacer(Modifier.height(8.dp))
        if (busy) Loading()
    }
}

/**
 * One emergency still open on the server: red-bordered, above everything else
 * on Home. The buttons are exactly what the server says is legal for it
 * ([OpenIncidents.actions]); each goes through a confirm dialog in HomeScreen.
 */
@Composable
private fun OpenIncidentCard(
    incident: OpenIncident,
    enabled: Boolean,
    onAction: (OpenIncidents.Action) -> Unit,
) {
    val ctx = LocalContext.current
    val raised = remember(incident.raisedAt) {
        OpenIncidents.raisedLocal(
            incident.raisedAt,
            java.time.ZoneId.systemDefault(),
            java.util.Locale.getDefault(),
            android.text.format.DateFormat.is24HourFormat(ctx),
        ) ?: "—"
    }
    val stage = when (OpenIncidents.stage(incident)) {
        OpenIncidents.Stage.CREATED -> stringResource(R.string.incident_stage_created)
        OpenIncidents.Stage.RECEIVED -> stringResource(R.string.incident_stage_received)
        OpenIncidents.Stage.RESPONDING -> stringResource(R.string.incident_stage_responding)
        OpenIncidents.Stage.OTHER -> stringResource(R.string.incident_stage_other, OpenIncidents.readableStage(incident.stage))
    }
    // Tinted with the alarm red and edged in it: the one card on Home that is
    // about something happening now.
    RaCard(
        border = BorderStroke(2.dp, Alarm),
        tint = androidx.compose.ui.graphics.lerp(Panel, Alarm, 0.06f),
        modifier = Modifier.fillMaxWidth().padding(bottom = RaSpace.s3),
    ) {
        Column(Modifier.padding(CardPad)) {
            Text(
                "● " + stringResource(R.string.incident_open_title),
                color = Alarm, style = RaType.title, fontWeight = FontWeight.SemiBold,
            )
            Text(
                stringResource(R.string.incident_raised, raised, OpenIncidents.label(incident)),
                color = Cream, style = RaType.label, modifier = Modifier.padding(top = 6.dp),
            )
            Text(stage, color = Muted, style = RaType.sub, modifier = Modifier.padding(top = 4.dp))
            OpenIncidents.actions(incident).forEach { action ->
                when (action) {
                    // The deeper alarmFill under white: 5.2:1, where white on
                    // the dark theme's bright red was 3.0:1.
                    OpenIncidents.Action.RESOLVE -> RaPrimaryButton(
                        stringResource(R.string.incident_action_resolve),
                        enabled = enabled,
                        fill = LocalRa.current.alarmFill, ink = LocalRa.current.onAlarm, height = 48.dp,
                        modifier = Modifier.padding(top = RaSpace.s3),
                    ) { onAction(action) }
                    OpenIncidents.Action.CANCEL -> RaOutlineButton(
                        stringResource(R.string.incident_action_cancel),
                        enabled = enabled, color = Alarm,
                        modifier = Modifier.fillMaxWidth().padding(top = RaSpace.s2 + 2.dp),
                    ) { onAction(action) }
                }
            }
        }
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
    // nearby list. It says WHO to request (its offer is tagged), never WHERE the
    // person is: the booking goes to the phone's own fix (BookingPosition).
    var target by remember { mutableStateOf<JSONObject?>(null) }
    var nearby by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    // Where the nearby list was searched; isDemo is said under its heading.
    var nearbyAt by remember { mutableStateOf<BookingPosition.NearbyCentre?>(null) }
    // Why the last booking was not sent, shown on screen until the next try.
    var notSent by remember { mutableStateOf<BookingPosition.Reason?>(null) }
    val perms = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { /* if denied, a booking is refused with a message rather than sent somewhere made up */ }

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
        } catch (e: kotlinx.coroutines.CancellationException) {
            // Leaving the tab mid-load is not a failure; toasting it printed
            // "StandaloneCoroutine was cancelled" over whichever tab came next.
            throw e
        } catch (e: Exception) {
            loadError = true
            onToast(e.message ?: "Failed to load services")
        }
    }

    // Nearest verified mechanics for the "nearby" list (real PostGIS query),
    // searched around the phone's fix. With no fix it is the demo point, and the
    // note under the heading says so (BookingPosition.nearbyCentre).
    LaunchedEffect(Unit) {
        try {
            val at = BookingPosition.nearbyCentre(Emergency.currentLocation(ctx))
            val d = Api.get(BookingPosition.nearbyPath(at)).getJSONObject("data")
            val arr = d.getJSONArray("mechanics")
            nearby = (0 until arr.length()).map { arr.getJSONObject(it) }.take(6)
            nearbyAt = at
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (_: Exception) {}
    }

    // demoChosen is per tap: true only from the "Use the NH-48 demo point"
    // button, so a demo choice can never carry into a later booking.
    fun bookAndDispatch(demoChosen: Boolean) {
        busy = true
        scope.launch {
            // Actively asks for a fresh fix (GPS, then network, then the OS
            // cache). No fix means no booking: a borrowed coordinate would send
            // a mechanic where nobody is waiting.
            val permitted = Emergency.hasLocationPermission(ctx)
            when (val at = BookingPosition.decide(Emergency.currentLocation(ctx), demoChosen, permitted)) {
                is BookingPosition.Decision.NotSent -> {
                    // Service, symptoms and the focused mechanic are left as they are for the retry.
                    notSent = at.reason
                    onToast(ctx.getString(R.string.booking_not_sent) + " " + ctx.getString(BookingPosition.reasonRes(at.reason)))
                    if (!permitted) perms.launch(arrayOf(android.Manifest.permission.ACCESS_FINE_LOCATION))
                }
                is BookingPosition.Decision.Send -> try {
                    val note = symptoms.ifBlank {
                        target?.let { "Requested ${it.optString("name")} from the live map" } ?: "reported from the Android app"
                    }
                    val b = Api.post(
                        "/v1/bookings",
                        JSONObject()
                            .put("vehicleId", vehicleId)
                            .put("serviceTypeCode", service!!.first)
                            .put("lat", at.lat).put("lng", at.lng)
                            .put("symptoms", note)
                            .apply { at.marker?.let { put("highwayMarker", it) } }
                            .put("idempotencyKey", "and-" + System.nanoTime()),
                    ).getJSONObject("data")
                    bookingId = b.getString("id")
                    notSent = null
                    onToast("Booking ${b.getString("reference")} — dispatching…")
                    val d = Api.post("/v1/bookings/${bookingId}/dispatch",
                        JSONObject().put("radiusKm", 30).put("limit", 5)).getJSONObject("data")
                    val arr = d.optJSONArray("offers") ?: JSONArray()
                    offers = (0 until arr.length()).map { arr.getJSONObject(it) }
                    if (offers.isEmpty()) onToast(ctx.getString(R.string.toast_no_mechanic))
                } catch (e: kotlinx.coroutines.CancellationException) {
                    throw e
                } catch (e: Exception) { onToast(e.message ?: "Failed") }
            }
            busy = false
        }
    }

    ScreenColumn {
        Spacer(Modifier.height(16.dp))
        Heading(R.string.head_book_plain, R.string.head_book_italic)
        Sub(stringResource(R.string.mechanics_nearby_sub))

        // Focused-mechanic banner (from the map or nearby list).
        target?.let { t ->
            Reveal(0) {
            RaCard(
                tint = androidx.compose.ui.graphics.lerp(Panel, GoldFill, 0.10f),
                border = BorderStroke(1.dp, GoldFill.copy(alpha = 0.45f)),
                modifier = Modifier.fillMaxWidth().padding(top = RaSpace.s4),
            ) {
                Row(Modifier.padding(start = CardPad, top = RaSpace.s3, bottom = RaSpace.s3, end = RaSpace.s1),
                    verticalAlignment = Alignment.CenterVertically) {
                    MechanicAvatar(t.optString("name"))
                    Column(Modifier.weight(1f).padding(start = RaSpace.s3)) {
                        Text(stringResource(R.string.dispatch_requesting_near), color = Muted, style = RaType.meta)
                        Text(t.optString("name"), color = Gold, style = RaType.title)
                    }
                    TextButton(onClick = { target = null }, modifier = Modifier.heightIn(min = 48.dp)) {
                        Text(stringResource(R.string.action_clear), color = Muted, style = RaType.button)
                    }
                }
            }
            }
        }

        Box {
            OutlinedButton(
                onClick = { if (loadError) reloadKey++ else if (services.isNotEmpty()) svcOpen = true },
                shape = RoundedCornerShape(RaRadius.sm),
                modifier = Modifier.fillMaxWidth().padding(top = RaSpace.s4).heightIn(min = 52.dp),
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
        // POST /v1/bookings takes at most 500 characters of symptoms.
        Field(symptoms, { symptoms = it.take(500) }, stringResource(R.string.field_what_happened))

        GoldButton(stringResource(R.string.action_book_dispatch), enabled = !busy && vehicleId != null && service != null) { bookAndDispatch(demoChosen = false) }

        // No fix: the request was not sent. The demo point is offered only as a
        // clearly secondary, explicitly labelled choice.
        notSent?.let { reason ->
            Text(
                stringResource(R.string.booking_not_sent) + " " + stringResource(BookingPosition.reasonRes(reason)),
                color = Alarm, style = RaType.label, lineHeight = 18.sp,
                modifier = Modifier.padding(top = 12.dp),
            )
            TextButton(
                onClick = { bookAndDispatch(demoChosen = true) },
                enabled = !busy && vehicleId != null && service != null,
                modifier = Modifier.padding(top = 6.dp),
            ) { Text(stringResource(R.string.booking_use_demo), color = Muted, style = RaType.caption) }
            Text(stringResource(R.string.booking_demo_note), color = Muted, style = RaType.meta)
        }

        // Offers from the dispatch broadcast; the focused mechanic is tagged.
        offers.forEachIndexed { i, o ->
            val m = o.getJSONObject("mechanic")
            val isTarget = target?.optString("id")?.let { it == m.optString("id") } ?: false
            Reveal(i) {
            RaCard(modifier = Modifier.fillMaxWidth().padding(top = RaSpace.s3)) {
                Row(
                    Modifier.padding(horizontal = CardPad, vertical = RaSpace.s4), verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    MechanicAvatar(m.getString("displayName"))
                    Column(Modifier.weight(1f).padding(start = RaSpace.s3)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(m.getString("displayName"), color = Cream, style = RaType.body, fontWeight = FontWeight.SemiBold)
                            if (isTarget) Text(stringResource(R.string.from_map), color = Gold, style = RaType.meta)
                        }
                        Text(
                            "★ ${m.getDouble("rating")} · ${m.getDouble("distanceKm")} km · ETA ${o.getInt("etaMinutes")} min",
                            color = Muted, style = RaType.caption.copy(fontWeight = FontWeight.Medium, fontFeatureSettings = "tnum"),
                            modifier = Modifier.padding(top = 2.dp),
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
                        modifier = Modifier.heightIn(min = 48.dp),
                    ) { Text(stringResource(R.string.action_accept), style = RaType.button) }
                }
            }
            }
        }

        // Nearby verified mechanics — tap "Request" to focus one for this booking.
        if (offers.isEmpty() && nearby.isNotEmpty()) {
            Text(stringResource(R.string.mechanics_nearby), color = Cream, style = RaType.title,
                modifier = Modifier.padding(top = RaSpace.s5))
            nearbyAt?.let { at ->
                Text(stringResource(BookingPosition.nearbyNoteRes(at)),
                    color = if (at.isDemo) Alarm else Muted, style = RaType.caption)
            }
            nearby.forEachIndexed { i, m ->
                Reveal(i) {
                RaCard(modifier = Modifier.fillMaxWidth().padding(top = RaSpace.s3)) {
                    Row(Modifier.padding(horizontal = CardPad, vertical = RaSpace.s3), verticalAlignment = Alignment.CenterVertically) {
                        MechanicAvatar(m.optString("display_name"))
                        Column(Modifier.weight(1f).padding(start = RaSpace.s3)) {
                            Text(m.optString("display_name"), color = Cream, style = RaType.body, fontWeight = FontWeight.SemiBold)
                            Text("★ ${m.optDouble("rating", 0.0)} · ${m.optDouble("km", 0.0)} km away",
                                color = Muted, style = RaType.caption.copy(fontWeight = FontWeight.Medium, fontFeatureSettings = "tnum"),
                                modifier = Modifier.padding(top = 2.dp))
                        }
                        RaOutlineButton(stringResource(R.string.action_request), height = 48.dp) {
                            // Who to request only; the booking is placed at the phone's fix.
                            target = JSONObject()
                                .put("id", m.optString("id")).put("name", m.optString("display_name"))
                            onToast("Focused ${m.optString("display_name")}")
                        }
                    }
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

    // A LaunchedEffect keyed on the booking, not `remember { scope.launch }`:
    // that launched from inside composition and was never keyed, so a new
    // bookingId kept showing the previous booking's status and commands.
    LaunchedEffect(bookingId) {
        try {
            val r = Api.get("/v1/bookings/$bookingId")
            status = r.getJSONObject("data").getString("status")
            val next = r.optJSONObject("meta")?.optJSONArray("nextCommands") ?: JSONArray()
            commands = (0 until next.length()).map { next.getString(it) }
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) { onToast(e.message ?: "Failed") }
    }

    ScreenColumn {
        Spacer(Modifier.height(16.dp))
        Heading(R.string.head_track_plain, R.string.head_track_italic)
        Sub("Booking $bookingId")

        RaCard(modifier = Modifier.fillMaxWidth().padding(top = 16.dp)) {
            Column(Modifier.padding(CardPad)) {
                Text(stringResource(R.string.label_status), color = Muted,
                    style = RaType.eyebrow, letterSpacing = 2.sp)
                // The status crossfades as the booking moves through the
                // state machine; a shimmer stands in while it is first read.
                if (status == "…") {
                    Shimmer(Modifier.fillMaxWidth(0.55f).padding(top = RaSpace.s2), height = 26.dp)
                } else {
                    androidx.compose.animation.Crossfade(
                        targetState = status, label = "status",
                        animationSpec = if (LocalReduceMotion.current) androidx.compose.animation.core.snap() else RaMotion.med(),
                    ) { st ->
                        Text(st, color = STATUS_COLOR(st), style = RaType.heading, fontSize = 26.sp,
                            modifier = Modifier.padding(top = RaSpace.s1))
                    }
                }
                invoice?.let {
                    Text(it, color = Muted, style = RaType.caption, modifier = Modifier.padding(top = 8.dp))
                }
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(RaSpace.s2),
                    verticalArrangement = Arrangement.spacedBy(RaSpace.s2),
                    modifier = Modifier.padding(top = RaSpace.s4),
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
                            border = BorderStroke(1.dp, GoldFill.copy(alpha = 0.45f)),
                            modifier = Modifier.heightIn(min = 48.dp),
                        ) { Text(CommandLabels[cmd] ?: cmd, style = RaType.button, fontSize = 13.sp, color = Cream) }
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
