"""SQLite connection and schema. The database is opened by absolute path so it
works the same locally and on PythonAnywhere."""
import os
import sqlite3

from flask import g

import mapdata

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATABASE = os.environ.get("UNT_NAV_DB", os.path.join(BASE_DIR, "app.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL CHECK (role IN ('student', 'organizer', 'admin')),
    created_at    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    event_date  TEXT NOT NULL,
    event_time  TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    wing        TEXT NOT NULL,
    room        TEXT NOT NULL,
    created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date);
CREATE INDEX IF NOT EXISTS idx_events_room ON events(room);
CREATE INDEX IF NOT EXISTS idx_events_wing ON events(wing);

CREATE TABLE IF NOT EXISTS saved_places (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL CHECK (kind IN ('schedule', 'location')),
    title      TEXT NOT NULL,
    days       TEXT NOT NULL DEFAULT '',
    start_time TEXT NOT NULL DEFAULT '',
    room       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_saved_user ON saved_places(user_id, kind);
CREATE INDEX IF NOT EXISTS idx_saved_room ON saved_places(room);

CREATE TABLE IF NOT EXISTS reports (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    category   TEXT NOT NULL,
    wing       TEXT NOT NULL,
    level      INTEGER,
    location   TEXT NOT NULL DEFAULT '',
    details    TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'fixed', 'dismissed')),
    admin_note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_wing ON reports(wing);

CREATE TABLE IF NOT EXISTS closures (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    wing        TEXT NOT NULL,
    level       INTEGER NOT NULL,
    target_type TEXT NOT NULL CHECK (target_type IN ('corridor', 'feature')),
    target_id   TEXT NOT NULL,
    note        TEXT NOT NULL DEFAULT '',
    created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (wing, level, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_closures_wing ON closures(wing);

CREATE TABLE IF NOT EXISTS maps (
    wing        TEXT NOT NULL,
    level       INTEGER NOT NULL,
    active      INTEGER NOT NULL DEFAULT 1,
    source_file TEXT NOT NULL DEFAULT '',
    updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (wing, level)
);
"""


def connect():
    con = sqlite3.connect(DATABASE)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


def get_db():
    if "db" not in g:
        g.db = connect()
    return g.db


def close_db(_exc=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def ensure_schema():
    """Create any missing tables and register every floor map as active."""
    con = connect()
    con.executescript(SCHEMA)
    for wing in mapdata.WINGS:
        for level in mapdata.levels(wing):
            con.execute("INSERT OR IGNORE INTO maps (wing, level) VALUES (?, ?)", (wing, level))
    con.commit()
    con.close()
