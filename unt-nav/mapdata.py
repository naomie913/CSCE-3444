"""Discovery Park map data, loaded from data/discovery_park.json.

That file is generated from the official floor map PDF by tools/build_map.py;
the hallway center lines are hand-traced in tools/corridors.py. Each floor is one
building-wide map, so routes can cross wings. Stairs and elevators connect the
floors by number (Stairs 1.8 <-> Stairs 2.8, Elevator 4 <-> Elevator 4).
"""
import json
import os
import re

DATA_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "discovery_park.json")
with open(DATA_FILE, encoding="utf-8") as _fh:
    _MAP = json.load(_fh)

FLOORS = {int(level): floor for level, floor in _MAP["floors"].items()}
SOURCE = _MAP["source"]
WINGS = ["A", "B", "D", "E", "F", "G", "H", "J", "K", "M"]
COMMON = "C"  # shared hallways and spaces, numbered C1xx / C2xx
HOURS = "7:00 AM - 10:00 PM"
ROOM_NUMBER_RE = re.compile(r"^[A-MC]\d{3}[A-Z]?$")

LOCATION_TYPES = {
    "room": {"label": "Rooms", "sub": "Every numbered room", "icon": "▦", "singular": "Room"},
    "lab": {"label": "Labs & facilities", "sub": "Makerspaces, research and manufacturing", "icon": "⚙", "singular": "Lab"},
    "office": {"label": "Offices & services", "sub": "Advising, career center, IT", "icon": "☰", "singular": "Office"},
    "study": {"label": "Study spaces", "sub": "Discovery Park Library", "icon": "✦", "singular": "Study space"},
    "cafeteria": {"label": "Food", "sub": "Discovery Perks Market & Grill", "icon": "☕", "singular": "Cafeteria"},
}

# room id -> {"room", "wing", "level"}
ROOMS = {
    room["id"]: {"room": room, "wing": room["wing"], "level": level}
    for level, floor in sorted(FLOORS.items())
    for room in floor["rooms"]
}


def levels(wing):
    return sorted({m["level"] for m in ROOMS.values() if m["wing"] == wing})


def wing_levels():
    """Every (wing, level) that has rooms; one admin-managed map each."""
    return [(wing, level) for wing in WINGS for level in levels(wing)]


def normalize_room(text):
    return re.sub(r"\s+", "", text or "").upper()


def find_room(room_id):
    return ROOMS.get(normalize_room(room_id))


def search_places(text, limit=8):
    """Rooms whose name contains the text, e.g. 'library' or 'perks'."""
    needle = re.sub(r"\s+", " ", (text or "").strip()).lower()
    if len(needle) < 3:
        return []
    hits = [m for m in ROOMS.values() if m["room"]["name"] and needle in m["room"]["name"].lower()]
    return sorted(hits, key=lambda m: m["room"]["name"])[:limit]


def room_title(room):
    """'B205', 'B112 · Discovery Park Library', or just the name for unnumbered places."""
    if not room["name"]:
        return room["id"]
    if ROOM_NUMBER_RE.match(room["id"]):
        return f"{room['id']} · {room['name']}"
    return room["name"]


def wing_label(wing):
    return "Common area" if wing == COMMON else f"Wing {wing}"


def rooms_in(wing, level_list, rtype=None):
    out = [m for m in ROOMS.values()
           if m["wing"] == wing and m["level"] in level_list and (rtype is None or m["room"]["type"] == rtype)]
    return sorted(out, key=lambda m: (m["level"], m["room"]["id"]))


def features(level):
    return FLOORS[level]["features"]


def landmark_label(level, feature):
    return f"{feature['label']} · Level {level}"


def default_start_label(level):
    has_entrance = any(f["kind"] == "entrance" for f in features(level))
    return "nearest entrance" if has_entrance else "nearest stairs or elevator"


def start_options():
    """Suggestions for 'Where are you now?': room numbers, then landmarks."""
    rooms = sorted(rid for rid in ROOMS if ROOM_NUMBER_RE.match(rid))
    places = sorted(m["room"]["name"] for m in ROOMS.values() if m["room"]["name"])
    landmarks = [landmark_label(level, f) for level in sorted(FLOORS) for f in features(level)]
    return rooms + places + landmarks


def resolve_start(text):
    """Turn a room number, place name or landmark into a start node.

    Returns {"node", "wing", "level", "label"} or None.
    """
    text = (text or "").strip()
    if not text:
        return None
    match = find_room(text)
    if match is None:
        exact = [m for m in ROOMS.values() if (m["room"]["name"] or "").lower() == text.lower()]
        named = exact or search_places(text)
        match = named[0] if len(named) == 1 or exact else None
    if match:
        room = match["room"]
        return {"node": f"room:{room['id']}", "wing": match["wing"], "level": match["level"],
                "label": room_title(room)}
    wanted = re.sub(r"\s+", " ", text).lower()
    for level in sorted(FLOORS):
        for f in features(level):
            if landmark_label(level, f).lower() == wanted or f["label"].lower() == wanted:
                return {"node": f"feat:{level}:{f['id']}", "wing": None, "level": level, "label": f["label"]}
    return None


def closure_targets(level):
    """Hallways, stairs, elevators and entrances an admin can close: (type, id, name, wing)."""
    floor = FLOORS[level]
    targets = [("corridor", c["id"], c["name"], c["wing"]) for c in floor["corridors"]]
    targets += [("feature", f["id"], f["label"], COMMON) for f in floor["features"]]
    return targets


def closure_target(level, target_type, target_id):
    if level not in FLOORS:
        return None
    for ttype, tid, name, wing in closure_targets(level):
        if ttype == target_type and tid == target_id:
            return {"name": name, "wing": wing}
    return None


def floor_for_api(level, inactive):
    """A floor's data with rooms on removed maps left out."""
    floor = dict(FLOORS[level])
    floor["rooms"] = [r for r in floor["rooms"] if (r["wing"], level) not in inactive]
    return floor
