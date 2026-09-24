/* RoadAssist — pointer tilt for the depth layer in ds.css.
 *
 * A card under a mouse tips toward it and catches a glare. Only a real mouse:
 * on a touch screen a tilt would follow the finger that is trying to scroll,
 * and anyone who asked for reduced motion gets none of it. The script only
 * sets custom properties and one attribute — every visual lives in ds.css.
 */
(function () {
  "use strict";
  // SMIL animation (the landing scene's travelling mechanic) ignores the
  // reduced-motion media query that stills everything in ds.css, so it is
  // paused by hand.
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    var still = function () {
      document.querySelectorAll("svg").forEach(function (svg) { if (svg.pauseAnimations) svg.pauseAnimations(); });
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", still); else still();
  }
  var mq = window.matchMedia && window.matchMedia(
    "(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)");
  if (!mq || !mq.matches) return;

  var SEL = ".card.lift, .kpi, .tilt";
  var MAX = 7;          // degrees; more than this reads as a gimmick
  var current = null, frame = 0, lastEvent = null;

  function release(el) {
    el.removeAttribute("data-tilting");
    el.style.removeProperty("--rx"); el.style.removeProperty("--ry");
  }

  function apply() {
    frame = 0;
    var e = lastEvent, el = e.target instanceof Element ? e.target.closest(SEL) : null;
    if (current && current !== el) release(current);
    current = el;
    if (!el) return;
    var r = el.getBoundingClientRect();
    var px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    el.style.setProperty("--ry", ((px - 0.5) * 2 * MAX).toFixed(2) + "deg");
    el.style.setProperty("--rx", ((0.5 - py) * 2 * MAX).toFixed(2) + "deg");
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
