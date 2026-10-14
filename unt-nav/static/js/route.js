/* Route page: map loading (Fig 22) -> route navigation (Fig 23).
 * Polls for closures and removed maps, and recalculates the route when they change (Observer). */
(function () {
  "use strict";
  var app = document.getElementById("route-app");
  if (!app || !window.NavMap) return;

  var cfg = app.dataset;
  var startLevel = Number(cfg.level), stepFree = cfg.stepfree === "1", autoRead = cfg.autoread === "1";
  var POLL_MS = 20000;
  var state = { map: null, closed: new Set(), inactive: "", graph: null, path: null, steps: [], step: 0, viewLevel: startLevel };
  var pollTimer = null;

  function $(id) { return document.getElementById(id); }
  var panels = { loading: $("route-loading"), error: $("route-error"), view: $("route-view") };
  var svg = $("route-map");
  var viewport = NavMap.makeViewport(svg, { controls: $("route-zoom"), onFit: fitToRoute });

  function show(name) {
    Object.keys(panels).forEach(function (k) { panels[k].hidden = k !== name; });
  }

  function setProgress(pct) {
    $("route-bar").style.width = pct + "%";
    $("route-pct").textContent = pct + "% completed";
    $("route-progress").setAttribute("aria-valuenow", pct);
  }

  function fail(message, canRetry) {
    $("route-error-msg").textContent = message;
    $("route-retry").hidden = !canRetry;
    show("error");
  }

  function load() {
    show("loading");
    var pct = 0;
    setProgress(0);
    var timer = setInterval(function () { pct = Math.min(90, pct + 6); setProgress(pct); }, 70);
    var minWait = new Promise(function (resolve) { setTimeout(resolve, 700); });
    var request = fetch(cfg.api, { headers: { Accept: "application/json" } }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
    Promise.all([request, minWait]).then(function (res) {
      clearInterval(timer);
      setProgress(100);
      state.map = res[0];
      state.closed = new Set(res[0].closures);
      state.inactive = res[0].inactive.join(",");
      if (compute()) { show("view"); render(true); }
      if (!pollTimer) pollTimer = setInterval(poll, POLL_MS);
    }).catch(function () {
      clearInterval(timer);
      fail("The Discovery Park map couldn't load. Check your connection and try again.", true);
    });
  }

  function compute() {
    var map = state.map;
    if (!map.floors[startLevel]) {
      fail("Level " + startLevel + " is unavailable right now.", false);
      return false;
    }
    if (!NavMap.findRoom(map, cfg.room)) {
      fail("The map for " + cfg.room + " is unavailable right now.", false);
      return false;
    }
    state.graph = NavMap.buildGraph(map, state.closed);
    var srcs = cfg.start ? [cfg.start] : NavMap.defaultStarts(map, startLevel, stepFree);
    if (!srcs.some(function (s) { return state.graph.nodes[s]; })) {
      fail("Your starting point isn't on the current map. Choose a different starting point.", false);
      return false;
    }
    var path = NavMap.shortestPath(state.graph, srcs, "room:" + cfg.room, { stepFree: stepFree });
    if (!path) {
      fail(stepFree
        ? "No step-free route to " + cfg.room + " is open right now. Try again without step-free access, or check back later."
        : "No open route to " + cfg.room + " right now because of a closure. Check back later or report a problem.", false);
      return false;
    }
    state.path = path;
    state.steps = NavMap.buildDirections(state.graph, path, map);
    state.step = 0;
    state.viewLevel = state.steps[0].level;
    var first = state.graph.nodes[path.nodes[0]];
    $("route-from").textContent = first.room ? NavMap.roomName(first.room) : first.feature.label;
    return true;
  }

  function fitToRoute() {
    var box = NavMap.routeBox(state.graph, state.path, state.viewLevel);
    if (!box) return;
    // Keep the whole destination room (and a starting room) in view, not just the door.
    [state.path.nodes[0], state.path.nodes[state.path.nodes.length - 1]].forEach(function (id) {
      var n = state.graph.nodes[id];
      if (n.room && n.level === state.viewLevel) {
        box = [Math.min(box[0], n.room.box[0]), Math.min(box[1], n.room.box[1]),
               Math.max(box[2], n.room.box[2]), Math.max(box[3], n.room.box[3])];
      }
    });
    viewport.fit(box, 18, 110);
  }

  function render(refit) {
    var map = state.map, path = state.path, nodes = state.graph.nodes;
    var endLevel = nodes[path.nodes[path.nodes.length - 1]].level;
    var beginLevel = nodes[path.nodes[0]].level;
    $("route-levels").textContent = beginLevel === endLevel ? "Level " + beginLevel : "Level " + beginLevel + " → Level " + endLevel;
    $("route-eta").textContent = (stepFree ? "Step-free" : "Fastest") + " · " + NavMap.etaMinutes(path) + " min";
    $("route-level-badge").textContent = "Level " + state.viewLevel;

    var btns = $("route-level-btns");
    btns.innerHTML = "";
    var levels = NavMap.levelsOf(map);
    btns.hidden = beginLevel === endLevel;
    levels.forEach(function (lv) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "seg-btn" + (lv === state.viewLevel ? " on" : "");
      b.textContent = "Level " + lv;
      b.setAttribute("aria-pressed", lv === state.viewLevel);
      b.addEventListener("click", function () { state.viewLevel = lv; render(true); });
      btns.appendChild(b);
    });

    NavMap.renderFloor(svg, map, state.viewLevel, { closed: state.closed, highlight: cfg.room, route: path, graph: state.graph });
    if (refit) fitToRoute();
    svg.setAttribute("aria-label", "Level " + state.viewLevel + " map with your route to " + cfg.room);

    var step = state.steps[state.step];
    $("route-step-label").textContent = step.arrive ? "Arrive:" : "Next:";
    $("route-step-text").textContent = step.text;
    $("route-step-count").textContent = (state.step + 1) + " of " + state.steps.length;
    $("route-prev").disabled = state.step === 0;
    $("route-next").disabled = state.step === state.steps.length - 1;

    var list = $("route-steps");
    list.innerHTML = "";
    state.steps.forEach(function (s, i) {
      var li = document.createElement("li");
      var b = document.createElement("button");
      b.type = "button";
      b.className = "step-item" + (i === state.step ? " current" : "");
      b.textContent = s.text;
      b.addEventListener("click", function () { goTo(i); });
      li.appendChild(b);
      list.appendChild(li);
    });
  }

  function goTo(i) {
    var before = state.viewLevel;
    state.step = Math.max(0, Math.min(state.steps.length - 1, i));
    state.viewLevel = state.steps[state.step].level;
    render(before !== state.viewLevel);
    if (autoRead) speak();
  }

  function speak() {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance($("route-step-text").textContent));
  }

  function poll() {
    fetch(cfg.statusApi, { headers: { Accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !state.map) return;
        if (data.inactive.join(",") !== state.inactive) { load(); return; }  // a map was added or removed
        var next = new Set(data.closures);
        var same = next.size === state.closed.size && Array.from(next).every(function (k) { return state.closed.has(k); });
        if (same) return;
        var before = state.path ? state.path.nodes.join("|") : "";
        state.closed = next;
        if (compute()) {
          show("view");
          render(true);
          if (state.path.nodes.join("|") !== before) {
            var notice = $("route-notice");
            notice.textContent = "A closure changed, so your route was updated.";
            notice.hidden = false;
          }
        }
      })
      .catch(function () { /* try again on the next poll */ });
  }

  $("route-prev").addEventListener("click", function () { goTo(state.step - 1); });
  $("route-next").addEventListener("click", function () { goTo(state.step + 1); });
  $("route-retry").addEventListener("click", load);
  $("route-text-btn").addEventListener("click", function () {
    var list = $("route-steps"), open = list.hidden;
    list.hidden = !open;
    this.setAttribute("aria-expanded", open);
    this.textContent = open ? "Hide directions" : "Text directions";
  });
  var audioBtn = $("route-audio-btn");
  if (!("speechSynthesis" in window)) {
    audioBtn.disabled = true;
    audioBtn.title = "Audio isn't supported in this browser";
  }
  audioBtn.addEventListener("click", speak);

  load();
})();
