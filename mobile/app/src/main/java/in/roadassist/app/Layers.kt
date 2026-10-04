package `in`.roadassist.app

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.doOnLayout

/**
 * "Layers in 3D": the web's layers.html — every layer of the platform as a
 * live three.js model — shown in a WebView, the same way the Map tab shows
 * map.html.
 *
 * The decisions are pure and live here so they are tested off-device
 * (LayersTest): which address to load, and which navigations stay in the
 * WebView. Both read the configured API base rather than naming a host, so a
 * developer pointed at a laptop sees the laptop's page, exactly as the map does.
 */
object Layers {
    /** The page, on whatever server this phone talks to. */
    fun url(base: String): String = base.trimEnd('/') + "/layers.html"

    /**
     * May this navigation happen inside the WebView?
     *
     * Only on the configured server: same scheme, same host, same port. The
     * page links to the showcase and the citizen app on its own origin, which
     * stay in the app; anything else (another host, a tel: or mailto: link, a
     * plain-http downgrade of the live host) leaves for the system browser or
     * handler, so the WebView can never be walked off to a third-party site
     * while wearing this app's chrome.
     */
    fun staysInApp(base: String, target: String): Boolean {
        val b = parse(base) ?: return false
        val t = parse(target) ?: return false
        return b.scheme.equals(t.scheme, ignoreCase = true) &&
            b.host.equals(t.host, ignoreCase = true) &&
            port(b) == port(t)
    }

    /** The key layers.html (and the other web pages) keep the theme choice under. */
    const val THEME_KEY = "ra.theme"

    /**
     * A script that puts the page in the app's theme.
     *
     * layers.html has no theme parameter: a script in its <head> reads
     * localStorage["ra.theme"] and sets data-theme on <html>, and its own ◐
     * button writes the same key. So the app writes that key (the next open is
     * right from the page's first script) and sets the attribute (this open
     * is right as soon as the document exists). Only "light" or "dark" is
     * ever written — the value is chosen here, never taken from the page.
     */
    fun themeScript(isDark: Boolean): String {
        val t = if (isDark) "dark" else "light"
        return "(function(){try{localStorage.setItem('$THEME_KEY','$t')}catch(e){}" +
            "var d=document.documentElement;if(d&&d.getAttribute('data-theme')!=='$t')d.setAttribute('data-theme','$t')})()"
    }

    private fun parse(s: String): java.net.URI? = try {
        java.net.URI(s.trim()).takeIf { it.scheme != null && it.host != null }
    } catch (_: Exception) { null }

    private fun port(u: java.net.URI): Int = when {
        u.port != -1 -> u.port
        u.scheme.equals("https", ignoreCase = true) -> 443
        u.scheme.equals("http", ignoreCase = true) -> 80
        else -> -1
    }
}

/**
 * The full-screen Layers view. Covers the whole app (top bar and bottom nav
 * included) and is closed by the back arrow or the system back button.
 *
 * The WebView is built when this opens and destroyed when it closes. Unlike
 * the map, it is not retained: a three.js scene holds a GPU context and runs
 * an animation loop, and keeping one alive behind the SOS screen for the rest
 * of the session would cost battery on the phones this app is for.
 *
 * The page is shown in the app's theme ([Layers.themeScript]). Its 3D stage is
 * a dark studio in both of the page's themes by design; the chrome around it
 * (header, journey bar, layer list) is what follows light or dark.
 */
