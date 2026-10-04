package `in`.roadassist.app

import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

/**
 * The type scale, pinned to the sizes it replaced.
 *
 * [RaType] was not designed from scratch — it was extracted from the literals
 * already in MainActivity, so that naming them changed nothing on screen. That
 * only holds while the numbers stay put, and a wrong number here silently
 * restyles a screen nobody re-opens before a demo. Compose cannot be rendered
 * in a JVM unit test, so this is the part of "it still looks the same" that can
 * actually be checked without a device: the styles resolve to what the call
 * sites used to say.
 *
 * Each case names the call sites it stands for. If you change a value, change
 * it because the design changed, and expect this test to tell you.
 */
class RaTypeTest {

    @Test
    fun `title keeps the 17sp the eight card and row titles used`() {
        assertEquals(17.sp, RaType.title.fontSize)
    }

    @Test
    fun `title is Inter 600 — the text face, not the display face`() {
        // An earlier draft thickened every card title by accident while the
        // build stayed green. The weight is a decision now, so it is pinned.
        assertEquals(Inter, RaType.title.fontFamily)
        assertEquals(FontWeight.SemiBold, RaType.title.fontWeight)
    }

    @Test
    fun `caption keeps 12sp — the most common size in the app`() {
        assertEquals(12.sp, RaType.caption.fontSize)
    }

    @Test
    fun `sub is caption plus the line height that makes it a paragraph`() {
        assertEquals(12.sp, RaType.sub.fontSize)
        assertEquals(17.sp, RaType.sub.lineHeight)
    }

    @Test
    fun `label keeps 13sp and body keeps 15sp`() {
        assertEquals(13.sp, RaType.label.fontSize)
        assertEquals(15.sp, RaType.body.fontSize)
    }

    @Test
    fun `meta keeps 11sp`() {
        assertEquals(11.sp, RaType.meta.fontSize)
    }

    @Test
    fun `eyebrow carries the tracking that makes it read as a micro label`() {
        assertEquals(10.sp, RaType.eyebrow.fontSize)
        assertEquals(1.sp, RaType.eyebrow.letterSpacing)
    }

    @Test
    fun `the wordmark is the bundled Space Grotesk, not the platform serif`() {
        // FontFamily.Serif was the stand-in while the app bundled no fonts.
        assertEquals(SpaceGrotesk, RaType.display.fontFamily)
        assertFalse(RaType.display.fontFamily == FontFamily.Serif)
        assertEquals(30.sp, RaType.display.fontSize)
        assertEquals(FontWeight.Bold, RaType.display.fontWeight)
    }

    @Test
    fun `screen headings are Space Grotesk 600 at 27sp`() {
        assertEquals(SpaceGrotesk, RaType.heading.fontFamily)
        assertEquals(FontWeight.SemiBold, RaType.heading.fontWeight)
        assertEquals(27.sp, RaType.heading.fontSize)
    }

    @Test
    fun `display styles are upright — the brand set has no italics`() {
        for (style in listOf(RaType.display, RaType.heading)) {
            assertFalse(style.fontStyle == androidx.compose.ui.text.font.FontStyle.Italic)
        }
    }

    @Test
    fun `text is Inter, never the platform default`() {
        // A style with no family falls back to Roboto, which is how a screen
        // ends up in two typefaces with nobody having chosen the second.
        for (style in listOf(
            RaType.title, RaType.body, RaType.label, RaType.caption, RaType.sub, RaType.meta, RaType.button,
        )) {
            assertEquals(Inter, style.fontFamily)
        }
    }

    @Test
    fun `values are JetBrains Mono 500 with tabular figures`() {
        // Emergency numbers, the countdown, distances and codes: a column of
        // them lines up and a ticking count does not jitter.
        assertEquals(JetBrainsMono, RaType.figures.fontFamily)
        assertEquals(FontWeight.Medium, RaType.figures.fontWeight)
        assertEquals("tnum", RaType.figures.fontFeatureSettings)
        assertEquals(JetBrainsMono, RaType.eyebrow.fontFamily)
    }

    @Test
    fun `buttons are Inter 600 at 14sp`() {
        assertEquals(14.sp, RaType.button.fontSize)
        assertEquals(FontWeight.SemiBold, RaType.button.fontWeight)
    }

    @Test
    fun `no style carries a colour, which would be wrong in one of the themes`() {
        // Colour belongs to RaColors through LocalRa. Baking it in here is the
        // mistake goldFill/goldInk exist to prevent: a style that is legible in
        // dark and invisible on paper.
        for (style in listOf(
            RaType.display, RaType.heading, RaType.title, RaType.body,
            RaType.label, RaType.caption, RaType.sub, RaType.meta, RaType.eyebrow,
            RaType.button, RaType.figures,
        )) {
            assertEquals(androidx.compose.ui.graphics.Color.Unspecified, style.color)
        }
    }
}
