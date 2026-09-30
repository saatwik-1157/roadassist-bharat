/* RoadAssist — shrink a hazard photo on the phone before it is uploaded.
 *
 * A phone camera file is 3-5 MB. The server keeps report photos in its
 * database on the hosted demo and refuses one over 600 KiB (ADR-0013,
 * apps/api/src/domain/photo-store.ts), so the photo is redrawn here: longest
 * side at most 1280 px, JPEG at quality 0.8, and smaller or rougher steps only
 * if that still does not fit. Re-encoding also drops the camera's metadata,
 * GPS included, which the report does not need: it sends its own position.
 *
 * A classic script (no import/export), like journey.js, so app.html loads it
 * with a plain <script src> ahead of its inline code and
 * apps/api/test/photo-shrink.test.ts can import the same file; it only defines
 * globalThis.RAPhotoShrink.
 */
(function (global) {
  "use strict";

  /** The server's cap on the db store, in bytes (DB_PHOTO_MAX_BYTES). */
  var MAX_BYTES = 600 * 1024;

  /** [longest side in px, JPEG quality], tried in order until one fits. */
  var LADDER = [[1280, 0.8], [1280, 0.7], [1024, 0.7], [1024, 0.6], [800, 0.6]];

  /** Dimensions that fit within max x max, never enlarged, never below 1 px. */
  function fitWithin(width, height, max) {
    var scale = Math.min(1, max / Math.max(width, height));
    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
    };
  }

  /**
   * The first rung whose encoding fits. `encode(side, quality)` resolves to a
   * Blob (anything with .size). Exactly MAX_BYTES fits, as it does on the server.
   */
  function firstFit(encode, ladder, maxBytes) {
    var i = 0;
    function next() {
      if (i >= ladder.length) {
        return Promise.reject(new Error("That photo is too detailed to send even when shrunk — try another"));
      }
      var rung = ladder[i++];
      return Promise.resolve(encode(rung[0], rung[1])).then(function (blob) {
        return blob && blob.size <= maxBytes ? { blob: blob, side: rung[0], quality: rung[1] } : next();
      });
    }
    return next();
  }

  function decode(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("Couldn't read that photo — try a JPEG or PNG"));
      };
      img.src = url;
    });
  }

  function readDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result)); };
      r.onerror = function () { reject(new Error("Couldn't read that photo")); };
      r.readAsDataURL(blob);
    });
  }

  /**
   * File -> { base64, mime, dataUrl, bytes, width, height }. base64 has no
   * data: prefix, which is what POST /v1/raksha/report takes.
   */
  function shrink(file) {
    return decode(file).then(function (img) {
      var w = img.naturalWidth, h = img.naturalHeight, size = null;
      if (!w || !h) throw new Error("Couldn't read that photo — try a JPEG or PNG");
      var canvas = document.createElement("canvas");
      return firstFit(function (side, quality) {
        size = fitWithin(w, h, side);
        canvas.width = size.width; canvas.height = size.height;
        var ctx = canvas.getContext("2d");
        // JPEG has no transparency: a PNG's clear pixels would turn black.
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, size.width, size.height);
        ctx.drawImage(img, 0, 0, size.width, size.height);
        return new Promise(function (resolve) { canvas.toBlob(resolve, "image/jpeg", quality); });
      }, LADDER, MAX_BYTES).then(function (fit) {
        return readDataUrl(fit.blob).then(function (dataUrl) {
          return {
            base64: dataUrl.slice(dataUrl.indexOf(",") + 1), mime: "image/jpeg", dataUrl: dataUrl,
            bytes: fit.blob.size, width: size.width, height: size.height,
          };
        });
      });
    });
  }

  global.RAPhotoShrink = {
    MAX_BYTES: MAX_BYTES, LADDER: LADDER, fitWithin: fitWithin, firstFit: firstFit, shrink: shrink,
  };
})(globalThis);
