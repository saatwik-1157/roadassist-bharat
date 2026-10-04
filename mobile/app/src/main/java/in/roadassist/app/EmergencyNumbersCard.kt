package `in`.roadassist.app

import android.content.Context
import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Call
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.net.toUri

/**
 * Home's "Emergency numbers" card: every entry of [EmergencyNumbers.ALL], each
 * one tap from the dialer.
 *
 * Static on purpose. It needs no network, no session and no permission, so it
 * is there on the screen a stranded person is holding even when the SOS
 * ladder has nothing left to try. ACTION_DIAL only: the dialer opens with the
 * number filled in and the person presses call — the app never places a call
 * itself and does not ask for CALL_PHONE.
 *
 * Numbers are set in tabular figures so the column of them lines up; every
 * row is at least 48dp and presses in under the thumb.
 */
@Composable
fun EmergencyNumbersCard(modifier: Modifier = Modifier) {
    val ctx = LocalContext.current
    RaCard(modifier = modifier.fillMaxWidth()) {
        Column(Modifier.padding(CardPad)) {
            Text(stringResource(R.string.emergency_numbers_title), color = Cream, style = RaType.title)
            Text(
                stringResource(R.string.emergency_numbers_note),
                color = Muted, style = RaType.sub, modifier = Modifier.padding(top = 4.dp),
            )
            Spacer(Modifier.height(RaSpace.s1))
            EmergencyNumbers.ALL.forEach { n ->
                if (n.primary) PrimaryRow(n) { dialEmergency(ctx, n.number) }
                else SecondaryRow(n) { dialEmergency(ctx, n.number) }
            }
        }
    }
}

private fun dialEmergency(ctx: Context, number: String) {
    try { ctx.startActivity(Intent(Intent.ACTION_DIAL, "tel:$number".toUri())) } catch (_: Exception) { }
}

/** 112: large, red-edged, lit from above, first — the number that reaches all three services. */
@Composable
private fun PrimaryRow(n: EmergencyNumber, onDial: () -> Unit) {
    val ra = LocalRa.current
    val shape = RoundedCornerShape(RaRadius.md)
    val source = remember { MutableInteractionSource() }
    val press = rememberPressScale(source, pressed = 0.975f)
    val wash = remember(ra) {
        Brush.verticalGradient(listOf(ra.alarm.copy(alpha = if (ra.isDark) 0.16f else 0.10f), ra.alarm.copy(alpha = 0.04f)))
    }
    Row(
        Modifier.fillMaxWidth().padding(top = RaSpace.s3)
            .graphicsLayer { val s = press.value; scaleX = s; scaleY = s }
            .clip(shape)
            .background(wash)
            .border(1.dp, ra.alarm.copy(alpha = 0.7f), shape)
            .clickable(interactionSource = source, indication = ripple(), role = Role.Button, onClick = onDial)
            .semantics(mergeDescendants = true) { }
            .heightIn(min = 64.dp)
            .padding(horizontal = RaSpace.s4, vertical = RaSpace.s3),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(n.number, color = Alarm, style = RaType.figures, fontSize = 28.sp, letterSpacing = (-0.5).sp,
            modifier = Modifier.width(76.dp))
        Text(stringResource(n.labelRes), color = Cream, style = RaType.label, lineHeight = 17.sp,
            modifier = Modifier.weight(1f))
        DialBadge(fill = ra.alarmFill, ink = ra.onAlarm)
    }
}

@Composable
private fun SecondaryRow(n: EmergencyNumber, onDial: () -> Unit) {
    val ra = LocalRa.current
    val source = remember { MutableInteractionSource() }
    val press = rememberPressScale(source, pressed = 0.98f)
    Row(
        Modifier.fillMaxWidth().padding(top = 2.dp)
            .graphicsLayer { val s = press.value; scaleX = s; scaleY = s }
            .clip(RoundedCornerShape(RaRadius.sm))
            .clickable(interactionSource = source, indication = ripple(), role = Role.Button, onClick = onDial)
            .semantics(mergeDescendants = true) { }
            .heightIn(min = 52.dp)
            .padding(horizontal = RaSpace.s4),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(n.number, color = Gold, style = RaType.figures, fontSize = 17.sp,
            modifier = Modifier.width(76.dp))
        Text(stringResource(n.labelRes), color = Muted, style = RaType.label, modifier = Modifier.weight(1f))
        DialBadge(fill = ra.goldFill.copy(alpha = 0.16f), ink = ra.gold)
    }
}

/** The handset glyph at the end of each row: the row is a call, and says so. */
@Composable
private fun DialBadge(fill: Color, ink: Color) {
    Box(
        Modifier.size(32.dp).clip(CircleShape).background(fill),
        contentAlignment = Alignment.Center,
    ) {
        Icon(Icons.Rounded.Call, contentDescription = null, tint = ink, modifier = Modifier.size(17.dp))
    }
}
