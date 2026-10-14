/* UNT Navigation - floor map drawing and in-browser routing.
 *
 * buildGraph()      turns a wing's hallway/room/feature data into a walking graph
 * shortestPath()    Dijkstra over that graph (skips closures; step-free skips stairs)
 * buildDirections() turns a path into tap-through text steps
 * renderFloor()     draws one level as SVG, with an optional route overlay
 */
(function () {
  "use strict";

  var SVGNS = "http://www.w3.org/2000/svg";
  var UNIT_M = 0.4;        // metres per map unit
  var WALK_MPS = 1.2;      // walking speed, metres per second
  var STAIRS_S = 20;       // seconds to climb one level
  var ELEVATOR_S = 45;     // seconds including the wait

  function pt(p) { return Array.isArray(p) ? p : [p.x, p.y]; }
  function dist(a, b) { a = pt(a); b = pt(b); return Math.hypot(a[0] - b[0], a[1] - b[1]); }
  function nodeKey(level, p) { return level + ":" + Math.round(p[0] * 10) / 10 + "," + Math.round(p[1] * 10) / 10; }
  function cross(a, b) { return a[0] * b[1] - a[1] * b[0]; }
  function unit(v) { var l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; }
  function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }

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

  function levelsOf(wing) {
    return Object.keys(wing.floors).map(Number).sort(function (a, b) { return a - b; });
  }

  function findRoom(wing, roomId) {
    var levels = levelsOf(wing);
    for (var i = 0; i < levels.length; i++) {
      var r = byId(wing.floors[levels[i]].rooms, roomId);
      if (r) return { room: r, level: levels[i] };
    }
    return null;
  }

  /* closed: Set of "level:corridor:id" / "level:feature:id" keys */
  function buildGraph(wing, closed) {
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

    levelsOf(wing).forEach(function (level) {
      var floor = wing.floors[level];
      var points = {};
      floor.corridors.forEach(function (c) { points[c.id] = [c.from, c.to]; });

      // Junctions: corridor endpoints that touch another corridor, and crossings.
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
        var p = project(c, item.door);
        points[c.id].push(p);
        addNode(id, level, item.door, extra);
        var j = addNode(nodeKey(level, p), level, p);
        addEdge(id, j, dist(item.door, p), { level: level, corridor: c.id, door: true, closed: isClosed });
      }
      floor.rooms.forEach(function (r) { attach(r, "room:" + r.id, { room: r }, false); });
      floor.features.forEach(function (f) {
        attach(f, "feat:" + level + ":" + f.id, { feature: f }, closed.has(level + ":feature:" + f.id));
      });

      // Chain the points along each corridor.
      floor.corridors.forEach(function (c) {
        var isClosed = closed.has(level + ":corridor:" + c.id);
        var list = points[c.id].slice().sort(function (p, q) { return dist(c.from, p) - dist(c.from, q); });
        var prev = null;
        list.forEach(function (p) {
          var id = addNode(nodeKey(level, p), level, p);
          if (prev && prev !== id) addEdge(prev, id, dist(nodes[prev], nodes[id]), { level: level, corridor: c.id, closed: isClosed });
          prev = id;
        });
      });
    });

    // Stairs and elevators with the same id connect neighbouring levels.
    var levels = levelsOf(wing);
    for (var i = 0; i + 1 < levels.length; i++) {
      var lo = levels[i], hi = levels[i + 1];
      if (hi - lo !== 1) continue;
      wing.floors[lo].features.forEach(function (f) {
        if (f.kind !== "stairs" && f.kind !== "elevator") return;
        var a = "feat:" + lo + ":" + f.id, b = "feat:" + hi + ":" + f.id;
        if (!nodes[b]) return;
        var secs = f.kind === "stairs" ? STAIRS_S : ELEVATOR_S;
        addEdge(a, b, secs * WALK_MPS / UNIT_M, {
          vertical: true, kind: f.kind, feature: f,
          closed: closed.has(lo + ":feature:" + f.id) || closed.has(hi + ":feature:" + f.id)
        });
      });
    }
    return { nodes: nodes, adj: adj };
  }

  function shortestPath(graph, src, dst, opts) {
    opts = opts || {};
    if (!graph.nodes[src] || !graph.nodes[dst]) return null;
    var best = {}, prev = {}, prevEdge = {}, done = {}, queue = [src];
    best[src] = 0;
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
    for (var v = dst; v !== src; v = prev[v]) { edges.unshift(prevEdge[v]); nodes.unshift(prev[v]); }
    return { nodes: nodes, edges: edges, cost: best[dst] };
  }

  function etaMinutes(path) {
    return Math.max(1, Math.ceil(path.cost * UNIT_M / WALK_MPS / 60));
  }

  var FEET_PER_M = 3.28084;
  function feet(units) { return Math.max(10, Math.round(units * UNIT_M * FEET_PER_M / 10) * 10); }

  function buildDirections(graph, path, wing) {
    var N = graph.nodes, steps = [];
    var start = N[path.nodes[0]];
    // "the east stairs" or "B192": where the user is when no hallway step has happened yet
    var lastPlace = start.room ? start.room.id : "the " + start.feature.label.toLowerCase();
    var startName = start.room ? start.room.id + (start.room.name ? " (" + start.room.name + ")" : "") : lastPlace;
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
        text = "Leave " + leavingRoom + ", then " + text.charAt(0).toLowerCase() + text.slice(1);
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
          steps.push({ level: a.level, text: "Leave " + leavingRoom + " and go to the " + e.feature.label.toLowerCase() + " outside the door." });
        }
        steps.push({ level: a.level, text: "Take the " + e.feature.label.toLowerCase() + " " + (b.level > a.level ? "up" : "down") + " to Level " + b.level + "." });
        heading = null;
        leavingRoom = null;
        lastPlace = "the " + e.feature.label.toLowerCase();
        return;
      }
      if (e.door) {
        if (!b.room) return; // stepping out of a doorway
        flush();
        var r = b.room, name = r.id + (r.name ? " (" + r.name + ")" : ""), text;
        if (!heading || leavingRoom) {
          text = name + " is right next to " + lastPlace + ".";
        } else {
          var c = cross(heading, [b.x - a.x, b.y - a.y]);
          text = Math.abs(c) < 1e-6 ? name + " is straight ahead." : name + " is on your " + (c > 0 ? "right" : "left") + ".";
        }
        steps.push({ level: b.level, text: text, arrive: true });
        return;
      }
      var corridor = byId(wing.floors[a.level].corridors, e.corridor);
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

  var SHADED = { study: 1, other: 1, cafeteria: 1 };
  var FEATURE_TEXT = { stairs: "STAIRS", elevator: "ELEV", entrance: "ENTRANCE" };

  /* opts: closed (Set), highlight (room id), route (path), graph, onRoomClick(room) */
  function renderFloor(svg, wing, level, opts) {
    opts = opts || {};
    var floor = wing.floors[level], closed = opts.closed || new Set();
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute("viewBox", "0 0 360 330");

    el("rect", { x: 0, y: 0, width: 360, height: 330, rx: 10, "class": "map-bg" }, svg);
    floor.corridors.forEach(function (c) {
      el("line", { x1: c.from[0], y1: c.from[1], x2: c.to[0], y2: c.to[1], "class": "map-hall" }, svg);
    });
    floor.corridors.forEach(function (c) {
      if (!c.showLabel) return;
      var mx = (c.from[0] + c.to[0]) / 2, my = (c.from[1] + c.to[1]) / 2;
      if (c.from[0] === c.to[0]) label(svg, mx - 4, my, c.label, "map-hall-label", { transform: "rotate(-90 " + (mx - 4) + " " + my + ")" });
      else label(svg, mx, my - 4, c.label, "map-hall-label");
    });

    floor.rooms.forEach(function (r) {
      var cls = "map-room" + (SHADED[r.type] ? " shaded" : "") + (opts.highlight === r.id ? " dest" : "") + (opts.onRoomClick ? " clickable" : "");
      var g = el("g", { "class": cls, "data-room": r.id }, svg);
      el("rect", { x: r.x, y: r.y, width: r.w, height: r.h, rx: 3 }, g);
      var fs = Math.max(5.5, Math.min(11, r.w / (r.label.length * 0.62), r.h * 0.45));
      label(g, r.x + r.w / 2, r.y + r.h / 2, r.label, "map-room-label", { "font-size": fs.toFixed(1) });
      el("title", {}, g).textContent = r.id + (r.name ? " · " + r.name : "");
      if (opts.onRoomClick) {
        g.setAttribute("tabindex", "0");
        g.setAttribute("role", "button");
        g.setAttribute("aria-label", r.id + (r.name ? ", " + r.name : ""));
        g.addEventListener("click", function () { opts.onRoomClick(r); });
        g.addEventListener("keydown", function (ev) {
          if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); opts.onRoomClick(r); }
        });
      }
    });

    var used = {};
    if (opts.route) opts.route.edges.forEach(function (e) { if (e.vertical) used[e.feature.id] = true; });
    floor.features.forEach(function (f) {
      var g = el("g", { "class": "map-feat map-" + f.kind + (used[f.id] ? " active" : "") }, svg);
      el("rect", { x: f.x, y: f.y, width: f.w, height: f.h, rx: 3 }, g);
      if (f.kind === "stairs" && f.h >= 30) {
        for (var yy = f.y + 8; yy < f.y + f.h - 4; yy += 6) el("line", { x1: f.x + 5, x2: f.x + f.w - 5, y1: yy, y2: yy }, g);
      }
      var txt = FEATURE_TEXT[f.kind] || f.label;
      if (f.h >= 30 || f.kind === "entrance") label(g, f.x + f.w / 2, f.y + f.h + 7, txt, "map-feat-label");
      else label(g, f.x + f.w / 2, f.y + f.h / 2, txt, "map-feat-label");
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
        p = [f.x + f.w / 2, f.y + f.h / 2];
      }
      var g = el("g", { "class": "map-closed" }, svg);
      el("line", { x1: p[0] - 5, y1: p[1] - 5, x2: p[0] + 5, y2: p[1] + 5 }, g);
      el("line", { x1: p[0] - 5, y1: p[1] + 5, x2: p[0] + 5, y2: p[1] - 5 }, g);
      var tx = p[0] + 44 > 360 ? p[0] - 43 : p[0] + 8;
      el("rect", { x: tx, y: p[1] - 6, width: 35, height: 12, rx: 3, "class": "map-closed-tag" }, g);
      label(g, tx + 17.5, p[1], "CLOSED", "map-closed-label");
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
        el("circle", { cx: first.x, cy: first.y, r: 6, "class": "map-you" }, svg);
        label(svg, first.x - 9, first.y - 11, "You", "map-you-label", { "text-anchor": "end" });
      }
    }
  }

  window.NavMap = {
    levelsOf: levelsOf,
    findRoom: findRoom,
    buildGraph: buildGraph,
    shortestPath: shortestPath,
    buildDirections: buildDirections,
    etaMinutes: etaMinutes,
    renderFloor: renderFloor
  };
})();
