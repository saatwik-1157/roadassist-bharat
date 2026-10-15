/* RoadAssist - the citizen app's phone number: reading one the way people
 * write it, and the "add your mobile number" card a Google sign-up gets.
 *
 * Out of app.html because that page is one classic script with a size
 * ceiling (scripts/check-boundaries.mjs), and this is self-contained. Loaded
 * before app.html's inline script, which uses RAPhone.normalize for its own
 * sign-in form and emergency contacts.
 */
(function (global) {
  "use strict";

  /**
   * Accept a phone number the way people actually write it.
   *
   * The API requires strict E.164 (+91XXXXXXXXXX) and is right to. But nobody
   * in India types their own number that way — they type ten digits, or with
   * spaces from a contact card, or with the STD leading zero. Rejecting those
   * as invalid is the app being pedantic about a format it can work out for
   * itself. Anything genuinely not an Indian mobile still fails, and says why.
   */
  function normalize(raw) {
    var v = String(raw || "").replace(/[\s\-().]/g, "");
    if (/^[6-9]\d{9}$/.test(v)) return "+91" + v;          // 7000009876
    if (/^0[6-9]\d{9}$/.test(v)) return "+91" + v.slice(1); // 07000009876
    if (/^91[6-9]\d{9}$/.test(v)) return "+" + v;           // 917000009876
    if (/^\+91[6-9]\d{9}$/.test(v)) return v;               // already correct
    return null;
  }

  var CARD =
    '<h2 class="title" data-i18n="phone.title">Add your mobile number</h2>' +
    '<p class="meta" style="margin-top:4px" data-i18n="phone.why">Mechanics call you on it. SOS works without it; booking a mechanic needs it.</p>' +
    '<label class="field"><span data-i18n="auth.msisdn">Mobile number</span>' +
    '<input id="ph-msisdn" inputmode="tel" autocomplete="tel" placeholder="+9198…"></label>' +
    '<button class="btn soft" id="ph-send" style="margin-top:12px" data-i18n="auth.send">Send code</button>' +
    '<div id="ph-step2" hidden><label class="field"><span data-i18n="auth.code">6-digit code</span>' +
    '<input id="ph-code" maxlength="6" inputmode="numeric" placeholder="000000" autocomplete="one-time-code"></label>' +
    '<button class="btn" id="ph-verify" style="margin-top:12px" data-i18n="auth.verify">Verify &amp; continue</button></div>' +
    '<button class="btn ghost" id="ph-later" style="margin-top:10px" data-i18n="phone.later">Later</button>';

  /**
   * The card, asked once: "Later" puts it away for this account on this
   * device, and Settings (or a booking that needs the number) brings it back.
   * The number is proved with the ordinary sign-in code - POST
   * /v1/auth/otp/request, the same limits and SMS - and attached by
   * POST /v1/me/phone. A number that already has an account of its own is
   * refused by the server and nothing changes (routes/google-auth.ts).
   *
   * o: { el, call(method, path, body, opts), refresh(), toast, busy, fieldError,
   *      tr, userId(), onAdded(msisdn) }
   */
  function mountCard(o) {
    o.el.innerHTML = CARD;
    var q = function (id) { return o.el.querySelector("#" + id); };
    var key = function () { return "ra.app.phoneLater." + o.userId(); };
    var number = null;

    function later() { try { return global.localStorage.getItem(key()) === "1"; } catch { return false; } }

    q("ph-later").onclick = function () {
      try { global.localStorage.setItem(key(), "1"); } catch { /* asked again next time */ }
      o.el.hidden = true;
    };
    q("ph-send").onclick = o.busy(q("ph-send"), async function () {
      var msisdn = normalize(q("ph-msisdn").value);
      if (!msisdn) { o.fieldError("ph-msisdn", "Enter a 10-digit Indian mobile number, starting 6, 7, 8 or 9."); return; }
      o.fieldError("ph-msisdn", null);
      try {
        var r = await o.call("POST", "/v1/auth/otp/request", { msisdn: msisdn }, { force: true });
        number = msisdn; q("ph-msisdn").value = msisdn;
        q("ph-step2").hidden = false; q("ph-code").focus();
        if (r.meta && r.meta.devOtp) { q("ph-code").value = r.meta.devOtp; o.toast("Dev OTP auto-filled (" + r.meta.devOtp + ")"); }
        else o.toast("Code sent by SMS", "ok");
      } catch (e) { o.toast(e.message, "bad"); }
    });
    q("ph-verify").onclick = o.busy(q("ph-verify"), async function () {
      var code = q("ph-code").value.trim();
      if (!/^\d{6}$/.test(code)) { o.fieldError("ph-code", "Enter the 6-digit code."); return; }
      o.fieldError("ph-code", null);
      var body = { msisdn: number, code: code };
      try {
        // noRetry: a wrong code is a 401 too, and replaying it after a token
        // refresh would spend a second attempt. Only an expired access token
        // is refreshed and the code sent again.
        try { await o.call("POST", "/v1/me/phone", body, { force: true, noRetry: true }); }
        catch (e1) {
          if (e1.code !== "AUTH_EXPIRED" || !(await o.refresh())) throw e1;
          await o.call("POST", "/v1/me/phone", body, { force: true, noRetry: true });
        }
        o.el.hidden = true;
        o.onAdded(number);
        o.toast(o.tr("phone.added", "Mobile number verified"), "ok");
      } catch (e) {
        // A number with an account of its own: nothing changed. The way to
        // join the two is to sign in with that number and use Link Google.
        o.toast(e.code === "phone_in_use" ? o.tr("phone.inUse", e.message) : e.message, "bad");
      }
    });

    return {
      /** Show the card if the account has no phone and "Later" was not pressed. */
      render: function (hasPhone) { o.el.hidden = hasPhone || later(); },
      /** Show it whatever "Later" said, and put the cursor in it. */
      ask: function () {
        try { global.localStorage.removeItem(key()); } catch { /* shown anyway */ }
        o.el.hidden = false; q("ph-msisdn").focus();
      },
      reset: function () { o.el.hidden = true; q("ph-step2").hidden = true; q("ph-code").value = ""; number = null; },
    };
  }

  global.RAPhone = { normalize: normalize, mountCard: mountCard };
})(window);
