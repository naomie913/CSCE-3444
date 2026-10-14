"""Discovery Park map data: floors, rooms, hallways, stairs and elevators.

Wing B follows the simplified layouts in the Sprint 1 wireframes (Figures 23-24).
Every other wing uses a PLACEHOLDER template until the real floor plans arrive
(Production Plan T07); replace them with JSON exported from the map editor (T53).

Each floor uses a 360 x 330 coordinate space. Hallways are straight line
segments. Every room and feature has a `door` point that joins the hallway
named by `corridor`. The browser builds the walking graph from this data
(static/js/navmap.js), so the server never computes routes.
"""
import re

WINGS = ["A", "B", "D", "E", "G", "H", "J", "K", "M"]
HOURS = "7:00 AM - 10:00 PM"

# key: (menu label, menu subtitle, icon, singular name)
LOCATION_TYPES = {
    "classroom": {"label": "Classrooms", "sub": "Explore classrooms", "icon": "▦", "singular": "Classroom"},
    "faculty": {"label": "Faculty offices", "sub": "Explore offices", "icon": "☰", "singular": "Faculty office"},
    "office": {"label": "Office rooms", "sub": "Explore office rooms", "icon": "▫", "singular": "Office"},
    "study": {"label": "Study spaces", "sub": "Library and study tables", "icon": "✦", "singular": "Study space"},
    "cafeteria": {"label": "Cafeteria", "sub": "Discovery Perks Market & Grill", "icon": "☕", "singular": "Cafeteria"},
    "other": {"label": "Other", "sub": "Restrooms, entrances, labs", "icon": "◉", "singular": "Room"},
}


def _hall(hid, label, start, end, name=None, show_label=False):
    return {"id": hid, "label": label, "name": name or label.capitalize(),
            "from": list(start), "to": list(end), "showLabel": show_label}


def _room(rid, rtype, x, y, w, h, door, corridor, name=None, label=None, note=None):
    return {"id": rid, "type": rtype, "x": x, "y": y, "w": w, "h": h,
            "door": list(door), "corridor": corridor,
            "name": name, "label": label or rid, "note": note}


def _feat(fid, kind, label, x, y, w, h, door, corridor):
    return {"id": fid, "kind": kind, "label": label, "x": x, "y": y, "w": w, "h": h,
            "door": list(door), "corridor": corridor}


# ---------- Wing B (from the wireframes) ----------

WING_B_LEVEL_1 = {
    "start": "entrance",
    "corridors": [
        _hall("east", "east hallway", (272, 20), (272, 296), show_label=True),
        _hall("n1", "north hallway", (20, 98), (272, 98)),
        _hall("m1", "central hallway", (20, 184), (272, 184)),
        _hall("b1", "south hallway", (20, 296), (272, 296)),
    ],
    "rooms": [
        _room("B112", "study", 20, 15, 170, 75, (105, 90), "n1", name="Library", label="Library (B112)"),
        _room("B129", "classroom", 190, 15, 70, 55, (260, 42), "east"),
        _room("B131", "office", 190, 70, 70, 20, (225, 90), "n1"),
        _room("B157", "faculty", 20, 106, 30, 70, (35, 106), "n1"),
        _room("B155", "classroom", 50, 106, 60, 70, (80, 106), "n1"),
        _room("B142", "classroom", 110, 106, 70, 70, (145, 106), "n1"),
        _room("B140", "classroom", 180, 106, 60, 70, (210, 106), "n1"),
        _room("B1-WC", "other", 240, 106, 20, 70, (250, 106), "n1", name="Restroom", label="WC"),
        _room("B185", "cafeteria", 20, 192, 100, 88, (70, 192), "m1", name="Discovery Perks Market & Grill"),
        _room("B187", "other", 120, 192, 70, 88, (155, 192), "m1"),
        _room("B190", "faculty", 190, 192, 70, 44, (225, 192), "m1"),
        _room("B192", "office", 190, 236, 70, 44, (260, 258), "east"),
    ],
    "features": [
        _feat("stairs-east", "stairs", "East stairs", 292, 20, 40, 45, (292, 42), "east"),
        _feat("elevator", "elevator", "Elevator", 40, 308, 40, 16, (60, 308), "b1"),
        _feat("stairs-west", "stairs", "West stairs", 130, 308, 40, 16, (150, 308), "b1"),
        _feat("entrance", "entrance", "East entrance", 292, 286, 40, 20, (292, 296), "east"),
    ],
}

