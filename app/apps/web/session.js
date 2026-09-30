/* RoadAssist - a signed-in web page's session, shared by the citizen app, the
 * mechanic console and RAKSHA.
 *
 * The refresh token is an HttpOnly cookie the server sets when the page sends
 * X-RA-Client (routes/auth.ts). Script never sees it, so a script injected
 * into a page cannot carry it away; it used to sit in localStorage for 30
 * days. Each page has its own slot, so the three can be signed in as three
 * different people on one origin, as they could before.
 *
 * The access token lives in sessionStorage: it lasts ten minutes, a reload or
 * an app-switcher resume then needs no refresh, and it is gone when the tab
 * closes. Memory alone would refresh on every reload, rotating the cookie each
 * time - and two tabs reloading together would present the same cookie twice,
 * which the server treats as theft and answers by signing everyone out.
 * localStorage keeps only what is not a credential (who, which vehicle, which
 * booking) and a flag saying a cookie session exists.
 *
 * A session stored before the cookie existed still has its refresh token in
 * localStorage. load() hands it back as `refresh`; the page's first refresh()
 * sends it once in the body with the header, the server rotates it into a
 * cookie, and the next save() writes the record without it.
 *
 * Its own file, not part of email-signin.js: a phone that installed the
 * previous release has that file in its service-worker cache and would run the
 * new page against the old copy once. A file the old worker never cached is
 * always fetched fresh.
 */
(function () {
  "use strict";

  /**
   * `refresh` in the page's state is true for a cookie session, or the
   * pre-cookie token until its one exchange.
   */
  window.RASession = function (key, slot, api) {
    var headers = { "x-ra-client": "web-" + slot };
    // By name: merely touching a blocked storage object throws.
    function read(store) { try { return JSON.parse(window[store].getItem(key) || "null"); } catch { return null; } }
    return {
      headers: headers,
      save: function (token, data, refresh) {
        try {
          var rec = Object.assign({}, data, refresh === true ? { cookie: true }
            : typeof refresh === "string" ? { refresh: refresh } : {});
          localStorage.setItem(key, JSON.stringify(rec));
          sessionStorage.setItem(key, JSON.stringify({ token: token }));
        } catch { /* storage blocked - the session lasts for this page only */ }
      },
      /** The stored session, or null. Its `token` may be stale. */
      load: function () {
        var s = read("localStorage");
        if (!s || !(s.cookie || s.refresh)) return null;
        var t = read("sessionStorage");
        s.token = (t && t.token) || s.token || null;   // a pre-cookie record kept it here
        s.refresh = typeof s.refresh === "string" ? s.refresh : true;
        return s;
      },
      clear: function () {
        try { localStorage.removeItem(key); sessionStorage.removeItem(key); } catch { /* nothing to clear */ }
      },
      /** A new access token from the cookie (or, once, from a legacy token), or null. */
      refresh: function (legacy) {
        return fetch(api + "/v1/auth/refresh", {
          method: "POST", credentials: "include",
          headers: Object.assign({ "content-type": "application/json" }, headers),
          body: JSON.stringify(typeof legacy === "string" ? { refreshToken: legacy } : {}),
        }).then(function (r) { return r.ok ? r.json() : null; })
          .then(function (j) { return (j && j.data && j.data.accessToken) || null; })
          .catch(function () { return null; });
      },
      /** End the session on the server and clear the cookie. Best effort. */
      logout: function (token) {
        return fetch(api + "/v1/auth/logout", {
          method: "POST", credentials: "include",
          headers: Object.assign({}, headers, token ? { authorization: "Bearer " + token } : {}),
        }).catch(function () { /* offline: signed out here; the server session lapses on its own */ });
      },
    };
  };
})();
