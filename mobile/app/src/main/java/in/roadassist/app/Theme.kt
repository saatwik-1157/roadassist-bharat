package `in`.roadassist.app

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.LifecycleResumeEffect

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
 *
 * `alarmFill` is the same split for red: `alarm` is the red for text and
 * borders, `alarmFill` the red a filled button is painted with, always under
 * `onAlarm`. White on the dark theme's bright #FF5A66 measures 3.0:1, below
 * the 4.5:1 a button label needs, so filled red is the deeper red in both.
 *
 * The paper theme's `gold`, `warn` and `textDim` are darker than ds.css's:
 * measured on white and on the paper background they were 3.5–4.4:1, and they
 * carry small text ("Request", "Call", footnotes). The values below are all
 * ≥ 4.7:1 on every surface they sit on.
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
    val alarmFill: Color,
    val onAlarm: Color,
    /** True for the dark palette; lighting and shadows are tuned per room. */
    val isDark: Boolean,
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
    alarmFill = Color(0xFFD42233),
    onAlarm = Color.White,
    isDark = true,
)

val RaLight = RaColors(
    gold = Color(0xFF8A6316),
    goldFill = Color(0xFFE3B96A),
    goldInk = Color(0xFF1A1408),
    bg = Color(0xFFF6F5F2),
    panel = Color(0xFFFFFFFF),
    panel2 = Color(0xFFF2F0EA),
    text = Color(0xFF14151A),
    textDim = Color(0xFF646776),
    line = Color(0xFFE3E1DA),
    alarm = Color(0xFFD42233),
    ok = Color(0xFF0F7A52),
    warn = Color(0xFF8A5704),
    info = Color(0xFF2560C9),
    alarmFill = Color(0xFFD42233),
    onAlarm = Color.White,
    isDark = false,
)

/** Reading the palette anywhere in the tree, without threading it through. */
val LocalRa = staticCompositionLocalOf { RaDark }

/**
 * True when the system's "Remove animations" is on (ANIMATOR_DURATION_SCALE
 * is 0). Every decorative motion in the app reads this and stands still;
 * information that happens to move — the SOS countdown ring — still shows its
 * value, it just steps instead of gliding.
 */
val LocalReduceMotion = staticCompositionLocalOf { false }

private val DarkScheme = darkColorScheme(
    primary = RaDark.gold, onPrimary = RaDark.goldInk,
    background = RaDark.bg, onBackground = RaDark.text,
    surface = RaDark.panel, onSurface = RaDark.text,
    surfaceContainer = RaDark.panel2,
    secondary = RaDark.textDim, error = RaDark.alarm,
    // Material's default outline is a lilac grey from its own palette; this
    // is the panel hairline lifted to 3:1 on every surface, so an outlined control's edge is
    // visible without shouting.
    outline = Color(0xFF60667A), outlineVariant = RaDark.line,
)

private val LightScheme = lightColorScheme(
    primary = RaLight.gold, onPrimary = Color.White,
    background = RaLight.bg, onBackground = RaLight.text,
    surface = RaLight.panel, onSurface = RaLight.text,
    surfaceContainer = RaLight.panel,
    secondary = RaLight.textDim, error = RaLight.alarm,
    outline = Color(0xFF8A877E), outlineVariant = RaLight.line,
)

