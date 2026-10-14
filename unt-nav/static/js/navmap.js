/* UNT Navigation - building map drawing and in-browser routing.
 *
 * The map (from /api/map) has one building-wide plan per floor: room shapes and
 * labels traced from the official PDF, hallway center lines, and numbered
 * stairs/elevators that connect the floors.
 *
 * buildGraph()      turns the map into a walking graph (edge weights in feet)
 * shortestPath()    Dijkstra from one or more start nodes (skips closures; step-free skips stairs)
 * buildDirections() turns a path into tap-through text steps
 * renderFloor()     draws one floor as SVG, with an optional route overlay
 * makeViewport()    pan / zoom / fit for a map <svg>
 */
(function () {
  "use strict";

  var SVGNS = "http://www.w3.org/2000/svg";
  var WALK_FPS = 4;        // walking speed, feet per second
  var STAIRS_S = 20;       // seconds to climb one level
  var ELEVATOR_S = 45;     // seconds including the wait

  function pt(p) { return Array.isArray(p) ? p : [p.x, p.y]; }
  function dist(a, b) { a = pt(a); b = pt(b); return Math.hypot(a[0] - b[0], a[1] - b[1]); }
  function nodeKey(level, p) { return level + ":" + Math.round(p[0] * 10) / 10 + "," + Math.round(p[1] * 10) / 10; }
  function cross(a, b) { return a[0] * b[1] - a[1] * b[0]; }
  function unit(v) { var l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; }
  function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function lowerFirst(s) { return s.charAt(0).toLowerCase() + s.slice(1); }

  function project(c, p) {
    var dx = c.to[0] - c.from[0], dy = c.to[1] - c.from[1];
    var t = ((p[0] - c.from[0]) * dx + (p[1] - c.from[1]) * dy) / (dx * dx + dy * dy);
    t = Math.max(0, Math.min(1, t));
    return [c.from[0] + t * dx, c.from[1] + t * dy];
  }

  function onSegment(c, p) { return dist(project(c, p), p) < 0.5; }

  function intersect(a, b) {
    var x1 = a.from[0], y1 = a.from[1], x2 = a.to[0], y2 = a.to[1];
    var x3 = b.from[0], y3 = b.from[1], x4 = b.to[0], y4 = b.to[1];
    var d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(d) < 1e-9) return null;
    var t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d;
    var u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / d;
    if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
    return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
  }

  function levelsOf(map) {
    return Object.keys(map.floors).map(Number).sort(function (a, b) { return a - b; });
  }

  function findRoom(map, roomId) {
    var levels = levelsOf(map);
    for (var i = 0; i < levels.length; i++) {
      var r = byId(map.floors[levels[i]].rooms, roomId);
      if (r) return { room: r, level: levels[i] };
    }
    return null;
  }

  /* "Stairs 1.8" -> "stairs 1.8"; "East entrance" -> "the east entrance" */
  function placeName(feature) {
    return feature.kind === "entrance" ? "the " + lowerFirst(feature.label) : lowerFirst(feature.label);
  }

  function roomName(room) {
    if (!room.name) return room.id;
    return /^[A-MC]\d{3}[A-Z]?$/.test(room.id) ? room.id + " (" + room.name + ")" : room.name;
  }

  /* closed: Set of "level:corridor:id" / "level:feature:id" keys */
  function buildGraph(map, closed) {
    closed = closed || new Set();
    var nodes = {}, adj = {};

    function addNode(id, level, p, extra) {
      if (!nodes[id]) {
        nodes[id] = Object.assign({ id: id, level: level, x: p[0], y: p[1] }, extra || {});
        adj[id] = [];
      }
      return id;
    }
    function addEdge(a, b, w, info) {
      if (a === b) return;
      adj[a].push(Object.assign({ to: b, w: w }, info));
      adj[b].push(Object.assign({ to: a, w: w }, info));
    }

    levelsOf(map).forEach(function (level) {
      var floor = map.floors[level], scale = floor.feetPerUnit, points = {};
      floor.corridors.forEach(function (c) { points[c.id] = [c.from, c.to]; });

      // Junctions: hallway endpoints that touch another hallway, and crossings.
      floor.corridors.forEach(function (a) {
        floor.corridors.forEach(function (b) {
          if (a === b) return;
          [b.from, b.to].forEach(function (p) { if (onSegment(a, p)) points[a.id].push(p); });
          var x = intersect(a, b);
          if (x) points[a.id].push(x);
        });
      });

      function attach(item, id, extra, isClosed) {
        var c = byId(floor.corridors, item.corridor);
        if (!c) return;
        var p = project(c, item.door);
        points[c.id].push(p);
        addNode(id, level, item.door, extra);
        var j = addNode(nodeKey(level, p), level, p);
        addEdge(id, j, dist(item.door, p) * scale, { level: level, corridor: c.id, door: true, closed: isClosed });
      }
      floor.rooms.forEach(function (r) { attach(r, "room:" + r.id, { room: r }, false); });
      floor.features.forEach(function (f) {
        attach(f, "feat:" + level + ":" + f.id, { feature: f }, closed.has(level + ":feature:" + f.id));
      });

      // Chain the points along each hallway.
      floor.corridors.forEach(function (c) {
        var isClosed = closed.has(level + ":corridor:" + c.id);
        var list = points[c.id].slice().sort(function (p, q) { return dist(c.from, p) - dist(c.from, q); });
        var prev = null;
        list.forEach(function (p) {
          var id = addNode(nodeKey(level, p), level, p);
          if (prev && prev !== id) addEdge(prev, id, dist(nodes[prev], nodes[id]) * scale, { level: level, corridor: c.id, closed: isClosed });
          prev = id;
        });
      });
    });

    // Stairs and elevators with the same number connect neighbouring floors.
    var levels = levelsOf(map);
    for (var i = 0; i + 1 < levels.length; i++) {
      var lo = levels[i], hi = levels[i + 1];
      if (hi - lo !== 1) continue;
      map.floors[lo].features.forEach(function (f) {
        if (f.kind !== "stairs" && f.kind !== "elevator") return;
        var a = "feat:" + lo + ":" + f.id, b = "feat:" + hi + ":" + f.id;
        if (!nodes[a] || !nodes[b]) return;
        var secs = f.kind === "stairs" ? STAIRS_S : ELEVATOR_S;
        addEdge(a, b, secs * WALK_FPS, {
          vertical: true, kind: f.kind,
          closed: closed.has(lo + ":feature:" + f.id) || closed.has(hi + ":feature:" + f.id)
        });
      });
    }
    return { nodes: nodes, adj: adj };
  }

  /* srcs: one node id or a list (the route starts from whichever is closest) */
  function shortestPath(graph, srcs, dst, opts) {
    opts = opts || {};
    srcs = (Array.isArray(srcs) ? srcs : [srcs]).filter(function (s) { return graph.nodes[s]; });
    if (!srcs.length || !graph.nodes[dst]) return null;
    var best = {}, prev = {}, prevEdge = {}, done = {}, queue = srcs.slice();
    srcs.forEach(function (s) { best[s] = 0; });
    while (queue.length) {
      var bi = 0;
      for (var i = 1; i < queue.length; i++) if (best[queue[i]] < best[queue[bi]]) bi = i;
      var u = queue.splice(bi, 1)[0];
      if (done[u]) continue;
      done[u] = true;
      if (u === dst) break;
      graph.adj[u].forEach(function (e) {
        if (e.closed) return;
        if (opts.stepFree && e.vertical && e.kind === "stairs") return;
        var nd = best[u] + e.w;
        if (best[e.to] === undefined || nd < best[e.to]) {
          best[e.to] = nd; prev[e.to] = u; prevEdge[e.to] = e; queue.push(e.to);
        }
      });
    }
    if (best[dst] === undefined) return null;
    var nodes = [dst], edges = [];
    for (var v = dst; prev[v] !== undefined; v = prev[v]) { edges.unshift(prevEdge[v]); nodes.unshift(prev[v]); }
    return { nodes: nodes, edges: edges, cost: best[dst] };
  }

  /* Default starting points on a floor: entrances, or stairs/elevator landings upstairs. */
  function defaultStarts(map, level, stepFree) {
    var feats = map.floors[level].features;
    var entrances = feats.filter(function (f) { return f.kind === "entrance"; });
    var pick = entrances.length ? entrances : feats.filter(function (f) {
      return f.kind === "elevator" || (!stepFree && f.kind === "stairs");
    });
    return pick.map(function (f) { return "feat:" + level + ":" + f.id; });
  }

  function etaMinutes(path) { return Math.max(1, Math.ceil(path.cost / WALK_FPS / 60)); }
  function feet(ft) { return Math.max(10, Math.round(ft / 10) * 10); }

  function buildDirections(graph, path, map) {
    var N = graph.nodes, steps = [];
    var start = N[path.nodes[0]];
    var lastPlace = start.room ? start.room.id : placeName(start.feature);
    var startName = start.room ? roomName(start.room) : placeName(start.feature);
    steps.push({ level: start.level, text: "Start at " + startName + " on Level " + start.level + "." });

    var group = null, heading = null, leavingRoom = null;
    if (start.room && path.nodes.length > 1) {
      // Facing out of the doorway, so the first turn is left or right of the door.
      var out = N[path.nodes[1]];
      heading = unit([out.x - start.x, out.y - start.y]);
      leavingRoom = start.room.id;
    }
    function flush() {
      if (!group) return;
      var h = unit([group.end.x - group.start.x, group.end.y - group.start.y]);
      var ft = feet(group.len), text;
      if (!heading) {
        text = "Walk along the " + group.label + " for " + ft + " ft.";
      } else {
        var dot = heading[0] * h[0] + heading[1] * h[1];
        if (dot > 0.7) text = "Continue along the " + group.label + " for " + ft + " ft.";
        else if (dot < -0.7) text = "Turn around and walk along the " + group.label + " for " + ft + " ft.";
        else text = "Turn " + (cross(heading, h) > 0 ? "right" : "left") + " onto the " + group.label + " and walk " + ft + " ft.";
      }
      if (leavingRoom) {
        text = "Leave " + leavingRoom + ", then " + lowerFirst(text);
        leavingRoom = null;
      }
      steps.push({ level: group.level, text: text });
      heading = h;
      group = null;
    }

    path.edges.forEach(function (e, i) {
      var a = N[path.nodes[i]], b = N[path.nodes[i + 1]];
      if (e.vertical) {
        flush();
        if (leavingRoom) {
          steps.push({ level: a.level, text: "Leave " + leavingRoom + " and go to " + placeName(a.feature) + " outside the door." });
        }
        steps.push({ level: a.level, text: "Take " + placeName(a.feature) + " " + (b.level > a.level ? "up" : "down") + " to Level " + b.level + "." });
        heading = null;
        leavingRoom = null;
        lastPlace = placeName(b.feature);
        return;
      }
      if (e.door) {
        if (!b.room) return; // stepping out of a doorway
        flush();
        var name = roomName(b.room), text;
        if (!heading || leavingRoom) {
          text = name + " is right next to " + lastPlace + ".";
        } else {
          var c = cross(heading, [b.x - a.x, b.y - a.y]);
          text = Math.abs(c) < 1e-6 ? name + " is straight ahead." : name + " is on your " + (c > 0 ? "right" : "left") + ".";
        }
        steps.push({ level: b.level, text: text, arrive: true });
        return;
      }
      var corridor = byId(map.floors[a.level].corridors, e.corridor);
      var label = corridor ? corridor.label : "hallway";
      if (group && group.label === label && group.level === a.level) {
        group.end = b; group.len += e.w;
      } else {
        flush();
        group = { label: label, level: a.level, start: a, end: b, len: e.w };
      }
    });
    flush();
    return steps;
  }

  // ---------- SVG drawing ----------

  function el(name, attrs, parent) {
    var n = document.createElementNS(SVGNS, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function label(parent, x, y, str, cls, extra) {
    var t = el("text", Object.assign({ x: x, y: y, "class": cls, "text-anchor": "middle", "dominant-baseline": "central" }, extra || {}), parent);
    t.textContent = str;
    return t;
  }
  function center(box) { return [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2]; }

  var FEATURE_TEXT = { stairs: function (f) { return f.label.replace("Stairs ", ""); },
                       elevator: function (f) { return "E" + f.id.split("-")[1]; },
                       entrance: function () { return "IN"; } };

  /* opts: closed (Set), highlight (room id), route (path), graph, onRoomClick(room) */
  function renderFloor(svg, map, level, opts) {
    opts = opts || {};
    var floor = map.floors[level], closed = opts.closed || new Set();
    var keepView = svg.getAttribute("viewBox");
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!keepView) {
      var b = floor.bbox;
      svg.setAttribute("viewBox", [b[0], b[1], b[2] - b[0], b[3] - b[1]].join(" "));
    }

    var shapes = el("g", { "class": "map-shapes" }, svg);
    floor.shapes.forEach(function (s) {
      var cls = s.hall ? "map-hall-shape" : s.fill === "#ffffff" ? "map-space" : "map-dept";
      var attrs = { d: s.d, "class": cls };
      if (cls === "map-dept") attrs.style = "fill:" + s.fill;
      el("path", attrs, shapes);
    });

    var dest = opts.highlight ? byId(floor.rooms, opts.highlight) : null;
    if (dest) {
      var g = el("g", { "class": "map-dest" }, svg);
      if (dest.shape !== null && dest.shape !== undefined) el("path", { d: floor.shapes[dest.shape].d }, g);
      else el("rect", { x: dest.box[0], y: dest.box[1], width: dest.box[2] - dest.box[0], height: dest.box[3] - dest.box[1] }, g);
    }

    var texts = el("g", { "class": "map-labels" }, svg);
    floor.labels.forEach(function (l) {
      var cls = "map-label" + (l.minor ? " minor" : "") + (l.name ? " name" : "") + (dest && l.t === dest.id ? " dest" : "");
      if (l.name) {
        var words = l.t.split(" "), lines = [], line = "";
        words.forEach(function (w) { if ((line + " " + w).trim().length > 16 && line) { lines.push(line); line = w; } else line = (line + " " + w).trim(); });
        lines.push(line);
        lines.forEach(function (ln, i) {
          label(texts, l.x, l.y + (i - (lines.length - 1) / 2) * l.s * 1.15, ln, cls, { "font-size": l.s });
        });
      } else {
        label(texts, l.x, l.y, l.t, cls, { "font-size": l.s });
      }
    });

    var used = {};
    if (opts.route) {
      opts.route.edges.forEach(function (e, i) {
        if (e.vertical) used[opts.graph.nodes[opts.route.nodes[i]].feature.id] = true;
      });
    }
    floor.features.forEach(function (f) {
      var g = el("g", { "class": "map-feat map-" + f.kind + (used[f.id] ? " active" : "") }, svg);
      var b = f.box;
      el("rect", { x: b[0], y: b[1], width: b[2] - b[0], height: b[3] - b[1], rx: 1.5 }, g);
      var c = center(b);
      label(g, c[0], c[1], FEATURE_TEXT[f.kind](f), "map-feat-label");
      el("title", {}, g).textContent = f.label;
    });

    closed.forEach(function (k) {
      var parts = k.split(":");
      if (Number(parts[0]) !== level) return;
      var p;
      if (parts[1] === "corridor") {
        var c = byId(floor.corridors, parts[2]);
        if (!c) return;
        p = [(c.from[0] + c.to[0]) / 2, (c.from[1] + c.to[1]) / 2];
      } else {
        var f = byId(floor.features, parts[2]);
        if (!f) return;
        p = center(f.box);
      }
      var g = el("g", { "class": "map-closed" }, svg);
      el("line", { x1: p[0] - 3.5, y1: p[1] - 3.5, x2: p[0] + 3.5, y2: p[1] + 3.5 }, g);
      el("line", { x1: p[0] - 3.5, y1: p[1] + 3.5, x2: p[0] + 3.5, y2: p[1] - 3.5 }, g);
      el("rect", { x: p[0] + 5, y: p[1] - 4, width: 24, height: 8, rx: 2, "class": "map-closed-tag" }, g);
      label(g, p[0] + 17, p[1], "CLOSED", "map-closed-label");
    });

    if (opts.route && opts.graph) {
      var runs = [], cur = [];
      opts.route.nodes.forEach(function (id) {
        var n = opts.graph.nodes[id];
        if (n.level === level) cur.push(n);
        else { if (cur.length) runs.push(cur); cur = []; }
      });
      if (cur.length) runs.push(cur);
      runs.forEach(function (run) {
        if (run.length < 2) return;
        el("polyline", { points: run.map(function (n) { return n.x + "," + n.y; }).join(" "), "class": "map-route" }, svg);
      });
      var first = opts.graph.nodes[opts.route.nodes[0]];
      if (first.level === level) {
        el("circle", { cx: first.x, cy: first.y, r: 3.5, "class": "map-you" }, svg);
        label(svg, first.x - 6, first.y - 7, "You", "map-you-label", { "text-anchor": "end" });
      }
    }

    if (opts.onRoomClick) {
      var hits = el("g", { "class": "map-hits" }, svg);
      floor.rooms.slice().sort(function (a, b) {
        return (b.box[2] - b.box[0]) * (b.box[3] - b.box[1]) - (a.box[2] - a.box[0]) * (a.box[3] - a.box[1]);
      }).forEach(function (r) {
        var h = el("rect", { x: r.box[0], y: r.box[1], width: r.box[2] - r.box[0], height: r.box[3] - r.box[1],
                             "class": "map-hit", tabindex: "0", role: "button", "aria-label": roomName(r) }, hits);
        el("title", {}, h).textContent = roomName(r);
        h.addEventListener("click", function () { opts.onRoomClick(r); });
        h.addEventListener("keydown", function (ev) {
          if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); opts.onRoomClick(r); }
        });
      });
    }
  }

  /* Bounding box [x0, y0, x1, y1] of the route's points on one floor. */
  function routeBox(graph, path, level) {
    var xs = [], ys = [];
    path.nodes.forEach(function (id) {
      var n = graph.nodes[id];
      if (n.level === level) { xs.push(n.x); ys.push(n.y); }
    });
    if (!xs.length) return null;
    return [Math.min.apply(null, xs), Math.min.apply(null, ys), Math.max.apply(null, xs), Math.max.apply(null, ys)];
  }

  // ---------- pan / zoom ----------

  function makeViewport(svg, opts) {
    opts = opts || {};
    var vb = null, pointers = {}, moved = 0;
    var MIN_W = 40, MAX_W = 900;

    function set(v) { vb = v; svg.setAttribute("viewBox", v.map(function (n) { return n.toFixed(1); }).join(" ")); }
    function current() {
      if (!vb) { var a = (svg.getAttribute("viewBox") || "0 0 600 600").split(/\s+/).map(Number); vb = a; }
      return vb;
    }
    function toSvg(x, y) {
      var p = svg.createSVGPoint(); p.x = x; p.y = y;
      return p.matrixTransform(svg.getScreenCTM().inverse());
    }
    function zoomAt(f, cx, cy) {
      var v = current(), p = toSvg(cx, cy);
      var w = Math.min(Math.max(v[2] / f, MIN_W), MAX_W), k = w / v[2];
      set([p.x - (p.x - v[0]) * k, p.y - (p.y - v[1]) * k, v[2] * k, v[3] * k]);
    }
    function zoomCenter(f) {
      var r = svg.getBoundingClientRect();
      zoomAt(f, r.left + r.width / 2, r.top + r.height / 2);
    }
    function fit(box, pad, minW) {
      pad = pad === undefined ? 20 : pad;
      var x0 = box[0] - pad, y0 = box[1] - pad, w = box[2] - box[0] + pad * 2, h = box[3] - box[1] + pad * 2;
      var minWidth = minW || 90;
      if (w < minWidth) { x0 -= (minWidth - w) / 2; w = minWidth; }
      if (h < minWidth * 0.8) { y0 -= (minWidth * 0.8 - h) / 2; h = minWidth * 0.8; }
      set([x0, y0, w, h]);
    }

    svg.addEventListener("wheel", function (e) {
      e.preventDefault();
      zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX, e.clientY);
    }, { passive: false });

    function onMove(e) {
      if (!pointers[e.pointerId]) return;
      var ids = Object.keys(pointers);
      if (ids.length === 1) {
        var p0 = toSvg(pointers[e.pointerId].x, pointers[e.pointerId].y), p1 = toSvg(e.clientX, e.clientY);
        var v = current();
        set([v[0] - (p1.x - p0.x), v[1] - (p1.y - p0.y), v[2], v[3]]);
        moved += Math.abs(e.clientX - pointers[e.pointerId].x) + Math.abs(e.clientY - pointers[e.pointerId].y);
      } else if (ids.length === 2) {
        var other = pointers[ids[0] === String(e.pointerId) ? ids[1] : ids[0]];
        var before = Math.hypot(pointers[e.pointerId].x - other.x, pointers[e.pointerId].y - other.y);
        var after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
        if (before > 0) zoomAt(after / before, (e.clientX + other.x) / 2, (e.clientY + other.y) / 2);
        moved += 10;
      }
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    }
    function onUp(e) {
      delete pointers[e.pointerId];
      if (!Object.keys(pointers).length) {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      }
    }
    svg.addEventListener("pointerdown", function (e) {
      if (!Object.keys(pointers).length) {
        moved = 0;
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
      }
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    });
    // A drag shouldn't count as tapping a room.
    svg.addEventListener("click", function (e) { if (moved > 8) { e.stopPropagation(); e.preventDefault(); } }, true);

    if (opts.controls) {
      opts.controls.querySelector("[data-zoom='in']").addEventListener("click", function () { zoomCenter(1.4); });
      opts.controls.querySelector("[data-zoom='out']").addEventListener("click", function () { zoomCenter(1 / 1.4); });
      opts.controls.querySelector("[data-zoom='fit']").addEventListener("click", function () { if (opts.onFit) opts.onFit(); });
    }
    return { fit: fit, zoomCenter: zoomCenter };
  }

  window.NavMap = {
    levelsOf: levelsOf,
    findRoom: findRoom,
    roomName: roomName,
    buildGraph: buildGraph,
    shortestPath: shortestPath,
    defaultStarts: defaultStarts,
    buildDirections: buildDirections,
    etaMinutes: etaMinutes,
    renderFloor: renderFloor,
    routeBox: routeBox,
    makeViewport: makeViewport
  };
})();
