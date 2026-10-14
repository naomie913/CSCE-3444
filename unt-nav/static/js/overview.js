/* Floor overview (Fig 24): switch levels, tap a room for details. */
(function () {
  "use strict";
  var app = document.getElementById("overview-app");
  if (!app || !window.NavMap) return;

  var cfg = app.dataset;
  var state = { wing: null, closed: new Set(), level: Number(cfg.level) || null, room: cfg.room || null };
  function $(id) { return document.getElementById(id); }

  function render() {
    var wing = state.wing, levels = NavMap.levelsOf(wing);
    var btns = $("overview-levels");
    btns.innerHTML = "";
    levels.forEach(function (lv) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "seg-btn" + (lv === state.level ? " on" : "");
      b.textContent = "Level " + lv;
      b.setAttribute("aria-pressed", lv === state.level);
      b.addEventListener("click", function () { state.level = lv; render(); });
      btns.appendChild(b);
    });
    $("overview-badge").textContent = "Level " + state.level;
    var svg = $("overview-map");
    NavMap.renderFloor(svg, wing, state.level, {
      closed: state.closed,
      highlight: state.room,
      onRoomClick: function (r) { state.room = r.id; render(); }
    });
    svg.setAttribute("aria-label", "Wing " + cfg.wing + ", Level " + state.level + " floor map");

    var found = state.room ? NavMap.findRoom(wing, state.room) : null;
    var card = $("overview-room"), hint = $("overview-hint");
    if (found && found.level === state.level) {
      var r = found.room;
      $("overview-room-title").textContent = r.id + (r.name ? " · " + r.name : "");
      $("overview-room-sub").textContent = "Wing " + cfg.wing + ", Level " + found.level + (r.note ? " · " + r.note : "");
      $("overview-room-go").href = cfg.findUrl + "?room=" + encodeURIComponent(r.id);
      $("overview-room-from").href = cfg.findUrl + "?from=" + encodeURIComponent(r.id) + "&wing=" + encodeURIComponent(cfg.wing);
      $("overview-room-from").setAttribute("aria-label", "Start from " + r.id);
      card.hidden = false;
      hint.hidden = true;
    } else {
      card.hidden = true;
      hint.hidden = false;
    }
  }

  fetch(cfg.api, { headers: { Accept: "application/json" } })
    .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
    .then(function (data) {
      state.wing = data;
      state.closed = new Set(data.closures);
      var levels = NavMap.levelsOf(data);
      if (!levels.length) throw new Error("no levels");
      var found = state.room ? NavMap.findRoom(data, state.room) : null;
      if (found) state.level = found.level;
      if (levels.indexOf(state.level) === -1) state.level = levels[0];
      $("overview-loading").hidden = true;
      $("overview-body").hidden = false;
      render();
    })
    .catch(function () {
      $("overview-loading").hidden = true;
      $("overview-error").hidden = false;
    });
})();
