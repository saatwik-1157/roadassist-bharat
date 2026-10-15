/* RoadAssist - "Continue with Google" and "Link Google" on the citizen web app.
 *
 * There is no Google code on this page, on purpose. The button is a plain
 * link to this server's /v1/auth/google/start, which answers with a redirect
 * to Google's consent screen (routes/google-auth.ts): the browser reaches
 * Google only because the person clicked, and no Google script, iframe or font
 * is ever loaded - the CSP and the data-residency gate stay exactly as they
 * were. Google sends the browser back to /v1/auth/google/callback; the server
 * verifies everything there and lands the page on app.html with the outcome
 * in the fragment:
 *
 *   #google=signedin[&new=1]    the citizen app's refresh cookie is set; refresh() to get a token
 *   #google=linked              Link Google finished for the signed-in account
 *   #google=error&reason=<code> nothing changed; say why
 *
 * The fragment is read once and removed, and a reason is only ever turned
 * into one of the fixed messages below - never written into the page as given,
 * because anybody can make a link ending in #google=error&reason=<anything>.
 *
 * Out of app.html (a classic script with a size ceiling, check-boundaries.mjs)
 * like email-signin.js and phone.js, and loaded before its inline script.
 */
(function (global) {
  "use strict";

  /** The reasons the server sends, each to a catalogue key (i18n.js) and its English. */
  var REASONS = {
    google_cancelled: ["google.err.cancelled", "Google sign-in was cancelled."],
    privileged_account: ["google.err.privileged", "This account cannot use Google sign-in. Sign in with your phone number."],
    email_signin_account: ["google.err.privileged", "This account cannot use Google sign-in. Sign in with your phone number."],
    google_in_use: ["google.err.inUse", "That Google account is already linked to another RoadAssist account."],
    other_google_linked: ["google.err.inUse", "That Google account is already linked to another RoadAssist account."],
    email_unverified: ["google.err.unverified", "Your Google account's email address is not verified with Google, so it cannot be used to sign in."],
    link_expired: ["google.err.linkExpired", "That Link Google request expired. Press Link Google again."],
  };
  var FAILED = ["google.err.failed", "Google sign-in did not complete. Try again."];

  /**
   * What a fragment says, or null when it is not a Google return. Pure: the
   * caller removes the fragment (consume) - tests feed it strings.
   */
  function parse(hash) {
    var h = String(hash || "").replace(/^#/, "");
    if (h.indexOf("google=") !== 0) return null;
    var out = { outcome: null, reason: null, isNew: false };
    h.split("&").forEach(function (pair) {
      var i = pair.indexOf("="), k = i < 0 ? pair : pair.slice(0, i), v = i < 0 ? "" : pair.slice(i + 1);
      if (k === "google" && /^(signedin|linked|error)$/.test(v)) out.outcome = v;
      else if (k === "reason" && /^[a-z_]{1,40}$/.test(v)) out.reason = v;
      else if (k === "new" && v === "1") out.isNew = true;
    });
    if (!out.outcome) return null;
    if (out.outcome !== "error") out.reason = null;
    return out;
  }

  /** The person-facing sentence for a reason: always one of the fixed ones. */
  function message(reason, t) {
    var m = Object.prototype.hasOwnProperty.call(REASONS, reason) ? REASONS[reason] : FAILED;
    return t ? t(m[0], m[1]) : m[1];
  }

  /** Read the page's own fragment once, and take it off the address bar and out of history. */
  function consume() {
    var r = parse(global.location && global.location.hash);
    if (r) {
      try { global.history.replaceState(null, "", global.location.pathname + global.location.search); }
      catch { global.location.hash = ""; }
    }
    return r;
  }

  var featureOnce = null;
  /**
   * Whether this server has Google sign-in on: /health's static flag, asked
   * once per page. Any failure is "off" - the button is simply not drawn.
   */
  function feature(api) {
    if (!featureOnce) {
      featureOnce = global.fetch(api + "/health", { cache: "no-store" })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          var g = j && j.data && j.data.features && j.data.features.googleSignin;
          return { web: Boolean(g && g.web === true) };
        })
        .catch(function () { return { web: false }; });
    }
    return featureOnce;
  }

  /** The address the button goes to: this server's start route, never Google's. */
  function startUrl(api) { return api + "/v1/auth/google/start"; }

  /**
   * Link Google from inside a signed-in account: the server sets a five-minute
   * sealed cookie naming the account (Bearer-authenticated, so no other site
   * can), then the page goes through the same redirect as sign-in.
   */
  function startLink(api, headers, token) {
    return global.fetch(api + "/v1/me/google/web-link", {
      method: "POST", credentials: "include",
      headers: Object.assign({ "content-type": "application/json", authorization: "Bearer " + token }, headers),
      body: "{}",
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok || !j.data || j.data.next !== "/v1/auth/google/start?link=1") {
          throw Object.assign(new Error((j.error && j.error.title) || "HTTP " + r.status), { code: j.error && j.error.code });
        }
        global.location.assign(api + j.data.next);
      });
    });
  }

  /**
   * Google's "G", inline, full colour, exactly as Google's sign-in branding
   * guidelines draw it. An image of a mark, not a request to Google.
   */
  var G_MARK = '<svg viewBox="0 0 48 48" width="20" height="20" focusable="false">' +
    '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>' +
    '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>' +
    '<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>' +
    '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>' +
    '<path fill="none" d="M0 0h48v48H0z"/></svg>';
  var mark = '<span class="gsi-mark" aria-hidden="true">' + G_MARK + "</span>";

  /**
   * Everything the page needs, mounted into three empty containers app.html
   * provides: #a-google-wrap (sign-in), #phone-card (Home), #g-account
   * (Settings). Returns the controller app.html calls at its four moments:
   * back() at boot, update(me) after /v1/me, reset() on sign-out, askPhone()
   * when a booking needs the number.
   *
   * o: { api, headers, $, tr, toast, busy, fieldError, nav, call, refresh, token(), onPhone(msisdn) }
   */
  function mount(o) {
    var $ = o.$, state = { on: false, userId: null, roles: [], hasPhone: true, google: null };

    // ── sign-in: the button ──────────────────────────────────────────────
    var wrap = $("a-google-wrap");
    wrap.innerHTML = '<p class="or-rule" aria-hidden="true"><span data-i18n="auth.or">or</span></p>' +
      '<a class="gsi-btn" id="a-google" rel="nofollow">' + mark +
      '<span class="gsi-text" data-i18n="auth.google">Continue with Google</span></a>';
    var button = $("a-google");
    button.href = startUrl(o.api);
    // In a frame (the project site shows this page in one) Google's screen
    // refuses to open, so the link takes a tab of its own instead.
    var framed = false;
    try { framed = global.top !== global.self; } catch { framed = true; }
    if (framed) { button.target = "_blank"; button.rel = "noopener nofollow"; }

    // ── Home: the number a Google sign-up adds (phone.js) ────────────────
    var card = global.RAPhone.mountCard({
      el: $("phone-card"), call: o.call, refresh: o.refresh, toast: o.toast, busy: o.busy,
      fieldError: o.fieldError, tr: o.tr, userId: function () { return state.userId; },
      onAdded: function (n) { state.hasPhone = true; render(); o.onPhone(n); },
    });

    // ── Settings: add the number, Link Google ────────────────────────────
    var acct = $("g-account");
    acct.innerHTML = '<button class="btn soft" id="s-phone" style="margin-top:12px" hidden data-i18n="phone.title">Add your mobile number</button>' +
      '<div id="g-link-row" hidden><p class="meta" id="g-link-state" style="margin-top:10px" hidden></p>' +
      '<button type="button" class="gsi-btn" id="g-link" style="margin-top:10px">' + mark +
      '<span class="gsi-text" data-i18n="google.link">Link Google</span></button></div>';
    $("s-phone").onclick = function () { o.nav("home"); card.ask(); };
    $("g-link").onclick = o.busy($("g-link"), async function () {
      try { await startLink(o.api, o.headers, o.token()); }
      catch (e) {
        var err = e;
        // An access token that expired while the page sat open: refresh once.
        if (err.code === "AUTH_EXPIRED" && await o.refresh()) {
          try { await startLink(o.api, o.headers, o.token()); return; } catch (e2) { err = e2; }
        }
        o.toast(err.code ? message(err.code, o.tr) : err.message, "bad");
      }
    });

    function render() {
      if (!state.userId) return;
      card.render(state.hasPhone);
      $("s-phone").hidden = state.hasPhone;
      // Link Google is for a citizen account only; the server refuses any other.
      var citizenOnly = state.roles.length > 0 && state.roles.every(function (r) { return r === "citizen"; });
      var linked = Boolean(state.google && state.google.linked);
      $("g-link-row").hidden = !(state.on && citizenOnly);
      $("g-link").hidden = linked;
      $("g-link-state").hidden = !linked;
      $("g-link-state").textContent = linked
        ? o.tr("google.linkedAs", "Google account linked: {email}").replace("{email}", state.google.email || "") : "";
    }

    feature(o.api).then(function (f) { state.on = f.web; wrap.hidden = !f.web; render(); });

    return {
      /** At boot: the outcome Google's round trip left in the fragment, said once. "signedin" is the page's to finish. */
      back: function () {
        var r = consume();
        if (!r) return null;
        if (r.outcome === "error") o.toast(message(r.reason, o.tr), "bad");
        if (r.outcome === "linked") global.setTimeout(function () { o.toast(o.tr("google.linked", "Google account linked"), "ok"); }, 600);
        return r.outcome;
      },
      /** After GET /v1/me: who this is, whether they have a phone, whether Google is linked. */
      update: function (me) {
        state.userId = me.user && me.user.id; state.roles = me.roles || [];
        state.hasPhone = me.hasPhone !== false; state.google = me.google || null;
        render();
      },
      reset: function () {
        state.userId = null; state.roles = []; state.hasPhone = true; state.google = null;
        card.reset(); $("s-phone").hidden = true; $("g-link-row").hidden = true;
      },
      /** A booking was refused for want of a phone: bring the card back. */
      askPhone: function () { o.nav("home"); state.hasPhone = false; render(); card.ask(); },
    };
  }

  global.RAGoogle = {
    parse: parse, message: message, consume: consume, feature: feature, startUrl: startUrl,
    startLink: startLink, mount: mount,
  };
})(typeof window !== "undefined" ? window : globalThis);
