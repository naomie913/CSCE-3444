
(function () {
  "use strict";
  var app = document.getElementById("route-app");
  if (!app || !window.NavMap) return;

  var cfg = app.dataset;
  var startLevel = Number(cfg.level), stepFree = cfg.stepfree === "1", autoRead = cfg.autoread === "1";
  var POLL_MS = 10000;
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

  /* The best open route from `from` (a graph node id), or from the chosen start when `from`
   * is null. Returns {graph, path}, or null after showing why there is no route. */
  function findRoute(from) {
    var map = state.map;
    if (!map.floors[startLevel]) {
      fail("Level " + startLevel + " is unavailable right now.", false);
      return null;
    }
    if (!NavMap.findRoom(map, cfg.room)) {
      fail("The map for " + cfg.room + " is unavailable right now.", false);
      return null;
    }
    var graph = NavMap.buildGraph(map, state.closed);
    var srcs = from ? [from] : cfg.start ? [cfg.start] : NavMap.defaultStarts(map, startLevel, stepFree);
    if (!srcs.some(function (s) { return graph.nodes[s]; })) {
      fail("Your starting point isn't on the current map. Choose a different starting point.", false);
      return null;
    }
    var path = NavMap.shortestPath(graph, srcs, "room:" + cfg.room, { stepFree: stepFree });
    if (!path) {
      fail(stepFree
        ? "No step-free route to " + cfg.room + " is open right now. Try again without step-free access, or check back later."
        : "No open route to " + cfg.room + " right now because of a closure. Check back later or report a problem.", false);
      return null;
    }
    return { graph: graph, path: path };
  }

  function useRoute(found) {
    state.graph = found.graph;
    state.path = found.path;
    state.steps = NavMap.buildDirections(state.graph, state.path, state.map);
    state.step = 0;
    state.viewLevel = state.steps[0].level;
    var first = state.graph.nodes[state.path.nodes[0]];
    $("route-from").textContent = first.room ? NavMap.roomName(first.room)
      : first.feature ? first.feature.label : "where you are now";
  }

  function compute() {
    var found = findRoute(null);
    if (found) useRoute(found);
    return !!found;
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
    if (audioOn) readStep();
  }

  // ---------- voice guidance ----------
  // When audio is on, each step is read aloud as you move to it (Next, Back, or tapping a
  // step in the list), plus arrival and route changes. Browsers only allow speech after
  // you tap something, so nothing is read until the first tap.
  // If speech.js hasn't loaded (a dropped connection, a bad deploy), routing still runs with
  // this stand-in, and the screen reader still reads each step from the aria-live step card.
  var NO_VOICE = { supported: false, speak: function () {}, stop: function () {} };
  var Voice = window.Voice || NO_VOICE;
  var SPEECH_RETRIES = 2, SPEECH_RETRY_MS = 3000;
  var AUDIO_KEY = "unt-nav-audio";
  var audioBtn = $("route-audio-btn"), repeatBtn = $("route-repeat");
  var audioOn = false;
  try {
    var saved = localStorage.getItem(AUDIO_KEY);
    audioOn = saved === null ? autoRead : saved === "1";
  } catch (e) { audioOn = autoRead; }

  function readStep(prefix, slower) {
    var step = state.steps[state.step];
    if (!step) return;
    var text = step.text;
    if (state.step === state.steps.length - 1) text += " You have arrived.";
    Voice.speak((prefix || "") + text, { rate: slower ? 0.85 : 1 });
  }

  // remember=true only when the user taps the button; otherwise the Accessibility
  // setting "Read directions aloud" decides.
  function setAudio(on, remember) {
    audioOn = on && Voice.supported;
    if (remember) {
      try { localStorage.setItem(AUDIO_KEY, audioOn ? "1" : "0"); } catch (e) { /* private mode */ }
    }
    audioBtn.setAttribute("aria-pressed", audioOn);
    audioBtn.classList.toggle("btn-primary", audioOn);
    audioBtn.classList.toggle("btn-outline", !audioOn);
    audioBtn.innerHTML = audioOn ? "&#128266; Audio on" : "&#128264; Audio off";
    if (!audioOn) Voice.stop();
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
        state.closed = next;
        // Re-route from the start of the step the user is on. On the first step they haven't
        // set off yet, so the route may still pick a different entrance.
        var at = state.step > 0 ? state.steps[state.step].at : 0;
        var from = state.step > 0 ? state.path.nodes[at] : null;
        var rest = state.path.nodes.slice(at).join("|");
        var found = findRoute(from);
        if (!found) return;
        show("view");
        if (found.path.nodes.join("|") === rest) {
          state.graph = found.graph;  // the closure isn't on the way: keep the user's place
          render(false);
          return;
        }
        useRoute(found);
        render(true);
        var notice = $("route-notice");
        notice.textContent = "A closure changed, so your route was updated from where you are now.";
        notice.hidden = false;
        if (audioOn) readStep("A closure changed, so your route was updated. ");
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
  function audioUnavailable(title) {
    audioBtn.disabled = true;
    audioBtn.textContent = "Audio unavailable";
    audioBtn.title = title;
  }

  function voiceMessage(text) {
    var msg = $("route-voice-msg");
    msg.textContent = text;
    msg.hidden = !text;
  }

  var voiceWired = false;
  function enableVoice() {
    if (!Voice.supported) {
      audioUnavailable("This browser can't read directions aloud");
      return;
    }
    audioBtn.disabled = false;
    audioBtn.title = "";
    setAudio(audioOn, false);
    // Replay the current step (a little slower), whether or not voice guidance is on.
    repeatBtn.hidden = false;
    if (voiceWired) return;
    voiceWired = true;
    audioBtn.addEventListener("click", function () {
      setAudio(!audioOn, true);
      if (audioOn) readStep("Step " + (state.step + 1) + " of " + state.steps.length + ". ");
    });
    repeatBtn.addEventListener("click", function () { readStep("", true); });
    document.addEventListener("keydown", function (e) {
      if ((e.key === "r" || e.key === "R") && !e.ctrlKey && !e.metaKey && !e.altKey &&
          !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && !panels.view.hidden) {
        readStep("", true);
      }
    });
    window.addEventListener("pagehide", function () { Voice.stop(); });
  }

  /* Load speech.js again in the background, without reloading the page, so the user keeps
   * their place in the directions. Voice guidance turns on as soon as it arrives. */
  function retrySpeech(attempt) {
    var script = document.createElement("script");
    script.src = cfg.speechSrc + (cfg.speechSrc.indexOf("?") < 0 ? "?" : "&") + "retry=" + attempt;
    function failed() {
      if (attempt < SPEECH_RETRIES) {
        setTimeout(function () { retrySpeech(attempt + 1); }, SPEECH_RETRY_MS);
        return;
      }
      audioUnavailable("Voice guidance couldn't load");
      voiceMessage("Voice guidance couldn't load. Your screen reader will still read each step. " +
                   "Reload the page to try again.");
    }
    script.onerror = failed;
    script.onload = function () {
      if (!window.Voice) { failed(); return; }
      Voice = window.Voice;
      enableVoice();
      voiceMessage(Voice.supported ? "Voice guidance is ready." : "");
    };
    document.body.appendChild(script);
  }

  if (window.Voice) {
    enableVoice();
  } else {
    audioBtn.disabled = true;
    audioBtn.textContent = "Audio loading…";
    setTimeout(function () { retrySpeech(1); }, SPEECH_RETRY_MS);
  }

  load();
})();