@Composable
fun RoadAssistTheme(dark: Boolean, content: @Composable () -> Unit) {
    val ctx = LocalContext.current
    fun animationsOff() = android.provider.Settings.Global.getFloat(
        ctx.contentResolver, android.provider.Settings.Global.ANIMATOR_DURATION_SCALE, 1f,
    ) == 0f
    // Re-read on every resume: the setting is changed in the system Settings
    // app, which pauses this one, and a stale answer would keep the motion on.
    var reduce by remember { mutableStateOf(animationsOff()) }
    LifecycleResumeEffect(Unit) {
        reduce = animationsOff()
        onPauseOrDispose { }
    }
    CompositionLocalProvider(
        LocalRa provides if (dark) RaDark else RaLight,
        LocalReduceMotion provides reduce,
    ) {
        MaterialTheme(
            colorScheme = if (dark) DarkScheme else LightScheme,
            typography = RaMaterialType,
            content = content,
        )
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
 * The brand's three faces, bundled (res/font) rather than downloaded, so the
 * first screen on a phone with no signal is already in the right type.
 *
 *  · Space Grotesk — display: the wordmark, screen headings, dialog titles.
 *  · Inter — everything read as text: titles, body, labels, buttons.
 *  · JetBrains Mono — anything read as a value: emergency numbers, the SOS
 *    countdown, severities, reference and status codes, micro labels
 *    (digits and codes only: it has no ₹, so rupee amounts stay in Inter).
 *
 * All three are SIL Open Font License 1.1. The licence texts ship unchanged
 * in assets/licenses and are named, and readable, under More → About. Indic
 * scripts fall through to the platform's Noto fonts glyph by glyph.
 */
val SpaceGrotesk = FontFamily(
    Font(R.font.space_grotesk_medium, FontWeight.Medium),
    Font(R.font.space_grotesk_semibold, FontWeight.SemiBold),
    Font(R.font.space_grotesk_bold, FontWeight.Bold),
)

val Inter = FontFamily(
    Font(R.font.inter_regular, FontWeight.Normal),
    Font(R.font.inter_medium, FontWeight.Medium),
    Font(R.font.inter_semibold, FontWeight.SemiBold),
)

val JetBrainsMono = FontFamily(
    Font(R.font.jetbrains_mono_medium, FontWeight.Medium),
)

/**
 * The type scale. The sizes were extracted from what the screens already use
 * rather than invented: 12sp appears 29 times, 17sp fourteen, 13sp twelve, 11sp
 * eight. Those clusters are the real hierarchy, so they are named here instead
 * of being retyped as literals.
 *
 * Display styles are upright only — the brand set has no italics, and a
 * slanted Space Grotesk would be the platform faking one.
 *
 * No colour is set on any of these. Colour comes from [RaColors] through
 * [LocalRa], and baking it in here would produce styles that are wrong in one
 * of the two themes — the mistake `goldFill`/`goldInk` exist to prevent.
 */
object RaType {
    /** The wordmark: Space Grotesk 700, tracked in. */
    val display = TextStyle(
        fontFamily = SpaceGrotesk, fontSize = 30.sp, fontWeight = FontWeight.Bold,
        letterSpacing = (-0.6).sp,
    )
    /** Screen headings: Space Grotesk 600. */
    val heading = TextStyle(
        fontFamily = SpaceGrotesk, fontSize = 27.sp, fontWeight = FontWeight.SemiBold,
        lineHeight = 32.sp, letterSpacing = (-0.6).sp,
    )
    /** Card and row titles: Inter 600. */
    val title = TextStyle(
        fontFamily = Inter, fontSize = 17.sp, fontWeight = FontWeight.SemiBold,
        letterSpacing = (-0.2).sp,
    )
    val body = TextStyle(fontFamily = Inter, fontSize = 15.sp, lineHeight = 21.sp)
    val label = TextStyle(fontFamily = Inter, fontSize = 13.sp)
    val caption = TextStyle(fontFamily = Inter, fontSize = 12.sp)
    /** A paragraph of supporting copy. The line height is what separates it. */
    val sub = TextStyle(fontFamily = Inter, fontSize = 12.sp, lineHeight = 17.sp)
    val meta = TextStyle(fontFamily = Inter, fontSize = 11.sp)
    /** Micro label (status, source, "online"): mono, tracked — it reads as a tag. */
    val eyebrow = TextStyle(
        fontFamily = JetBrainsMono, fontSize = 10.sp, letterSpacing = 1.sp, fontWeight = FontWeight.Medium,
    )
    /** Button labels: Inter 600 at 14, no letter-spacing games. */
    val button = TextStyle(
        fontFamily = Inter, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.sp,
    )
    /**
     * Numbers that are read against each other — emergency numbers, the SOS
     * countdown, severities, reference codes. JetBrains Mono 500: monospaced,
     * so a column of numbers lines up and a ticking count does not jitter;
     * "tnum" asks the same of any fallback face. Digits and codes only —
     * JetBrains Mono has no ₹, so a rupee amount stays in Inter.
     */
    val figures = TextStyle(
        fontFamily = JetBrainsMono, fontWeight = FontWeight.Medium, fontFeatureSettings = "tnum",
    )
}

/**
 * Material's own slots, re-faced. Buttons, navigation labels, text fields,
 * dialogs and menus read MaterialTheme.typography, so this is what makes the
 * components match the screens around them: display and headline slots
 * (dialog titles) in Space Grotesk, everything else in Inter, at Material's
 * own sizes.
 */
private val RaMaterialType: Typography = Typography().let { t ->
    Typography(
        displayLarge = t.displayLarge.copy(fontFamily = SpaceGrotesk, fontWeight = FontWeight.SemiBold),
        displayMedium = t.displayMedium.copy(fontFamily = SpaceGrotesk, fontWeight = FontWeight.SemiBold),
        displaySmall = t.displaySmall.copy(fontFamily = SpaceGrotesk, fontWeight = FontWeight.SemiBold),
        headlineLarge = t.headlineLarge.copy(fontFamily = SpaceGrotesk, fontWeight = FontWeight.SemiBold),
        headlineMedium = t.headlineMedium.copy(fontFamily = SpaceGrotesk, fontWeight = FontWeight.SemiBold),
        headlineSmall = t.headlineSmall.copy(fontFamily = SpaceGrotesk, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.3).sp),
        titleLarge = t.titleLarge.copy(fontFamily = SpaceGrotesk, fontWeight = FontWeight.Medium),
        titleMedium = t.titleMedium.copy(fontFamily = Inter, fontWeight = FontWeight.SemiBold),
        titleSmall = t.titleSmall.copy(fontFamily = Inter, fontWeight = FontWeight.SemiBold),
        bodyLarge = t.bodyLarge.copy(fontFamily = Inter),
        bodyMedium = t.bodyMedium.copy(fontFamily = Inter),
        bodySmall = t.bodySmall.copy(fontFamily = Inter),
        labelLarge = t.labelLarge.copy(fontFamily = Inter, fontWeight = FontWeight.SemiBold),
        labelMedium = t.labelMedium.copy(fontFamily = Inter, fontWeight = FontWeight.SemiBold),
        labelSmall = t.labelSmall.copy(fontFamily = Inter, fontWeight = FontWeight.Medium),
    )
}
