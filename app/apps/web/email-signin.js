/* RoadAssist — "Sign in with email", shared by the citizen app, the mechanic
 * console and RAKSHA.
 *
 * Each page keeps its own session handling; this only collects an address and
 * a code, talks to /v1/auth/email/*, and hands the session to the page's
 * onSession callback - the same shape the phone verify returns, so the page's
 * existing "signed in" path runs unchanged.
 *
 * The code is emailed and is never shown here. The one exception is a local
 * development server with no email provider (EMAIL_PROVIDER=console), which
 * says so in its response; the same rule the phone code follows.
 */
(function () {
  "use strict";

  function post(path, body) {
    return fetch(path, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (json) {
        if (!res.ok) throw new Error((json.error && json.error.title) || ("Request failed (" + res.status + ")"));
        return json;
      });
    });
  }

  function el(html) { var d = document.createElement("div"); d.innerHTML = html.trim(); return d.firstChild; }

  function mount(after, opts) {
    if (!after || !after.parentNode) return;
    var say = opts.toast || function () {};
    var box = el(
      '<div class="em-signin">' +
        '<button type="button" class="btn ghost em-toggle" aria-expanded="false">Sign in with email</button>' +
        '<div class="em-form" hidden>' +
          '<p class="hint em-why" role="status" hidden style="margin-top:12px"></p>' +
          '<label class="field"><span>Email address</span>' +
            '<input class="em-email" type="email" inputmode="email" autocomplete="email" spellcheck="false" placeholder="you@example.com"></label>' +
          '<button type="button" class="btn em-send" style="margin-top:14px">Email me a code</button>' +
          '<div class="em-step2" hidden>' +
            '<label class="field"><span>6-digit code from the email</span>' +
              '<input class="em-code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000" ' +
              'style="font-family:var(--mono);font-size:22px;letter-spacing:.36em;text-align:center"></label>' +
            '<button type="button" class="btn em-verify" style="margin-top:14px">Verify &amp; sign in</button>' +
          '</div>' +
          '<p class="hint em-note">For accounts the project owner has set up. The code arrives in your inbox and is never shown on this screen.</p>' +
        '</div>' +
      '</div>');
    after.parentNode.insertBefore(box, after.nextSibling);

    var q = function (c) { return box.querySelector(c); };
    var email = "";

    q(".em-toggle").addEventListener("click", function () {
      var open = q(".em-form").hidden;
      q(".em-form").hidden = !open;
      this.setAttribute("aria-expanded", String(open));
      if (open) q(".em-email").focus();
    });

    function busy(btn, fn) {
      return function () {
        if (btn.classList.contains("is-busy")) return;
        btn.classList.add("is-busy");
        Promise.resolve().then(fn).catch(function (e) { say(e.message, "bad"); })
          .then(function () { btn.classList.remove("is-busy"); });
      };
    }

    q(".em-send").addEventListener("click", busy(q(".em-send"), function () {
      email = q(".em-email").value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { say("Enter the email address your account uses.", "bad"); return; }
      return post("/v1/auth/email/request", { email: email }).then(function (r) {
        q(".em-step2").hidden = false;
        q(".em-code").focus();
        if (r.meta && r.meta.devOtp) { q(".em-code").value = r.meta.devOtp; say("Local development: code filled in", "ok"); }
        else say("If that address has an account, a code is on its way. Check your inbox and spam.", "ok");
      });
    }));

    q(".em-verify").addEventListener("click", busy(q(".em-verify"), function () {
      var code = q(".em-code").value.trim();
      if (!/^\d{6}$/.test(code)) { say("Enter the 6-digit code from the email.", "bad"); return; }
      return post("/v1/auth/email/verify", { email: email, code: code }).then(function (r) {
        return opts.onSession(r.data);
      });
    }));

    /**
     * Open the form from the page, with the reason it was opened.
     *
     * An account its owner put behind email sign-in refuses the phone code
     * with 403 email_signin_required. The page used to print that and stop,
     * leaving the person to find a collapsed button below the one they had
     * just pressed. On the hosted RAKSHA that was every first sign-in, because
     * the pre-filled demo admin is exactly such an account. The page now hands
     * the server's message here and the form opens on it, ready for an address.
     */
    function open(options) {
      options = options || {};
      var why = q(".em-why");
      why.textContent = options.message || "";
      why.hidden = !options.message;
      q(".em-form").hidden = false;
      q(".em-toggle").setAttribute("aria-expanded", "true");
      if (box.scrollIntoView) box.scrollIntoView({ block: "nearest" });
      q(".em-email").focus();
    }

    return { open: open };
  }

  /** Is this error the API saying "this account signs in by email"? */
  function isRequired(err) { return Boolean(err && err.code === "email_signin_required"); }

  window.RAEmail = { mount: mount, isRequired: isRequired };
})();
