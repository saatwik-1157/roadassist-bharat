package `in`.roadassist.app

/**
 * What the live-map WebView may do, decided off-device (MapWebGuardTest).
 *
 * The map WebView carries two JavaScript bridges: AndroidAuth hands out the
 * signed-in user's access token and can rotate it, and AndroidNav starts a
 * booking. A bridge is visible to whatever page the WebView happens to show,
 * so each one answers only while that page is on the configured server (same
 * scheme, host and port as Api.base). The same rule decides which navigations
 * stay in the WebView and which origins may ask for the device's location.
 */
object MapWebGuard {
    /** Same scheme, host and port as the configured server. */
    fun sameOrigin(base: String, target: String?): Boolean =
        target != null && Layers.staysInApp(base, target)

    /** The token for the bridge: the real one on our own origin, else nothing. */
    fun bridgeToken(base: String, pageUrl: String?, token: String): String =
        if (sameOrigin(base, pageUrl)) token else ""

    /** May the page ask the app to rotate the session / start a booking? */
    fun bridgeAllowed(base: String, pageUrl: String?): Boolean = sameOrigin(base, pageUrl)

    /** Geolocation is granted only to the configured server's origin. */
    fun mayUseLocation(base: String, requestingOrigin: String?): Boolean =
        sameOrigin(base, requestingOrigin)
}
