package `in`.roadassist.app

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

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

/**
 * Spacing — the Kotlin twin of `--s-1`..`--s-9` in ds.css, same 4dp base.
 *
 * The screens were written before this existed and reach for a fresh number
 * every time: 29 distinct dp values across MainActivity, with 12, 16, 14, 17,
 * 18 and 10 all in use for what is visually the same gap. The web had the same
 * problem until ds.css grew a ladder. Numbered rather than named (`s4`, not
 * `medium`) so the two files can be read side by side.
 */
object RaSpace {
    val s1 = 4.dp
    val s2 = 8.dp
    val s3 = 12.dp
    val s4 = 16.dp
    val s5 = 24.dp
    val s6 = 32.dp
    val s7 = 48.dp
    val s8 = 64.dp
    val s9 = 80.dp
}

/** Corner radii — the twin of `--r-xs`..`--r-full`. `full` is the pill. */
object RaRadius {
    val xs = 8.dp
    val sm = 12.dp
    val md = 16.dp
    val lg = 22.dp
    val xl = 30.dp
    val full = 999.dp
}

/**
 * The type scale, extracted from what the screens already use rather than
 * invented: 12sp appears 29 times, 17sp fourteen, 13sp twelve, 11sp eight.
 * Those clusters are the real hierarchy, so they are named here instead of
 * being retyped as literals.
 *
 * No colour is set on any of these. Colour comes from [RaColors] through
 * [LocalRa], and baking it in here would produce styles that are wrong in one
 * of the two themes — the mistake `goldFill`/`goldInk` exist to prevent.
 *
 * Serif is the display face: the app bundles no fonts, and the platform serif
 * is the closest stand-in for Fraunces on the web side.
 *
 * Deliberately NOT wired into MaterialTheme.typography. Material components
 * (buttons, navigation labels) read that, so replacing it would restyle them
 * silently; adopting these is a per-call-site change.
 */
object RaType {
    /** The wordmark, and only the wordmark. Serif is the display face. */
    val display = TextStyle(
        fontFamily = FontFamily.Serif, fontSize = 30.sp, fontWeight = FontWeight.Medium,
    )
    /** Screen headings. Sans, not serif — the serif is reserved for the mark. */
    val heading = TextStyle(fontSize = 27.sp, fontWeight = FontWeight.Normal)
    /** Card and row titles. Carries no weight: the call sites do not set one. */
    val title = TextStyle(fontSize = 17.sp)
    val body = TextStyle(fontSize = 15.sp)
    val label = TextStyle(fontSize = 13.sp)
    val caption = TextStyle(fontSize = 12.sp)
    /** A paragraph of supporting copy. The line height is what separates it. */
    val sub = TextStyle(fontSize = 12.sp, lineHeight = 17.sp)
    val meta = TextStyle(fontSize = 11.sp)
    /** All-caps micro label; the tracking is what makes it read as one. */
    val eyebrow = TextStyle(fontSize = 10.sp, letterSpacing = 1.sp)
}
