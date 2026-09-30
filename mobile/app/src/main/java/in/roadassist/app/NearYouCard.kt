package `in`.roadassist.app

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.net.toUri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LifecycleResumeEffect
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope

/**
 * Home's "Near you" card: the Android side of the web's near.js. The pure
 * decisions (parsing, ordering, distance text, error mapping) are in
 * NearYou.kt; this file only fetches and draws.
 *
 * It is kept well away from the SOS path:
 *  - it runs in this composable's own LaunchedEffect, which Compose cancels
 *    when Home leaves the screen, never in Emergency.ladderScope;
 *  - while an SOS is armed or being raised ([sosActive]) it does nothing, and
 *    a lookup already in flight is cancelled, so it never competes with the
 *    ladder for the location provider or the network;
 *  - it never asks for a permission. It loads on its own only when location
 *    is already granted, and otherwise waits for a tap on "Find help near me".
 *    A tap without permission searches around the demo point and says so.
 */

/** The last card that loaded, so moving between tabs does not re-query for [NearYou.TTL_MS]. */
private object NearMemory {
    @Volatile private var last: Pair<Long, NearYou.State.Loaded>? = null
    fun fresh(now: Long = System.currentTimeMillis()): NearYou.State.Loaded? =
        last?.takeIf { NearYou.fresh(it.first, now) }?.second
    fun keep(state: NearYou.State.Loaded) { last = System.currentTimeMillis() to state }
}

private fun hasLocationPermission(ctx: Context): Boolean =
    ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

/** Locate (or fall back, labelled), then ask for the address and the nearby places together. */
private suspend fun loadNearYou(ctx: Context): NearYou.State {
    // A short budget: this is a convenience, and a person is watching the card.
    val fix = Emergency.currentLocation(ctx, timeoutMs = 6_000)
    val source = when {
        fix != null -> NearYou.Fix.GPS
        !hasLocationPermission(ctx) -> NearYou.Fix.NO_PERMISSION
        else -> NearYou.Fix.NO_FIX
    }
    val lat = fix?.first ?: NearYou.DEMO_LAT
    val lng = fix?.second ?: NearYou.DEMO_LNG
    return try {
        coroutineScope {
            val address = async { Api.get(NearYou.addressPath(lat, lng)) }
            val nearby = async { Api.get(NearYou.nearbyPath(lat, lng)) }
            NearYou.State.Loaded(
                fix = source,
                address = NearYou.parseAddress(address.await()),
                rows = NearYou.rows(NearYou.parseGroups(nearby.await())),
            )
        }
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        NearYou.State.Failed(NearYou.problemOf(e))
    }
}

/**
 * The card and its loading. [sosActive] is true while an SOS is armed or
 * being raised; see the file comment for why that pauses everything here.
 */
@Composable
fun NearYouSection(online: Boolean, sosActive: Boolean) {
    val ctx = LocalContext.current
    // Re-read on every resume: the SOS button and hazard reports ask for
    // location, and the answer comes back through a permission dialog that
    // pauses and resumes this screen. A card that says "permission is not
    // granted" must not outlive the grant (NearYou.reusable).
    var permitted by remember { mutableStateOf(hasLocationPermission(ctx)) }
    LifecycleResumeEffect(Unit) {
        permitted = hasLocationPermission(ctx)
        onPauseOrDispose { }
    }
    var state by remember {
        mutableStateOf<NearYou.State>(
            NearMemory.fresh()?.takeIf { NearYou.reusable(it, permitted) } ?: NearYou.State.Idle,
        )
    }
    // Taps on "Find help near me" and "Retry". 0 = nobody has asked yet.
    var asked by remember { mutableIntStateOf(0) }

    LaunchedEffect(asked, online, sosActive, permitted) {
        if (sosActive) return@LaunchedEffect
        NearMemory.fresh()?.takeIf { NearYou.reusable(it, permitted) }?.let { state = it; return@LaunchedEffect }
        if (asked == 0 && !hasLocationPermission(ctx)) { state = NearYou.State.Idle; return@LaunchedEffect }
        if (!online) { state = NearYou.State.Offline; return@LaunchedEffect }
        state = NearYou.State.Loading
        val next = loadNearYou(ctx.applicationContext)
        if (next is NearYou.State.Loaded) NearMemory.keep(next)
        state = next
    }

    NearYouCard(state, onAsk = { asked++ })
}

private fun dial(ctx: Context, uri: String) {
    // ACTION_DIAL only: the dialer opens with the number and the person decides.
    try { ctx.startActivity(Intent(Intent.ACTION_DIAL, uri.toUri())) } catch (_: Exception) { }
}

