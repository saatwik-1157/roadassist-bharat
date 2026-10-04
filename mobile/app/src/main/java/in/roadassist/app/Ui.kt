package `in`.roadassist.app

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.interaction.InteractionSource
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.isSpecified
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The app's small kit of depth, motion and status pieces.
 *
 * Every animation here obeys two rules, because this app is opened on old
 * phones on bad days:
 *  · it is read in a deferred phase (`graphicsLayer {}` or a draw lambda), so a
 *    frame of motion redraws a layer and recomposes nothing;
 *  · it stands still when [LocalReduceMotion] is set ("Remove animations").
 */
object RaMotion {
    /** A state change the eye should barely register: a press, a chip. */
    const val FAST = 120
    /** The default: tab crossfades, toasts, list items. */
    const val MED = 200
    /** Something arriving: a card entering, a screen settling. */
    const val SLOW = 320

    /** Material's standard curve; everything that is not a spring uses it. */
    val ease = FastOutSlowInEasing
    /** The web's `--ease-out` (cubic-bezier(.2,.7,.3,1)): fast away, long settle. */
    val settle = CubicBezierEasing(0.2f, 0.7f, 0.3f, 1f)

    fun <T> fast() = tween<T>(FAST, easing = ease)
    fun <T> med() = tween<T>(MED, easing = ease)
    fun <T> slow() = tween<T>(SLOW, easing = settle)
    /** Sheets, toasts and anything pushed by a finger: lightly damped, no bounce to speak of. */
    fun <T> sheet() = spring<T>(dampingRatio = 0.86f, stiffness = Spring.StiffnessMediumLow)
}

/** The 20dp inside every card: 16 + 4 on the spacing ladder. */
val CardPad: Dp = RaSpace.s4 + RaSpace.s1

/**
 * A press that the hand can feel: the control dips to [pressed] and springs
 * back. Returned as State so the caller reads it inside `graphicsLayer {}`.
 */
@Composable
fun rememberPressScale(source: InteractionSource, pressed: Float = 0.965f): State<Float> {
    val reduce = LocalReduceMotion.current
    val isPressed by source.collectIsPressedAsState()
    return animateFloatAsState(
        targetValue = if (isPressed && !reduce) pressed else 1f,
        animationSpec = if (isPressed) tween(RaMotion.FAST, easing = RaMotion.ease)
        else spring(dampingRatio = 0.55f, stiffness = Spring.StiffnessMedium),
        label = "press",
    )
}

/**
 * A panel with light falling on it from above: a soft drop shadow, a fill that
 * is a touch brighter at the top edge, and a hairline whose top is lit and
 * whose bottom falls into shade. It replaces Material's flat Card, which has
 * none of those in the dark theme (Material tints elevation instead of
 * shading it, and this palette has no tint to give).
 */
@Composable
fun RaCard(
    modifier: Modifier = Modifier,
    border: BorderStroke? = null,
    tint: Color = Color.Unspecified,
    elevation: Dp = 10.dp,
    content: @Composable ColumnScope.() -> Unit,
) {
    val ra = LocalRa.current
    val shape = RoundedCornerShape(RaRadius.lg)
    val fill = if (tint.isSpecified) tint else ra.panel
    val lighting = remember(ra.isDark) {
        Brush.verticalGradient(
            if (ra.isDark) listOf(Color.White.copy(alpha = 0.045f), Color.Transparent)
            else listOf(Color.White.copy(alpha = 0.9f), Color(0x00FFFFFF)),
        )
    }
    val edge = border ?: remember(ra) {
        BorderStroke(
            1.dp,
            if (ra.isDark) Brush.verticalGradient(listOf(Color.White.copy(alpha = 0.10f), ra.line.copy(alpha = 0.55f)))
            else Brush.verticalGradient(listOf(ra.line.copy(alpha = 0.7f), ra.line)),
        )
    }
    val shade = if (ra.isDark) Color.Black.copy(alpha = 0.7f) else Color(0x403B2F1A)
    Column(
        modifier
            .shadow(if (ra.isDark) elevation else elevation * 0.6f, shape, clip = false,
                ambientColor = shade, spotColor = shade)
            .clip(shape)
            .background(fill)
            .background(lighting)
            .border(edge, shape),
        content = content,
    )
}

