
(function () {
  "use strict";

  var SVGNS = "http://www.w3.org/2000/svg";
  var WALK_FPS = 4;
  var STAIRS_S = 20;
  var ELEVATOR_S = 45;

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

  /* Each step's `at` is the index in path.nodes where that step begins, so a route can be
   * recalculated from the step the user is on. A route that starts mid-hallway (a re-route)
   * starts from "where you are". */
  function buildDirections(graph, path, map) {
    var N = graph.nodes, steps = [];
    var start = N[path.nodes[0]];
    var lastPlace = start.room ? start.room.id : start.feature ? placeName(start.feature) : "where you are";
    var startName = start.room ? roomName(start.room) : start.feature ? placeName(start.feature) : null;
    steps.push({ level: start.level, at: 0, text: startName
      ? "Start at " + startName + " on Level " + start.level + "."
      : "Continue from where you are on Level " + start.level + "." });

    var group = null, heading = null, leavingRoom = null, prevLabel = null;
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
        else if (group.label === prevLabel) text = "Turn " + (cross(heading, h) > 0 ? "right" : "left") + " to stay on the " + group.label + " and walk " + ft + " ft.";
        else text = "Turn " + (cross(heading, h) > 0 ? "right" : "left") + " onto the " + group.label + " and walk " + ft + " ft.";
      }
      if (leavingRoom) {
        text = "Leave " + leavingRoom + ", then " + lowerFirst(text);
        leavingRoom = null;
      }
      steps.push({ level: group.level, at: group.at, text: text });
      heading = h;
      prevLabel = group.label;
      group = null;
    }

    path.edges.forEach(function (e, i) {
      var a = N[path.nodes[i]], b = N[path.nodes[i + 1]];
      if (e.vertical) {
        flush();
        if (leavingRoom) {
          steps.push({ level: a.level, at: 0, text: "Leave " + leavingRoom + " and go to " + placeName(a.feature) + " outside the door." });
        }
        steps.push({ level: a.level, at: i, text: "Take " + placeName(a.feature) + " " + (b.level > a.level ? "up" : "down") + " to Level " + b.level + "." });
        heading = null;
        prevLabel = null;
        leavingRoom = null;
        lastPlace = placeName(b.feature);
        return;
      }
      if (e.door) {
        if (!b.room) return; 
        flush();
        var name = roomName(b.room), text;
        var side = null;
        if (heading && !leavingRoom) {
          var c = cross(heading, [b.x - a.x, b.y - a.y]);
          side = Math.abs(c) < 1e-6 ? "straight ahead" : c > 0 ? "on your right" : "on your left";
        }
        if (b.room.inner) {
          // The map shows no hallway door for this room, so don't pretend there is one.
          text = name + " is inside the room or suite " + (side || "next to " + lastPlace) +
                 ". Go in and follow the room signs.";
        } else if (!side) {
          text = name + " is right next to " + lastPlace + ".";
        } else {
          text = side === "straight ahead" ? name + " is straight ahead." : name + " is " + side + ".";
        }
        steps.push({ level: b.level, at: i, text: text, arrive: true });
        return;
      }
      var corridor = byId(map.floors[a.level].corridors, e.corridor);
      var label = corridor ? corridor.label : "hallway";
      // A new step when the hallway changes, or when the path turns within the same one.
      // Very short pieces (where a door or junction splits a hallway) don't count as turns.
      var dir = unit([b.x - a.x, b.y - a.y]), tiny = e.w < 15;
      if (group && group.label === label && group.level === a.level &&
          (tiny || !group.dir || dir[0] * group.dir[0] + dir[1] * group.dir[1] > 0.7)) {
        group.end = b; group.len += e.w;
        if (!tiny && !group.dir) group.dir = dir;
      } else {
        flush();
        group = { label: label, level: a.level, start: a, end: b, len: e.w, dir: tiny ? null : dir, at: i };
      }
    });
    flush();
    return steps;
  }

  // ---------- SVG drawing ----------
  //
  // The building (room shapes, hallways, route line) is drawn in map units and
  // scales as you zoom. Everything you read - room numbers, place names, stairs and
  // elevator markers, "You", "Closed" - is drawn as a "pin": a group placed at a map
  // point and scaled by 1/zoom, so it stays the same size on screen. layout() then
  // shows each label only where it fits inside its room without overlapping others,
  // so zooming in reveals the smaller rooms' numbers.

  var LABEL_PX = 11;          // every room label uses this size on screen
  var LINE_PX = 13;           // line height for multi-line names
  var NAME_CHARS = 14;        // wrap place names at about this many characters

  function el(name, attrs, parent) {
    var n = document.createElementNS(SVGNS, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function center(box) { return [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2]; }
  function isNumber(id) { return /^[A-MC]\d{3}[A-Z]?$/.test(id); }

  function wrap(text) {
    var lines = [], line = "";
    text.split(" ").forEach(function (w) {
      if (line && (line + " " + w).length > NAME_CHARS) { lines.push(line); line = w; }
      else line = (line + " " + w).trim();
    });
    lines.push(line);
    return lines;
  }

  /* A <text> with one <tspan> per line, centered on the pin's anchor. */
  function textBlock(parent, lines, cls) {
    var t = el("text", { "class": cls, "text-anchor": "middle", "font-size": LABEL_PX }, parent);
    lines.forEach(function (ln, i) {
      var span = el("tspan", { x: 0, y: (i - (lines.length - 1) / 2) * LINE_PX, "dominant-baseline": "central" }, t);
      span.textContent = ln;
    });
    return t;
  }

  /* One label per room (rooms that share a space, like E117-E124, share a label). */
  function roomLabels(floor, destId) {
    var groups = {};
    floor.rooms.forEach(function (r) {
      var key = r.box.join(",");
      (groups[key] = groups[key] || []).push(r);
    });
    return Object.keys(groups).map(function (key) {
      var rooms = groups[key].sort(function (a, b) { return a.id < b.id ? -1 : 1; });
      var r = rooms[0], dest = rooms.some(function (x) { return x.id === destId; });
      var number = rooms.length > 1 ? rooms[0].id + "–" + rooms[rooms.length - 1].id : r.id;
      var variants = [];
      if (r.name && isNumber(r.id)) variants.push([number].concat(wrap(r.name)), [number]);
      else if (r.name) variants.push(wrap(r.name));
      else variants.push([number]);
      if (dest) variants = [[destId]];
      var area = (r.box[2] - r.box[0]) * (r.box[3] - r.box[1]);
      return { x: r.x, y: r.y, box: r.box, variants: variants, dest: dest,
               prio: dest ? 0 : r.name ? 1 : 2, area: area };
    }).sort(function (a, b) { return a.prio - b.prio || b.area - a.area; });
  }

  var MARKER_TEXT = {
    stairs: function (f) { return f.label.replace("Stairs ", ""); },
    elevator: function (f, level) { return level + "." + f.id.split("-")[1]; },
    entrance: function () { return "In"; }
  };

  /* Stairs / elevator / entrance badge, drawn in screen pixels around (0, 0). */
  function markerBadge(g, f, level) {
    var text = MARKER_TEXT[f.kind](f, level), w = 22 + text.length * 5.6, h = 16;
    el("rect", { x: -w / 2, y: -h / 2, width: w, height: h, rx: 4, "class": "badge-bg" }, g);
    var ix = -w / 2 + 4;
    if (f.kind === "stairs") {
      el("path", { d: "M" + ix + " 4h3v-3h3v-3h3v-3", "class": "badge-icon" }, g);
    } else if (f.kind === "elevator") {
      el("path", { d: "M" + (ix + 1) + " -1l3 -4l3 4z M" + (ix + 1) + " 1l3 4l3 -4z", "class": "badge-icon solid" }, g);
    } else {
      el("path", { d: "M" + ix + " 0h7m-3 -3l3 3l-3 3", "class": "badge-icon" }, g);
    }
    var t = el("text", { x: 5.5, y: 0, "text-anchor": "middle", "dominant-baseline": "central", "class": "badge-text" }, g);
    t.textContent = text;
    return [-w / 2, -h / 2, w / 2, h / 2];
  }

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
    var pins = [], labels = [];
    function pin(x, y, cls, parent) {
      var g = el("g", { "class": cls }, parent || svg);
      var p = { g: g, x: x, y: y, rect: null };
      pins.push(p);
      return p;
    }

    // Building shapes, in map units.
    var shapes = el("g", { "class": "map-shapes" }, svg);
    floor.shapes.forEach(function (s) {
      var cls = s.hall ? "map-hall-shape" : s.fill === "#ffffff" ? "map-space" : "map-dept";
      var attrs = { d: s.d, "class": cls };
      if (cls === "map-dept") attrs.style = "fill:" + s.fill;
      el("path", attrs, shapes);
    });

    var dest = opts.highlight ? byId(floor.rooms, opts.highlight) : null;
    if (dest) {
      var dg = el("g", { "class": "map-dest" }, svg);
      if (dest.shape !== null && dest.shape !== undefined) el("path", { d: floor.shapes[dest.shape].d }, dg);
      else el("rect", { x: dest.box[0], y: dest.box[1], width: dest.box[2] - dest.box[0], height: dest.box[3] - dest.box[1] }, dg);
    }

    // Route line (constant width on screen).
    // Route nodes to draw: leave off the last step into a room that has no hallway door
    // on the map (and the first step out of one), so the line never crosses a wall.
    var routeNodes = null;
    if (opts.route && opts.graph) {
      routeNodes = opts.route.nodes.slice();
      var lastNode = opts.graph.nodes[routeNodes[routeNodes.length - 1]];
      if (lastNode.room && lastNode.room.inner && routeNodes.length > 2) routeNodes.pop();
      var firstNode = opts.graph.nodes[routeNodes[0]];
      if (firstNode.room && firstNode.room.inner && routeNodes.length > 2) routeNodes.shift();
    }

    if (opts.route && opts.graph) {
      var runs = [], cur = [];
      routeNodes.forEach(function (id) {
        var n = opts.graph.nodes[id];
        if (n.level === level) cur.push(n);
        else { if (cur.length) runs.push(cur); cur = []; }
      });
      if (cur.length) runs.push(cur);
      runs.forEach(function (run) {
        if (run.length < 2) return;
        el("polyline", { points: run.map(function (n) { return n.x + "," + n.y; }).join(" "), "class": "map-route" }, svg);
      });
    }

    // Room labels.
    var labelLayer = el("g", { "class": "map-labels" }, svg);
    roomLabels(floor, dest && dest.id).forEach(function (l) {
      var p = pin(l.x, l.y, "map-label-pin", labelLayer);
      if (l.dest) {
        var t = textBlock(p.g, l.variants[0], "map-label dest");
        l.texts = [t];
        l.bg = el("rect", { "class": "map-label-dest-bg", rx: 4 }, p.g);
        p.g.insertBefore(l.bg, t);
      } else {
        l.texts = l.variants.map(function (v) { return textBlock(p.g, v, "map-label"); });
      }
      l.pin = p;
      labels.push(l);
    });

    // Stairs, elevators and entrances.
    var used = {};
    if (opts.route) {
      opts.route.edges.forEach(function (e, i) {
        if (e.vertical) used[opts.graph.nodes[opts.route.nodes[i]].feature.id] = true;
      });
    }
    floor.features.forEach(function (f) {
      var c = center(f.box);
      var p = pin(c[0], c[1], "map-marker map-" + f.kind + (used[f.id] ? " active" : ""));
      p.rect = markerBadge(p.g, f, level);
      el("title", {}, p.g).textContent = f.label;
    });

    closed.forEach(function (k) {
      var parts = k.split(":");
      if (Number(parts[0]) !== level) return;
      var c;
      if (parts[1] === "corridor") {
        var cor = byId(floor.corridors, parts[2]);
        if (!cor) return;
        c = [(cor.from[0] + cor.to[0]) / 2, (cor.from[1] + cor.to[1]) / 2];
      } else {
        var f = byId(floor.features, parts[2]);
        if (!f) return;
        c = center(f.box);
      }
      var p = pin(c[0], c[1], "map-closed");
      el("circle", { r: 7, "class": "closed-dot" }, p.g);
      el("path", { d: "M-3 -3L3 3M-3 3L3 -3", "class": "closed-x" }, p.g);
      el("rect", { x: 9, y: -7, width: 40, height: 14, rx: 4, "class": "closed-tag" }, p.g);
      var t = el("text", { x: 29, y: 0, "text-anchor": "middle", "dominant-baseline": "central", "class": "closed-text" }, p.g);
      t.textContent = "Closed";
      p.rect = [-8, -8, 50, 8];
    });

    if (opts.route && opts.graph) {
      var first = opts.graph.nodes[routeNodes[0]];
      if (first.level === level) {
        var yp = pin(first.x, first.y, "map-you");
        el("circle", { r: 6, "class": "you-dot" }, yp.g);
        var yt = el("text", { x: -10, y: -10, "text-anchor": "end", "class": "you-text" }, yp.g);
        yt.textContent = "You";
        yp.rect = [-36, -22, 8, 8];
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

    svg._layout = { pins: pins, labels: labels, scale: null };
    layout(svg);
  }

  function overlaps(a, list) {
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]) return true;
    }
    return false;
  }

  /* Size the pins for the current zoom and decide which labels fit. */
  function layout(svg) {
    var st = svg._layout, ctm = svg.getScreenCTM();
    if (!st || !ctm || !svg.getBoundingClientRect().width) return;
    var s = Math.abs(ctm.a);
    if (!s || (st.scale && Math.abs(st.scale - s) / s < 0.002)) return;  // panning only: nothing to redo
    st.scale = s;
    var k = 1 / s, placed = [];
    st.pins.forEach(function (p) {
      p.g.setAttribute("transform", "translate(" + p.x + " " + p.y + ") scale(" + k + ")");
      if (p.rect) placed.push([p.x * s + p.rect[0], p.y * s + p.rect[1], p.x * s + p.rect[2], p.y * s + p.rect[3]]);
    });
    st.labels.forEach(function (l) {
      if (!l.widths) {
        l.widths = l.texts.map(function (t) {
          var w = 0;
          Array.prototype.forEach.call(t.childNodes, function (span) { w = Math.max(w, span.getComputedTextLength()); });
          return w;
        });
        if (l.widths.some(function (w) { return !w; })) l.widths = null;  // not rendered yet: estimate this time
      }
      var cx = l.x * s, cy = l.y * s;
      var box = [l.box[0] * s, l.box[1] * s, l.box[2] * s, l.box[3] * s];
      var shown = -1;
      for (var i = 0; i < l.texts.length && shown < 0; i++) {
        var lines = l.variants[i];
        var w = (l.widths ? l.widths[i] : Math.max.apply(null, lines.map(function (ln) { return ln.length; })) * LABEL_PX * 0.6) + 4;
        var h = lines.length * LINE_PX + 2;
        var r = [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
        var fits = r[0] >= box[0] - 1 && r[2] <= box[2] + 1 && r[1] >= box[1] - 1 && r[3] <= box[3] + 1;
        if (l.dest || (fits && !overlaps(r, placed))) {
          shown = i;
          placed.push(r);
          if (l.bg) {
            l.bg.setAttribute("x", -w / 2 - 2); l.bg.setAttribute("y", -h / 2);
            l.bg.setAttribute("width", w + 4); l.bg.setAttribute("height", h);
          }
        }
      }
      l.texts.forEach(function (t, i) { t.style.display = i === shown ? "" : "none"; });
      if (l.bg) l.bg.style.display = shown < 0 ? "none" : "";
    });
  }

  /* Re-run layout on the next frame (coalesces pinch/wheel zoom events). */
  function scheduleLayout(svg) {
    if (svg._layoutQueued) return;
    svg._layoutQueued = true;
    requestAnimationFrame(function () { svg._layoutQueued = false; layout(svg); });
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

    function set(v) {
      vb = v;
      svg.setAttribute("viewBox", v.map(function (n) { return n.toFixed(1); }).join(" "));
      scheduleLayout(svg);
    }
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
    window.addEventListener("resize", function () { if (svg._layout) svg._layout.scale = null; scheduleLayout(svg); });
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
