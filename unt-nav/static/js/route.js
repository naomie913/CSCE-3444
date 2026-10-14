/* Route page: map loading (Fig 22) -> route navigation (Fig 23).
 * Polls for closures and recalculates the route when they change (Observer). */
(function () {
  "use strict";
  var app = document.getElementById("route-app");
  if (!app || !window.NavMap) return;

  var cfg = app.dataset;
  var startLevel = Number(cfg.level), stepFree = cfg.stepfree === "1", autoRead = cfg.autoread === "1";
  var POLL_MS = 20000;
  var state = { wing: null, closed: new Set(), graph: null, path: null, steps: [], step: 0, viewLevel: startLevel };

  function $(id) { return document.getElementById(id); }
  var panels = { loading: $("route-loading"), error: $("route-error"), view: $("route-view") };

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
    var minWait = new Promise(function (resolve) { setTimeout(resolve, 900); });
    var request = fetch(cfg.api, { headers: { Accept: "application/json" } }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
    Promise.all([request, minWait]).then(function (res) {
      clearInterval(timer);
      setProgress(100);
      state.wing = res[0];
      state.closed = new Set(res[0].closures);
      if (compute()) { show("view"); render(); }
      setInterval(poll, POLL_MS);
    }).catch(function () {
      clearInterval(timer);
      fail("The map for Wing " + cfg.wing + " couldn't load. Check your connection and try again.", true);
    });
  }

  function compute() {
    var wing = state.wing;
    if (!wing.floors[startLevel]) {
      fail("Level " + startLevel + " of Wing " + cfg.wing + " is unavailable right now.", false);
      return false;
    }
    if (!NavMap.findRoom(wing, cfg.room)) {
      fail("The map for " + cfg.room + "'s level is unavailable right now.", false);
      return false;
    }
    state.graph = NavMap.buildGraph(wing, state.closed);
    var src = cfg.start || "feat:" + startLevel + ":" + wing.floors[startLevel].start;
    if (!state.graph.nodes[src]) {
      fail("Your starting point isn't on the current map. Choose a different starting point.", false);
      return false;
    }
    var path = NavMap.shortestPath(state.graph, src, "room:" + cfg.room, { stepFree: stepFree });
    if (!path) {
      fail(stepFree
        ? "No step-free route to " + cfg.room + " is open right now. Try again without step-free access, or check back later."
        : "No open route to " + cfg.room + " right now because of a closure. Check back later or report a problem.", false);
      return false;
    }
    state.path = path;
    state.steps = NavMap.buildDirections(state.graph, path, wing);
    state.step = 0;
    state.viewLevel = state.steps[0].level;
    return true;
  }

  function render() {
    var wing = state.wing, path = state.path, nodes = state.graph.nodes;
    var endLevel = nodes[path.nodes[path.nodes.length - 1]].level;
    $("route-levels").textContent = startLevel === endLevel ? "Level " + startLevel : "Level " + startLevel + " → Level " + endLevel;
    $("route-eta").textContent = (stepFree ? "Step-free" : "Fastest") + " · " + NavMap.etaMinutes(path) + " min";
    $("route-level-badge").textContent = "Level " + state.viewLevel;

    var btns = $("route-level-btns");
    btns.innerHTML = "";
    var levels = NavMap.levelsOf(wing);
    btns.hidden = levels.length < 2;
    levels.forEach(function (lv) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "seg-btn" + (lv === state.viewLevel ? " on" : "");
      b.textContent = "Level " + lv;
      b.setAttribute("aria-pressed", lv === state.viewLevel);
      b.addEventListener("click", function () { state.viewLevel = lv; render(); });
      btns.appendChild(b);
    });

    var svg = $("route-map");
    NavMap.renderFloor(svg, wing, state.viewLevel, { closed: state.closed, highlight: cfg.room, route: path, graph: state.graph });
    svg.setAttribute("aria-label", "Wing " + cfg.wing + ", Level " + state.viewLevel + " map with your route to " + cfg.room);

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
    state.step = Math.max(0, Math.min(state.steps.length - 1, i));
    state.viewLevel = state.steps[state.step].level;
    render();
    if (autoRead) speak();
  }

  function speak() {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance($("route-step-text").textContent));
  }

  function poll() {
    fetch(cfg.closuresApi, { headers: { Accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !state.wing) return;
        var next = new Set(data.closures);
        var same = next.size === state.closed.size && Array.from(next).every(function (k) { return state.closed.has(k); });
        var levelsSame = data.levels.length === NavMap.levelsOf(state.wing).length;
        if (same && levelsSame) return;
        if (!levelsSame) { load(); return; }
        var before = state.path ? state.path.nodes.join("|") : "";
        state.closed = next;
        if (compute()) {
          show("view");
          render();
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
