package `in`.roadassist.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

// ── brand ──────────────────────────────────────────────────────────────────
val Gold = Color(0xFFE3B96A)
val Bg = Color(0xFF050505)
val Panel = Color(0xFF12100C)
val Cream = Color(0xFFF4F2EC)
val Muted = Color(0xFF9A9184)
val Alarm = Color(0xFFE4574A)

private val Scheme = darkColorScheme(
    primary = Gold, onPrimary = Color(0xFF0A0805),
    background = Bg, onBackground = Cream,
    surface = Panel, onSurface = Cream,
    secondary = Muted, error = Alarm,
)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { MaterialTheme(colorScheme = Scheme) { RoadAssistApp() } }
    }
}

// ── app state machine ──────────────────────────────────────────────────────
/** The RoadAssist mark (gold, from res/drawable/ic_mark.xml). */
@Composable
private fun BrandMark(size: Int = 24) {
    Image(
        painter = painterResource(R.drawable.ic_mark),
        contentDescription = "RoadAssist",
        modifier = Modifier.size(size.dp),
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
private data class Tab(val label: String, val glyph: String)
private val TABS = listOf(
    Tab("Home", "⌂"),     // house
    Tab("Assist", "⚑"),   // flag
    Tab("Track", "◉"),    // fisheye/pin
    Tab("More", "☰"),     // menu
)

@Composable
fun RoadAssistApp() {
    var signedIn by remember { mutableStateOf(false) }
    var tab by remember { mutableIntStateOf(0) }
    var toast by remember { mutableStateOf<String?>(null) }
    var vehicleId by remember { mutableStateOf<String?>(null) }
    var vehicleLabel by remember { mutableStateOf<String?>(null) }
    var bookingId by remember { mutableStateOf<String?>(null) }
    var msisdn by remember { mutableStateOf("+919876543210") }

    Box(Modifier.fillMaxSize().background(Bg)) {
        if (!signedIn) {
            SignInScreen(
                msisdn = msisdn, onMsisdn = { msisdn = it },
                onToast = { toast = it },
                onSignedIn = { vid, vlabel -> vehicleId = vid; vehicleLabel = vlabel; signedIn = true; tab = 0 },
            )
        } else {
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
                        Text("● live", color = Color(0xFF3DDC97), fontSize = 10.sp, letterSpacing = 1.sp)
                    }
                },
                bottomBar = {
                    NavigationBar(containerColor = Panel, tonalElevation = 0.dp) {
                        TABS.forEachIndexed { i, t ->
                            NavigationBarItem(
                                selected = tab == i,
                                onClick = { tab = i },
                                icon = { Text(t.glyph, fontSize = 20.sp) },
                                label = { Text(t.label, fontSize = 10.sp, letterSpacing = 1.sp) },
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
                Box(Modifier.padding(pad)) {
                    when (tab) {
                        0 -> HomeScreen(
                            msisdn = msisdn, vehicleId = vehicleId, vehicleLabel = vehicleLabel,
                            onVehicle = { id, label -> vehicleId = id; vehicleLabel = label },
                            onBook = { tab = 1 },
                            onToast = { toast = it },
                        )
                        1 -> BookScreen(
                            vehicleId = vehicleId,
                            onToast = { toast = it },
                            onTracked = { id -> bookingId = id; tab = 2 },
                            onNeedVehicle = { tab = 0 },
                        )
                        2 -> {
                            val id = bookingId
                            if (id == null) EmptyTrack(onBook = { tab = 1 })
                            else TrackScreen(bookingId = id, onToast = { toast = it })
                        }
                        else -> MoreScreen(
                            msisdn = msisdn,
                            onSignOut = { Api.token = null; signedIn = false; bookingId = null },
                        )
                    }
                }
            }
        }

        toast?.let { msg ->
            Card(
                modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 96.dp, start = 18.dp, end = 18.dp),
                shape = RoundedCornerShape(999.dp),
                colors = CardDefaults.cardColors(containerColor = Gold),
            ) {
                Text(
                    msg, color = Color(0xFF0A0805), fontSize = 13.sp,
                    modifier = Modifier.padding(horizontal = 18.dp, vertical = 11.dp),
                )
            }
        }
    }

    val scope = rememberCoroutineScope()
    if (toast != null) {
        remember(toast) { scope.launch { kotlinx.coroutines.delay(3200); toast = null } }
    }
}

@Composable
private fun EmptyTrack(onBook: () -> Unit) {
    Column(
        Modifier.fillMaxSize().padding(22.dp),
        verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("◉", fontSize = 48.sp, color = Muted)
        Text("No active rescue", color = Cream, fontSize = 18.sp, modifier = Modifier.padding(top = 12.dp))
        Text("Book assistance and track it live here.", color = Muted, fontSize = 13.sp,
            modifier = Modifier.padding(top = 4.dp))
        OutlinedButton(onClick = onBook, shape = RoundedCornerShape(999.dp),
            modifier = Modifier.padding(top = 18.dp)) { Text("Request assistance", color = Gold) }
    }
}

@Composable
private fun MoreScreen(msisdn: String, onSignOut: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var summary by remember { mutableStateOf(TripGuardian.cachedSummary(ctx)) }
    var mosaic by remember { mutableStateOf(TripGuardian.mosaic(ctx)?.asImageBitmap()) }

    val riskColor = { r: String -> when (r) {
        "LOW", "GOOD" -> Color(0xFF3DDC97); "MEDIUM", "FAIR" -> Color(0xFFE3C451)
        "HIGH", "POOR" -> Color(0xFFFF9F43); "CRITICAL" -> Alarm; else -> Muted
    } }

    ScreenColumn {
        Spacer(Modifier.height(16.dp))
        Heading("Account &", "more.")
        Sub("$msisdn · signed in")

        Card(
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = Panel),
            modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
        ) {
            Column(Modifier.padding(17.dp)) {
                Text("Trip Guardian", color = Cream, fontSize = 17.sp)
                Text("Prepare a route before you lose signal — weather, dead-zone risk and offline maps saved to this phone.",
                    color = Muted, fontSize = 12.sp, lineHeight = 17.sp, modifier = Modifier.padding(top = 4.dp))

                summary?.let { s ->
                    s.weatherRisk?.let { risk ->
                        Row(Modifier.padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text("Weather  ", color = Muted, fontSize = 12.sp)
                            Text(risk, color = riskColor(risk), fontSize = 13.sp, fontWeight = FontWeight.Bold)
                        }
                        Text(s.weatherFactors, color = Muted, fontSize = 11.5.sp, lineHeight = 16.sp)
                    }
                    Text("Dead-zone risk", color = Muted, fontSize = 12.sp, modifier = Modifier.padding(top = 10.dp))
                    s.segments.forEach { (code, risk, ratio) ->
                        Row(Modifier.padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text("●", color = riskColor(risk), fontSize = 12.sp)
                            Text("  ${code.removePrefix("NH48-")} — $risk" +
                                (ratio?.let { " (${(it * 100).toInt()}% offline)" } ?: ""),
                                color = Cream, fontSize = 12.sp)
                        }
                    }
                    mosaic?.let { bmp ->
                        Image(
                            bitmap = bmp, contentDescription = "Offline route map",
                            contentScale = ContentScale.FillWidth,
                            modifier = Modifier.fillMaxWidth().padding(top = 12.dp)
                                .clip(RoundedCornerShape(12.dp)),
                        )
                        Text("${s.tilesCached}/${s.tilesTotal} map tiles on this device · shows offline · © OpenStreetMap",
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
                    shape = RoundedCornerShape(999.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Gold, contentColor = Color(0xFF0A0805)),
                    modifier = Modifier.fillMaxWidth().padding(top = 14.dp).height(48.dp),
                ) { Text(if (summary == null) "Prepare my route" else "Refresh route",
                    fontWeight = FontWeight.SemiBold, letterSpacing = 1.5.sp, fontSize = 12.sp) }
                if (busy) Loading()
            }
        }

        Card(
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = Panel),
            modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
        ) {
            Column(Modifier.padding(17.dp)) {
                Text("About", color = Cream, fontSize = 17.sp)
                Text("RoadAssist Bharat — one platform, every vehicle, every road. Student prototype; no real emergency dispatch is connected.",
                    color = Muted, fontSize = 12.sp, lineHeight = 17.sp, modifier = Modifier.padding(top = 4.dp))
            }
        }
        LineButton("Sign out") { onSignOut() }
    }
}

// ── shared pieces ──────────────────────────────────────────────────────────
@Composable
private fun ScreenColumn(content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(22.dp),
        content = content,
    )
}

@Composable
private fun Heading(plain: String, italic: String) {
    Row {
        Text(plain, fontSize = 27.sp, color = Cream, fontWeight = FontWeight.Normal)
        Text(
            " $italic", fontSize = 27.sp, color = Gold,
            fontStyle = FontStyle.Italic, fontWeight = FontWeight.Normal,
        )
    }
}

@Composable
private fun Sub(text: String) {
    Text(text, fontSize = 13.sp, color = Muted, lineHeight = 19.sp, modifier = Modifier.padding(top = 6.dp))
}

@Composable
private fun Field(value: String, onChange: (String) -> Unit, label: String, enabled: Boolean = true) {
    OutlinedTextField(
        value = value, onValueChange = onChange, enabled = enabled,
        label = { Text(label, color = Muted, fontSize = 12.sp) },
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
        shape = RoundedCornerShape(999.dp),
        colors = ButtonDefaults.buttonColors(containerColor = Gold, contentColor = Color(0xFF0A0805)),
        modifier = Modifier.fillMaxWidth().padding(top = 16.dp).height(52.dp),
    ) { Text(text, fontWeight = FontWeight.SemiBold, letterSpacing = 2.sp, fontSize = 12.sp) }
}

@Composable
private fun LineButton(text: String, onClick: () -> Unit) {
    OutlinedButton(
        onClick = onClick,
        shape = RoundedCornerShape(999.dp),
        modifier = Modifier.fillMaxWidth().padding(top = 10.dp).height(48.dp),
    ) { Text(text, color = Muted, fontSize = 12.sp, letterSpacing = 1.5.sp) }
}

// ── sign in ────────────────────────────────────────────────────────────────
@Composable
private fun SignInScreen(
    msisdn: String, onMsisdn: (String) -> Unit,
    onToast: (String) -> Unit,
    onSignedIn: (vehicleId: String?, vehicleLabel: String?) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var baseUrl by remember { mutableStateOf(Api.base) }
    var code by remember { mutableStateOf("") }
    var otpSent by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }

    ScreenColumn {
        Spacer(Modifier.height(40.dp))
        Row(
            Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            BrandMark(40)
            Spacer(Modifier.width(12.dp))
            Row {
                Text("Road", color = Cream, fontFamily = androidx.compose.ui.text.font.FontFamily.Serif,
                    fontSize = 30.sp, fontWeight = FontWeight.Medium)
                Text("Assist", color = Gold, fontFamily = androidx.compose.ui.text.font.FontFamily.Serif,
                    fontSize = 30.sp, fontWeight = FontWeight.Medium)
            }
        }
        Text("Every vehicle · Every road · Every phone",
            color = Muted, fontSize = 12.sp, letterSpacing = 1.sp,
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        Spacer(Modifier.height(34.dp))
        Heading("Sign in with your", "phone.")
        Sub("Real OTP against the live RoadAssist API. In development the code is returned by the server and auto-filled.")

        Field(baseUrl, { baseUrl = it }, "API base URL (10.0.2.2 = your PC from the emulator)")
        Field(msisdn, onMsisdn, "Mobile number (+91…)")

        if (!otpSent) {
            GoldButton("Send OTP", enabled = !busy) {
                busy = true
                Api.base = baseUrl.trim()
                scope.launch {
                    try {
                        val r = Api.post("/v1/auth/otp/request", JSONObject().put("msisdn", msisdn.trim()))
                        val dev = r.optJSONObject("meta")?.optString("devOtp").orEmpty()
                        if (dev.isNotBlank()) { code = dev; onToast("Dev OTP auto-filled ($dev)") }
                        else onToast("OTP sent by SMS")
                        otpSent = true
                    } catch (e: Exception) { onToast(e.message ?: "Failed") }
                    busy = false
                }
            }
        } else {
            Field(code, { code = it }, "6-digit code")
            GoldButton("Verify & sign in", enabled = !busy && code.length == 6) {
                busy = true
                scope.launch {
                    try {
                        val r = Api.post(
                            "/v1/auth/otp/verify",
                            JSONObject().put("msisdn", msisdn.trim()).put("code", code.trim()),
                        )
                        Api.token = r.getJSONObject("data").getString("accessToken")
                        val me = Api.get("/v1/me").getJSONObject("data")
                        val vehicles = me.optJSONArray("vehicles") ?: JSONArray()
                        if (vehicles.length() > 0) {
                            val v = vehicles.getJSONObject(0)
                            onSignedIn(v.getString("id"), v.getString("registrationNo"))
                        } else onSignedIn(null, null)
                        onToast("Signed in")
                    } catch (e: Exception) { onToast(e.message ?: "Failed") }
                    busy = false
                }
            }
        }
        if (busy) Loading()
    }
}

// ── home: SOS + vehicle ────────────────────────────────────────────────────
@Composable
private fun HomeScreen(
    msisdn: String, vehicleId: String?, vehicleLabel: String?,
    onVehicle: (String, String) -> Unit,
    onBook: () -> Unit, onToast: (String) -> Unit,
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
        Heading("Namaste,", "traveller.")
        Sub("$msisdn · signed in")

        // SOS — the fallback ladder: data → SMS → 112 → queue. Works with no net.
        val ctx = LocalContext.current
        val DEMO_LAT = 28.4595; val DEMO_LNG = 77.0266   // fallback if no GPS fix yet
        // Arm the no-data (SMS) and real-location rungs by requesting both perms.
        val perms = rememberLauncherForActivityResult(
            ActivityResultContracts.RequestMultiplePermissions(),
        ) { /* granted or not, the ladder degrades gracefully per rung */ }

        // Any queued SOS flushes automatically when data returns.
        LaunchedEffect(Unit) {
            val flushed = Emergency.flush(ctx)
            if (flushed > 0) onToast("$flushed queued SOS synced now that you're online")
        }

        Box(Modifier.fillMaxWidth().padding(vertical = 26.dp), contentAlignment = Alignment.Center) {
            Button(
                onClick = {
                    // Arm the no-data + real-location rungs up front.
                    perms.launch(arrayOf(
                        android.Manifest.permission.SEND_SMS,
                        android.Manifest.permission.ACCESS_FINE_LOCATION,
                    ))
                    busy = true
                    scope.launch {
                        val loc = Emergency.lastKnownLocation(ctx)
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
                            Emergency.Rung.DATA -> "✓ ONLINE — ${result.detail}"
                            Emergency.Rung.SMS -> "✓ NO DATA → SMS — ${result.detail}"
                            Emergency.Rung.DIALER -> "→ ${result.detail}"
                            Emergency.Rung.QUEUED -> "◷ ${result.detail}"
                        }
                        onToast("SOS via ${result.rung}")
                        busy = false
                    }
                },
                enabled = !busy,
                shape = CircleShape,
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1A0B08), contentColor = Cream),
                modifier = Modifier.size(150.dp).border(1.dp, Alarm.copy(alpha = 0.7f), CircleShape),
            ) { Text("SOS", fontSize = 20.sp, letterSpacing = 6.sp, fontWeight = FontWeight.SemiBold) }
        }
        sosResult?.let {
            Text(it, color = Alarm, fontSize = 12.sp, lineHeight = 17.sp,
                modifier = Modifier.align(Alignment.CenterHorizontally))
        }
        Text(
            "Works with no internet: SOS falls back data → SMS → 112 → offline queue, " +
                "and syncs the moment signal returns. SMS number is a placeholder until a real code is provisioned.",
            color = Muted, fontSize = 11.sp, lineHeight = 16.sp,
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
                    Text("Add your vehicle", color = Cream, fontSize = 17.sp)
                    Field(reg, { reg = it.uppercase() }, "Registration number")
                    Box {
                        OutlinedButton(
                            onClick = { classOpen = true },
                            shape = RoundedCornerShape(12.dp),
                            modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                        ) { Text("Type: $vClass", color = Cream, fontSize = 13.sp) }
                        DropdownMenu(expanded = classOpen, onDismissRequest = { classOpen = false }) {
                            classes.forEach { c ->
                                DropdownMenuItem(
                                    text = { Text(c) },
                                    onClick = { vClass = c; classOpen = false },
                                )
                            }
                        }
                    }
                    GoldButton("Add vehicle", enabled = !busy && reg.length >= 4) {
                        busy = true
                        scope.launch {
                            try {
                                val v = Api.post(
                                    "/v1/vehicles",
                                    JSONObject().put("registrationNo", reg.trim()).put("vehicleClass", vClass),
                                ).getJSONObject("data")
                                onVehicle(v.getString("id"), v.getString("registrationNo"))
                                onToast("Vehicle added")
                            } catch (e: Exception) { onToast(e.message ?: "Failed") }
                            busy = false
                        }
                    }
                } else {
                    Text("Your vehicle", color = Cream, fontSize = 17.sp)
                    Text(vehicleLabel ?: "", color = Muted, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp))
                    GoldButton("Request assistance") { onBook() }
                }
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
    onToast: (String) -> Unit,
    onTracked: (String) -> Unit,
    onNeedVehicle: () -> Unit,
) {
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

    ScreenColumn {
        Spacer(Modifier.height(16.dp))
        Heading("Request", "assistance.")
        Sub("Nearest verified mechanics, ranked by a real PostGIS query on the server.")

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
                    color = if (loadError) Alarm else Cream, fontSize = 13.sp,
                )
            }
            DropdownMenu(expanded = svcOpen, onDismissRequest = { svcOpen = false }) {
                services.forEach { s ->
                    DropdownMenuItem(text = { Text(s.second) }, onClick = { service = s; svcOpen = false })
                }
            }
        }
        Field(symptoms, { symptoms = it }, "What happened?")

        GoldButton("Book & dispatch", enabled = !busy && vehicleId != null && service != null) {
            busy = true
            scope.launch {
                try {
                    val b = Api.post(
                        "/v1/bookings",
                        JSONObject()
                            .put("vehicleId", vehicleId)
                            .put("serviceTypeCode", service!!.first)
                            .put("lat", 28.4595).put("lng", 77.0266)
                            .put("symptoms", symptoms.ifBlank { "reported from the Android app" })
                            .put("highwayMarker", "NH-48, KM 212")
                            .put("idempotencyKey", "and-" + System.nanoTime()),
                    ).getJSONObject("data")
                    bookingId = b.getString("id")
                    onToast("Booking ${b.getString("reference")} — dispatching…")
                    val d = Api.post("/v1/bookings/${bookingId}/dispatch",
                        JSONObject().put("radiusKm", 30).put("limit", 5)).getJSONObject("data")
                    val arr = d.optJSONArray("offers") ?: JSONArray()
                    offers = (0 until arr.length()).map { arr.getJSONObject(it) }
                    if (offers.isEmpty()) onToast("No mechanic in range — widen the radius")
                } catch (e: Exception) { onToast(e.message ?: "Failed") }
                busy = false
            }
        }

        offers.forEach { o ->
            val m = o.getJSONObject("mechanic")
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
                        Text(m.getString("displayName"), color = Cream, fontSize = 15.sp)
                        Text(
                            "★ ${m.getDouble("rating")} · ${m.getDouble("distanceKm")} km · ETA ${o.getInt("etaMinutes")} min",
                            color = Muted, fontSize = 12.sp,
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
                        shape = RoundedCornerShape(999.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Gold, contentColor = Color(0xFF0A0805)),
                    ) { Text("Accept", fontSize = 11.sp, fontWeight = FontWeight.Bold) }
                }
            }
        }

        if (vehicleId == null) LineButton("Add a vehicle first") { onNeedVehicle() }
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
        Heading("Your", "rescue.")
        Sub("Booking $bookingId")

        Card(
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = Panel),
            modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
        ) {
            Column(Modifier.padding(17.dp)) {
                Text("STATUS", color = Muted, fontSize = 10.sp, letterSpacing = 3.sp)
                Text(status, color = Gold, fontSize = 24.sp, modifier = Modifier.padding(top = 4.dp))
                invoice?.let {
                    Text(it, color = Muted, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp))
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
                                        val r = Api.post(
                                            "/v1/bookings/$bookingId/transition",
                                            JSONObject().put("command", cmd),
                                        )
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
                            shape = RoundedCornerShape(999.dp),
                        ) { Text(CommandLabels[cmd] ?: cmd, fontSize = 11.sp, color = Cream) }
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
