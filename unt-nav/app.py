"""UNT Navigation (Discovery Park) - Flask web app.

Screens follow the Sprint 1 wireframes (Figures 15-29). Map data is static
(mapdata.py) and routes are calculated in the browser (static/js/navmap.js).
The server handles accounts, events, saved places, reports and admin map
management, and stores them in SQLite (db.py).
"""
import os
import re
import secrets
from datetime import date, datetime, timezone
from functools import wraps

from flask import (Flask, abort, flash, g, jsonify, redirect, render_template,
                   request, session, url_for)
from markupsafe import Markup
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename

import mapdata
from db import BASE_DIR, close_db, ensure_schema, get_db

ROLES = {"student": "Student / Faculty", "organizer": "Event Organizer", "admin": "Admin"}
HEADER_LABELS = {"guest": "Guest →", "student": "Account", "organizer": "Organizer", "admin": "Admin"}
MIN_PASSWORD_LENGTH = 8
USERNAME_RE = re.compile(r"^[A-Za-z0-9_.]{3,32}$")
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
MAP_UPLOAD_EXTS = {".svg", ".json", ".png", ".jpg", ".jpeg", ".pdf"}
REPORT_CATEGORIES = {
    "blocked_path": "Blocked path",
    "wrong_info": "Wrong information",
    "missing_room": "Missing room",
    "other": "Other",
}
REPORT_STATUSES = {"open": "Open", "fixed": "Fixed", "dismissed": "Dismissed"}
DEFAULT_PREFS = {"stepfree": False, "autoread": False, "largetext": False}
GUEST = {"id": None, "username": "Guest", "role": "guest", "role_label": "Guest"}

app = Flask(__name__)
app.config.update(
    SECRET_KEY=os.environ.get("UNT_NAV_SECRET", "dev-only-change-me"),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    MAX_CONTENT_LENGTH=10 * 1024 * 1024,
)
app.teardown_appcontext(close_db)
ensure_schema()


# ---------- request setup: CSRF + current user ----------

def csrf_token():
    if "_csrf" not in session:
        session["_csrf"] = secrets.token_hex(16)
    return session["_csrf"]


def csrf_field():
    return Markup(f'<input type="hidden" name="_csrf" value="{csrf_token()}">')


@app.before_request
def check_csrf():
    if request.method == "POST":
        sent = request.form.get("_csrf", "")
        if not sent or not secrets.compare_digest(sent, session.get("_csrf", "")):
            abort(400, "Your form expired. Reload the page and try again.")


@app.before_request
def load_user():
    g.user = None
    if request.endpoint == "static":
        return
    if session.get("guest"):
        g.user = GUEST
    elif "user_id" in session:
        row = get_db().execute(
            "SELECT id, username, role FROM users WHERE id = ?", (session["user_id"],)
        ).fetchone()
        if row is None:  # account was deleted
            session.clear()
        else:
            g.user = {"id": row["id"], "username": row["username"], "role": row["role"],
                      "role_label": ROLES[row["role"]]}


def current_user():
    return g.get("user")