WING_B_LEVEL_2 = {
    "start": "stairs-east",
    "corridors": [
        _hall("east", "east hallway", (272, 20), (272, 296), show_label=True),
        _hall("n2", "north hallway", (10, 68), (272, 68)),
        _hall("mid", "central hallway", (10, 124), (272, 124)),
        _hall("sw-a", "south hallway", (10, 220), (80, 220), name="South hallway (west end)"),
        _hall("sw-b", "south hallway", (80, 220), (140, 220), name="South hallway by B240 / B242"),
        _hall("se", "south hallway", (140, 220), (272, 220), name="South hallway (east end)"),
        _hall("b2", "lower hallway", (10, 296), (272, 296)),
        _hall("w2", "west hallway", (10, 68), (10, 296)),
    ],
    "rooms": [
        _room("B201", "classroom", 20, 15, 100, 45, (70, 60), "n2"),
        _room("B203", "faculty", 120, 15, 35, 45, (137, 60), "n2"),
        _room("B204", "faculty", 155, 15, 35, 45, (172, 60), "n2"),
        _room("B205", "office", 190, 15, 70, 45, (260, 42), "east",
              name="College of Information Advising", note="next to the east stairs"),
        _room("B227", "faculty", 20, 76, 45, 40, (42, 76), "n2"),
        _room("B217", "faculty", 65, 76, 45, 40, (87, 76), "n2"),
        _room("B207", "classroom", 110, 76, 120, 40, (170, 76), "n2"),
        _room("B206", "office", 230, 76, 30, 40, (245, 76), "n2"),
        _room("B226", "classroom", 20, 132, 60, 40, (50, 132), "mid"),
        _room("B216", "classroom", 80, 132, 60, 40, (110, 132), "mid"),
        _room("B210", "classroom", 140, 132, 60, 40, (170, 132), "mid"),
        _room("B209", "faculty", 200, 132, 60, 40, (230, 132), "mid"),
        _room("B241", "classroom", 20, 172, 60, 40, (50, 212), "sw-a"),
        _room("B240", "classroom", 80, 172, 60, 40, (110, 212), "sw-b"),
        _room("B250", "study", 140, 172, 60, 40, (170, 212), "se", name="Study tables"),
        _room("B251", "classroom", 200, 172, 60, 40, (230, 212), "se"),
        _room("B236", "office", 20, 228, 60, 52, (50, 228), "sw-a"),
        _room("B242", "classroom", 80, 228, 60, 52, (110, 228), "sw-b"),
        _room("B2-WC", "other", 140, 228, 40, 52, (160, 228), "se", name="Restroom", label="WC"),
        _room("B270", "faculty", 200, 228, 60, 52, (230, 228), "se"),
    ],
    "features": [
        _feat("stairs-east", "stairs", "East stairs", 292, 20, 40, 45, (292, 42), "east"),
        _feat("elevator", "elevator", "Elevator", 40, 308, 40, 16, (60, 308), "b2"),
        _feat("stairs-west", "stairs", "West stairs", 130, 308, 40, 16, (150, 308), "b2"),
    ],
}


# ---------- placeholder template for the other wings ----------

def _generic_floor(wing, level, with_entrance):
    top = [(1, "classroom"), (4, "classroom"), (8, "faculty"), (12, "faculty"), (16, "office")]
    bottom = [(20, "classroom"), (24, "classroom"), (28, "study"), (32, "faculty"), (36, "office"), (40, "classroom")]
    rooms = []
    for i, (num, rtype) in enumerate(top):
        x = 20 + 48 * i
        rooms.append(_room(f"{wing}{level}{num:02d}", rtype, x, 30, 48, 120, (x + 24, 150), "main",
                           name="Study area" if rtype == "study" else None))
    rooms.append(_room(f"{wing}{level}-WC", "other", 260, 30, 48, 120, (284, 150), "main",
                       name="Restroom", label="WC"))
    for i, (num, rtype) in enumerate(bottom):
        x = 20 + 48 * i
        rooms.append(_room(f"{wing}{level}{num:02d}", rtype, x, 170, 48, 120, (x + 24, 170), "main",
                           name="Study area" if rtype == "study" else None))
    features = [
        _feat("stairs", "stairs", "Stairs", 328, 30, 28, 40, (328, 50), "east"),
        _feat("elevator", "elevator", "Elevator", 328, 140, 28, 40, (328, 160), "east"),
    ]
    if with_entrance:
        features.append(_feat("entrance", "entrance", "Entrance", 328, 262, 28, 30, (328, 277), "east"))
    return {
        "start": "entrance" if with_entrance else "stairs",
        "corridors": [
            _hall("main", "main hallway", (10, 160), (320, 160)),
            _hall("east", "east hallway", (320, 40), (320, 300)),
        ],
        "rooms": rooms,
        "features": features,
    }


