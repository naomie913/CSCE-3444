/* Floor overview (Fig 24): the building map zoomed to one wing; tap a room for details. */
(function () {
  "use strict";
  var app = document.getElementById("overview-app");
  if (!app || !window.NavMap) return;

  var cfg = app.dataset;
  var wingLevels = cfg.levels ? cfg.levels.split(",").map(Number) : [];
  var state = { map: null, closed: new Set(), level: Number(cfg.level) || null, room: cfg.room || null };
  function $(id) { return document.getElementById(id); }
  var svg = $("overview-map");
  var viewport = NavMap.makeViewport(svg, { controls: $("overview-zoom"), onFit: fitToWing });

  function wingBox(level) {
    var rooms = state.map.floors[level].rooms.filter(function (r) { return r.wing === cfg.wing; });
    if (!rooms.length) return null;
    return [Math.min.apply(null, rooms.map(function (r) { return r.box[0]; })),
            Math.min.apply(null, rooms.map(function (r) { return r.box[1]; })),
            Math.max.apply(null, rooms.map(function (r) { return r.box[2]; })),
            Math.max.apply(null, rooms.map(function (r) { return r.box[3]; }))];
  }

  function fitToWing() {
    var found = state.room ? NavMap.findRoom(state.map, state.room) : null;
    if (found && found.level === state.level && cfg.room && state.room === cfg.room) {
      viewport.fit(found.room.box, 45, 140);
      return;
    }
    var box = wingBox(state.level);
    if (box) viewport.fit(box, 12, 120);
  }

  function selectRoom(r) {
    state.room = r.id;
    draw();
  }

  function draw() {
    NavMap.renderFloor(svg, state.map, state.level, { closed: state.closed, highlight: state.room, onRoomClick: selectRoom });
    svg.setAttribute("aria-label", "Level " + state.level + " floor map, Wing " + cfg.wing);
    var found = state.room ? NavMap.findRoom(state.map, state.room) : null;
    var card = $("overview-room"), hint = $("overview-hint");
    if (found && found.level === state.level) {
      var r = found.room;
      $("overview-room-title").textContent = NavMap.roomName(r);
      $("overview-room-sub").textContent = (r.wing === "C" ? "Common area" : "Wing " + r.wing) + ", Level " + found.level + (r.dept ? " · " + r.dept : "");
      $("overview-room-go").href = cfg.findUrl + "?room=" + encodeURIComponent(r.id) + "&action=search";
      $("overview-room-from").href = cfg.findUrl + "?from=" + encodeURIComponent(r.id);
      $("overview-room-from").setAttribute("aria-label", "Start from " + r.id);
      card.hidden = false;
      hint.hidden = true;
    } else {
      card.hidden = true;
      hint.hidden = false;
    }
  }

  function render(refit) {
    var btns = $("overview-levels");
    btns.innerHTML = "";
    btns.hidden = wingLevels.length < 2;
    wingLevels.forEach(function (lv) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "seg-btn" + (lv === state.level ? " on" : "");
      b.textContent = "Level " + lv;
      b.setAttribute("aria-pressed", lv === state.level);
      b.addEventListener("click", function () { state.level = lv; render(true); });
      btns.appendChild(b);
    });
    $("overview-badge").textContent = "Level " + state.level;
    draw();
    if (refit) fitToWing();
  }

  fetch(cfg.api, { headers: { Accept: "application/json" } })
    .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
    .then(function (data) {
      state.map = data;
      state.closed = new Set(data.closures);
      if (!wingLevels.length) throw new Error("no levels");
      var found = state.room ? NavMap.findRoom(data, state.room) : null;
      if (found) state.level = found.level;
      if (wingLevels.indexOf(state.level) === -1) state.level = wingLevels[0];
      $("overview-loading").hidden = true;
      $("overview-body").hidden = false;
      render(true);
    })
    .catch(function () {
      $("overview-loading").hidden = true;
      $("overview-error").hidden = false;
    });
})();
