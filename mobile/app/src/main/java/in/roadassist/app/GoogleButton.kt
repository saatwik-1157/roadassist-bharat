package `in`.roadassist.app

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * "Continue with Google" / "Link Google", drawn to Google's sign-in branding
 * guidelines rather than the app's theme: the full-colour G (ic_google_g),
 * a white pill with Google's #747775 stroke and #1F1F1F text in light rooms,
 * #131314 with #8E918F and #E3E3E3 in dark ones, Roboto Medium 14/20 (the
 * system's sans-serif on Android is Roboto), 12dp before the mark, 10dp
 * between mark and text. These are Google's colours, so they are not tokens.
 */
@Composable
fun GoogleButton(text: String, modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit) {
    val dark = LocalRa.current.isDark
    val fill = if (dark) Color(0xFF131314) else Color(0xFFFFFFFF)
    val stroke = if (dark) Color(0xFF8E918F) else Color(0xFF747775)
    val ink = if (dark) Color(0xFFE3E3E3) else Color(0xFF1F1F1F)
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(50),
        border = BorderStroke(1.dp, if (enabled) stroke else stroke.copy(alpha = 0.38f)),
        colors = ButtonDefaults.outlinedButtonColors(
            containerColor = fill, contentColor = ink,
            disabledContainerColor = fill.copy(alpha = 0.38f), disabledContentColor = ink.copy(alpha = 0.38f),
        ),
        contentPadding = PaddingValues(start = 12.dp, end = 12.dp),
        modifier = modifier.fillMaxWidth().heightIn(min = 48.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
            // Decorative: the button's text says what it does.
            Image(painterResource(R.drawable.ic_google_g), contentDescription = null, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(10.dp))
            Text(
                text,
                style = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Medium,
                    fontSize = 14.sp, lineHeight = 20.sp, letterSpacing = 0.25.sp),
                maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(end = 2.dp),
            )
        }
    }
}
