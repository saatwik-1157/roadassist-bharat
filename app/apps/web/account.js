/**
 * Settings -> Account: Unlink Google and Delete my account (app.html).
 *
 *   DELETE /v1/me/google   Unlink Google; refused (phone_required) without a verified phone
 *   POST   /v1/me/delete   { confirm: "DELETE MY ACCOUNT" }, within 10 minutes of signing in
 *
 * The rules are the server's (apps/api/src/domain/account-deletion.ts); this
 * file only asks deliberately and says what the server answered. The phrase is
 * typed exactly, in every language: it is a key, not a sentence, so it is
 * never translated (the sentence around it is).
 *
 * Unlink is shown only when GET /v1/me says a Google account is linked; Delete
 * only when it says selfDelete (a plain citizen account). Any other account
 * sees the by-request note instead (privacy.html section 9).
 */
(function (global) {
  "use strict";

  var PHRASE = "DELETE MY ACCOUNT";

  /** Error code -> [i18n key, English]. Anything else shows the server's own title. */
  var CODES = {
    confirmation_required: ["acct.err.phrase", "Type DELETE MY ACCOUNT exactly to confirm."],
    reauth_required: ["acct.err.reauth", "For your safety, sign out and sign in again, then delete your account within 10 minutes."],
    privileged_account: ["acct.byRequest", "This account is deleted on request. See the privacy policy for how to ask."],
    email_signin_account: ["acct.byRequest", "This account is deleted on request. See the privacy policy for how to ask."],
    active_booking: ["acct.err.booking", "Finish, pay or cancel your open booking first."],
    active_sos: ["acct.err.sos", "Resolve or cancel your open SOS first."],
    phone_required: ["acct.err.phone", "Add and verify your mobile number first, or you could not sign in again after unlinking Google."],
  };

  function phraseMatches(v) { return typeof v === "string" && v.trim() === PHRASE; }

  function message(err, tr) {
    var c = err && CODES[err.code];
    return c ? tr(c[0], c[1]) : (err && err.message) || tr("acct.err.generic", "That did not work. Try again.");
  }

  /** o: { $, call(method, path, body, opts), tr, toast, busy, refresh(), onMe(me), signOut(), onDeleted() } */
  function mount(o) {
    var $ = o.$, card = $("acct-card");
    card.innerHTML =
      '<h2 class="title" data-i18n="acct.title">Account</h2>' +
      '<p class="meta" id="acct-google" hidden></p>' +
      '<button type="button" class="btn soft" id="acct-unlink" style="margin-top:10px" hidden data-i18n="acct.unlink">Unlink Google</button>' +
      '<p class="meta" id="acct-byrequest" style="margin-top:10px" hidden><span data-i18n="acct.byRequest">This account is deleted on request. See the privacy policy for how to ask.</span> ' +
      '<a href="/privacy.html#rights" target="_blank" rel="noopener" data-i18n="legal.privacy">Privacy policy</a></p>' +
      '<button type="button" class="btn ghost" id="acct-delete" style="margin-top:12px" data-i18n="acct.delete">Delete my account</button>' +
      '<dialog id="acct-dialog" class="acct-dialog" aria-labelledby="acct-d-title">' +
      '<h2 class="title" id="acct-d-title" data-i18n="acct.d.title">Delete your account?</h2>' +
      '<p class="meta" data-i18n="acct.d.gone">Your emergency contacts and their Telegram links, your Google link, vehicles, devices and profile are deleted, and every session is signed out.</p>' +
      '<p class="meta" data-i18n="acct.d.kept">Your SOS history, bookings and payments with mechanics, and the audit log are kept for the people who need them, with your name and number removed.</p>' +
      '<label class="field" style="margin-top:12px"><span id="acct-d-label"></span>' +
      '<input id="acct-phrase" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="40"></label>' +
      '<p class="meta" id="acct-d-err" role="alert" hidden></p>' +
      '<div class="acct-actions">' +
      '<button type="button" class="btn ghost" id="acct-cancel" data-i18n="acct.d.cancel">Cancel</button>' +
      '<button type="button" class="btn danger" id="acct-confirm" disabled data-i18n="acct.d.confirm">Delete permanently</button></div>' +
      '<button type="button" class="btn soft" id="acct-signout" style="margin-top:10px" hidden data-i18n="acct.d.signout">Sign out now</button>' +
      "</dialog>";
    if (global.I18N) global.I18N.apply(card);

    var dialog = $("acct-dialog"), input = $("acct-phrase"), confirmBtn = $("acct-confirm"), errEl = $("acct-d-err");
    var state = { me: null };

    function label() {
      $("acct-d-label").textContent = o.tr("acct.d.type", "Type {phrase} to confirm").replace("{phrase}", PHRASE);
    }
    function showErr(text) { errEl.hidden = !text; errEl.textContent = text || ""; }

    function render() {
      var me = state.me;
      card.hidden = !me;
      if (!me) return;
      var linked = Boolean(me.google && me.google.linked);
      var canDelete = me.selfDelete !== false;   // an older server says nothing: offer it, the server decides
      $("acct-unlink").hidden = !linked;
      $("acct-google").hidden = !linked;
      $("acct-google").textContent = linked
        ? o.tr("google.linkedAs", "Google account linked: {email}").replace("{email}", me.google.email || "") : "";
      $("acct-delete").hidden = !canDelete;
      $("acct-byrequest").hidden = canDelete;
      label();
    }

    /** One call, refreshed once if the access token expired while the page sat open. */
    async function call(method, path, body) {
      try { return await o.call(method, path, body, { force: true, noRetry: true }); }
      catch (e) {
        if (e.code === "AUTH_EXPIRED" && await o.refresh()) return o.call(method, path, body, { force: true, noRetry: true });
        throw e;
      }
    }

    $("acct-unlink").onclick = o.busy($("acct-unlink"), async function () {
      try {
        var r = await call("DELETE", "/v1/me/google", null);
        o.toast(r.data && r.data.unlinked ? o.tr("acct.unlinked", "Google account unlinked") : o.tr("acct.notLinked", "No Google account was linked"), "ok");
        var me = await o.call("GET", "/v1/me", null, { force: true });
        state.me = me.data; render();
        if (o.onMe) o.onMe(me.data);
      } catch (e) { o.toast(message(e, o.tr), "bad"); }
    });

    $("acct-delete").onclick = function () {
      input.value = ""; confirmBtn.disabled = true; showErr(""); $("acct-signout").hidden = true; label();
      if (dialog.showModal) dialog.showModal(); else dialog.setAttribute("open", "");
      input.focus();
    };
    input.oninput = function () { confirmBtn.disabled = !phraseMatches(input.value); };
    $("acct-cancel").onclick = function () {
      if (dialog.close) dialog.close(); else dialog.removeAttribute("open");
    };
    $("acct-signout").onclick = function () { dialog.close(); o.signOut(); };

    confirmBtn.onclick = o.busy(confirmBtn, async function () {
      if (!phraseMatches(input.value)) return;
      showErr("");
      try {
        var r = await call("POST", "/v1/me/delete", { confirm: input.value.trim() });
        if (!r || !r.data || r.data.deleted !== true) throw new Error(o.tr("acct.err.generic", "That did not work. Try again."));
        dialog.close();
        o.onDeleted();
      } catch (e) {
        // The sessions of a deleted account are refused: a retry after a lost
        // answer lands here, and it means the delete already went through.
        if (e.status === 401 && e.code === "AUTH_REVOKED") { dialog.close(); o.onDeleted(); return; }
        showErr(message(e, o.tr));
        $("acct-signout").hidden = e.code !== "reauth_required";
      }
    });

    global.addEventListener("ra:locale", render);

    return {
      update: function (me) { state.me = me; render(); },
      reset: function () { state.me = null; if (dialog.open) dialog.close(); render(); },
    };
  }

  global.RAAccount = { PHRASE: PHRASE, phraseMatches: phraseMatches, message: message, mount: mount };
})(typeof window !== "undefined" ? window : globalThis);
