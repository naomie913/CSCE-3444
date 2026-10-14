"""Build data/discovery_park.json from the official Discovery Park floor map PDF.

    python tools/build_map.py [path/to/unt_discoverypark_map.pdf]

Reads room numbers, room shapes, department colors, stairs and elevators from
the PDF, joins them to the hallway center lines in tools/corridors.py, and works
out which hallway each room's door opens onto. Needs PyMuPDF (pip install pymupdf);
the app itself only reads the JSON this writes.
"""
import json
import math
import os
import re
import sys

import pymupdf

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from corridors import CORRIDORS, ENTRANCES, FEET_PER_UNIT, NAMED_PLACES  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_PDF = os.path.join(ROOT, "data", "source", "unt_discoverypark_map.pdf")
OUT = os.path.join(ROOT, "data", "discovery_park.json")

HALL_FILL = (0.82, 0.82, 0.82)
SKIP_FILLS = [(0.13, 0.12, 0.12), (0.14, 0.12, 0.12), (0.04, 0.18, 0.13), (0.0, 0.0, 0.0),
              (0.93, 0.12, 0.14), (1.0, 0.0, 0.0), (0.83, 0.83, 0.83)]
DEPARTMENTS = {
    "College of Engineering": (0.27, 0.58, 0.4),
    "Biomedical Engineering": (0.77, 0.37, 0.37),
    "Computer Science & Engineering": (0.48, 0.41, 0.68),
    "Electrical Engineering": (0.0, 0.39, 0.63),
    "Materials Science & Engineering": (0.55, 0.6, 0.95),
    "College of Information": (0.6, 0.8, 0.46),
    "Student Affairs": (0.99, 0.74, 0.39),
    "Mechanical Engineering": (0.01, 0.64, 0.88),
    "Engineering Research Services": (0.0, 0.8, 0.67),
    "Engineering Student Success": (0.99, 0.85, 0.8),
    "University Libraries": (0.87, 0.99, 0.61),
    "Risk Management": (0.96, 0.58, 0.59),
    "Central Receiving": (0.97, 0.92, 0.18),
    "Dining Services": (0.99, 0.84, 0.44),
}
ROOM_RE = re.compile(r"[A-MC]\d{3}(?:[A-Z](?!\d))?")
RANGE_RE = re.compile(r"^([A-M])(\d{3})-\1(\d{3})$")
MARKER_RE = re.compile(r"^(\d)\.(\d{1,2})$")
ELEVATORS_PER_FLOOR = 7  # the PDF lists the elevator markers first on each page


def close(a, b, tol=0.02):
    return all(abs(x - y) <= tol for x, y in zip(a, b))


def hexcolor(fill):
    return "#" + "".join(f"{round(c * 255):02x}" for c in fill)


def department_for(fill):
    best, best_d = None, 0.06
    for name, col in DEPARTMENTS.items():
        dist = max(abs(a - b) for a, b in zip(fill, col))
        if dist < best_d:
            best, best_d = name, dist
    return best


def path_d(drawing):
    out, last = [], None
    for item in drawing["items"]:
        kind = item[0]
        if kind == "re":
            r = item[1]
            out.append(f"M{r.x0:.1f} {r.y0:.1f}H{r.x1:.1f}V{r.y1:.1f}H{r.x0:.1f}Z")
            last = None
            continue
        if kind == "qu":
            q = item[1]
            out.append(f"M{q.ul.x:.1f} {q.ul.y:.1f}L{q.ur.x:.1f} {q.ur.y:.1f}L{q.lr.x:.1f} {q.lr.y:.1f}L{q.ll.x:.1f} {q.ll.y:.1f}Z")
            last = None
            continue
        p0 = item[1]
        if last is None or abs(last.x - p0.x) > 0.05 or abs(last.y - p0.y) > 0.05:
            out.append(f"M{p0.x:.1f} {p0.y:.1f}")
        if kind == "l":
            p1 = item[2]
            out.append(f"L{p1.x:.1f} {p1.y:.1f}")
            last = p1
        elif kind == "c":
            c1, c2, p1 = item[2], item[3], item[4]
            out.append(f"C{c1.x:.1f} {c1.y:.1f} {c2.x:.1f} {c2.y:.1f} {p1.x:.1f} {p1.y:.1f}")
            last = p1
    return "".join(out) + "Z"


def in_map_area(rect, pno):
    if rect.y0 > 700:                      # title bar
        return False
    if rect.x1 < 232 and rect.y1 < 132:    # UNT logo
        return False
    if pno == 1 and rect.y0 > 540 and rect.x1 < 400:   # legend on page 2
        return False
    return True


