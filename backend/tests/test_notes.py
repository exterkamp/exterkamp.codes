import sqlite3

import pytest
from fastapi.testclient import TestClient

from app import main


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("NOTES_DB", str(tmp_path / "notes.db"))
    main._recent_posts.clear()
    return TestClient(main.app)


def post(client, text="hello", lat=10.5, lon=-20.25, **kwargs):
    return client.post("/api/notes", json={"lat": lat, "lon": lon, "text": text}, **kwargs)


def test_list_is_empty_at_first(client):
    r = client.get("/api/notes")
    assert r.status_code == 200
    assert r.json() == []


def test_add_then_list(client):
    r = post(client, "  hi there  ")
    assert r.status_code == 201
    created = r.json()
    assert created["text"] == "hi there"
    assert (created["lat"], created["lon"]) == (10.5, -20.25)
    assert created["id"] and created["created_at"]

    post(client, "second")
    notes = client.get("/api/notes").json()
    assert [n["text"] for n in notes] == ["hi there", "second"]
    assert notes[0] == created


def test_notes_survive_restart(tmp_path, monkeypatch):
    monkeypatch.setenv("NOTES_DB", str(tmp_path / "notes.db"))
    main._recent_posts.clear()
    post(TestClient(main.app), "still here")
    # A new client opens the database file afresh, like a restarted process would.
    assert [n["text"] for n in TestClient(main.app).get("/api/notes").json()] == ["still here"]


def test_text_is_stored_verbatim_not_as_html(client):
    post(client, "<script>alert(1)</script>")
    assert client.get("/api/notes").json()[0]["text"] == "<script>alert(1)</script>"


@pytest.mark.parametrize("text", ["", "   ", "x" * 141, "bad\x00byte", "line\nbreak"])
def test_rejects_bad_text(client, text):
    assert post(client, text).status_code == 422
    assert client.get("/api/notes").json() == []


def test_accepts_exactly_140_characters(client):
    assert post(client, "x" * 140).status_code == 201


@pytest.mark.parametrize("lat,lon", [(90.1, 0), (-91, 0), (0, 180.5), (0, -181)])
def test_rejects_out_of_range_location(client, lat, lon):
    assert post(client, lat=lat, lon=lon).status_code == 422


def test_rejects_missing_fields(client):
    assert client.post("/api/notes", json={"text": "no place"}).status_code == 422


def test_rate_limits_per_client(client):
    for _ in range(main.RATE_LIMIT_POSTS):
        assert post(client, headers={"X-Real-IP": "1.1.1.1"}).status_code == 201
    r = post(client, headers={"X-Real-IP": "1.1.1.1"})
    assert r.status_code == 429
    assert int(r.headers["Retry-After"]) >= 1
    # Someone else is unaffected, and reading is never limited.
    assert post(client, headers={"X-Real-IP": "2.2.2.2"}).status_code == 201
    assert client.get("/api/notes", headers={"X-Real-IP": "1.1.1.1"}).status_code == 200


def test_rate_limit_window_expires(client, monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(main.time, "monotonic", lambda: clock[0])
    for _ in range(main.RATE_LIMIT_POSTS):
        post(client)
    assert post(client).status_code == 429
    clock[0] += main.RATE_LIMIT_WINDOW + 1
    assert post(client).status_code == 201


def test_rejected_posts_do_not_use_up_the_limit(client):
    for _ in range(main.RATE_LIMIT_POSTS + 2):
        post(client, text="")
    assert post(client).status_code == 201


def test_ip_addresses_are_not_stored(client, tmp_path):
    post(client, headers={"X-Real-IP": "203.0.113.9"})
    with sqlite3.connect(tmp_path / "notes.db") as conn:
        dump = repr(conn.execute("SELECT * FROM notes").fetchall())
    assert "203.0.113.9" not in dump


# --- demo seeding ---


def seeded_notes(monkeypatch, tmp_path, flag="1"):
    monkeypatch.setenv("NOTES_DB", str(tmp_path / "notes.db"))
    if flag is None:
        monkeypatch.delenv("SEED_DEMO_NOTES", raising=False)
    else:
        monkeypatch.setenv("SEED_DEMO_NOTES", flag)
    with TestClient(main.app) as c:  # entering the context runs startup
        return c.get("/api/notes").json()


def test_seeds_when_empty_and_flagged(tmp_path, monkeypatch):
    notes = seeded_notes(monkeypatch, tmp_path)
    assert 28 <= len(notes) <= 32
    assert any(n["lat"] < -60 for n in notes)  # Antarctica
    assert any(n["lon"] > 170 for n in notes) and any(n["lon"] < -170 for n in notes)
    # Every continent has at least one note (rough lat/lon boxes).
    continents = {
        "north america": (15, 72, -170, -50),
        "south america": (-56, 12, -82, -34),
        "europe": (36, 71, -25, 40),
        "africa": (-35, 37, -18, 52),
        "asia": (1, 75, 60, 150),
        "oceania": (-47, -10, 110, 180),
    }
    for name, (lat0, lat1, lon0, lon1) in continents.items():
        assert any(lat0 <= n["lat"] <= lat1 and lon0 <= n["lon"] <= lon1 for n in notes), name
    # At least one pair of notes sits within ~0.1 degrees of each other.
    assert any(
        abs(a["lat"] - b["lat"]) < 0.1 and abs(a["lon"] - b["lon"]) < 0.1
        for i, a in enumerate(notes)
        for b in notes[i + 1 :]
    )
    # Ids follow creation order, like real posts.
    assert [n["created_at"] for n in notes] == sorted(n["created_at"] for n in notes)


def test_does_not_seed_without_flag(tmp_path, monkeypatch):
    assert seeded_notes(monkeypatch, tmp_path, flag=None) == []
    assert seeded_notes(monkeypatch, tmp_path, flag="0") == []


def test_seed_does_not_duplicate_on_restart(tmp_path, monkeypatch):
    first = seeded_notes(monkeypatch, tmp_path)
    assert seeded_notes(monkeypatch, tmp_path) == first


def test_seed_leaves_non_empty_database_alone(tmp_path, monkeypatch):
    monkeypatch.setenv("NOTES_DB", str(tmp_path / "notes.db"))
    main._recent_posts.clear()
    post(TestClient(main.app), "mine")
    notes = seeded_notes(monkeypatch, tmp_path)
    assert [n["text"] for n in notes] == ["mine"]


def test_seed_rows_pass_note_validation():
    from app.demo_notes import DEMO_NOTES

    for lat, lon, text, _days in DEMO_NOTES:
        note = main.NoteIn(lat=lat, lon=lon, text=text)
        assert note.text == text