/**
 * Enters once: fades up 16dp, [index] × 45 ms after its neighbours, so a list
 * arrives as a cascade instead of all at once. Capped at the eighth item — a
 * long list must not keep a person waiting for its tail.
 */
@Composable
fun Reveal(index: Int, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val reduce = LocalReduceMotion.current
    val p = remember { Animatable(if (reduce) 1f else 0f) }
    LaunchedEffect(reduce) {
        if (reduce) { p.snapTo(1f); return@LaunchedEffect }
        if (p.value < 1f) {
            delay(index.coerceIn(0, 8) * 45L)
            p.animateTo(1f, tween(RaMotion.SLOW, easing = RaMotion.settle))
        }
    }
    Box(
        modifier.graphicsLayer {
            val v = p.value
            alpha = v
            translationY = (1f - v) * 16.dp.toPx()
        },
    ) { content() }
}

/** A status as a tinted pill with a dot: what a booking, report or link is doing now. */
@Composable
fun StatusChip(text: String, color: Color, modifier: Modifier = Modifier) {
    val pill = RoundedCornerShape(RaRadius.full)
    Row(
        modifier
            .clip(pill)
            .background(color.copy(alpha = 0.10f))
            .border(1.dp, color.copy(alpha = 0.32f), pill)
            .padding(horizontal = 10.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(6.dp).background(color, CircleShape))
        Spacer(Modifier.width(6.dp))
        Text(text, color = color, style = RaType.eyebrow.copy(letterSpacing = 0.6.sp))
    }
}

/**
 * The connection state in the top bar. Online breathes a halo round its dot
 * (slowly — it is reassurance, not an alert); offline sits still in amber.
 */
@Composable
fun LinkChip(online: Boolean) {
    val ra = LocalRa.current
    val reduce = LocalReduceMotion.current
    val color = if (online) ra.ok else ra.warn
    // Two pulses when the link comes up, then still. A halo that never
    // stopped kept every screen drawing frames for nothing — on a phone whose
    // battery may be all that is left between its owner and help.
    val halo = remember { Animatable(0f) }
    LaunchedEffect(online, reduce) {
        halo.snapTo(0f)
        if (!online || reduce) return@LaunchedEffect
        repeat(2) {
            halo.snapTo(0f)
            halo.animateTo(1f, tween(1400, easing = RaMotion.settle))
        }
        halo.snapTo(0f)
    }
    val pill = RoundedCornerShape(RaRadius.full)
    Row(
        Modifier
            .clip(pill)
            .background(color.copy(alpha = 0.10f))
            .border(1.dp, color.copy(alpha = 0.28f), pill)
            .padding(horizontal = 10.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Canvas(Modifier.size(10.dp)) {
            val r = size.minDimension / 2f
            val t = halo.value
            if (t > 0f) drawCircle(color.copy(alpha = 0.45f * (1f - t)), radius = r * (0.6f + 0.9f * t))
            drawCircle(color, radius = r * 0.55f)
        }
        Spacer(Modifier.width(6.dp))
        Text(if (online) "online" else "offline", color = color, style = RaType.eyebrow)
    }
}

/**
 * A loading placeholder: a block in the shape of what is coming, with a band
 * of light passing over it. With motion off it is the block alone.
 */
@Composable
fun Shimmer(modifier: Modifier = Modifier, height: Dp = 12.dp) {
    val ra = LocalRa.current
    val reduce = LocalReduceMotion.current
    val base = if (ra.isDark) Color.White.copy(alpha = 0.06f) else Color.Black.copy(alpha = 0.06f)
    val hi = if (ra.isDark) Color.White.copy(alpha = 0.10f) else Color.White.copy(alpha = 0.75f)
    val t: State<Float> = if (!reduce) {
        rememberInfiniteTransition(label = "shimmer").animateFloat(
            initialValue = 0f, targetValue = 1f,
            animationSpec = infiniteRepeatable(tween(1300, easing = LinearEasing)),
            label = "shimmer-x",
        )
    } else remember { mutableFloatStateOf(-1f) }
    Box(
        modifier
            .height(height)
            .clip(RoundedCornerShape(RaRadius.xs))
            .drawBehind {
                drawRect(base)
                val v = t.value
                if (v >= 0f) {
                    val w = size.width
                    val x = -w * 0.6f + (w * 1.6f) * v
                    drawRect(
                        Brush.horizontalGradient(
                            listOf(Color.Transparent, hi, Color.Transparent),
                            startX = x, endX = x + w * 0.6f,
                        ),
                    )
                }
            },
    )
}

/** A few shimmer lines of falling width — a paragraph or a short list, loading. */
@Composable
fun ShimmerLines(modifier: Modifier = Modifier, lines: Int = 3) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        repeat(lines) { i ->
            Shimmer(Modifier.fillMaxWidth(if (i == lines - 1) 0.55f else 1f - i * 0.12f))
        }
    }
}

