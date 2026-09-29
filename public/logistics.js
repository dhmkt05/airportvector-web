/* AirportVector for Logistics — zone calculator. Runs entirely in the browser. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  var ready = false;
  var lastRows = [];
  var locCache = {};           // code -> "Name PIN" | "" (none) ; filled from /api/v1/locality
  var LOC_MAX = 200;           // at most this many lookups per run
  var runSeq = 0;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function toast(msg) {
    var t = $("toast");
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove("show"); }, 1800);
  }
  function bands() {
    var out = [];
    ["z1", "z2", "z3", "z4"].forEach(function (id) {
      var v = parseFloat($(id).value);
      out.push(isFinite(v) && v >= 0 ? v : Infinity);
    });
    return out;
  }
  function zoneOf(km, b) {
    for (var i = 0; i < b.length; i++) if (km <= b[i]) return i + 1;
    return 5;
  }
  function zoneLabel(z) { return z === 5 ? "Remote" : "Zone " + z; }
  function fmtKm(km) {
    return km < 10 ? km.toFixed(1) + " km" : Math.round(km).toLocaleString("en-US") + " km";
  }

  function run() {
    if (!ready) return;
    var b = bands();
    var lines = $("codes").value.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 500);
    var body = $("outBody");
    var html = "";
    var counts = [0, 0, 0, 0, 0, 0];
    var errors = 0;
    lastRows = [];
    lines.forEach(function (line) {
      try {
        var code = OAVG.normalize(line);
        var p = OAVG.parse(code);
        var a = OAVG.getAnchor(p.anchor);
        var g = OAVG.decodeGrid(code);
        var km = Math.hypot(g.x, g.y) / 1000;
        var brg = (Math.atan2(g.x, g.y) * 180 / Math.PI + 360) % 360;
        var dir = COMPASS[Math.floor((brg + 11.25) / 22.5) % 16];
        var z = zoneOf(km, b);
        counts[z]++;
        lastRows.push([code, a.code, a.name, dir, locCache[code] || "", km.toFixed(1), zoneLabel(z)]);
        html += "<tr><td class=\"mono\"><a href=\"/" + esc(code) + "\">" + esc(code) + "</a></td>" +
          "<td><b>" + esc(a.code) + "</b> <span class=\"muted\">" + esc(a.name) + "</span></td>" +
          "<td>" + dir + "</td><td class=\"loc\" data-code=\"" + esc(code) + "\">" + locCell(code) + "</td><td class=\"km\">" + fmtKm(km) + "</td>" +
          "<td><span class=\"zchip z" + z + "\">" + zoneLabel(z) + "</span></td></tr>";
      } catch (err) {
        errors++;
        html += "<tr class=\"bad\"><td class=\"mono\">" + esc(line.slice(0, 40)) + "</td><td colspan=\"5\">" +
          esc(err && err.message ? err.message : "Invalid code") + "</td></tr>";
      }
    });
    body.innerHTML = html || "<tr><td colspan=\"6\" class=\"muted\">Paste one code per line.</td></tr>";
    fillLocalities();
    var parts = [];
    for (var z = 1; z <= 5; z++) if (counts[z]) parts.push(counts[z] + " × " + zoneLabel(z));
    $("summary").textContent = lastRows.length
      ? lastRows.length + " parcels: " + parts.join(" · ") + (errors ? " · " + errors + " invalid" : "")
      : (errors ? errors + " invalid" : "");
    $("csvBtn").disabled = lastRows.length === 0;
  }

  function locCell(code) {
    if (!(code in locCache)) return "<span class=\"muted\">…</span>";
    var v = locCache[code];
    if (!v) return "<span class=\"muted\">—</span>";
    // "Olaiyur, K. Sathanur PO 620021" -> village + (PO + PIN, hidden on phones)
    var m = /^(.*?)((?:,\s*[^,]*?)?(?:\s+PO)?\s+\d{6})$/.exec(v);
    return m ? esc(m[1]) + "<span class=\"pin\">" + esc(m[2]) + "</span>" : esc(v);
  }
  function fillLocalities() {
    var seq = ++runSeq;
    var todo = lastRows.map(function (r) { return r[0]; })
      .filter(function (c, i, arr) { return !(c in locCache) && arr.indexOf(c) === i; })
      .slice(0, LOC_MAX);
    var i = 0;
    function paint(code) {
      var cells = document.querySelectorAll("td.loc");
      for (var k = 0; k < cells.length; k++) if (cells[k].getAttribute("data-code") === code) cells[k].innerHTML = locCell(code);
      lastRows.forEach(function (r) { if (r[0] === code) r[4] = locCache[code] || ""; });
    }
    function next() {
      if (seq !== runSeq || i >= todo.length) return;
      var code = todo[i++];
      fetch("/api/v1/locality?code=" + encodeURIComponent(code))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          locCache[code] = (d && d.label) || "";
        }, function () { locCache[code] = ""; })
        .then(function () { paint(code); next(); });
    }
    for (var w = 0; w < 4; w++) next();   // 4 requests at a time
    // anything beyond LOC_MAX shows a dash
    lastRows.forEach(function (r) { if (!(r[0] in locCache) && todo.indexOf(r[0]) < 0) { locCache[r[0]] = ""; paint(r[0]); } });
  }

  function copyCsv() {
    var q = function (v) { v = String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var csv = [["code", "hub", "hub_name", "direction", "locality", "distance_km", "zone"]].concat(lastRows)
      .map(function (r) { return r.map(q).join(","); }).join("\n");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(csv).then(function () { toast("CSV copied"); }, function () { toast("Couldn't copy"); });
    } else { toast("Clipboard not available"); }
  }

  function boot() {
    $("runBtn").addEventListener("click", run);
    $("csvBtn").addEventListener("click", copyCsv);
    ["z1", "z2", "z3", "z4"].forEach(function (id) { $(id).addEventListener("input", run); });
    var t;
    $("codes").addEventListener("input", function () { clearTimeout(t); t = setTimeout(run, 300); });
    fetch("/anchors.json", { cache: "force-cache" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (rows) { OAVG.loadRegistry(rows); ready = true; run(); })
      .catch(function () {
        $("outBody").innerHTML = "<tr><td colspan=\"6\">Couldn't load the airport list. Please refresh.</td></tr>";
      });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
