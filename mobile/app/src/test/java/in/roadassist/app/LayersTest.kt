package `in`.roadassist.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The two decisions behind the "Layers in 3D" screen: which address it loads,
 * and which navigations the WebView is allowed to follow.
 *
 * Both are about the configured server, never a hard-coded host. A developer
 * pointed at a laptop must see the laptop's layers.html, and the WebView must
 * never be walked off to a third-party site while it wears this app's chrome.
 */
class LayersTest {

    private val live = Api.DEFAULT_BASE

    @Test
    fun `loads layers html from the configured base, not a fixed host`() {
        assertEquals("https://app.roadassistbharat.online/layers.html", Layers.url(live))
        assertEquals("http://10.0.2.2:4000/layers.html", Layers.url("http://10.0.2.2:4000"))
    }

    @Test
    fun `a trailing slash on the base does not double the separator`() {
        assertEquals("http://192.168.1.8:4000/layers.html", Layers.url("http://192.168.1.8:4000/"))
    }

    @Test
    fun `links on the same server stay in the app`() {
        assertTrue(Layers.staysInApp(live, "https://app.roadassistbharat.online/showcase.html"))
        assertTrue(Layers.staysInApp(live, "https://APP.roadassistbharat.online/"))
        assertTrue(Layers.staysInApp(live, "https://app.roadassistbharat.online:443/app.html"))
        assertTrue(Layers.staysInApp("http://10.0.2.2:4000", "http://10.0.2.2:4000/app.html"))
    }

    @Test
    fun `another host leaves for the browser`() {
        assertFalse(Layers.staysInApp(live, "https://github.com/roadassist"))
        assertFalse(Layers.staysInApp(live, "https://roadassistbharat.online/"))
        assertFalse(Layers.staysInApp(live, "https://app.roadassistbharat.online.evil.example/"))
    }

    @Test
    fun `a scheme or port change is not the same server`() {
        // A plain-http link to the live host would be a downgrade.
        assertFalse(Layers.staysInApp(live, "http://app.roadassistbharat.online/layers.html"))
        assertFalse(Layers.staysInApp("http://10.0.2.2:4000", "http://10.0.2.2:5000/"))
    }

    @Test
    fun `non-web links and garbage never stay in the WebView`() {
        assertFalse(Layers.staysInApp(live, "tel:112"))
        assertFalse(Layers.staysInApp(live, "mailto:help@example.com"))
        assertFalse(Layers.staysInApp(live, "intent://scan/#Intent;scheme=zxing;end"))
        assertFalse(Layers.staysInApp(live, "not a url"))
        assertFalse(Layers.staysInApp("", "https://app.roadassistbharat.online/"))
    }

    @Test
    fun `the theme script stores and applies exactly the app's theme`() {
        val dark = Layers.themeScript(isDark = true)
        val light = Layers.themeScript(isDark = false)
        assertTrue(dark.contains("localStorage.setItem('ra.theme','dark')"))
        assertTrue(dark.contains("setAttribute('data-theme','dark')"))
        assertFalse(dark.contains("'light'"))
        assertTrue(light.contains("localStorage.setItem('ra.theme','light')"))
        assertTrue(light.contains("setAttribute('data-theme','light')"))
        assertFalse(light.contains("'dark'"))
    }

    /**
     * The script above only works while layers.html keeps its theme under the
     * same key and applies it the same way. Read the page and hold it to that,
     * so a rename on the web side fails here instead of silently leaving the
     * app's light theme showing a dark page.
     */
    @Test
    fun `layers html still reads its theme from the key the app writes`() {
        val page = listOf(
            java.io.File("../../app/apps/web/layers.html"),   // from mobile/app (Gradle's test cwd)
            java.io.File("../app/apps/web/layers.html"),      // from mobile/
        ).firstOrNull { it.isFile }
        org.junit.Assume.assumeTrue("layers.html is not in this checkout", page != null)
        val src = page!!.readText()
        assertTrue(src.contains("localStorage.getItem(\"${Layers.THEME_KEY}\")"))
        assertTrue(src.contains("setAttribute(\"data-theme\""))
    }
}
