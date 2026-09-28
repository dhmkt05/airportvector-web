/* AirportVector website — demo logic. Everything runs locally in the browser. */
(function () {
  "use strict";

  var REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  var DIRS = { A: "North-East", B: "South-East", C: "South-West", D: "North-West" };
  var BANDS = ["Near · under 100 km (A–D)", "Regional · 100–999 km (E–H)", "Far · 1,000–9,999 km (I–L)"];
  var CELL = { "1km": "1 km × 1 km", "100m": "100 m × 100 m", "10m": "10 m × 10 m", "1m": "1 m × 1 m" };

  var $ = function (id) { return document.getElementById(id); };
  var MOBILE = window.matchMedia("(max-width: 760px)");
  var CODE_PATH = /^\/([A-Za-z]{3}-[A-La-l][0-9]{2,7}(?:\.?[0-9]{2,7}))\/?$/;
  function shareUrl(code) { return location.origin + "/" + code; }
  var state = { lat: null, lon: null, code: null, anchor: null, typedBase: null };
  var ready = false;
  var map = null, mapReady = false, pointMarker = null, airportMarker = null;

  /* ---------------------------------------------------------------- flap board */
  function bandOf(code) {
    try { return OAVG.parse(code).band; } catch (e) { return 0; }
  }

  function renderFlap(el, text, animate) {
    var band = /^[A-Z]{3}-[A-L]/.test(text) ? bandOf(text) : -1;
    el.style.setProperty("--n", String(text.length));
    var old = el.children;
    // rebuild if length changed
    if (old.length !== text.length) {
      el.textContent = "";
      for (var k = 0; k < text.length; k++) {
        var t = document.createElement("span");
        t.className = "tile";
        el.appendChild(t);
      }
    }
    el.setAttribute("aria-label", text);
    Array.prototype.forEach.call(el.children, function (tile, i) {
      var ch = text.charAt(i);
      tile.className = "tile" + (ch === "-" || ch === "." ? " dash" : "") +
        (i === 4 && band >= 0 ? " letter b" + band : "");
      tile.setAttribute("aria-hidden", "true");
      if (!animate || REDUCED || ch === "-" || tile.textContent === ch) { tile.textContent = ch; return; }
      var steps = 3 + ((i * 7) % 5);
      var n = 0;
      var timer = setInterval(function () {
        n++;
        tile.classList.remove("flip"); void tile.offsetWidth; tile.classList.add("flip");
        if (n >= steps) { clearInterval(timer); tile.textContent = ch; return; }
        tile.textContent = CHARSET.charAt(Math.floor(Math.random() * CHARSET.length));
      }, 55 + (i % 3) * 10);
    });
  }

  /* ---------------------------------------------------------------- hero */
  var HERO = [
    { code: "TRZ-D04200355", place: "Near Trichy Central Bus Stand, India" },
    { code: "LCY-D12710024", place: "Central London, United Kingdom" },
    { code: "DJG-F2590508465", place: "Deep in the Sahara, Algeria" },
    { code: "IPC-K104561248302", place: "Point Nemo — the ocean's pole of inaccessibility" },
    { code: "USH-J000000392217", place: "The South Pole, Antarctica" }
  ];
  var heroIdx = 0;
  function heroShow(animate) {
    var h = HERO[heroIdx];
    renderFlap($("heroFlap"), h.code, animate);
    $("heroSub").textContent = ready ? OAVG.describe(h.code) : "";
    $("heroPlace").textContent = h.place;
  }
  function tickClock() {
    var d = new Date();
    $("clock").textContent = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  /* ---------------------------------------------------------------- helpers */
  function toast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove("show"); }, 1800);
  }
  function currentPrecision() {
    var r = document.querySelector('input[name="prec"]:checked');
    return r ? r.value : "10m";
  }
  function setPrecisionRadio(p) {
    var r = document.querySelector('input[name="prec"][value="' + p + '"]');
    if (r) r.checked = true;
  }
  function fmt(n) { return (Math.round(n * 1e6) / 1e6).toFixed(6); }
  function showError(msg) {
    var e = $("searchError");
    if (!msg) { e.hidden = true; e.textContent = ""; return; }
    e.hidden = false; e.textContent = msg;
  }
  // Make a list of [lon, lat] continuous across the antimeridian (for drawing).
  function unwrap(coords) {
    var out = [];
    for (var i = 0; i < coords.length; i++) {
      var lon = coords[i][0], lat = coords[i][1];
      if (i > 0) {
        var prev = out[i - 1][0];
        while (lon - prev > 180) lon -= 360;
        while (lon - prev < -180) lon += 360;
      }
      out.push([lon, lat]);
    }
    return out;
  }

  /* ---------------------------------------------------------------- core update */
  function update(code, lat, lon, opts) {
    opts = opts || {};
    var p = OAVG.parse(code);
    var a = OAVG.getAnchor(p.anchor);
    var centre = OAVG.decode(code);
    state = { lat: lat, lon: lon, code: p.code, anchor: p.anchor,
              typedBase: opts.typed ? p.base : (opts.keepTyped ? state.typedBase : null) };

    renderFlap($("panelFlap"), p.code, true);
    $("describe").textContent = OAVG.describe(p.code);
    $("facts").hidden = false;
    $("fAirport").textContent = a.code + " · " + a.name;
    $("fDir").textContent = DIRS[p.sector];
    $("fBand").textContent = BANDS[p.band];
    $("fCell").textContent = CELL[p.precision];
    $("fCoord").textContent = fmt(centre.lat) + ", " + fmt(centre.lon);
    $("copyBtn").disabled = false;
    $("shareBtn").disabled = false;
    setPrecisionRadio(p.precision);
    showError(null);

    try { history.replaceState(null, "", "/" + p.code + location.hash); } catch (e) { /* ignore */ }
    document.body.classList.add("has-code");
    syncSheet();
    drawOnMap(p, a, centre, opts.fly !== false);
  }

  function fromPoint(lat, lon, opts) {
    var code = OAVG.encode(lat, lon, currentPrecision());
    update(code, lat, lon, opts);
  }

  function fromCode(text) {
    var code = OAVG.normalize(text);           // throws OAVGError with a clear message
    var c = OAVG.decode(code);
    update(code, c.lat, c.lon, { typed: true });
  }

  /* ---------------------------------------------------------------- map */
  function initMap() {
    if (!window.maplibregl) { $("mapFallback").hidden = false; return; }
    try {
      map = new maplibregl.Map({
        container: "map",
        style: "https://tiles.openfreemap.org/styles/positron",
        center: [78.7, 20],
        zoom: 1.6,
        attributionControl: { compact: true },
        cooperativeGestures: false,
        dragRotate: false
      });
    } catch (e) {
      $("mapFallback").hidden = false;
      return;
    }
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    var failTimer = setTimeout(function () { if (!mapReady) $("mapFallback").hidden = false; }, 12000);
    map.on("load", function () {
      mapReady = true;
      clearTimeout(failTimer);
      $("mapFallback").hidden = true;
      map.addSource("av-line", { type: "geojson", data: emptyFC() });
      map.addSource("av-cell", { type: "geojson", data: emptyFC() });
      map.addLayer({ id: "av-cell-fill", type: "fill", source: "av-cell", paint: { "fill-color": "#ffc517", "fill-opacity": 0.28 } });
      map.addLayer({ id: "av-cell-line", type: "line", source: "av-cell", paint: { "line-color": "#111", "line-width": 1.5 } });
      map.addLayer({ id: "av-line", type: "line", source: "av-line",
        paint: { "line-color": "#111", "line-width": 2.2, "line-dasharray": [2, 1.5] } });
      if (state.code) {
        var p = OAVG.parse(state.code);
        drawOnMap(p, OAVG.getAnchor(p.anchor), OAVG.decode(state.code), true);
      }
    });
    map.on("click", function (e) {
      var ll = e.lngLat.wrap();
      $("mapHint").classList.add("gone");
      try { fromPoint(ll.lat, ll.lng, { fly: false }); } catch (err) { showError(err.message); }
      placePoint(ll.lng, ll.lat);
    });
  }

  function emptyFC() { return { type: "FeatureCollection", features: [] }; }

  function placePoint(lon, lat) {
    if (!map) return;
    if (!pointMarker) {
      var el = document.createElement("div"); el.className = "m-point";
      pointMarker = new maplibregl.Marker({ element: el });
    }
    pointMarker.setLngLat([lon, lat]).addTo(map);
  }

  function drawOnMap(p, a, centre, fly) {
    if (!map) return;
    placePoint(state.lon, state.lat);
    if (!airportMarker) {
      var el = document.createElement("div"); el.className = "m-airport";
      airportMarker = new maplibregl.Marker({ element: el, anchor: "bottom", offset: [0, -4] });
    }
    airportMarker.getElement().textContent = "✈ " + a.code;
    airportMarker.setLngLat([a.lon, a.lat]).addTo(map);
    if (!mapReady) return;

    // Geodesic from the airport to the cell centre: a straight line in the
    // airport's azimuthal-equidistant grid is exactly the shortest path.
    var g = OAVG.decodeGrid ? OAVG.decodeGrid(p.code) : null;
    var pts = [];
    var gx = g ? g.x : 0, gy = g ? g.y : 0;
    for (var i = 0; i <= 96; i++) {
      var q = OAVG.fromGrid(a.code, gx * i / 96, gy * i / 96);
      pts.push([q.lon, q.lat]);
    }
    pts = unwrap(pts);
    map.getSource("av-line").setData({ type: "Feature", geometry: { type: "LineString", coordinates: pts } });

    var poly = unwrap(OAVG.cellPolygon(p.code).map(function (c) { return [c[1], c[0]]; }));
    poly.push(poly[0]);
    map.getSource("av-cell").setData({ type: "Feature", geometry: { type: "Polygon", coordinates: [poly] } });

    if (!fly) return;
    var dist = OAVG.distanceFromAnchorM(p.code);
    if (dist < 150000) {
      var b = new maplibregl.LngLatBounds();
      pts.forEach(function (c) { b.extend(c); });
      var sheet = MOBILE.matches ? $("result").offsetHeight : 0;
      var pad = MOBILE.matches ? { top: 80, bottom: sheet + 80, left: 40, right: 40 } : 70;
      map.fitBounds(b, { padding: pad, maxZoom: 15, duration: REDUCED ? 0 : 1400 });
    } else {
      map.flyTo({ center: [centre.lon, centre.lat], zoom: dist > 2000000 ? 2 : 4, duration: REDUCED ? 0 : 1600,
                  offset: [0, MOBILE.matches ? -$("result").offsetHeight / 2 : 0] });
    }
  }

  /* ---------------------------------------------------------------- wiring */
  function wire() {
    $("searchForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var v = $("searchInput").value.trim();
      if (!v) return;
      var m = v.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
      try {
        if (m) {
          var lat = parseFloat(m[1]), lon = parseFloat(m[2]);
          fromPoint(lat, lon);
          placePoint(lon, lat);
        } else {
          fromCode(v);
        }
        $("mapHint").classList.add("gone");
      } catch (err) {
        showError(err && err.message ? err.message : "That doesn't look like a code or coordinates.");
      }
    });

    document.querySelectorAll('input[name="prec"]').forEach(function (r) {
      r.addEventListener("change", function () {
        if (!state.code) return;
        try {
          // keep the same airport so changing precision never jumps to another anchor
          var code = OAVG.encode(state.lat, state.lon, currentPrecision(), state.anchor);
          var finer = state.typedBase !== null && OAVG.PRECISIONS[currentPrecision()] > state.typedBase;
          update(code, state.lat, state.lon, { fly: false, keepTyped: true });
          if (finer) toast("Zoomed in from the centre of the typed code's cell");
        } catch (err) { showError(err.message); }
      });
    });

    $("copyBtn").addEventListener("click", function () { copy(state.code, "Code copied"); });
    $("shareBtn").addEventListener("click", function () { copy(shareUrl(state.code), "Share link copied"); });
    $("locateBtn").addEventListener("click", locateMe);
    $("locateFab").addEventListener("click", locateMe);
    window.addEventListener("resize", syncSheet);
    document.querySelectorAll(".chip").forEach(function (b) {
      b.addEventListener("click", function () {
        try { fromCode(b.getAttribute("data-code")); $("mapHint").classList.add("gone"); } catch (err) { showError(err.message); }
      });
    });
  }

  function locateMe() {
    if (!ready) { toast("Still loading airports…"); return; }
    if (!navigator.geolocation) { toast("Location isn't available in this browser"); return; }
    var fab = $("locateFab");
    fab.classList.add("busy");
    toast("Finding you…");
    navigator.geolocation.getCurrentPosition(function (pos) {
      fab.classList.remove("busy");
      var lat = pos.coords.latitude, lon = pos.coords.longitude;
      try {
        fromPoint(lat, lon);
        placePoint(lon, lat);
        $("mapHint").classList.add("gone");
        var acc = Math.round(pos.coords.accuracy || 0);
        toast(acc ? "Found you · GPS accurate to ±" + acc + " m" : "Found you");
      } catch (err) { showError(err.message); }
    }, function (err) {
      fab.classList.remove("busy");
      toast(err && err.code === 1 ? "Location permission was blocked" : "Couldn't get your location");
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  }

  // Keep the map's controls and the location button above the mobile bottom card.
  function syncSheet() {
    var grid = document.querySelector(".demo-grid");
    if (!grid) return;
    var h = MOBILE.matches ? $("result").offsetHeight : 0;
    grid.style.setProperty("--sheet", h + "px");
  }

  function copy(text, msg) {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(msg); }, function () { toast(text); });
    } else { toast(text); }
  }

  /* ---------------------------------------------------------------- boot */
  function boot() {
    tickClock(); setInterval(tickClock, 15000);
    renderFlap($("heroFlap"), HERO[0].code, false);
    renderFlap($("panelFlap"), MOBILE.matches ? "TAP-THE-MAP" : "CLICK-THE-MAP", false);
    if (MOBILE.matches) {
      $("mapHint").textContent = "Tap anywhere on the map";
      $("searchInput").placeholder = "Paste a code or lat, lon";
    }
    syncSheet();
    wire();
    initMap();

    fetch("/anchors.json", { cache: "force-cache" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (rows) {
        OAVG.loadRegistry(rows);
        ready = true;
        heroShow(false);
        setInterval(function () { heroIdx = (heroIdx + 1) % HERO.length; heroShow(true); }, 5200);
        var m = location.pathname.match(CODE_PATH);
        var c = m ? m[1] : new URLSearchParams(location.search).get("c");
        if (c) {
          try { fromCode(c); $("mapHint").classList.add("gone"); } catch (err) { showError(err.message); }
        }
      })
      .catch(function () { showError("Couldn't load the airport list. Please refresh the page."); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