@android.annotation.SuppressLint("SetJavaScriptEnabled")
@Composable
fun LayersScreen(isDark: Boolean, onClose: () -> Unit) {
    val ctx = LocalContext.current
    val base = remember { Api.base }
    val url = remember { Layers.url(base) }
    var loading by remember { mutableStateOf(true) }
    var failed by remember { mutableStateOf(false) }

    val web = remember {
        android.webkit.WebView(ctx).apply {
            layoutParams = android.view.ViewGroup.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
            )
            // Hardware acceleration is left at its default (on): WebGL needs it.
            settings.javaScriptEnabled = true
            // The page keeps the shared ra.theme choice in localStorage.
            settings.domStorageEnabled = true
            settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            webViewClient = object : android.webkit.WebViewClient() {
                override fun shouldOverrideUrlLoading(
                    view: android.webkit.WebView,
                    request: android.webkit.WebResourceRequest,
                ): Boolean {
                    val target = request.url.toString()
                    if (Layers.staysInApp(base, target)) return false
                    try {
                        view.context.startActivity(
                            android.content.Intent(android.content.Intent.ACTION_VIEW, request.url)
                                .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK),
                        )
                    } catch (_: android.content.ActivityNotFoundException) { /* nothing can open it */ }
                    return true
                }

                override fun onPageStarted(view: android.webkit.WebView, u: String?, favicon: android.graphics.Bitmap?) {
                    loading = true
                }

                // The theme is applied when the new document is about to be
                // drawn and again when it has finished, both while the opaque
                // loading cover is still up, so the page is never seen in the
                // other theme. Only on the configured server's own pages.
                override fun onPageCommitVisible(view: android.webkit.WebView, u: String?) {
                    if (u != null && Layers.staysInApp(base, u)) view.evaluateJavascript(Layers.themeScript(isDark), null)
                }

                override fun onPageFinished(view: android.webkit.WebView, u: String?) {
                    if (u != null && Layers.staysInApp(base, u)) view.evaluateJavascript(Layers.themeScript(isDark), null)
                    loading = false
                }

                override fun onReceivedError(
                    view: android.webkit.WebView,
                    request: android.webkit.WebResourceRequest,
                    error: android.webkit.WebResourceError,
                ) {
                    // A failed font or a failed /v1/ping is the page's business
                    // (it shows its own "offline" pill). Only the page itself
                    // failing replaces it with the retry state.
                    if (request.isForMainFrame) { failed = true; loading = false }
                }

                override fun onReceivedHttpError(
                    view: android.webkit.WebView,
                    request: android.webkit.WebResourceRequest,
                    response: android.webkit.WebResourceResponse,
                ) {
                    // A server that answers 404/502 for the page is as unusable
                    // as no server, and its error body is not this app's screen.
                    if (request.isForMainFrame && response.statusCode >= 400) { failed = true; loading = false }
                }
            }
            // Loaded after the first layout, not here. Built inside remember,
            // the WebView has no size yet, and a page that starts loading at
            // 0 x 0 lays itself out for a zero-height viewport and then jumps
            // when the real size arrives. The view itself is MATCH_PARENT in a
            // weighted box, so it has its full height from the first frame;
            // this makes the page's first layout use that height too.
            doOnLayout { loadUrl(url) }
        }
    }
    DisposableEffect(web) {
        onDispose {
            web.stopLoading()
            web.destroy()
        }
    }

    BackHandler {
        // A link followed inside the page (the showcase, the citizen app) is
        // stepped back through first; from layers.html itself, back closes.
        if (!failed && web.canGoBack()) web.goBack() else onClose()
    }

    val backLabel = stringResource(R.string.cd_back)
    Column(Modifier.fillMaxSize().background(Bg)) {
        Row(
            Modifier.fillMaxWidth()
                .background(Panel)
                .padding(WindowInsets.statusBars.asPaddingValues())
                .padding(horizontal = 8.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "←", color = Cream, fontSize = 22.sp,
                modifier = Modifier
                    .clip(CircleShape)
                    .clickable { onClose() }
                    .semantics { contentDescription = backLabel }
                    .padding(horizontal = 12.dp, vertical = 4.dp),
            )
            Spacer(Modifier.width(4.dp))
            Text(stringResource(R.string.layers_title), color = Cream, style = RaType.title)
        }
        Box(
            Modifier.fillMaxWidth().weight(1f)
                .padding(WindowInsets.navigationBars.asPaddingValues()),
        ) {
            AndroidView(modifier = Modifier.fillMaxSize(), factory = { web })
            if (failed) {
                Column(
                    Modifier.fillMaxSize().background(Bg).padding(28.dp),
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text("◈", fontSize = 44.sp, color = Muted)
                    Text(
                        stringResource(R.string.layers_offline_title), color = Cream,
                        style = RaType.title, textAlign = TextAlign.Center,
                        modifier = Modifier.padding(top = 12.dp),
                    )
                    Text(
                        stringResource(R.string.layers_offline_body), color = Muted,
                        style = RaType.sub, textAlign = TextAlign.Center,
                        modifier = Modifier.padding(top = 6.dp),
                    )
                    Button(
                        onClick = {
                            failed = false
                            loading = true
                            web.loadUrl(url)
                        },
                        shape = RoundedCornerShape(RaRadius.full),
                        colors = ButtonDefaults.buttonColors(containerColor = GoldFill, contentColor = GoldInk),
                        modifier = Modifier.padding(top = 18.dp).height(46.dp),
                    ) { Text(stringResource(R.string.action_retry), fontWeight = FontWeight.SemiBold) }
                }
            } else if (loading) {
                Box(Modifier.fillMaxSize().background(Bg), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = Gold, modifier = Modifier.size(32.dp))
                }
            }
        }
    }
}
