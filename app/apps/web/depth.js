/* RoadAssist — pointer tilt for the depth layer in ds.css.
 *
 * A card under a mouse tips toward it and catches a glare. Only a real mouse:
 * on a touch screen a tilt would follow the finger that is trying to scroll,
 * and anyone who asked for reduced motion gets none of it. The script only
 * sets custom properties and one class or attribute — every visual lives in
 * ds.css. Two later additions follow the same rule: html.ra-lite (low-power
 * mode) and a small device-orientation tilt for opted-in hero surfaces.
 */
(function () {
  "use strict";
  var root = document.documentElement;

  // Low-power mode. A phone on Save-Data, with 2 GB of memory or less, or on a
  // battery under 20% that is not charging gets html.ra-lite, and ds.css drops
  // the blur, the drifting light and the moving road for it. All three are
  // decoration; the battery is not.
  function lite() { root.classList.add("ra-lite"); }
  try {
    var conn = navigator.connection;
    if ((conn && conn.saveData) ||
        (window.matchMedia && window.matchMedia("(prefers-reduced-data: reduce)").matches) ||
        (navigator.deviceMemory && navigator.deviceMemory <= 2)) lite();
    if (navigator.getBattery) {
      navigator.getBattery().then(function (b) {
        var check = function () { if (!b.charging && b.level <= 0.2) lite(); };
        check();
        b.addEventListener("levelchange", check);
      }).catch(function () { /* no battery API here — nothing to save */ });
    }
  } catch { /* a hint, never a requirement */ }

  // SMIL animation (the landing scene's travelling mechanic) ignores the
  // reduced-motion media query that stills everything in ds.css, so it is
  // paused by hand.
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    var still = function () {
      document.querySelectorAll("svg").forEach(function (svg) { if (svg.pauseAnimations) svg.pauseAnimations(); });
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", still); else still();
  }
  // Hero surfaces (ds.css: .tilt3d, [data-depth="hero"] > .card) tilt a little
  // with the phone itself. Only where the browser hands over orientation
  // without a permission prompt (iOS asks, so iOS is skipped rather than
  // prompted), never under reduced motion or low-power mode, and never on the
  // SOS control: an emergency button that moves is harder to hit.
  var HERO = ".tilt3d, [data-depth='hero'] > .card";
  var coarse = window.matchMedia && window.matchMedia(
    "(hover: none) and (pointer: coarse) and (prefers-reduced-motion: no-preference)");
  if (coarse && coarse.matches && window.DeviceOrientationEvent &&
      typeof window.DeviceOrientationEvent.requestPermission !== "function") {
    var base = null, gx = 0, gy = 0, gFrame = 0;
    var clamp = function (v) { return Math.max(-4, Math.min(4, v)); };
    var paint = function () {
      gFrame = 0;
      var off = root.classList.contains("ra-lite");
      document.querySelectorAll(HERO).forEach(function (el) {
        if (el.closest(".sos")) return;
        el.style.setProperty("--tx", (off ? 0 : gx).toFixed(2) + "deg");
        el.style.setProperty("--ty", (off ? 0 : gy).toFixed(2) + "deg");
      });
    };
    window.addEventListener("deviceorientation", function (e) {
      if (e.beta == null || e.gamma == null || document.hidden) return;
      // The baseline follows the hand slowly, so however the phone is held
      // the cards settle back to flat and only a movement tilts them.
      if (!base) base = { b: e.beta, g: e.gamma };
      base.b += (e.beta - base.b) * 0.03;
      base.g += (e.gamma - base.g) * 0.03;
      gx = clamp(-(e.beta - base.b) * 0.3);
      gy = clamp((e.gamma - base.g) * 0.3);
      if (!gFrame) gFrame = requestAnimationFrame(paint);
    }, { passive: true });
    document.addEventListener("visibilitychange", function () { base = null; });
  }

  var mq = window.matchMedia && window.matchMedia(
    "(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)");
  if (!mq || !mq.matches) return;

  var SEL = ".card.lift, .kpi, .tilt, " + HERO;
  var MAX = 7;          // degrees; more than this reads as a gimmick
  var HERO_MAX = 3.5;   // a hero card is wider, so the same angle moves more
  var current = null, frame = 0, lastEvent = null;

  function release(el) {
    el.removeAttribute("data-tilting");
    el.style.removeProperty("--rx"); el.style.removeProperty("--ry");
  }

  function apply() {
    frame = 0;
    var e = lastEvent, el = e.target instanceof Element ? e.target.closest(SEL) : null;
    if (el && (el.closest(".sos") || root.classList.contains("ra-lite"))) el = null;
    if (current && current !== el) release(current);
    current = el;
    if (!el) return;
    var max = el.matches(HERO) ? HERO_MAX : MAX;
    var r = el.getBoundingClientRect();
    var px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    el.style.setProperty("--ry", ((px - 0.5) * 2 * max).toFixed(2) + "deg");
    el.style.setProperty("--rx", ((0.5 - py) * 2 * max).toFixed(2) + "deg");
    el.style.setProperty("--mx", (px * 100).toFixed(1) + "%");
    el.style.setProperty("--my", (py * 100).toFixed(1) + "%");
    el.setAttribute("data-tilting", "");
  }

  document.addEventListener("pointermove", function (e) {
    if (e.pointerType !== "mouse") return;
    lastEvent = e;
    if (!frame) frame = requestAnimationFrame(apply);
  }, { passive: true });
  document.addEventListener("pointerleave", function () { if (current) release(current); current = null; });
})();