/**
 * A frosted panel for controls floated over the live map. The WebView beneath
 * cannot be blurred from Compose, so the frost is translucency plus a lit
 * edge and a shadow — enough to lift the control off busy map tiles.
 */
@Composable
fun GlassPanel(
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues(6.dp),
    content: @Composable RowScope.() -> Unit,
) {
    val ra = LocalRa.current
    val shape = RoundedCornerShape(RaRadius.full)
    val glass = remember(ra) {
        Brush.verticalGradient(
            if (ra.isDark) listOf(ra.panel2.copy(alpha = 0.86f), ra.panel.copy(alpha = 0.78f))
            else listOf(Color.White.copy(alpha = 0.92f), ra.panel2.copy(alpha = 0.84f)),
        )
    }
    val edge = remember(ra) {
        Brush.verticalGradient(
            if (ra.isDark) listOf(Color.White.copy(alpha = 0.16f), Color.White.copy(alpha = 0.04f))
            else listOf(Color.White, ra.line),
        )
    }
    Row(
        modifier
            .shadow(14.dp, shape, clip = false,
                ambientColor = Color.Black.copy(alpha = 0.5f), spotColor = Color.Black.copy(alpha = 0.5f))
            .clip(shape)
            .background(glass)
            .border(1.dp, edge, shape)
            .padding(contentPadding),
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}

/** The gold call to action: lit from above, presses in, 52dp tall. */
@Composable
fun RaPrimaryButton(
    text: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    fill: Color = LocalRa.current.goldFill,
    ink: Color = LocalRa.current.goldInk,
    height: Dp = 52.dp,
    fillWidth: Boolean = true,
    onClick: () -> Unit,
) {
    val ra = LocalRa.current
    val source = remember { MutableInteractionSource() }
    val scale = rememberPressScale(source)
    val shape = RoundedCornerShape(RaRadius.full)
    val sheen = remember { Brush.verticalGradient(0f to Color.White.copy(alpha = 0.20f), 0.55f to Color.Transparent) }
    Button(
        onClick = onClick, enabled = enabled, shape = shape,
        interactionSource = source,
        colors = ButtonDefaults.buttonColors(
            containerColor = fill, contentColor = ink,
            disabledContainerColor = if (ra.isDark) ra.panel2 else ra.line,
            disabledContentColor = ra.textDim,
        ),
        contentPadding = PaddingValues(horizontal = 20.dp),
        modifier = modifier
            .then(if (fillWidth) Modifier.fillMaxWidth() else Modifier)
            .heightIn(min = height)
            .graphicsLayer { val s = scale.value; scaleX = s; scaleY = s }
            .shadow(if (enabled) 8.dp else 0.dp, shape, clip = false,
                ambientColor = fill.copy(alpha = 0.6f), spotColor = fill.copy(alpha = 0.6f))
            // A sheen over the top half of the fill: the light the cards get.
            .drawWithContent {
                drawContent()
                if (enabled) drawRoundRect(sheen, cornerRadius = CornerRadius(size.height / 2f))
            },
    ) { Text(text, style = RaType.button) }
}

/** The quiet secondary: hairline, presses in, 48dp so it is a real touch target. */
@Composable
fun RaOutlineButton(
    text: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    color: Color = LocalRa.current.gold,
    height: Dp = 48.dp,
    style: TextStyle = RaType.button,
    onClick: () -> Unit,
) {
    val ra = LocalRa.current
    val source = remember { MutableInteractionSource() }
    val scale = rememberPressScale(source)
    OutlinedButton(
        onClick = onClick, enabled = enabled,
        shape = RoundedCornerShape(RaRadius.full),
        interactionSource = source,
        border = BorderStroke(1.dp, if (enabled) color.copy(alpha = 0.45f) else ra.line),
        contentPadding = PaddingValues(horizontal = 18.dp),
        modifier = modifier
            .heightIn(min = height)
            .graphicsLayer { val s = scale.value; scaleX = s; scaleY = s },
    ) { Text(text, color = if (enabled) color else ra.textDim, style = style) }
}

/**
 * The SOS control: one round button with depth, a slow breathing glow while
 * it waits, and — once armed — a ring that drains over the grace window, so
 * the time left can be seen as well as read.
 *
 * The button itself never tilts or moves away from the thumb; only its glow
 * and ring animate. While armed the ring is information, so with motion off it
 * still shows the time left, stepping once a second instead of gliding.
 */
@Composable
fun SosControl(
    armed: Boolean,
    secondsLeft: Int,
    totalSeconds: Int,
    enabled: Boolean,
    hint: String,
    onClick: () -> Unit,
) {
    val ra = LocalRa.current
    val reduce = LocalReduceMotion.current
    val alarm = ra.alarm

    // A few slow breaths each time Home is opened (about 25 s), then the glow
    // rests half-lit. Breathing forever would keep the screen rendering 60
    // frames a second for as long as Home is open — measurable battery on the
    // phone of somebody stranded — for a cue that has done its job after the
    // first few breaths. Armed, the glow holds full; with motion off it holds.
    val breath = remember { Animatable(0.5f) }
    LaunchedEffect(enabled, armed, reduce) {
        if (armed) { if (reduce) breath.snapTo(1f) else breath.animateTo(1f, RaMotion.med()); return@LaunchedEffect }
        if (reduce || !enabled) { breath.snapTo(0.5f); return@LaunchedEffect }
        repeat(5) {
            breath.animateTo(1f, tween(1300, easing = FastOutSlowInEasing))
            breath.animateTo(0f, tween(1300, easing = FastOutSlowInEasing))
        }
        breath.animateTo(0.5f, tween(900, easing = FastOutSlowInEasing))
    }

    val ring = rememberCountdownRing(armed, secondsLeft, totalSeconds)

    val glow = remember(alarm) {
        Brush.radialGradient(listOf(alarm.copy(alpha = 0.30f), alarm.copy(alpha = 0.07f), Color.Transparent))
    }
    val source = remember { MutableInteractionSource() }
    val press = rememberPressScale(source, pressed = 0.95f)

    Box(Modifier.fillMaxWidth().height(250.dp), contentAlignment = Alignment.Center) {
        Box(
            Modifier
                .size(236.dp)
                .graphicsLayer {
                    val b = breath.value
                    val s = 0.92f + 0.10f * b
                    scaleX = s; scaleY = s
                    alpha = 0.65f + 0.35f * b
                }
                .background(glow, CircleShape),
        )
        Canvas(Modifier.size(182.dp)) {
            val stroke = 4.dp.toPx()
            val inset = stroke / 2f
            val arcSize = Size(size.width - stroke, size.height - stroke)
            drawCircle(alarm.copy(alpha = if (armed) 0.22f else 0.14f), radius = size.minDimension / 2f - inset,
                style = Stroke(width = 1.5.dp.toPx()))
            val v = ring.value
            if (armed && v > 0f) {
                drawArc(
                    color = alarm, startAngle = -90f, sweepAngle = 360f * v, useCenter = false,
                    topLeft = Offset(inset, inset), size = arcSize,
                    style = Stroke(width = stroke, cap = StrokeCap.Round),
                )
            }
        }
        Button(
            onClick = onClick,
            enabled = enabled,
            shape = CircleShape,
            interactionSource = source,
            colors = ButtonDefaults.buttonColors(
                containerColor = Color.Transparent, contentColor = SosInk,
                disabledContainerColor = Color.Transparent, disabledContentColor = SosInk.copy(alpha = 0.6f),
            ),
            contentPadding = PaddingValues(0.dp),
            modifier = Modifier
                .size(150.dp)
                .graphicsLayer { val s = press.value; scaleX = s; scaleY = s }
                .shadow(18.dp, CircleShape, clip = false, ambientColor = alarm, spotColor = alarm)
                // Lit from the upper left: a deep ember, brighter where the
                // light lands. Built once per size, not per frame.
                .drawWithCache {
                    val face = Brush.radialGradient(
                        listOf(Color(0xFF4A1A15), Color(0xFF240E0A), Color(0xFF140604)),
                        center = Offset(size.width * 0.36f, size.height * 0.30f),
                        radius = size.width * 0.78f,
                    )
                    onDrawBehind { drawCircle(face) }
                }
                .border(1.dp, Brush.verticalGradient(listOf(alarm, alarm.copy(alpha = 0.35f))), CircleShape),
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text("SOS", style = RaType.display.copy(fontSize = 26.sp, letterSpacing = 6.sp))
                Text(hint, style = RaType.eyebrow, color = SosHint, modifier = Modifier.padding(top = 2.dp))
            }
        }
    }
}

