/*
 * "Near you" and road ETAs for the citizen app, from open map data.
 *
 * The page hands in its own api() and locate(), so this file holds no token
 * and makes no network call of its own: every lookup goes to this platform's
 * /v1/geo/* routes, which talk to OpenStreetMap on the server (routes/geo.ts).
 * A visitor's address never reaches a third party from the browser.
 *
 * It says what it knows and no more: a fallback position is labelled as one,
 * an unnamed place is labelled unnamed, a phone number appears only when the
 * map has one, and a failed lookup says it failed rather than showing nothing.
 * Loaded as a classic script before the app's inline shell; it only defines
 * window.RANear, and the shell decides when to call it.
 */
(function () {
  "use strict";

  var KINDS = [
    ["hospital", "Hospital"], ["police", "Police"], ["fuel", "Fuel"],
    ["charging", "EV charging"], ["repair", "Repair / tyres"],
  ];
  var HOME_TTL = 10 * 60 * 1000;
  var last = null;             // { at, html } of the last home render
  var etaSeen = {};            // booking id -> { at, text }
  var busy = false;            // a lookup in flight: a re-render must not wipe it

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function km(d) { return d < 1 ? Math.round(d * 1000) + " m" : d.toFixed(1) + " km"; }
  function tel(p) { return String(p).replace(/[^\d+]/g, ""); }

  function shell(el, body) {
    el.hidden = false;
    el.innerHTML =
      "<div class='card near-card'>" +
        "<div class='near-head'><b>Near you</b><span class='near-src'>OpenStreetMap</span></div>" +
        body +
      "</div>";
  }

  function idle(el, run) {
    shell(el,
      "<p class='meta' style='margin:6px 0 10px'>Hospitals, police, fuel, EV chargers and repair shops " +
      "around you, with your nearest address.</p>" +
      "<button class='btn ghost near-go' type='button'>Find help near me</button>");
    el.querySelector(".near-go").onclick = run;
  }

  function failed(el, message, run) {
    shell(el,
      "<p class='meta' style='margin:6px 0 10px'>" + esc(message) + "</p>" +
      "<button class='btn ghost near-go' type='button'>Try again</button>");
    el.querySelector(".near-go").onclick = run;
  }

  function render(el, pos, address, groups) {
    var where = address && address.label
      ? "<p class='near-addr'>" + esc(address.label) + "</p>"
      : "<p class='near-addr meta'>No street address on the map for this spot.</p>";
    if (pos.demo) {
      where += "<p class='meta near-demo'>Your location was not shared, so this is the demo point on NH-48, Gurugram.</p>";
    }
    var rows = KINDS.map(function (k) {
      var list = (groups && groups[k[0]]) || [];
      if (!list.length) {
        return "<li class='near-row'><span class='near-k'>" + esc(k[1]) + "</span>" +
          "<span class='near-v meta'>none mapped within 5 km</span></li>";
      }
      var p = list[0];
      return "<li class='near-row'><span class='near-k'>" + esc(k[1]) + "</span>" +
        "<span class='near-v'><b>" + esc(p.name) + "</b> · " + esc(km(p.distanceKm)) +
        (p.phone ? " · <a href='tel:" + esc(tel(p.phone)) + "'>Call</a>" : "") +
        (list.length > 1 ? "<small class='meta'> +" + (list.length - 1) + " more nearby</small>" : "") +
        "</span></li>";
    }).join("");
    shell(el, where +
      "<ul class='near-list'>" + rows + "</ul>" +
      "<p class='meta near-foot'>Straight-line distances from community map data (© OpenStreetMap contributors). " +
      "In an emergency, <a href='tel:112'>call 112</a>.</p>");
  }

  /**
   * The home card. `auto` loads straight away (the page passes it only when
   * location permission is already granted, so nobody is prompted unasked);
   * otherwise the card waits for a tap.
   */
  function mount(opts) {
    var el = opts.el;
    if (!el || busy) return;
    if (last && Date.now() - last.at < HOME_TTL) { el.hidden = false; el.innerHTML = last.html; wireRetry(); return; }

    function wireRetry() { var b = el.querySelector(".near-go"); if (b) b.onclick = run; }

    async function run() {
      if (opts.online && !opts.online()) return failed(el, "Needs a connection. Your SOS still works offline.", run);
      shell(el, "<p class='meta' style='margin:6px 0'>Finding help near you…</p>");
      busy = true;
      try { await lookup(); } finally { busy = false; }
    }

    async function lookup() {
      var pos = await opts.locate();
      var q = "?lat=" + encodeURIComponent(pos.lat) + "&lng=" + encodeURIComponent(pos.lng);
      try {
        var both = await Promise.all([
          opts.api("GET", "/v1/geo/address" + q, null, { force: true }),
          opts.api("GET", "/v1/geo/nearby" + q + "&radiusKm=5", null, { force: true }),
        ]);
        render(el, pos, both[0].data.address, both[1].data.groups);
        last = { at: Date.now(), html: el.innerHTML };
      } catch (e) {
        // A server with the services switched off will never answer, so a
        // retry button would only promise something that cannot happen.
        if (e && e.code === "geo_disabled") { el.hidden = true; el.innerHTML = ""; return; }
        failed(el, (e && e.message) || "The map service did not answer.", run);
      }
    }

    if (opts.auto) run(); else idle(el, run);
  }

  /**
   * Road distance and driving time for a live rescue, next to the straight-line
   * figure the tracking card already shows. At most one lookup a minute per
   * booking; on any failure the line is simply not added.
   */
  function roadEta(opts) {
    var b = opts.booking, el = opts.el;
    if (!el || !b || !b.mechanic || b.mechanic.lat == null || b.lat == null) return;
    if (b.status !== "ASSIGNED" && b.status !== "EN_ROUTE") return;
    var seen = etaSeen[b.id];
    function show(text) {
      var span = el.querySelector(".road-eta");
      if (!span) { span = document.createElement("span"); span.className = "road-eta"; el.appendChild(span); }
      span.textContent = text ? " · " + text : "";
    }
    if (seen && Date.now() - seen.at < 60000) return show(seen.text);
    etaSeen[b.id] = { at: Date.now(), text: seen ? seen.text : "" };
    opts.api("GET", "/v1/geo/route?fromLat=" + b.mechanic.lat + "&fromLng=" + b.mechanic.lng +
      "&toLat=" + b.lat + "&toLng=" + b.lng, null, { force: true })
      .then(function (r) {
        var route = r && r.data && r.data.route;
        var text = route ? "by road " + route.distanceKm + " km, ~" + route.durationMin + " min" : "";
        etaSeen[b.id] = { at: Date.now(), text: text };
        show(text);
      })
      .catch(function () { /* the straight-line figure stays; nothing invented */ });
  }

  window.RANear = { mount: mount, roadEta: roadEta };
})();
