/* AirportVector website — demo logic. Everything runs locally in the browser. */
(function () {
  "use strict";

  var REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var CHARSET = "123456789";
  var DIRS = { N: "North", NNE: "North-North-East", NE: "North-East", ENE: "East-North-East", E: "East",
               ESE: "East-South-East", SE: "South-East", SSE: "South-South-East", S: "South",
               SSW: "South-South-West", SW: "South-West", WSW: "West-South-West", W: "West",
               WNW: "West-North-West", NW: "North-West", NNW: "North-North-West" };
  var COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  var FIVES = ["over 40 km", "within 40 km", "within 13.5 km", "within 4.5 km", "within 1.5 km", "within 500 m"];
  var CELL = { "1km": "1 km × 1 km", "333m": "333 m × 333 m", "111m": "111 m × 111 m",
               "37m": "37 m × 37 m", "12m": "12 m × 12 m", "4m": "4 m × 4 m" };

  var $ = function (id) { return document.getElementById(id); };
  var MOBILE = window.matchMedia("(max-width: 760px)");
  var CODE_PATH = /^\/([A-Za-z]{3}-[1-9]{5,9}(?:-[1-9]{1,5})?)\/?$/;
  // Encode a name for a URL; also escape ' ( ) ! * so chat apps don't cut the link short.
  function encName(s) {
    return encodeURIComponent(s).replace(/[!'()*]/g, function (c) { return "%" + c.charCodeAt(0).toString(16).toUpperCase(); });
  }
  function shareUrl(code, name) { return location.origin + "/" + code + (name ? "?n=" + encName(name) : ""); }
  // Names come from people and from links: strip control characters, squash spaces, cap the length.
  // (Always shown with textContent / .value, never as HTML.)
  function cleanName(s) {
    return String(s == null ? "" : s).replace(/[\u0000-\u001F\u007F-\u009F]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
  }
  function gmapsUrl(code, navigate) {
    var c = OAVG.decode(code), ll = fmt(c.lat) + "," + fmt(c.lon);
    return navigate ? "https://www.google.com/maps/dir/?api=1&destination=" + ll
                    : "https://www.google.com/maps/search/?api=1&query=" + ll;
  }
  var shared = null;   // place opened from a share link: { code, name }
  var state = { lat: null, lon: null, code: null, anchor: null, typedBase: null };
  var ready = false;
  var map = null, mapReady = false, pointMarker = null, airportMarker = null;

  /* ---------------------------------------------------------------- flap board */
  // How many tiles (from index 4) are leading 5s: they light up, so "closer" is visible at a glance.
  function fivesOf(text) {
    try { return /^[A-Z]{3} [1-9]/.test(text) ? OAVG.parse(text).leadingFives : 0; } catch (e) { return 0; }
  }

  function renderFlap(el, text, animate) {
    var fives = fivesOf(text);
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
      var gap = ch === "-" || ch === "." || ch === " ";
      tile.className = "tile" + (gap ? " dash" : "") + (i >= 4 && i < 4 + fives ? " five" : "");
      tile.setAttribute("aria-hidden", "true");
      if (!animate || REDUCED || gap || tile.textContent === ch) { tile.textContent = ch; return; }
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
    { code: "TRZ 55511 79566", place: "Near Trichy Central Bus Stand, India" },
    { code: "LCY 55444 38173", place: "Central London, United Kingdom" },
    { code: "DJG 686479 26417", place: "Deep in the Sahara, Algeria" },
    { code: "IPC 84772643 65933", place: "Point Nemo — the ocean's pole of inaccessibility" },
    { code: "USH 822858828 82252", place: "The South Pole, Antarctica" }
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
  // Toasts must sit inside an open modal dialog, or the dialog's backdrop hides them.
  function topHost() {
    var open = document.querySelectorAll("dialog[open]");
    return open.length ? open[open.length - 1] : document.body;
  }
  function toast(msg) {
    var t = $("toast");
    if (t.parentNode !== topHost()) topHost().appendChild(t);
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove("show"); }, 1800);
  }
  function currentPrecision() {
    var r = document.querySelector('input[name="prec"]:checked');
    return r ? r.value : "4m";
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
    var g = OAVG.decodeGrid(p.code);
    var brg = (Math.atan2(g.x, g.y) * 180 / Math.PI + 360) % 360;
    state = { lat: lat, lon: lon, code: p.code, display: p.display, anchor: p.anchor,
              source: opts.source || (opts.keepTyped ? state.source : (opts.typed ? "typed" : "map")),
              typedBase: opts.typed ? p.fineDigits : (opts.keepTyped ? state.typedBase : null) };

    renderFlap($("panelFlap"), p.display, true);
    $("describe").textContent = OAVG.describe(p.code);
    $("facts").hidden = false;
    $("fAirport").textContent = a.code + " · " + a.name;
    $("fDir").textContent = DIRS[COMPASS[Math.floor((brg + 11.25) / 22.5) % 16]];
    $("fBand").textContent = p.extra > 0
      ? "Long first group → over " + (121.5 * Math.pow(3, p.extra - 1)).toLocaleString("en-US") + " km"
      : (p.leadingFives ? "5".repeat(p.leadingFives) + " → " : "No leading 5 → ") + FIVES[Math.min(p.leadingFives, 5)];
    $("fCell").textContent = CELL[p.precision];
    $("fCoord").textContent = fmt(centre.lat) + ", " + fmt(centre.lon);
    $("copyBtn").disabled = false;
    $("shareBtn").disabled = false;
    $("saveBtn").disabled = false;
    $("saveBtn").textContent = state.source === "gps" ? "Save my location" : "Save place";
    setPrecisionRadio(p.precision);
    showError(null);

    var isShared = !!(shared && shared.code === p.code);
    renderShared(isShared);
    try {
      history.replaceState(null, "", "/" + p.code + (isShared && shared.name ? "?n=" + encName(shared.name) : "") + location.hash);
    } catch (e) { /* ignore */ }
    document.body.classList.add("has-code");
    syncSheet();
    drawOnMap(p, a, centre, opts.fly !== false);
    loadLocality(p.code);
  }

  /* ---------------------------------------------------------------- shared place (opened from a link) */
  function renderShared(on) {
    var box = $("sharedBox");
    box.hidden = !on;
    if (!on) return;
    var disp = OAVG.display(shared.code);
    $("sharedName").textContent = shared.name || disp;
    $("sharedCode").textContent = shared.name ? disp : "";
    $("sharedCode").hidden = !shared.name;
    $("sharedNav").href = gmapsUrl(shared.code, true);
    $("sharedOpen").href = gmapsUrl(shared.code, false);
  }

  /* ---------------------------------------------------------------- locality (India Post, pilot) */
  var locSeq = 0, locTimer = null;
  function loadLocality(code) {
    var el = $("locality");
    var seq = ++locSeq;
    el.hidden = true; el.textContent = "";
    clearTimeout(locTimer);
    locTimer = setTimeout(function () {
      fetch("/api/v1/locality?code=" + encodeURIComponent(code))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (seq !== locSeq || !d || (!d.place && !d.postal)) return;
          var pl = d.place, po = d.postal, lines = [];
          if (pl) lines.push("\uD83D\uDCCD " + (pl.relation === "in" ? "" : "Near ") + pl.name +
                             (pl.name_ta && pl.name_ta !== pl.name ? " \u00B7 " + pl.name_ta : ""));
          if (po) lines.push("\u2709\uFE0F " + po.name + " PO " + po.pin + " \u00B7 " + po.district);
          el.textContent = lines.join("\n");
          el.title = "Places: OpenStreetMap \u00B7 Post offices: India Post";
          el.hidden = false;
          syncSheet();
        })
        .catch(function () { /* locality is optional */ });
    }, 250);
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

  /* ---------------------------------------------------------------- saved places (this device only) */
  var SAVE_KEY = "av.places.v4", SAVE_MAX = 20;
  function loadPlaces() {
    try {
      var v = JSON.parse(localStorage.getItem(SAVE_KEY) || "[]");
      return Array.isArray(v) ? v.filter(function (x) { return x && typeof x.code === "string"; }) : [];
    } catch (e) { return []; }
  }
  function storePlaces(list) {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(list.slice(0, SAVE_MAX))); return true; }
    catch (e) { toast("Couldn't save on this browser (private mode?)"); return false; }
  }
  function savedNameFor(code) {
    var l = loadPlaces();
    for (var i = 0; i < l.length; i++) if (l[i].code === code) return l[i].name || "";
    return "";
  }
  function storeNamed(code, name) {
    var list = loadPlaces().filter(function (x) { return x.code !== code; });
    var dropped = list.length >= SAVE_MAX;
    name = cleanName(name) ||
      (state.source === "gps" && code === state.code ? "My location" : "Saved place " + (list.length + 1));
    list.unshift({ code: code, name: name, at: Date.now() });
    if (storePlaces(list)) {
      renderPlaces();
      toast(dropped ? "Saved · oldest place removed (max " + SAVE_MAX + ")" : "Saved “" + name + "”");
    }
  }
  // Save: always ask for a name (Home, Office, Site one, Mom's home...).
  function askSave(code, suggested, after, onCancel) {
    if (!code) return;
    openDlg({
      title: "Save place", code: OAVG.display(code), label: "Name", value: suggested || "",
      placeholder: "e.g. Home, Office, Site one", picks: true,
      note: "Saved on this device only.",
      ok: function () { return "Save"; }, alt: "Cancel",
      onOk: function (v) { storeNamed(code, v); if (after) after(); },
      onCancel: onCancel
    });
  }

  /* ---------------------------------------------------------------- sharing */
  // Phones get the system share sheet (WhatsApp, Telegram, SMS...). Desktops get WhatsApp + Copy.
  function canNativeShare() {
    return !!navigator.share && !!window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  }
  // The name the receiver sees starts as my saved name; I can overwrite it or clear it (code only).
  function askShare(code, myName) {
    if (!code) return;
    var native = canNativeShare();
    openDlg({
      title: myName ? "Share “" + myName + "”" : "Share this place",
      code: OAVG.display(code), label: "Name they will see (optional)", value: myName || "",
      placeholder: "e.g. Abdul's office", picks: false,
      note: myName ? "Change the name if you like, or clear it to send just the code."
                   : "Leave blank to send just the code.",
      ok: function (v) { return native ? (v ? "Share" : "Share code only") : "WhatsApp"; },
      alt: native ? "Cancel" : "Copy",
      onOk: function (v) { sendShare(code, v, native ? "native" : "whatsapp"); },
      onAlt: native ? null : function (v) { sendShare(code, v, "copy"); }
    });
  }
  function sendShare(code, name, how) {
    var disp = OAVG.display(code), url = shareUrl(code, name);
    var text = (name ? name + "\n" : "") + disp;
    var full = text + "\n" + url;
    if (how === "native") {
      navigator.share({ title: name || disp, text: text, url: url }).catch(function (e) {
        if (!e || e.name !== "AbortError") copy(full, "Share message copied");
      });
    } else if (how === "whatsapp") {
      window.open("https://wa.me/?text=" + encodeURIComponent(full), "_blank", "noopener");
    } else {
      copy(full, "Share message copied");
    }
  }

  /* ---------------------------------------------------------------- name dialog (save + share) */
  var dlgCfg = null;
  function openDlg(cfg) {
    var d = $("dlg");
    if (!d || typeof d.showModal !== "function") {      // very old browsers
      var v = window.prompt(cfg.title + " — " + cfg.label, cfg.value || "");
      if (v !== null) cfg.onOk(cleanName(v));
      return;
    }
    dlgCfg = cfg;
    $("dlgTitle").textContent = cfg.title;
    $("dlgCode").textContent = cfg.code;
    $("dlgLabel").textContent = cfg.label || "Name";
    var noIn = !!cfg.noInput;
    $("dlgLabel").hidden = noIn; $("dlgInput").hidden = noIn;
    $("dlgInput").value = cfg.value || "";
    $("dlgInput").placeholder = cfg.placeholder || "";
    $("dlgPicks").hidden = !cfg.picks;
    $("dlgNote").textContent = cfg.note || "";
    $("dlgAlt").textContent = cfg.alt || "Cancel";
    syncDlgOk();
    d.showModal();
    if (!MOBILE.matches && !noIn) { $("dlgInput").focus(); $("dlgInput").select(); }
    else $("dlgClose").focus();                          // don't pop the keyboard over the buttons
  }
  function syncDlgOk() {
    $("dlgClear").hidden = !$("dlgInput").value || $("dlgInput").hidden;
    if (dlgCfg) $("dlgOk").textContent = dlgCfg.ok(cleanName($("dlgInput").value));
  }
  function closeDlg() { var d = $("dlg"); dlgCfg = null; if (d && d.open) d.close(); }
  function cancelDlg() { var cfg = dlgCfg; closeDlg(); if (cfg && cfg.onCancel) cfg.onCancel(); }
  function wireDlg() {
    var d = $("dlg");
    if (!d) return;
    $("dlgInput").addEventListener("input", syncDlgOk);
    $("dlgClear").addEventListener("click", function () {     // one tap empties the name box
      $("dlgInput").value = ""; syncDlgOk(); $("dlgInput").focus();
    });
    $("dlgForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var cfg = dlgCfg, v = cleanName($("dlgInput").value);
      closeDlg();
      if (cfg) cfg.onOk(v);
    });
    $("dlgAlt").addEventListener("click", function () {
      var cfg = dlgCfg, v = cleanName($("dlgInput").value);
      closeDlg();
      if (cfg && cfg.onAlt) cfg.onAlt(v);
    });
    $("dlgClose").addEventListener("click", cancelDlg);
    d.addEventListener("click", function (e) { if (e.target === d) cancelDlg(); });  // tap outside
    d.addEventListener("cancel", function () {                                     // Esc / Android back
      var cfg = dlgCfg; dlgCfg = null; if (cfg && cfg.onCancel) cfg.onCancel();
    });
    document.querySelectorAll("#dlgPicks [data-name]").forEach(function (b) {
      b.addEventListener("click", function () {
        $("dlgInput").value = b.getAttribute("data-name"); syncDlgOk(); $("dlgInput").focus();
      });
    });
  }

  function validCode(x) { try { OAVG.display(x.code); return true; } catch (e) { return false; } }
  function goTo(code) {
    closePlaces();
    try { fromCode(code); $("mapHint").classList.add("gone"); } catch (err) { showError(err.message); }
  }
  function mkBtn(text, cls, label, onClick) {
    var b = document.createElement("button");
    b.type = "button"; b.className = cls; b.textContent = text;
    if (label) b.setAttribute("aria-label", label);
    if (onClick) b.addEventListener("click", onClick);
    return b;
  }
  function navLink(code, who) {
    var a = document.createElement("a");
    a.className = "btn btn-small btn-ghost"; a.textContent = "Navigate";
    a.href = gmapsUrl(code, true); a.target = "_blank"; a.rel = "noopener";
    a.setAttribute("aria-label", "Navigate to " + who + " with Google Maps");
    return a;
  }

  // One row in "My places" (kind "saved") or "Recently received" (kind "recent").
  function placeRow(item, kind) {
    var disp = OAVG.display(item.code), who = item.name || disp;
    var li = document.createElement("li"), title;
    if (kind === "saved") {
      title = document.createElement("input");
      title.type = "text"; title.value = item.name || "Saved place"; title.maxLength = 40;
      title.setAttribute("aria-label", "Name for " + disp);
      title.addEventListener("change", function () { renamePlace(item.code, title.value); });
    } else {
      title = document.createElement("p");
      title.className = "saved-name"; title.textContent = item.name || "Shared place";
    }
    var open = mkBtn(disp, "saved-code", null, function () {
      if (kind === "recent") shared = { code: item.code, name: item.name || "" };
      goTo(item.code);
    });
    open.title = "Show on the map";
    var acts = document.createElement("div");
    acts.className = "saved-acts";
    if (kind === "saved") {
      acts.appendChild(mkBtn("Share", "btn btn-small", "Share " + who, function () {
        askShare(item.code, cleanName(title.value) || item.name);
      }));
      acts.appendChild(navLink(item.code, who));
      acts.appendChild(mkBtn("Copy", "btn btn-small btn-ghost", "Copy " + disp, function () { copy(disp, "Code copied"); }));
      acts.appendChild(mkBtn("Delete", "btn btn-small btn-ghost btn-del", "Delete " + who, function () { deletePlace(item.code); }));
    } else {
      var isSaved = !!savedNameFor(item.code);
      var sv = mkBtn(isSaved ? "Saved ✓" : "Save", "btn btn-small", "Save " + who, function () { askSave(item.code, item.name); });
      sv.disabled = isSaved;
      acts.appendChild(sv);
      acts.appendChild(navLink(item.code, who));
      acts.appendChild(mkBtn("Remove", "btn btn-small btn-ghost btn-del", "Remove " + who + " from recent", function () {
        storeRecent(loadRecent().filter(function (x) { return x.code !== item.code; })); renderRecent();
      }));
    }
    li.appendChild(title); li.appendChild(open); li.appendChild(acts);
    return li;
  }

  function renderPlaces() {
    var list = loadPlaces().filter(validCode);
    [$("savedList"), $("placesList")].forEach(function (ul) {
      ul.textContent = "";
      list.forEach(function (item) { ul.appendChild(placeRow(item, "saved")); });
    });
    $("saved").hidden = list.length === 0;
    $("placesEmpty").hidden = list.length > 0;
    $("placesCount").textContent = String(list.length);
    $("placesCount").hidden = list.length === 0;
    renderRecent();
    syncSheet();
  }
  function renamePlace(code, name) {
    var l = loadPlaces();
    for (var i = 0; i < l.length; i++) if (l[i].code === code) { l[i].name = cleanName(name) || "Saved place"; break; }
    if (storePlaces(l)) renderPlaces();
  }

  /* ---------------------------------------------------------------- delete with undo (no "are you sure?") */
  var undoFn = null, undoTimer = null;
  function showUndo(msg, fn) {
    var bar = $("undoBar");
    if (bar.parentNode !== topHost()) topHost().appendChild(bar);
    $("toast").classList.remove("show");
    $("undoText").textContent = msg;
    undoFn = fn; bar.hidden = false;
    clearTimeout(undoTimer);
    undoTimer = setTimeout(hideUndo, 6000);
  }
  function hideUndo() { $("undoBar").hidden = true; undoFn = null; }
  function deletePlace(code) {
    var l = loadPlaces(), idx = -1;
    for (var i = 0; i < l.length; i++) if (l[i].code === code) { idx = i; break; }
    if (idx < 0) return;
    var item = l.splice(idx, 1)[0];
    if (!storePlaces(l)) return;
    renderPlaces();
    showUndo("Deleted “" + (item.name || OAVG.display(code)) + "”", function () {
      var l2 = loadPlaces().filter(function (x) { return x.code !== item.code; });
      l2.splice(Math.min(idx, l2.length), 0, item);
      if (storePlaces(l2)) { renderPlaces(); toast("Restored “" + (item.name || OAVG.display(code)) + "”"); }
    });
  }

  /* ---------------------------------------------------------------- recently received (last 5 links opened, this device only) */
  var RECENT_KEY = "av.recent.v1", RECENT_MAX = 5;
  function loadRecent() {
    try {
      var v = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
      return Array.isArray(v) ? v.filter(function (x) { return x && typeof x.code === "string"; }) : [];
    } catch (e) { return []; }
  }
  function storeRecent(list) {
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX))); } catch (e) { /* optional */ }
  }
  function addRecent(code, name) {
    var l = loadRecent().filter(function (x) { return x.code !== code; });
    l.unshift({ code: code, name: cleanName(name), at: Date.now() });
    storeRecent(l);
  }
  function renderRecent() {
    var l = loadRecent().filter(validCode), ul = $("recentList");
    ul.textContent = "";
    l.forEach(function (item) { ul.appendChild(placeRow(item, "recent")); });
    $("recentBox").hidden = l.length === 0;
  }

  /* ---------------------------------------------------------------- "My places" sheet */
  function openPlaces() {
    renderPlaces();
    var d = $("placesDlg");
    if (typeof d.showModal !== "function") { $("saved").hidden = false; $("saved").scrollIntoView(); return; }
    if (!d.open) d.showModal();
  }
  function closePlaces() { var d = $("placesDlg"); if (d && d.open) d.close(); }

  /* ---------------------------------------------------------------- closing a shared place */
  var sharedPushed = false, ignorePop = false;   // we add one history entry so the phone's Back closes the card
  function sharedLink(s) { return "/" + s.code + (s.name ? "?n=" + encName(s.name) : ""); }
  function requestCloseShared(fromBack) {
    if (!shared) return;
    var s = shared;
    if (savedNameFor(s.code)) { closeShared(fromBack); return; }      // already saved: no pointless prompt
    var restore = function () {                                       // user changed their mind after Back
      if (fromBack) { try { history.pushState(null, "", sharedLink(s)); sharedPushed = true; } catch (e) { /* ignore */ } }
    };
    openDlg({
      title: "Keep “" + (s.name || OAVG.display(s.code)) + "”?", code: OAVG.display(s.code),
      noInput: true, picks: false,
      note: "If you discard it, you'll still find it in My places → Recently received.",
      ok: function () { return "Save"; }, alt: "Discard",
      onOk: function () { askSave(s.code, s.name, function () { closeShared(fromBack); }, restore); },
      onAlt: function () { closeShared(fromBack); toast("Discarded · kept in Recently received"); },
      onCancel: restore
    });
  }
  function closeShared(fromBack) {
    shared = null;
    if (sharedPushed && !fromBack) { sharedPushed = false; ignorePop = true; try { history.back(); } catch (e) { ignorePop = false; } }
    else sharedPushed = false;
    resetView();
  }
  // Back to the plain live map ("Tap the map").
  function resetView() {
    state = { lat: null, lon: null, code: null, anchor: null, typedBase: null };
    renderShared(false);
    document.body.classList.remove("has-code");
    renderFlap($("panelFlap"), MOBILE.matches ? "TAP THE MAP" : "CLICK THE MAP", false);
    $("describe").textContent = "Pick a spot on the map to see its code.";
    $("facts").hidden = true;
    locSeq++; $("locality").hidden = true; $("locality").textContent = "";
    $("copyBtn").disabled = true; $("shareBtn").disabled = true; $("saveBtn").disabled = true;
    $("saveBtn").textContent = "Save place";
    if (pointMarker) pointMarker.remove();
    if (airportMarker) airportMarker.remove();
    if (map && mapReady) { map.getSource("av-line").setData(emptyFC()); map.getSource("av-cell").setData(emptyFC()); }
    $("mapHint").classList.remove("gone");
    try { history.replaceState(null, "", "/"); } catch (e) { /* ignore */ }
    syncSheet();
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

    $("copyBtn").addEventListener("click", function () { copy(state.display, "Code copied"); });
    $("saveBtn").addEventListener("click", function () {
      askSave(state.code, shared && shared.code === state.code && shared.name ? shared.name : savedNameFor(state.code));
    });
    $("shareBtn").addEventListener("click", function () {
      askShare(state.code, savedNameFor(state.code) || (shared && shared.code === state.code ? shared.name : ""));
    });
    $("sharedSave").addEventListener("click", function () { if (shared) askSave(shared.code, shared.name); });
    wireDlg();
    $("placesBtn").addEventListener("click", openPlaces);
    $("placesClose").addEventListener("click", closePlaces);
    $("placesDlg").addEventListener("click", function (e) { if (e.target === $("placesDlg")) closePlaces(); });
    $("recentClear").addEventListener("click", function () { storeRecent([]); renderRecent(); toast("Recent list cleared"); });
    $("sharedClose").addEventListener("click", function () { requestCloseShared(false); });
    $("undoBtn").addEventListener("click", function () { var f = undoFn; hideUndo(); if (f) f(); });
    window.addEventListener("popstate", function () {
      if (ignorePop) { ignorePop = false; return; }
      if (shared && !$("sharedBox").hidden) { sharedPushed = false; requestCloseShared(true); }
    });
    $("locateBtn").addEventListener("click", locateMe);
    $("locateFab").addEventListener("click", locateMe);
    window.addEventListener("resize", syncSheet);
    document.querySelectorAll(".chip[data-code]").forEach(function (b) {
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
        setPrecisionRadio("4m");                 // your own location: always the exact code
        fromPoint(lat, lon, { source: "gps" });
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
    renderFlap($("panelFlap"), MOBILE.matches ? "TAP THE MAP" : "CLICK THE MAP", false);
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
        renderPlaces();
        heroShow(false);
        setInterval(function () { heroIdx = (heroIdx + 1) % HERO.length; heroShow(true); }, 5200);
        var qs = new URLSearchParams(location.search);
        var m = location.pathname.match(CODE_PATH);
        var c = m ? m[1] : qs.get("c");
        if (c) {
          try {
            // airportvector.org/TRZ-52868-48177?n=Name  ->  "Shared place" card with Google Maps buttons
            if (m) {
              shared = { code: OAVG.parse(OAVG.normalize(c)).code, name: cleanName(qs.get("n")) };
              addRecent(shared.code, shared.name);
              renderRecent();
              try {
                var here = location.pathname + location.search;
                history.replaceState(null, "", "/");
                history.pushState(null, "", here);
                sharedPushed = true;
              } catch (e) { /* ignore */ }
            }
            fromCode(c); $("mapHint").classList.add("gone");
          } catch (err) { shared = null; showError(err.message); }
        }
      })
      .catch(function () { showError("Couldn't load the airport list. Please refresh the page."); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