/**
 * How much of the grace window is left, 1 → 0, as an animated value.
 *
 * Full at the moment of arming, empty as the ladder starts. Each second's
 * target is where the ring must be when the NEXT tick lands, so the glide and
 * the number on screen agree. With motion off it steps to the exact share left.
 */
@Composable
private fun rememberCountdownRing(armed: Boolean, secondsLeft: Int, totalSeconds: Int): Animatable<Float, *> {
    val reduce = LocalReduceMotion.current
    val ring = remember { Animatable(if (armed) 1f else 0f) }
    LaunchedEffect(armed, secondsLeft, reduce) {
        if (!armed) { ring.snapTo(0f); return@LaunchedEffect }
        val total = totalSeconds.coerceAtLeast(1).toFloat()
        if (reduce) { ring.snapTo(secondsLeft / total); return@LaunchedEffect }
        if (secondsLeft >= totalSeconds) ring.snapTo(1f)
        ring.animateTo(((secondsLeft - 1).coerceAtLeast(0)) / total, tween(1000, easing = LinearEasing))
    }
    return ring
}

/** The SOS dialog's countdown: the seconds left inside a ring that drains with them. */
@Composable
fun SosCountdownBadge(secondsLeft: Int, totalSeconds: Int) {
    val alarm = LocalRa.current.alarm
    val ring = rememberCountdownRing(true, secondsLeft, totalSeconds)
    Box(Modifier.size(44.dp), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(44.dp)) {
            val stroke = 3.dp.toPx()
            val inset = stroke / 2f
            drawCircle(alarm.copy(alpha = 0.18f), radius = size.minDimension / 2f - inset, style = Stroke(stroke))
            drawArc(
                alarm, startAngle = -90f, sweepAngle = 360f * ring.value, useCenter = false,
                topLeft = Offset(inset, inset), size = Size(size.width - stroke, size.height - stroke),
                style = Stroke(stroke, cap = StrokeCap.Round),
            )
        }
        Text("$secondsLeft", color = alarm, style = RaType.figures, fontSize = 17.sp)
    }
}

