package `in`.roadassist.app

import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
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
    fun `title sets no weight, because the call sites it replaced set none`() {
        // An earlier draft made this SemiBold. Applied to eight bare 17.sp
        // Texts it would have thickened every card title on the device while
        // the build stayed green.
        assertNull(RaType.title.fontWeight)
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
    fun `the wordmark is the serif, and the only thing that is`() {
        assertEquals(FontFamily.Serif, RaType.display.fontFamily)
        assertEquals(30.sp, RaType.display.fontSize)
        assertEquals(FontWeight.Medium, RaType.display.fontWeight)
    }

    @Test
    fun `screen headings are sans — the serif is reserved for the mark`() {
        assertNull(RaType.heading.fontFamily)
        assertEquals(27.sp, RaType.heading.fontSize)
    }

    @Test
    fun `no style carries a colour, which would be wrong in one of the themes`() {
        // Colour belongs to RaColors through LocalRa. Baking it in here is the
        // mistake goldFill/goldInk exist to prevent: a style that is legible in
        // dark and invisible on paper.
        for (style in listOf(
            RaType.display, RaType.heading, RaType.title, RaType.body,
            RaType.label, RaType.caption, RaType.sub, RaType.meta, RaType.eyebrow,
        )) {
            assertEquals(androidx.compose.ui.graphics.Color.Unspecified, style.color)
        }
    }
}