def _build_wings():
    wings = {}
    for wing in WINGS:
        if wing == "B":
            floors = {1: WING_B_LEVEL_1, 2: WING_B_LEVEL_2}
            source = "Simplified from the official floor map"
        else:
            levels = [1] if wing == "A" else [1, 2]
            floors = {lv: _generic_floor(wing, lv, lv == 1) for lv in levels}
            source = "Placeholder layout until the official floor plan is added"
        wings[wing] = {"wing": wing, "name": f"Wing {wing}", "source": source, "floors": floors}
    return wings


WING_DATA = _build_wings()

# room id -> {"room", "wing", "level"}
ROOMS = {
    room["id"]: {"room": room, "wing": wing, "level": level}
    for wing, data in WING_DATA.items()
    for level, floor in data["floors"].items()
    for room in floor["rooms"]
}


def levels(wing):
    return sorted(WING_DATA[wing]["floors"]) if wing in WING_DATA else []


def normalize_room(text):
    return re.sub(r"\s+", "", text or "").upper()


def find_room(room_id):
    return ROOMS.get(normalize_room(room_id))


def rooms_in(wing, level_list, rtype=None):
    out = []
    for lv in level_list:
        for room in WING_DATA[wing]["floors"][lv]["rooms"]:
            if rtype is None or room["type"] == rtype:
                out.append({"room": room, "wing": wing, "level": lv})
    return out


def landmark_label(wing, level, feature):
    return f"{feature['label']} · Wing {wing}, Level {level}"


def default_start(wing, level):
    """The feature a route starts from when the user doesn't name a room."""
    floor = WING_DATA[wing]["floors"][level]
    return next(f for f in floor["features"] if f["id"] == floor["start"])


def start_options(wings):
    """Suggestions for the 'Where are you now?' box: room numbers, then landmarks."""
    rooms, landmarks = [], []
    for wing in wings:
        for level, floor in sorted(WING_DATA[wing]["floors"].items()):
            rooms += [r["id"] for r in floor["rooms"] if "-" not in r["id"]]
            landmarks += [landmark_label(wing, level, f) for f in floor["features"]]
    return rooms + landmarks


def resolve_start(text):
    """Turn a typed room number or landmark label into a graph start node.

    Returns {"node", "wing", "level", "label"} or None.
    """
    text = (text or "").strip()
    if not text:
        return None
    match = find_room(text)
    if match:
        room = match["room"]
        label = room["id"] + (f" ({room['name']})" if room["name"] else "")
        return {"node": f"room:{room['id']}", "wing": match["wing"], "level": match["level"], "label": label}
    wanted = re.sub(r"\s+", " ", text).lower()
    for wing, data in WING_DATA.items():
        for level, floor in data["floors"].items():
            for f in floor["features"]:
                if landmark_label(wing, level, f).lower() == wanted:
                    return {"node": f"feat:{level}:{f['id']}", "wing": wing, "level": level,
                            "label": f"{f['label']} (Level {level})"}
    return None


def closure_targets(wing, level):
    """Hallways, stairs, elevators and entrances an admin can mark closed."""
    floor = WING_DATA[wing]["floors"][level]
    targets = [("corridor", c["id"], c["name"]) for c in floor["corridors"]]
    targets += [("feature", f["id"], f["label"]) for f in floor["features"]]
    return targets


def closure_name(wing, level, target_type, target_id):
    if wing not in WING_DATA or level not in WING_DATA[wing]["floors"]:
        return None
    for ttype, tid, name in closure_targets(wing, level):
        if ttype == target_type and tid == target_id:
            return name
    return None