def extract_shapes(page, pno):
    shapes = []
    for dr in page.get_drawings():
        fill = dr.get("fill")
        if not fill:
            continue
        fill = tuple(round(c, 2) for c in fill)
        r = dr["rect"]
        if not in_map_area(r, pno) or any(close(fill, s, 0.005) for s in SKIP_FILLS):
            continue
        if r.width * r.height < 12 or len(dr["items"]) > 150:
            continue  # specks, and decorative artwork (the Pettinger Center blueprint)
        kinds = {i[0] for i in dr["items"]}
        hall = close(fill, HALL_FILL, 0.005)
        white = fill == (1.0, 1.0, 1.0)
        if white and "c" in kinds and r.width * r.height > 900:
            continue  # rounded parking lots
        if not hall and not white and "c" in kinds and department_for(fill) is None:
            continue  # parking signs and other round badges
        if not hall and not white and department_for(fill) is None and r.width * r.height < 60:
            continue  # icons
        shapes.append({
            "d": path_d(dr), "fill": hexcolor(fill), "hall": hall,
            "dept": None if hall or white else department_for(fill),
            "bbox": [round(r.x0, 1), round(r.y0, 1), round(r.x1, 1), round(r.y1, 1)],
            "area": r.width * r.height,
        })
    return shapes


def words_with_ids(page):
    """Yield (room_id, cx, cy, font_size, original_word) with merged words split."""
    for w in page.get_text("words"):
        text, x0, y0, x1, y1 = w[4], w[0], w[1], w[2], w[3]
        rng = RANGE_RE.match(text)
        if rng:
            letter, a, b = rng.group(1), int(rng.group(2)), int(rng.group(3))
            for n in range(a, b + 1):
                yield f"{letter}{n}", (x0 + x1) / 2, (y0 + y1) / 2, y1 - y0, text
            continue
        ids = ROOM_RE.findall(text)
        if not ids or "".join(ids) != text:
            continue
        step = (x1 - x0) / len(text)
        pos = 0
        for rid in ids:
            cx = x0 + step * (pos + len(rid) / 2)
            yield rid, cx, (y0 + y1) / 2, y1 - y0, rid
            pos += len(rid)


def smallest_shape(shapes, x, y, allow_hall=False, max_area=9000):
    best = None
    for i, s in enumerate(shapes):
        if s["hall"] and not allow_hall:
            continue
        b = s["bbox"]
        if b[0] <= x <= b[2] and b[1] <= y <= b[3] and s["area"] < max_area:
            if best is None or s["area"] < shapes[best]["area"]:
                best = i
    return best


def seg_point_dist(a, b, p):
    dx, dy = b[0] - a[0], b[1] - a[1]
    t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    q = (a[0] + t * dx, a[1] + t * dy)
    return math.hypot(p[0] - q[0], p[1] - q[1]), q


def clamp_to_box(p, box):
    return (min(max(p[0], box[0]), box[2]), min(max(p[1], box[1]), box[3]))


def attach(box, corridors):
    """Pick the hallway closest to a room's box and the door point on the box."""
    best = None
    for c in corridors:
        a, b = c["from"], c["to"]
        length = math.hypot(b[0] - a[0], b[1] - a[1])
        steps = max(1, int(length / 1.5))
        for k in range(steps + 1):
            p = (a[0] + (b[0] - a[0]) * k / steps, a[1] + (b[1] - a[1]) * k / steps)
            door = clamp_to_box(p, box)
            dist = math.hypot(p[0] - door[0], p[1] - door[1])
            if best is None or dist < best[0]:
                best = (dist, c["id"], door)
    return best


def extract_outlines(page, pno):
    """Unfilled room outlines: white rooms are drawn as lines on one white background."""
    out = []
    for dr in page.get_drawings():
        r = dr["rect"]
        area = r.width * r.height
        if dr.get("color") and not dr.get("fill") and 30 < area < 9000 and in_map_area(r, pno):
            out.append(([round(r.x0, 1), round(r.y0, 1), round(r.x1, 1), round(r.y1, 1)], area))
    return out


def smallest_outline(outlines, x, y):
    best = None
    for box, area in outlines:
        if box[0] <= x <= box[2] and box[1] <= y <= box[3] and (best is None or area < best[1]):
            best = (box, area)
    return best