def roles_required(*roles):
    """Require a logged-in account (not guest); optionally limit to roles."""
    def decorator(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            user = current_user()
            if user is None or user["role"] == "guest":
                flash("Log in to use this feature.", "error")
                nxt = request.full_path if request.method == "GET" else None
                return redirect(url_for("login", next=nxt))
            if roles and user["role"] not in roles:
                abort(403)
            return view(*args, **kwargs)
        return wrapped
    return decorator


member_required = roles_required()
admin_required = roles_required("admin")


def safe_next(target):
    if target and target.startswith("/") and not target.startswith("//") and "\\" not in target:
        return target
    return None


def get_prefs():
    return {**DEFAULT_PREFS, **session.get("prefs", {})}


# ---------- map helpers ----------

def active_levels(wing):
    rows = get_db().execute("SELECT level FROM maps WHERE wing = ? AND active = 1", (wing,)).fetchall()
    have = {r["level"] for r in rows}
    return [lv for lv in mapdata.levels(wing) if lv in have]


def closure_keys(wing):
    levels = set(active_levels(wing))
    rows = get_db().execute(
        "SELECT level, target_type, target_id FROM closures WHERE wing = ?", (wing,)
    ).fetchall()
    return sorted(f"{r['level']}:{r['target_type']}:{r['target_id']}" for r in rows if r["level"] in levels)


def lookup_room(raw, wing=None):
    """Returns (match, error). match = {"room", "wing", "level"}."""
    room_id = mapdata.normalize_room(raw)
    if not room_id:
        return None, "Enter a room number."
    match = mapdata.find_room(room_id)
    if match is None or (wing and match["wing"] != wing):
        where = f"Wing {wing}" if wing else "Discovery Park"
        return None, f"Room {room_id} was not found in {where}. Check the room number and try again."
    if match["level"] not in active_levels(match["wing"]):
        return None, f"The map for Wing {match['wing']}, Level {match['level']} is unavailable right now."
    return match, None


def room_place(room_id):
    match = mapdata.find_room(room_id)
    if match is None:
        return room_id
    room = match["room"]
    place = f"Wing {match['wing']}, Room {room['id']} · Level {match['level']}"
    return f"{room['name']} · {place}" if room["name"] else place


def valid_wing(wing):
    wing = (wing or "").upper()
    if wing not in mapdata.WINGS:
        abort(404)
    return wing


# ---------- template helpers ----------

@app.context_processor
def inject_globals():
    return {
        "current_user": current_user,
        "prefs": get_prefs(),
        "HEADER_LABELS": HEADER_LABELS,
        "LOCATION_TYPES": mapdata.LOCATION_TYPES,
        "csrf_field": csrf_field,
        "room_place": room_place,
    }


@app.template_filter("fmt_date")
def fmt_date(value):
    try:
        d = date.fromisoformat(value)
    except (TypeError, ValueError):
        return value
    return f"{d:%a}, {d:%b} {d.day}"


@app.template_filter("fmt_time")
def fmt_time(value):
    try:
        t = datetime.strptime(value, "%H:%M")
    except (TypeError, ValueError):
        return value
    return f"{t.hour % 12 or 12}:{t:%M} {t:%p}"


@app.template_filter("ago")
def ago(value):
    try:
        then = datetime.strptime(value, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return value
    secs = (datetime.now(timezone.utc) - then).total_seconds()
    if secs < 3600:
        return "Just now" if secs < 120 else f"{int(secs // 60)} minutes ago"
    if secs < 86400:
        hours = int(secs // 3600)
        return f"{hours} hour{'s' if hours > 1 else ''} ago"
    days = int(secs // 86400)
    return "Yesterday" if days == 1 else f"{days} days ago"


# ---------- welcome + accounts ----------

@app.route("/")
def welcome():
    return render_template("welcome.html", tab="find")


@app.route("/login", methods=["GET", "POST"])
def login():
    nxt = safe_next(request.values.get("next"))
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        user = get_db().execute(
            "SELECT id, username, password_hash, role FROM users WHERE username = ?", (username,)
        ).fetchone()
        if user is None or not check_password_hash(user["password_hash"], password):
            flash("Incorrect username or password.", "error")
            return render_template("login.html", username=username, next=nxt), 401
        session.clear()
        session["user_id"] = user["id"]
        return redirect(nxt or url_for("home"))
    return render_template("login.html", username="", next=nxt)


@app.route("/register", methods=["GET", "POST"])
def register():
    form = {"username": "", "role": "student"}
    errors = {}
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        confirm = request.form.get("confirm", "")
        role = request.form.get("role", "student")
        form = {"username": username, "role": role}
        if not USERNAME_RE.match(username):
            errors["username"] = "Use 3-32 letters, numbers, dots or underscores."
        if len(password) < MIN_PASSWORD_LENGTH:
            errors["password"] = f"Password must be at least {MIN_PASSWORD_LENGTH} characters."
        elif password != confirm:
            errors["confirm"] = "Passwords do not match."
        if role not in ROLES:
            errors["role"] = "Choose a valid role."
        if not errors:
            db = get_db()
            if db.execute("SELECT 1 FROM users WHERE username = ?", (username,)).fetchone():
                errors["username"] = "That username is already taken."
            else:
                db.execute("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
                           (username, generate_password_hash(password), role))
                db.commit()
                flash("Account created. Log in to continue.", "success")
                return redirect(url_for("login"))
        return render_template("register.html", form=form, roles=ROLES, errors=errors), 400
    return render_template("register.html", form=form, roles=ROLES, errors=errors)


@app.route("/guest", methods=["POST"])
def guest():
    session.clear()
    session["guest"] = True
    return redirect(url_for("wings"))


@app.route("/logout", methods=["POST"])
def logout():
    prefs = session.get("prefs")
    session.clear()
    if prefs:
        session["prefs"] = prefs
    flash("You have been logged out.", "success")
    return redirect(url_for("welcome"))


@app.route("/home")
def home():
    user = current_user()
    if user and user["role"] == "admin":
        return redirect(url_for("admin_dashboard"))
    return redirect(url_for("find"))


@app.route("/account")
def account():
    if current_user() is None:
        return redirect(url_for("login"))
    return render_template("account.html")


# ---------- wayfinding ----------

@app.route("/find")
def find():
    action = request.args.get("action")
    wing = request.args.get("wing", "").upper()
    wing = wing if wing in mapdata.WINGS else None
    q = mapdata.normalize_room(request.args.get("room", ""))
    stepfree = request.args.get("stepfree") == "1" if action else get_prefs()["stepfree"]

    match, error = (None, None)
    if q:
        match, error = lookup_room(q, wing)
    elif action == "go":
        error = "Enter a room number first."

    start_text = request.args.get("from", "").strip()
    start, start_error = check_start(start_text, match)

    level_wing = match["wing"] if match else (start["wing"] if start else wing)
    levels = active_levels(level_wing) if level_wing else [1, 2]
    level = start["level"] if start else request.args.get("level", type=int)
    if level not in levels:
        level = levels[0] if levels else None
    if match and not levels:
        match, error = None, f"Maps for Wing {level_wing} are unavailable right now."

    if action == "go" and match and not start_error:
        return redirect(url_for("route", room=match["room"]["id"], level=level, stepfree=int(stepfree),
                                **({"from": start_text} if start else {})))
    default_label = (mapdata.default_start(level_wing, level)["label"].lower()
                     if level_wing and level else "entrance or stairs")
    options_wings = [level_wing] if level_wing else mapdata.WINGS
    return render_template("find.html", tab="find", q=q, match=match, error=error, wing=wing,
                           levels=levels, level=level, stepfree=stepfree,
                           start_text=start_text, start=start, start_error=start_error,
                           default_label=default_label,
                           start_options=mapdata.start_options(options_wings))


def check_start(text, match):
    """Validate the optional starting room/landmark. Returns (start, error)."""
    if not text:
        return None, None
    start = mapdata.resolve_start(text)
    if start is None:
        return None, (f"We couldn't find “{text}”. Enter a room number like B192, "
                      "or pick a landmark from the list.")
    if match and start["wing"] != match["wing"]:
        return None, (f"Pick a starting point in Wing {match['wing']}. "
                      "Routes between wings aren't available yet.")
    if start["level"] not in active_levels(start["wing"]):
        return None, f"The map for Wing {start['wing']}, Level {start['level']} is unavailable right now."
    if match and start["node"] == f"room:{match['room']['id']}":
        return None, "That's your destination. Enter where you are now."
    return start, None


@app.route("/route")
def route():
    match, error = lookup_room(request.args.get("room", ""))
    level = request.args.get("level", type=int)
    start_text = request.args.get("from", "").strip()
    start = None
    if match and not error:
        start, error = check_start(start_text, match)
        if start:
            level = start["level"]
        elif level not in active_levels(match["wing"]):
            error = error or "Choose the level you are on."
    if error:
        flash(error, "error")
        return redirect(url_for("find", room=request.args.get("room", ""), **{"from": start_text}))
    return render_template("route.html", tab="find", match=match, level=level,
                           stepfree=request.args.get("stepfree") == "1",
                           start=start, start_text=start_text,
                           default_start_label=mapdata.default_start(match["wing"], level)["label"].lower(),
                           wing_info=mapdata.WING_DATA[match["wing"]],
                           levels=active_levels(match["wing"]))


@app.route("/wings")
def wings():
    cards = [{"wing": w, "levels": len(active_levels(w))} for w in mapdata.WINGS]
    return render_template("wings.html", tab="explore", cards=cards, hours=mapdata.HOURS)


@app.route("/wings/<wing>")
def wing_types(wing):
    wing = valid_wing(wing)
    rooms = mapdata.rooms_in(wing, active_levels(wing))
    present = {m["room"]["type"] for m in rooms}
    types = [(key, info) for key, info in mapdata.LOCATION_TYPES.items() if key in present]
    return render_template("wing_types.html", tab="explore", wing=wing, types=types)


@app.route("/wings/<wing>/<loc_type>")
def room_list(wing, loc_type):
    wing = valid_wing(wing)
    if loc_type not in mapdata.LOCATION_TYPES:
        abort(404)
    rooms = mapdata.rooms_in(wing, active_levels(wing), loc_type)
    return render_template("room_list.html", tab="explore", wing=wing, loc_type=loc_type,
                           info=mapdata.LOCATION_TYPES[loc_type], rooms=rooms)


@app.route("/map/<wing>")
def floor_overview(wing):
    wing = valid_wing(wing)
    return render_template("overview.html", tab="explore", wing=wing,
                           wing_info=mapdata.WING_DATA[wing], levels=active_levels(wing),
                           room=mapdata.normalize_room(request.args.get("room", "")),
                           level=request.args.get("level", type=int))


# ---------- events ----------

def can_manage_event(event):
    user = current_user()
    if not user:
        return False
    return user["role"] == "admin" or (user["role"] == "organizer" and event["created_by"] == user["id"])


app.jinja_env.globals["can_manage_event"] = can_manage_event


def get_event(event_id):
    event = get_db().execute("SELECT * FROM events WHERE id = ?", (event_id,)).fetchone()
    if event is None:
        abort(404)
    return event


def read_event_form():
    form = {k: request.form.get(k, "").strip()
            for k in ("name", "event_date", "event_time", "description", "wing", "room")}
    form["wing"] = form["wing"].upper()
    form["room"] = mapdata.normalize_room(form["room"])
    errors = {}
    if not form["name"]:
        errors["name"] = "Enter an event name."
    elif len(form["name"]) > 100:
        errors["name"] = "Keep the name under 100 characters."
    try:
        if date.fromisoformat(form["event_date"]) < date.today():
            errors["event_date"] = "Pick today or a later date."
    except ValueError:
        errors["event_date"] = "Enter a valid date."
    if not TIME_RE.match(form["event_time"]):
        errors["event_time"] = "Enter a valid time."
    if len(form["description"]) > 1000:
        errors["description"] = "Keep the description under 1000 characters."
    if form["wing"] not in mapdata.WINGS:
        errors["wing"] = "Choose a wing."
    elif not form["room"]:
        errors["room"] = "Enter the room for the venue."
    else:
        match = mapdata.find_room(form["room"])
        if match is None or match["wing"] != form["wing"]:
            errors["room"] = f"Room {form['room']} isn't in Wing {form['wing']}."
    return form, errors


@app.route("/events")
def events():
    q = request.args.get("q", "").strip()
    sql = "SELECT * FROM events WHERE status = 'active' AND event_date >= ?"
    params = [date.today().isoformat()]
    if q:
        sql += " AND (name LIKE ? OR description LIKE ? OR room LIKE ?)"
        like = f"%{q}%"
        params += [like, like, like]
    rows = get_db().execute(sql + " ORDER BY event_date, event_time", params).fetchall()
    return render_template("events.html", tab="explore", events=rows, q=q)


@app.route("/events/<int:event_id>")
def event_detail(event_id):
    event = get_event(event_id)
    share = url_for("event_detail", event_id=event_id, _external=True)
    return render_template("event_detail.html", tab="explore", event=event, share=share)


@app.route("/events/new", methods=["GET", "POST"])
@roles_required("organizer", "admin")
def event_new():
    form = {"name": "", "event_date": "", "event_time": "", "description": "", "wing": "B", "room": ""}
    errors = {}
    if request.method == "POST":
        form, errors = read_event_form()
        if not errors:
            db = get_db()
            cur = db.execute(
                "INSERT INTO events (name, event_date, event_time, description, wing, room, created_by)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
                (form["name"], form["event_date"], form["event_time"], form["description"],
                 form["wing"], form["room"], current_user()["id"]))
            db.commit()
            flash("Event published. Share the link below.", "success")
            return redirect(url_for("event_detail", event_id=cur.lastrowid))
    return render_template("event_form.html", tab="explore", form=form, errors=errors,
                           wings=mapdata.WINGS, editing=False), (400 if errors else 200)


@app.route("/events/<int:event_id>/edit", methods=["GET", "POST"])
@roles_required("organizer", "admin")
def event_edit(event_id):
    event = get_event(event_id)
    if not can_manage_event(event):
        abort(403)
    form, errors = dict(event), {}
    if request.method == "POST":
        form, errors = read_event_form()
        if not errors:
            db = get_db()
            db.execute(
                "UPDATE events SET name = ?, event_date = ?, event_time = ?, description = ?,"
                " wing = ?, room = ? WHERE id = ?",
                (form["name"], form["event_date"], form["event_time"], form["description"],
                 form["wing"], form["room"], event_id))
            db.commit()
            flash("Event updated.", "success")
            return redirect(url_for("event_detail", event_id=event_id))
    return render_template("event_form.html", tab="explore", form=form, errors=errors,
                           wings=mapdata.WINGS, editing=True, event=event), (400 if errors else 200)


@app.route("/events/<int:event_id>/cancel", methods=["POST"])
@roles_required("organizer", "admin")
def event_cancel(event_id):
    event = get_event(event_id)
    if not can_manage_event(event):
        abort(403)
    db = get_db()
    db.execute("UPDATE events SET status = 'cancelled' WHERE id = ?", (event_id,))
    db.commit()
    flash(f"“{event['name']}” was cancelled.", "success")
    return redirect(url_for("events"))


# ---------- saved places ----------

@app.route("/saved")
@member_required
def saved():
    kind = "location" if request.args.get("tab") == "locations" else "schedule"
    rows = get_db().execute(
        "SELECT * FROM saved_places WHERE user_id = ? AND kind = ? ORDER BY created_at, id",
        (current_user()["id"], kind)).fetchall()
    return render_template("saved.html", tab="find", kind=kind, items=rows)


@app.route("/saved/new", methods=["GET", "POST"])
@member_required
def saved_new():
    kind = "location" if request.values.get("kind") == "location" else "schedule"
    form = {"title": "", "days": "", "start_time": "", "room": request.args.get("room", "")}
    errors = {}
    if request.method == "POST":
        form = {k: request.form.get(k, "").strip() for k in ("title", "days", "start_time", "room")}
        form["room"] = mapdata.normalize_room(form["room"])
        if not form["title"] or len(form["title"]) > 60:
            errors["title"] = "Enter a name (up to 60 characters)."
        if kind == "schedule":
            if not form["days"] or len(form["days"]) > 30:
                errors["days"] = "Enter the days, e.g. Mon/Wed."
            if not TIME_RE.match(form["start_time"]):
                errors["start_time"] = "Enter a valid time."
        if not form["room"]:
            errors["room"] = "Enter a room number."
        elif mapdata.find_room(form["room"]) is None:
            errors["room"] = f"Room {form['room']} was not found in Discovery Park."
        if not errors:
            db = get_db()
            db.execute(
                "INSERT INTO saved_places (user_id, kind, title, days, start_time, room) VALUES (?, ?, ?, ?, ?, ?)",
                (current_user()["id"], kind, form["title"], form.get("days", ""),
                 form.get("start_time", ""), form["room"]))
            db.commit()
            flash("Saved.", "success")
            return redirect(url_for("saved", tab="locations" if kind == "location" else None))
    return render_template("saved_form.html", tab="find", kind=kind, form=form, errors=errors), \
        (400 if errors else 200)


@app.route("/saved/<int:item_id>/delete", methods=["POST"])
@member_required
def saved_delete(item_id):
    db = get_db()
    row = db.execute("SELECT kind FROM saved_places WHERE id = ? AND user_id = ?",
                     (item_id, current_user()["id"])).fetchone()
    if row is None:
        abort(404)
    db.execute("DELETE FROM saved_places WHERE id = ?", (item_id,))
    db.commit()
    flash("Removed.", "success")
    return redirect(url_for("saved", tab="locations" if row["kind"] == "location" else None))


# ---------- reports ----------

@app.route("/report", methods=["GET", "POST"])
@member_required
def report():
    form = {
        "category": "blocked_path",
        "wing": request.args.get("wing", "B").upper(),
        "level": request.args.get("level", ""),
        "location": mapdata.normalize_room(request.args.get("room", "")),
        "details": "",
    }
    errors = {}
    if request.method == "POST":
        form = {k: request.form.get(k, "").strip() for k in ("category", "wing", "level", "location", "details")}
        form["wing"] = form["wing"].upper()
        if form["category"] not in REPORT_CATEGORIES:
            errors["category"] = "Choose a problem type."
        if form["wing"] not in mapdata.WINGS:
            errors["wing"] = "Choose a wing."
        elif form["level"] and (not form["level"].isdigit() or int(form["level"]) not in mapdata.levels(form["wing"])):
            errors["level"] = f"Wing {form['wing']} doesn't have that level."
        if len(form["location"]) > 100:
            errors["location"] = "Keep this under 100 characters."
        if not form["details"]:
            errors["details"] = "Tell us what's wrong."
        elif len(form["details"]) > 1000:
            errors["details"] = "Keep this under 1000 characters."
        if not errors:
            db = get_db()
            db.execute(
                "INSERT INTO reports (user_id, category, wing, level, location, details) VALUES (?, ?, ?, ?, ?, ?)",
                (current_user()["id"], form["category"], form["wing"],
                 int(form["level"]) if form["level"] else None, form["location"], form["details"]))
            db.commit()
            flash("Thanks! An admin will review your report.", "success")
            return redirect(url_for("find"))
    return render_template("report.html", tab="find", form=form, errors=errors,
                           categories=REPORT_CATEGORIES, wings=mapdata.WINGS), (400 if errors else 200)


# ---------- accessibility ----------

@app.route("/accessibility", methods=["GET", "POST"])
def accessibility():
    if request.method == "POST":
        session["prefs"] = {key: request.form.get(key) == "1" for key in DEFAULT_PREFS}
        flash("Accessibility settings saved.", "success")
        return redirect(url_for("accessibility"))
    return render_template("accessibility.html", tab="accessibility")


# ---------- admin ----------

@app.route("/admin")
@admin_required
def admin_dashboard():
    db = get_db()
    stats = {
        "open_reports": db.execute("SELECT COUNT(*) FROM reports WHERE status = 'open'").fetchone()[0],
        "closures": db.execute("SELECT COUNT(*) FROM closures").fetchone()[0],
        "removed_maps": db.execute("SELECT COUNT(*) FROM maps WHERE active = 0").fetchone()[0],
        "users": db.execute("SELECT COUNT(*) FROM users").fetchone()[0],
    }
    recent = db.execute(
        "SELECT * FROM reports WHERE status = 'open' ORDER BY created_at DESC LIMIT 5").fetchall()
    return render_template("admin/dashboard.html", admin_area=True, tab="dashboard",
                           stats=stats, recent=recent, categories=REPORT_CATEGORIES)


@app.route("/admin/maps")
@admin_required
def admin_maps():
    rows = get_db().execute("SELECT * FROM maps ORDER BY wing, level").fetchall()
    return render_template("admin/maps.html", admin_area=True, tab="maps",
                           maps=rows, confirm=request.args.get("confirm", ""))


@app.route("/admin/maps/remove", methods=["POST"])
@admin_required
def admin_map_remove():
    wing = valid_wing(request.form.get("wing"))
    level = request.form.get("level", type=int)
    if level not in mapdata.levels(wing):
        abort(400)
    db = get_db()
    db.execute("UPDATE maps SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE wing = ? AND level = ?",
               (wing, level))
    db.commit()
    flash(f"Wing {wing} - Level {level} was removed. Active routes on this level will be recalculated.", "success")
    return redirect(url_for("admin_maps"))


@app.route("/admin/maps/new", methods=["GET", "POST"])
@admin_required
def admin_map_new():
    db = get_db()
    rows = db.execute("SELECT * FROM maps ORDER BY wing, level").fetchall()
    errors = {}
    selected = request.form.get("target", "")
    if request.method == "POST":
        try:
            wing, level = selected.split("-")
            wing, level = wing.upper(), int(level)
            if wing not in mapdata.WINGS or level not in mapdata.levels(wing):
                raise ValueError
        except ValueError:
            errors["target"] = "Choose a wing and level."
        upload = request.files.get("floorplan")
        filename = ""
        if upload and upload.filename:
            ext = os.path.splitext(upload.filename)[1].lower()
            if ext not in MAP_UPLOAD_EXTS:
                errors["floorplan"] = "Upload an SVG, JSON, PNG, JPG or PDF file."
            elif not errors:
                os.makedirs(UPLOAD_DIR, exist_ok=True)
                filename = secure_filename(f"wing{wing}_level{level}_{datetime.now():%Y%m%d%H%M%S}{ext}")
                upload.save(os.path.join(UPLOAD_DIR, filename))
        if not errors:
            db.execute(
                "UPDATE maps SET active = 1, source_file = CASE WHEN ? = '' THEN source_file ELSE ? END,"
                " updated_at = CURRENT_TIMESTAMP WHERE wing = ? AND level = ?",
                (filename, filename, wing, level))
            db.commit()
            flash(f"Wing {wing} - Level {level} is live.", "success")
            return redirect(url_for("admin_maps"))
    return render_template("admin/map_new.html", admin_area=True, tab="maps", maps=rows,
                           errors=errors, selected=selected), (400 if errors else 200)


@app.route("/admin/closures", methods=["GET", "POST"])
@admin_required
def admin_closures():
    db = get_db()
    errors = {}
    if request.method == "POST":
        parts = request.form.get("target", "").split("|")
        note = request.form.get("note", "").strip()
        name = None
        if len(parts) == 4 and parts[1].isdigit():
            name = mapdata.closure_name(parts[0], int(parts[1]), parts[2], parts[3])
        if name is None:
            errors["target"] = "Choose what is closed."
        if len(note) > 200:
            errors["note"] = "Keep the note under 200 characters."
        if not errors:
            db.execute(
                "INSERT OR IGNORE INTO closures (wing, level, target_type, target_id, note, created_by)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (parts[0], int(parts[1]), parts[2], parts[3], note, current_user()["id"]))
            db.commit()
            flash(f"Marked closed: Wing {parts[0]}, Level {parts[1]} · {name}. Routes now avoid it.", "success")
            return redirect(url_for("admin_closures"))
    rows = db.execute("SELECT * FROM closures ORDER BY wing, level, created_at").fetchall()
    closures = [dict(r, name=mapdata.closure_name(r["wing"], r["level"], r["target_type"], r["target_id"]) or r["target_id"])
                for r in rows]
    groups = [(w, lv, mapdata.closure_targets(w, lv)) for w in mapdata.WINGS for lv in mapdata.levels(w)]
    return render_template("admin/closures.html", admin_area=True, tab="dashboard",
                           closures=closures, groups=groups, errors=errors), (400 if errors else 200)


@app.route("/admin/closures/<int:closure_id>/delete", methods=["POST"])
@admin_required
def admin_closure_delete(closure_id):
    db = get_db()
    db.execute("DELETE FROM closures WHERE id = ?", (closure_id,))
    db.commit()
    flash("Closure removed. Routes can use that path again.", "success")
    return redirect(url_for("admin_closures"))


@app.route("/admin/reports")
@admin_required
def admin_reports():
    status = request.args.get("status", "open")
    if status not in REPORT_STATUSES:
        status = "open"
    rows = get_db().execute(
        "SELECT r.*, u.username FROM reports r LEFT JOIN users u ON u.id = r.user_id"
        " WHERE r.status = ? ORDER BY r.created_at DESC", (status,)).fetchall()
    return render_template("admin/reports.html", admin_area=True, tab="reports", reports=rows,
                           status=status, statuses=REPORT_STATUSES, categories=REPORT_CATEGORIES)


@app.route("/admin/reports/<int:report_id>", methods=["GET", "POST"])
@admin_required
def admin_report_detail(report_id):
    db = get_db()
    row = db.execute(
        "SELECT r.*, u.username FROM reports r LEFT JOIN users u ON u.id = r.user_id WHERE r.id = ?",
        (report_id,)).fetchone()
    if row is None:
        abort(404)
    if request.method == "POST":
        action = request.form.get("action")
        note = request.form.get("admin_note", "").strip()[:1000]
        status = {"fix": "fixed", "dismiss": "dismissed", "reopen": "open"}.get(action, row["status"])
        db.execute("UPDATE reports SET status = ?, admin_note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                   (status, note, report_id))
        db.commit()
        flash(f"Report {REPORT_STATUSES[status].lower()}." if action in ("fix", "dismiss", "reopen")
              else "Details saved.", "success")
        return redirect(url_for("admin_reports", status=status) if action in ("fix", "dismiss")
                        else url_for("admin_report_detail", report_id=report_id))
    return render_template("admin/report_detail.html", admin_area=True, tab="reports", report=row,
                           statuses=REPORT_STATUSES, categories=REPORT_CATEGORIES)


@app.route("/admin/users")
@admin_required
def admin_users():
    rows = get_db().execute("SELECT id, username, role, created_at FROM users ORDER BY username").fetchall()
    return render_template("admin/users.html", admin_area=True, tab="dashboard", users=rows, roles=ROLES)


@app.route("/admin/users/<int:user_id>", methods=["POST"])
@admin_required
def admin_user_update(user_id):
    db = get_db()
    row = db.execute("SELECT id, username FROM users WHERE id = ?", (user_id,)).fetchone()
    if row is None:
        abort(404)
    action = request.form.get("action")
    is_self = user_id == current_user()["id"]
    if action == "role":
        role = request.form.get("role")
        if role not in ROLES:
            abort(400)
        if is_self and role != "admin":
            flash("You can't remove your own admin role.", "error")
        else:
            db.execute("UPDATE users SET role = ? WHERE id = ?", (role, user_id))
            flash(f"{row['username']} is now {ROLES[role]}.", "success")
    elif action == "reset":
        password = request.form.get("password", "")
        if len(password) < MIN_PASSWORD_LENGTH:
            flash(f"New password must be at least {MIN_PASSWORD_LENGTH} characters.", "error")
        else:
            db.execute("UPDATE users SET password_hash = ? WHERE id = ?",
                       (generate_password_hash(password), user_id))
            flash(f"Password reset for {row['username']}.", "success")
    elif action == "delete":
        if is_self:
            flash("You can't delete your own account here.", "error")
        else:
            db.execute("DELETE FROM users WHERE id = ?", (user_id,))
            flash(f"Deleted {row['username']}.", "success")
    else:
        abort(400)
    db.commit()
    return redirect(url_for("admin_users"))


# ---------- JSON API (used by the map pages) ----------

@app.route("/api/wings/<wing>")
def api_wing(wing):
    wing = wing.upper()
    if wing not in mapdata.WINGS:
        return jsonify(error="Unknown wing"), 404
    data = mapdata.WING_DATA[wing]
    return jsonify(wing=wing, name=data["name"], source=data["source"], hours=mapdata.HOURS,
                   floors={str(lv): data["floors"][lv] for lv in active_levels(wing)},
                   closures=closure_keys(wing))


@app.route("/api/wings/<wing>/closures")
def api_closures(wing):
    wing = wing.upper()
    if wing not in mapdata.WINGS:
        return jsonify(error="Unknown wing"), 404
    return jsonify(closures=closure_keys(wing), levels=active_levels(wing))


# ---------- errors ----------

@app.errorhandler(400)
@app.errorhandler(403)
@app.errorhandler(404)
@app.errorhandler(413)
def handle_error(err):
    messages = {
        400: ("Something went wrong", err.description if isinstance(err.description, str) else "Bad request."),
        403: ("Not allowed", "Your account doesn't have permission to view this page."),
        404: ("Page not found", "We couldn't find that page."),
        413: ("File too large", "Upload a file under 10 MB."),
    }
    title, message = messages[err.code]
    if err.code == 400 and message.startswith("The browser"):
        message = "Bad request."
    return render_template("error.html", title=title, message=message), err.code


if __name__ == "__main__":
    app.run(debug=True)
