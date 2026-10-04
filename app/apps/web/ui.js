/* RoadAssist — interface details for the citizen app (app.html).
 *
 * Two small behaviours that belong to presentation rather than to the app's
 * logic, kept out of app.html's inline script so neither can disturb it:
 *
 *  1. A sheet that opens takes keyboard focus, and gives it back when it
 *     closes. app.html opens a sheet by adding .show; both sheets are
 *     aria-modal dialogs, and a modal that leaves focus behind it strands a
 *     keyboard or screen-reader user on the page underneath. The SHEET itself
 *     takes focus (tabindex -1), never its first button: on the SOS countdown
 *     that button is "Cancel — false alarm", and a stray Enter must not land
 *     on it.
 *  2. The top bar gets a hairline once the screen has scrolled under it.
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
})();
