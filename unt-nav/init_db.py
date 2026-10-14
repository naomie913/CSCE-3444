"""Create the SQLite database. Run once: python init_db.py [--seed]

--seed adds demo data: one account per role (password: discovery123), sample
events, a class schedule for student_demo, user reports and one closure.
Seeding is skipped for any table that already has rows.
"""
import sys
from datetime import date, timedelta

from werkzeug.security import generate_password_hash

from db import DATABASE, connect, ensure_schema

DEMO_PASSWORD = "discovery123"
DEMO_USERS = [("student_demo", "student"), ("organizer_demo", "organizer"), ("admin_demo", "admin")]


def seed(con):
    for username, role in DEMO_USERS:
        con.execute(
            "INSERT OR IGNORE INTO users (username, password_hash, role) VALUES (?, ?, ?)",
            (username, generate_password_hash(DEMO_PASSWORD), role),
        )
    ids = {r["username"]: r["id"] for r in con.execute("SELECT id, username FROM users")}

    def empty(table):
        return con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == 0

    today = date.today()
    if empty("events"):
        con.executemany(
            "INSERT INTO events (name, event_date, event_time, description, wing, room, created_by)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
                ("Campus Tour", (today + timedelta(days=1)).isoformat(), "10:00",
                 "Meet the tour guide for a walk through Discovery Park.", "A", "A101", ids["organizer_demo"]),
                ("Career Workshop", (today + timedelta(days=3)).isoformat(), "14:00",
                 "Resume reviews and interview tips.", "B", "B207", ids["organizer_demo"]),
                ("Study Night", (today + timedelta(days=4)).isoformat(), "19:00",
                 "Quiet group study with snacks.", "B", "B112", ids["organizer_demo"]),
            ],
        )
    if empty("saved_places"):
        uid = ids["student_demo"]
        con.executemany(
            "INSERT INTO saved_places (user_id, kind, title, days, start_time, room) VALUES (?, ?, ?, ?, ?, ?)",
            [
                (uid, "schedule", "CSCE 3444", "Mon/Wed", "09:30", "B140"),
                (uid, "schedule", "MATH 1710", "Tue/Thu", "11:00", "A120"),
                (uid, "schedule", "Office Hours", "Fri", "13:00", "G120"),
                (uid, "location", "Advising", "", "", "B205"),
                (uid, "location", "Library", "", "", "B112"),
            ],
        )
    if empty("reports"):
        uid = ids["student_demo"]
        con.executemany(
            "INSERT INTO reports (user_id, category, wing, level, location, details, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?, datetime('now', ?))",
            [
                (uid, "blocked_path", "B", 1, "Central hallway", "Carts blocking the hallway near B142.", "-2 hours"),
                (uid, "wrong_info", "A", 1, "A104", "Room number sign says A105.", "-1 day"),
                (uid, "blocked_path", "K", 1, "North door", "Entrance closed for repairs.", "-2 days"),
            ],
        )
    if empty("closures"):
        con.execute(
            "INSERT INTO closures (wing, level, target_type, target_id, note, created_by)"
            " VALUES ('B', 2, 'corridor', 'sw-b', 'Construction', ?)",
            (ids["admin_demo"],),
        )


def main():
    ensure_schema()
    if "--seed" in sys.argv:
        con = connect()
        seed(con)
        con.commit()
        con.close()
    print(f"Database ready at {DATABASE}")


if __name__ == "__main__":
    main()
