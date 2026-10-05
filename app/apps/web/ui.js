/* RoadAssist — interface details for the citizen app (app.html).
 *
 * Small behaviours that belong to presentation rather than to the app's
 * logic, kept out of app.html's inline script so none can disturb it:
 *
 *  1. A sheet that opens takes keyboard focus, and gives it back when it
 *     closes. app.html opens a sheet by adding .show; both sheets are
 *     aria-modal dialogs, and a modal that leaves focus behind it strands a
 *     keyboard or screen-reader user on the page underneath. The SHEET itself
 *     takes focus (tabindex -1), never its first button: on the SOS countdown
 *     that button is "Cancel — false alarm", and a stray Enter must not land
 *     on it.
 *  2. The top bar gets a hairline once the screen has scrolled under it.
 *  3. The service picker on Assist is mirrored as a row of round tiles.
 *
 * Classic script, no globals, nothing fetched. Loaded last, after depth.js.
 */
(function () {
  "use strict";
  var doc = document;

  function watchSheet(sheet) {
    if (!sheet.hasAttribute("tabindex")) sheet.setAttribute("tabindex", "-1");
    var open = sheet.classList.contains("show");
    var returnTo = null;
    new MutationObserver(function () {
      var now = sheet.classList.contains("show");
      if (now === open) return;
      open = now;
      var active = doc.activeElement;
      if (now) {
        returnTo = active && active !== doc.body && !sheet.contains(active) ? active : null;
        // Next frame: the sheet is visible by then (it is visibility:hidden
        // while closed), and preventScroll keeps the page where it is.
        requestAnimationFrame(function () {
          if (sheet.classList.contains("show") && !sheet.contains(doc.activeElement)) {
            sheet.focus({ preventScroll: true });
          }
        });
      } else {
        var back = returnTo;
        returnTo = null;
        // Only if focus is still in the closed sheet (or nowhere): if the app
        // has already moved it somewhere on purpose, that wins.
        if (back && back.isConnected && (sheet.contains(active) || active === doc.body || !active)) {
          try { back.focus({ preventScroll: true }); } catch { /* element gone */ }
        }
        // The opener can be gone from view (e.g. the sheet switched screens):
        // then focus the active screen, so keyboard users are never dropped on body.
        if (doc.activeElement === doc.body || sheet.contains(doc.activeElement)) {
          var scr = doc.querySelector(".screen.active");
          if (scr) { if (!scr.hasAttribute("tabindex")) scr.setAttribute("tabindex", "-1");
            try { scr.focus({ preventScroll: true }); } catch { /* ignore */ } }
        }
      }
    }).observe(sheet, { attributes: true, attributeFilter: ["class"] });
  }
  doc.querySelectorAll(".sheet").forEach(watchSheet);

  var main = doc.getElementById("main");
  var bar = doc.querySelector(".topbar");
  if (main && bar) {
    var queued = false;
    var sync = function () {
      queued = false;
      bar.classList.toggle("is-scrolled", main.scrollTop > 4);
    };
    main.addEventListener("scroll", function () {
      if (!queued) { queued = true; requestAnimationFrame(sync); }
    }, { passive: true });
  }

  // 3. The service picker on Assist (#b-service) mirrored as a row of round
  //    tiles. The select stays the source of truth and keeps its label and
  //    price: a tile only sets its value and fires the same "change" the
  //    select does, so nothing in the booking flow knows the tiles exist.
  //    The glyphs are the Android app's ServiceGlyph shapes (Ui.kt), redrawn
  //    on a 24-unit grid; an unknown code gets the wrench.
  var sel = doc.getElementById("b-service");
  var row = doc.getElementById("b-svc-tiles");
  if (sel && row) {
    var GLYPH = {
      flat_tyre: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.2"/><path d="M12 15.2V21M9.2 10.4 4.2 7.5M14.8 10.4l5-2.9"/>',
      battery_jumpstart: '<rect x="2.5" y="7.2" width="19" height="12.5" rx="1.9"/><path d="M6.2 4.3h2.9M14.9 4.3h2.9M5.8 13.4h3.8M7.7 11.5v3.8M14.4 13.4h3.8"/>',
      fuel_delivery: '<rect x="3.8" y="3.4" width="10.6" height="17.3" rx="1.4"/><path d="M3.8 9.6h10.6M14.4 6.7l4.3 2.9.5 7.2h-2.4l-.5-4.3"/>',
      key_lockout: '<circle cx="6.7" cy="12" r="3.8"/><path d="M10.6 12h11M17.3 12v3.8M20.6 12v2.9"/>',
      towing: '<rect x="1.5" y="7.2" width="12.4" height="9.1" rx="1"/><path d="M13.9 9.6h5.3l3.3 3.4v3.3h-8.6"/>' +
        '<circle cx="6.2" cy="18.7" r="2.1" fill="currentColor"/><circle cx="18.2" cy="18.7" r="2.1" fill="currentColor"/>',
      ev_charge: '<path d="M13.9 1.9 5.8 13.4h5.7l-1.9 8.7 8.6-12h-5.7z"/>',
      accident_support: '<path d="M12 3.5 22 20H2z"/><path d="M12 10v4m0 3h.01"/>',
    };
    var WRENCH = '<path d="M14.5 6.5a4 4 0 0 1-5.2 5.06L4 16.86 7.14 20l5.3-5.3A4 4 0 0 0 17.5 9.5l-2.3 2.3-2.3-2.3z"/>';
    var esc = function (s) {
      return String(s).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
      });
    };
    var mark = function () {
      row.querySelectorAll(".svc").forEach(function (t) {
        t.setAttribute("aria-pressed", String(t.getAttribute("data-svc") === sel.value));
      });
    };
    var build = function () {
      var opts = Array.prototype.slice.call(sel.options);
      row.hidden = opts.length === 0;
      row.innerHTML = opts.map(function (o) {
        var name = String(o.textContent || "").split(" · ")[0];
        return "<button type='button' class='svc' data-svc='" + esc(o.value) + "' aria-label='" +
          esc(o.textContent) + "' aria-pressed='false'><i><svg aria-hidden='true' focusable='false' " +
          "viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.75' stroke-linecap='round' " +
          "stroke-linejoin='round'>" + (GLYPH[o.value] || WRENCH) + "</svg></i><span>" + esc(name) + "</span></button>";
      }).join("");
      mark();
    };
    row.addEventListener("click", function (e) {
      var t = e.target.closest ? e.target.closest(".svc") : null;
      if (!t || !row.contains(t)) return;
      var code = t.getAttribute("data-svc");
      if (sel.value !== code) {
        sel.value = code;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }
      mark();
    });
    sel.addEventListener("change", mark);
    new MutationObserver(build).observe(sel, { childList: true });
    // A diagnosis preselects a service by setting selectedIndex, which fires
    // no event, so the tiles also re-read the select when the result lands.
    var diag = doc.getElementById("b-diag");
    if (diag) new MutationObserver(mark).observe(diag, { childList: true });
    var scr = doc.getElementById("scr-book");
    if (scr) new MutationObserver(mark).observe(scr, { attributes: true, attributeFilter: ["class"] });
    build();
  }
})();
