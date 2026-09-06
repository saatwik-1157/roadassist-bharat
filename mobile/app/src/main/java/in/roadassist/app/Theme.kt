package `in`.roadassist.app

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/**
 * The RoadAssist palette — the Kotlin twin of `app/apps/web/ds.css`.
 *
 * Both themes ship. A phone used at 2 a.m. on a hard shoulder and a depot
 * office in daylight are different rooms, so the app follows the system by
 * default and lets the user pin either one.
 *
 * `gold` is the accent for text and icons — it darkens on paper to hold
 * contrast. `goldFill` is the decorative fill that stays bright in both themes
 * and is always paired with `goldInk`; keeping them separate is what stops a
 * light-theme button turning into dark-on-dark.
 */
@Immutable
data class RaColors(
    val gold: Color,
    val goldFill: Color,
    val goldInk: Color,
    val bg: Color,
    val panel: Color,
    val panel2: Color,
    val text: Color,
    val textDim: Color,
    val line: Color,
    val alarm: Color,
    val ok: Color,
    val warn: Color,
    val info: Color,
)

val RaDark = RaColors(
    gold = Color(0xFFE3B96A),
    goldFill = Color(0xFFE3B96A),
    goldInk = Color(0xFF14110A),
    bg = Color(0xFF08090C),
    panel = Color(0xFF101218),
    panel2 = Color(0xFF171A22),
    text = Color(0xFFF2F0EA),
    textDim = Color(0xFF8B8F9C),
    line = Color(0xFF232833),
    alarm = Color(0xFFFF5A66),
    ok = Color(0xFF35D08A),
    warn = Color(0xFFFFB454),
    info = Color(0xFF5B9DFF),
)

val RaLight = RaColors(
    gold = Color(0xFFA87A22),
    goldFill = Color(0xFFE3B96A),
    goldInk = Color(0xFF1A1408),
    bg = Color(0xFFF6F5F2),
    panel = Color(0xFFFFFFFF),
    panel2 = Color(0xFFF2F0EA),
    text = Color(0xFF14151A),
    textDim = Color(0xFF6E7180),
    line = Color(0xFFE3E1DA),
    alarm = Color(0xFFD42233),
    ok = Color(0xFF0F7A52),
    warn = Color(0xFFA86A08),
    info = Color(0xFF2560C9),
)

/** Reading the palette anywhere in the tree, without threading it through. */
val LocalRa = staticCompositionLocalOf { RaDark }

private val DarkScheme = darkColorScheme(
    primary = RaDark.gold, onPrimary = RaDark.goldInk,
    background = RaDark.bg, onBackground = RaDark.text,
    surface = RaDark.panel, onSurface = RaDark.text,
    secondary = RaDark.textDim, error = RaDark.alarm,
)

private val LightScheme = lightColorScheme(
    primary = RaLight.gold, onPrimary = Color.White,
    background = RaLight.bg, onBackground = RaLight.text,
    surface = RaLight.panel, onSurface = RaLight.text,
    secondary = RaLight.textDim, error = RaLight.alarm,
)

@Composable
fun RoadAssistTheme(dark: Boolean, content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalRa provides if (dark) RaDark else RaLight) {
        MaterialTheme(colorScheme = if (dark) DarkScheme else LightScheme, content = content)
    }
}