def build_floor(page, pno):
    level = pno + 1
    shapes = extract_shapes(page, pno)
    outlines = extract_outlines(page, pno)
    corridors = [{"id": cid, "wing": wing, "label": label, "name": name, "from": list(a), "to": list(b)}
                 for cid, wing, label, name, a, b in CORRIDORS[level]]
    hall_names = set()

    rooms, labels = {}, []
    for rid, cx, cy, size, text in words_with_ids(page):
        if not in_map_area(pymupdf.Rect(cx, cy, cx, cy), pno):
            continue
        si = smallest_shape(shapes, cx, cy)
        hall_si = smallest_shape(shapes, cx, cy, allow_hall=True)
        if rid.startswith("C") and (si is None or (hall_si is not None and shapes[hall_si]["hall"])):
            hall_names.add(rid)  # a hallway's own number, printed in the hallway
            continue
        if text == rid or text.startswith(rid):
            labels.append({"t": text if RANGE_RE.match(text) else rid, "x": round(cx, 1), "y": round(cy, 1),
                           "s": round(min(size * 0.8, 9), 1)})
        if si is not None:
            box, area = shapes[si]["bbox"], shapes[si]["area"]
        else:
            found = smallest_outline(outlines, cx, cy)
            box, area = found if found else ([cx - 5, cy - 4, cx + 5, cy + 4], 80)
        prev = rooms.get(rid)
        if prev is None or area > prev["_area"]:
            rooms[rid] = {"id": rid, "wing": rid[0], "type": "room", "name": None,
                          "dept": shapes[si]["dept"] if si is not None else None,
                          "shape": si, "box": [round(v, 1) for v in box],
                          "x": round(cx, 1), "y": round(cy, 1), "_area": area}

    # Single-letter suite labels (E215 A, B, C ...) are drawn but aren't rooms.
    for w in page.get_text("words"):
        if re.fullmatch(r"[A-Z]{1,2}", w[4]) and w[3] - w[1] < 9 and in_map_area(pymupdf.Rect(w[:4]), pno):
            labels.append({"t": w[4], "x": round((w[0] + w[2]) / 2, 1), "y": round((w[1] + w[3]) / 2, 1),
                           "s": round(min((w[3] - w[1]) * 0.8, 7), 1), "minor": True})

    for floor_no, search, name, wing, rtype, ids in NAMED_PLACES:
        if floor_no != level:
            continue
        hits = [r for r in page.search_for(search) if in_map_area(r, pno)]
        if not hits:
            print(f"  ! couldn't find '{search}' on floor {level}")
            continue
        hit = hits[0]
        cx, cy = (hit.x0 + hit.x1) / 2, (hit.y0 + hit.y1) / 2
        labels.append({"t": name, "x": round(cx, 1), "y": round(cy, 1), "s": 5.5, "name": True})
        targets = [rooms[i] for i in ids if i in rooms]
        if not targets:
            si = smallest_shape(shapes, cx, cy)
            pid = ids[0] if ids else re.sub(r"[^A-Z]", "", name.upper())[:10]
            box = shapes[si]["bbox"] if si is not None else [cx - 8, cy - 6, cx + 8, cy + 6]
            rooms[pid] = {"id": pid, "wing": wing, "type": rtype, "name": name,
                          "dept": shapes[si]["dept"] if si is not None else None, "shape": si,
                          "box": [round(v, 1) for v in box], "x": round(cx, 1), "y": round(cy, 1),
                          "_area": 0, "named": True}
        for r in targets:
            r["name"], r["type"] = name, rtype

    # Stairs and elevators: "level.number" markers; elevators come first in text order.
    features, seen = [], 0
    for w in page.get_text("words"):
        m = MARKER_RE.match(w[4])
        if not m:
            continue
        cx, cy = (w[0] + w[2]) / 2, (w[1] + w[3]) / 2
        num = int(m.group(2))
        kind = "elevator" if seen < ELEVATORS_PER_FLOOR else "stairs"
        seen += 1
        fid = f"{kind}-{num}"
        label = f"Elevator {num}" if kind == "elevator" else f"Stairs {w[4]}"
        box = [round(cx - 6, 1), round(cy - 15, 1), round(cx + 6, 1), round(cy + 3, 1)]
        features.append({"id": fid, "kind": kind, "label": label, "box": box})
    for fid, label, (x, y), cid in ENTRANCES[level]:
        features.append({"id": fid, "kind": "entrance", "label": label,
                         "box": [x - 5, y - 4, x + 5, y + 4], "corridor": cid, "door": [x, y]})

    far = []
    for item in list(rooms.values()) + features:
        if "corridor" in item:
            continue
        dist, cid, door = attach(item["box"], corridors)
        item["corridor"], item["door"] = cid, [round(door[0], 1), round(door[1], 1)]
        if dist > 25:
            far.append(f"{item['id']} ({dist:.0f} pt from {cid})")
    if far:
        print(f"  floor {level}: {len(far)} rooms are far from any hallway: {', '.join(far[:12])}")

    for r in rooms.values():
        r.pop("_area", None)
    xs = [v for s in shapes for v in (s["bbox"][0], s["bbox"][2])]
    ys = [v for s in shapes for v in (s["bbox"][1], s["bbox"][3])]
    for s in shapes:
        s.pop("area")
    return {
        "level": level,
        "bbox": [round(min(xs) - 4), round(min(ys) - 4), round(max(xs) + 4), round(max(ys) + 4)],
        "feetPerUnit": FEET_PER_UNIT[level],
        "shapes": shapes,
        "labels": labels,
        "corridors": corridors,
        "rooms": sorted(rooms.values(), key=lambda r: r["id"]),
        "features": features,
        "hallNumbers": sorted(hall_names),
    }


def main():
    pdf = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_PDF
    doc = pymupdf.open(pdf)
    floors = {}
    for pno in range(2):
        print(f"Floor {pno + 1}...")
        floors[str(pno + 1)] = build_floor(doc[pno], pno)
        f = floors[str(pno + 1)]
        print(f"  {len(f['rooms'])} rooms, {len(f['features'])} stairs/elevators/entrances, "
              f"{len(f['corridors'])} hallways, {len(f['shapes'])} shapes")
    data = {"source": "Traced from the official UNT Discovery Park floor map", "floors": floors}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(data, fh, separators=(",", ":"))
    print(f"Wrote {OUT} ({os.path.getsize(OUT) // 1024} KB)")


if __name__ == "__main__":
    main()