@Composable
private fun NearYouCard(state: NearYou.State, onAsk: () -> Unit) {
    val ctx = LocalContext.current
    Card(
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = Panel),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(17.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.near_title), color = Cream, style = RaType.title, modifier = Modifier.weight(1f))
                Text(stringResource(R.string.near_source), color = Muted, style = RaType.meta)
            }
            when (state) {
                NearYou.State.Idle -> {
                    Note(stringResource(R.string.near_intro))
                    AskButton(stringResource(R.string.near_find), onAsk)
                }
                NearYou.State.Loading -> Note(stringResource(R.string.near_loading))
                NearYou.State.Offline -> {
                    Note(stringResource(R.string.near_offline))
                    AskButton(stringResource(R.string.action_retry), onAsk)
                }
                is NearYou.State.Failed -> {
                    Note(
                        when (val p = state.problem) {
                            NearYou.Problem.Disabled -> stringResource(R.string.near_disabled)
                            NearYou.Problem.Unreachable -> stringResource(R.string.near_unreachable)
                            is NearYou.Problem.Server -> p.title
                        },
                    )
                    if (state.problem.retry) AskButton(stringResource(R.string.action_retry), onAsk)
                }
                is NearYou.State.Loaded -> LoadedBody(state, onDial = { dial(ctx, it) })
            }
        }
    }
}

@Composable
private fun LoadedBody(state: NearYou.State.Loaded, onDial: (String) -> Unit) {
    val address = state.address?.label
    Text(
        address ?: stringResource(R.string.near_no_address),
        color = if (address != null) Cream else Muted,
        style = RaType.label, modifier = Modifier.padding(top = 8.dp),
    )
    when (state.fix) {
        NearYou.Fix.GPS -> Unit
        NearYou.Fix.NO_PERMISSION -> Warn(stringResource(R.string.near_demo_no_permission))
        NearYou.Fix.NO_FIX -> Warn(stringResource(R.string.near_demo_no_fix))
    }
    state.rows.forEach { row -> PlaceRow(row, onDial) }
    Text(
        stringResource(R.string.near_footer) + " " + stringResource(R.string.near_attribution),
        color = Muted, style = RaType.meta, lineHeight = 15.sp, modifier = Modifier.padding(top = 12.dp),
    )
    // No side padding, so "call 112" lines up with the footer text above it; the
    // button keeps its 48 dp touch target from the minimum interactive size.
    TextButton(onClick = { onDial("tel:112") }, modifier = Modifier.padding(top = 2.dp),
        contentPadding = PaddingValues(horizontal = 0.dp, vertical = 8.dp)) {
        Text(stringResource(R.string.near_call_112), color = Alarm, style = RaType.label, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun PlaceRow(row: NearYou.Row, onDial: (String) -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(top = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(kindLabel(row.kind), color = Muted, style = RaType.meta, modifier = Modifier.width(92.dp))
        val place = row.nearest
        Column(Modifier.weight(1f)) {
            if (place == null) {
                Text(stringResource(R.string.near_none, NearYou.RADIUS_KM), color = Muted, style = RaType.label)
            } else {
                Text(
                    (place.name ?: stringResource(R.string.near_unnamed)) + " · " + NearYou.distance(place.distanceKm),
                    color = Cream, style = RaType.label,
                )
                if (row.more > 0) Text(stringResource(R.string.near_more, row.more), color = Muted, style = RaType.meta)
            }
        }
        val uri = NearYou.dialUri(place?.phone)
        if (place != null && uri != null) {
            val cd = stringResource(R.string.near_cd_call, place.name ?: stringResource(R.string.near_unnamed))
            TextButton(onClick = { onDial(uri) }, modifier = Modifier.semantics { contentDescription = cd }) {
                Text(stringResource(R.string.near_call), color = Gold, style = RaType.caption)
            }
        }
    }
}

@Composable
private fun kindLabel(kind: NearYou.Kind): String = stringResource(
    when (kind) {
        NearYou.Kind.HOSPITAL -> R.string.near_kind_hospital
        NearYou.Kind.POLICE -> R.string.near_kind_police
        NearYou.Kind.FUEL -> R.string.near_kind_fuel
        NearYou.Kind.CHARGING -> R.string.near_kind_charging
        NearYou.Kind.REPAIR -> R.string.near_kind_repair
    },
)

@Composable
private fun Note(text: String) {
    Text(text, color = Muted, style = RaType.sub, modifier = Modifier.padding(top = 6.dp))
}

@Composable
private fun Warn(text: String) {
    Text(text, color = LocalRa.current.warn, style = RaType.meta, lineHeight = 15.sp, modifier = Modifier.padding(top = 4.dp))
}

@Composable
private fun AskButton(text: String, onClick: () -> Unit) {
    OutlinedButton(
        onClick = onClick,
        shape = RoundedCornerShape(RaRadius.full),
        modifier = Modifier.fillMaxWidth().padding(top = 12.dp).height(46.dp),
    ) { Text(text, color = Gold, style = RaType.caption, letterSpacing = 1.sp) }
}
