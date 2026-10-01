import os
import sqlite3
import time
from collections import defaultdict, deque
from contextlib import closing
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

MAX_NOTE_LENGTH = 140
# Newest notes win if the table ever outgrows what one response should carry.
MAX_NOTES_RETURNED = 500
# Per-client posting limit: RATE_LIMIT_POSTS notes per RATE_LIMIT_WINDOW seconds.
RATE_LIMIT_POSTS = 5
RATE_LIMIT_WINDOW = 60.0

app = FastAPI()


def db_path() -> str:
    return os.environ.get("NOTES_DB", "/data/notes.db")


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(db_path())
    conn.row_factory = sqlite3.Row
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lat REAL NOT NULL,
            lon REAL NOT NULL,
            text TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    return conn


class NoteIn(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    text: str

    @field_validator("text")
    @classmethod
    def text_is_short_plain_text(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("note is empty")
        if len(v) > MAX_NOTE_LENGTH:
            raise ValueError(f"note is longer than {MAX_NOTE_LENGTH} characters")
        if any(ord(ch) < 32 or ord(ch) == 127 for ch in v):
            raise ValueError("note contains control characters")
        return v


class Note(BaseModel):
    id: int
    lat: float
    lon: float
    text: str
    created_at: str


# Recent post times per client, in memory only. Client addresses are used as keys
# here and never written to the database.
_recent_posts: dict[str, deque[float]] = defaultdict(deque)


def client_key(request: Request) -> str:
    # nginx sets X-Real-IP to the visitor's address (CF-Connecting-IP behind
    # cloudflared, else the connecting address). Only trust it while the backend
    # is reachable solely through nginx.
    return request.headers.get("x-real-ip") or (request.client.host if request.client else "unknown")


def check_rate_limit(key: str) -> None:
    now = time.monotonic()
    posts = _recent_posts[key]
    while posts and now - posts[0] >= RATE_LIMIT_WINDOW:
        posts.popleft()
    if len(posts) >= RATE_LIMIT_POSTS:
        retry_after = max(1, int(RATE_LIMIT_WINDOW - (now - posts[0])) + 1)
        raise HTTPException(
            status_code=429,
            detail="Too many notes, try again in a bit.",
            headers={"Retry-After": str(retry_after)},
        )
    posts.append(now)
    # Don't let one-off visitors accumulate forever.
    if len(_recent_posts) > 10_000:
        for k in [k for k, v in _recent_posts.items() if not v or now - v[-1] >= RATE_LIMIT_WINDOW]:
            del _recent_posts[k]


@app.get("/api/hello")
def hello():
    return {"message": "Hello, world!"}


@app.get("/api/notes", response_model=list[Note])
def list_notes():
    with closing(connect()) as conn:
        rows = conn.execute(
            "SELECT id, lat, lon, text, created_at FROM notes ORDER BY id DESC LIMIT ?",
            (MAX_NOTES_RETURNED,),
        ).fetchall()
    return [dict(r) for r in reversed(rows)]


@app.post("/api/notes", response_model=Note, status_code=201)
def create_note(note: NoteIn, request: Request):
    check_rate_limit(client_key(request))
    created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with closing(connect()) as conn, conn:
        cur = conn.execute(
            "INSERT INTO notes (lat, lon, text, created_at) VALUES (?, ?, ?, ?)",
            (note.lat, note.lon, note.text, created_at),
        )
    return Note(id=cur.lastrowid, lat=note.lat, lon=note.lon, text=note.text, created_at=created_at)
