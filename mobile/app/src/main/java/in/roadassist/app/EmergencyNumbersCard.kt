package `in`.roadassist.app

import android.content.Context
import android.content.Intent
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
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
 */
@Composable
fun EmergencyNumbersCard(modifier: Modifier = Modifier) {
    val ctx = LocalContext.current
    Card(
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = Panel),
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(17.dp)) {
            Text(stringResource(R.string.emergency_numbers_title), color = Cream, style = RaType.title)
            Text(
                stringResource(R.string.emergency_numbers_note),
                color = Muted, style = RaType.sub, modifier = Modifier.padding(top = 4.dp),
            )
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

/** 112: large, red-bordered, first — the number that reaches all three services. */
@Composable
private fun PrimaryRow(n: EmergencyNumber, onDial: () -> Unit) {
    val shape = RoundedCornerShape(12.dp)
    Row(
        Modifier.fillMaxWidth().padding(top = 12.dp)
            .clip(shape)
            .border(1.dp, Alarm.copy(alpha = 0.7f), shape)
            .clickable(role = Role.Button, onClick = onDial)
            .semantics(mergeDescendants = true) { }
            .heightIn(min = 56.dp)
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(n.number, color = Alarm, fontSize = 26.sp, fontWeight = FontWeight.SemiBold,
            modifier = Modifier.width(72.dp))
        Text(stringResource(n.labelRes), color = Cream, style = RaType.label, lineHeight = 17.sp)
    }
}

@Composable
private fun SecondaryRow(n: EmergencyNumber, onDial: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(top = 2.dp)
            .clip(RoundedCornerShape(10.dp))
            .clickable(role = Role.Button, onClick = onDial)
            .semantics(mergeDescendants = true) { }
            .heightIn(min = 48.dp)
            .padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(n.number, color = Gold, fontSize = 16.sp, fontWeight = FontWeight.SemiBold,
            modifier = Modifier.width(72.dp))
        Text(stringResource(n.labelRes), color = Muted, style = RaType.label)
    }
}