/**
 * A mechanic's initial in a lit gold disc. Derived from the name the server
 * sent and nothing else — there are no photos, and none are implied.
 */
@Composable
fun MechanicAvatar(name: String) {
    val ra = LocalRa.current
    val initial = name.trim().firstOrNull { it.isLetterOrDigit() }?.uppercaseChar()?.toString() ?: "·"
    Box(
        Modifier
            .size(40.dp)
            .clip(CircleShape)
            .background(Brush.linearGradient(listOf(ra.goldFill.copy(alpha = 0.32f), ra.goldFill.copy(alpha = 0.10f))))
            .border(1.dp, ra.goldFill.copy(alpha = 0.40f), CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(initial, color = ra.gold, style = RaType.title, fontSize = 17.sp)
    }
}

/** SOS face colours: the button is always a dark ember, so its ink is fixed light. */
private val SosInk = Color(0xFFF2F0EA)
private val SosHint = Color(0xFFB9A9A3)

/**
 * Home's hero: a lit panel that leans toward a finger resting on it and tips
 * back, like a card on a table, as the page scrolls it away. A road drawn in
 * perspective runs through it and drifts at half the scroll speed — the
 * parallax is inside the panel's clip, so nothing below is ever overlapped.
 *
 * This is decoration on the greeting only. The SOS control is a separate
 * element below it and is never tilted.
 */
@Composable
fun HomeHero(scroll: ScrollState, content: @Composable ColumnScope.() -> Unit) {
    val ra = LocalRa.current
    val reduce = LocalReduceMotion.current
    val scope = rememberCoroutineScope()
    val tiltX = remember { Animatable(0f) }
    val tiltY = remember { Animatable(0f) }
    val shape = RoundedCornerShape(RaRadius.xl)
    val springBack = spring<Float>(dampingRatio = 0.6f, stiffness = Spring.StiffnessLow)
    val gold = ra.goldFill
    val wash = remember(ra) {
        Brush.linearGradient(
            if (ra.isDark) listOf(Color(0xFF1C1A16), ra.panel, Color(0xFF0D0F14))
            else listOf(Color(0xFFFFFBF2), Color.White, ra.panel2),
            start = Offset.Zero, end = Offset(900f, 700f),
        )
    }
    val shade = if (ra.isDark) Color.Black.copy(alpha = 0.7f) else Color(0x403B2F1A)
    Column(
        Modifier
            .fillMaxWidth()
            .pointerInput(reduce) {
                if (reduce) return@pointerInput
                awaitEachGesture {
                    val down = awaitFirstDown(requireUnconsumed = false)
                    fun aim(p: Offset) {
                        val nx = (p.x / size.width - 0.5f).coerceIn(-0.5f, 0.5f) * 2f
                        val ny = (p.y / size.height - 0.5f).coerceIn(-0.5f, 0.5f) * 2f
                        scope.launch { tiltY.animateTo(nx * 5f, RaMotion.med()) }
                        scope.launch { tiltX.animateTo(-ny * 5f, RaMotion.med()) }
                    }
                    aim(down.position)
                    while (true) {
                        val ev = awaitPointerEvent()
                        val c = ev.changes.firstOrNull() ?: break
                        if (!c.pressed) break
                        aim(c.position)
                    }
                    scope.launch { tiltX.animateTo(0f, springBack) }
                    scope.launch { tiltY.animateTo(0f, springBack) }
                }
            }
            .graphicsLayer {
                val s = scroll.value.toFloat()
                rotationX = tiltX.value + (s / 28f).coerceIn(0f, 9f)
                rotationY = tiltY.value
                cameraDistance = 14f * density
                transformOrigin = androidx.compose.ui.graphics.TransformOrigin(0.5f, 1f)
            }
            .shadow(if (ra.isDark) 12.dp else 8.dp, shape, clip = false, ambientColor = shade, spotColor = shade)
            .clip(shape)
            .background(wash)
            .border(
                1.dp,
                Brush.verticalGradient(
                    if (ra.isDark) listOf(gold.copy(alpha = 0.28f), Color.White.copy(alpha = 0.04f))
                    else listOf(gold.copy(alpha = 0.55f), ra.line),
                ),
                shape,
            )
            .drawBehind {
                // A highway running away to the upper right: the carriageway
                // as a faint wedge, two kerbs and a dashed centre line, all
                // shifted by half the scroll for the parallax.
                val drift = (scroll.value * 0.5f).coerceAtMost(size.height)
                val vx = size.width * 0.80f
                val vy = -size.height * 0.10f + drift * 0.25f
                val bottom = size.height + drift
                val left = size.width * 0.44f
                val right = size.width * 1.16f
                val road = androidx.compose.ui.graphics.Path().apply {
                    moveTo(vx - 2f, vy); lineTo(vx + 2f, vy)
                    lineTo(right, bottom); lineTo(left, bottom); close()
                }
                drawPath(
                    road,
                    Brush.verticalGradient(
                        listOf(Color.Transparent, gold.copy(alpha = if (ra.isDark) 0.07f else 0.10f)),
                        startY = vy, endY = bottom,
                    ),
                )
                val kerb = gold.copy(alpha = if (ra.isDark) 0.22f else 0.35f)
                val w = 1.5.dp.toPx()
                drawLine(kerb, Offset(vx, vy), Offset(left, bottom), w)
                drawLine(kerb, Offset(vx, vy), Offset(right, bottom), w)
                val dash = gold.copy(alpha = if (ra.isDark) 0.40f else 0.55f)
                val bx = (left + right) / 2f
                for (i in 0 until 8) {
                    // Squared spacing: dashes grow and spread as they near the
                    // viewer, which is what sells the perspective.
                    val a = (i + 0.15f) / 8f
                    val b = (i + 0.55f) / 8f
                    val ea = a * a
                    val eb = b * b
                    drawLine(
                        dash,
                        Offset(vx + (bx - vx) * ea, vy + (bottom - vy) * ea),
                        Offset(vx + (bx - vx) * eb, vy + (bottom - vy) * eb),
                        strokeWidth = w * (0.5f + 2.2f * b),
                        cap = StrokeCap.Round,
                    )
                }
            }
            .padding(horizontal = CardPad, vertical = CardPad + 2.dp),
        content = content,
    )
}
