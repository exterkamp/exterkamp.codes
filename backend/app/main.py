import os
import random
import re
import sqlite3
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager, closing
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, HTTPException, Request, Response
from pydantic import BaseModel, Field, field_validator

from .demo_notes import DEMO_NOTES

MAX_NOTE_LENGTH = 140
# Newest notes win if the table ever outgrows what one response should carry.
MAX_NOTES_RETURNED = 500
# Per-client posting limit: RATE_LIMIT_POSTS notes per RATE_LIMIT_WINDOW seconds.
RATE_LIMIT_POSTS = 5
RATE_LIMIT_WINDOW = 60.0
# Per-client limit on rotation requests, in the same window. The globe asks once per turn
# (every ~30 seconds), so this only stops a client that hammers the endpoint.
RATE_LIMIT_ROTATIONS = 20
# One rotation shows MIN..MAX notes, spread over this many equal longitude sectors.
ROTATION_MIN = 3
ROTATION_MAX = 5
ROTATION_SECTORS = 5
MAX_EXCLUDE = 10


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
    # Lets a rotation count and sample the notes in a longitude sector without a table scan.
    conn.execute("CREATE INDEX IF NOT EXISTS notes_lon ON notes (lon)")
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


def seed_demo_notes() -> None:
    """Insert the demo notes if SEED_DEMO_NOTES=1 and the table is empty."""
    if os.environ.get("SEED_DEMO_NOTES") != "1":
        return
    now = datetime.now(timezone.utc)
    with closing(connect()) as conn, conn:
        # Take the write lock before checking, so two workers can't both see an empty table.
        conn.execute("BEGIN IMMEDIATE")
        if conn.execute("SELECT 1 FROM notes LIMIT 1").fetchone():
            return
        conn.executemany(
            "INSERT INTO notes (lat, lon, text, created_at) VALUES (?, ?, ?, ?)",
            [
                (lat, lon, text, (now - timedelta(days=days)).isoformat(timespec="seconds"))
                # Oldest first, so ids (and /api/notes order) follow created_at like real posts.
                for lat, lon, text, days in sorted(DEMO_NOTES, key=lambda n: -n[3])
            ],
        )


@asynccontextmanager
async def lifespan(_app: FastAPI):
    seed_demo_notes()
    yield


app = FastAPI(lifespan=lifespan)


# Recent post times per client, in memory only. Client addresses are used as keys
# here and never written to the database.
_recent_posts: dict[str, deque[float]] = defaultdict(deque)
_recent_rotations: dict[str, deque[float]] = defaultdict(deque)


def client_key(request: Request) -> str:
    # nginx sets X-Real-IP to the visitor's address (CF-Connecting-IP behind
    # cloudflared, else the connecting address). Only trust it while the backend
    # is reachable solely through nginx.
    return request.headers.get("x-real-ip") or (request.client.host if request.client else "unknown")


def check_rate_limit(
    key: str,
    recent: dict[str, deque[float]] = _recent_posts,
    limit: int = RATE_LIMIT_POSTS,
    detail: str = "Too many notes, try again in a bit.",
) -> None:
    now = time.monotonic()
    times = recent[key]
    while times and now - times[0] >= RATE_LIMIT_WINDOW:
        times.popleft()
    if len(times) >= limit:
        retry_after = max(1, int(RATE_LIMIT_WINDOW - (now - times[0])) + 1)
        raise HTTPException(
            status_code=429,
            detail=detail,
            headers={"Retry-After": str(retry_after)},
        )
    times.append(now)
    # Don't let one-off visitors accumulate forever.
    if len(recent) > 10_000:
        for k in [k for k, v in recent.items() if not v or now - v[-1] >= RATE_LIMIT_WINDOW]:
            del recent[k]


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


def parse_exclude(exclude: str) -> list[int]:
    if not exclude:
        return []
    parts = exclude.split(",")
    if len(parts) > MAX_EXCLUDE or not all(re.fullmatch(r"[0-9]{1,18}", p) for p in parts):
        raise HTTPException(
            status_code=422,
            detail=f"exclude must be at most {MAX_EXCLUDE} comma-separated note ids",
        )
    return [int(p) for p in parts]


def pick_random(conn: sqlite3.Connection, lon_lo: float, lon_hi: float, skip: set[int]) -> sqlite3.Row | None:
    """A random note with lon in [lon_lo, lon_hi) that is not in `skip`, without loading the rows."""
    marks = ",".join("?" * len(skip))
    where = f"lon >= ? AND lon < ? AND id NOT IN ({marks})"
    args = (lon_lo, lon_hi, *skip)
    (count,) = conn.execute(f"SELECT COUNT(*) FROM notes WHERE {where}", args).fetchone()
    if not count:
        return None
    return conn.execute(
        f"SELECT id, lat, lon, text, created_at FROM notes WHERE {where} LIMIT 1 OFFSET ?",
        (*args, random.randrange(count)),
    ).fetchone()


@app.get("/api/notes/rotation", response_model=list[Note])
def notes_rotation(request: Request, response: Response, exclude: str = ""):
    """3 to 5 random notes spread across longitude, for one turn of the globe.

    `exclude` lists the ids of the set just shown; they are skipped unless there aren't
    enough other notes to fill a set.
    """
    check_rate_limit(
        client_key(request),
        _recent_rotations,
        RATE_LIMIT_ROTATIONS,
        "Too many requests, try again in a bit.",
    )
    excluded = set(parse_exclude(exclude))
    response.headers["Cache-Control"] = "no-store"
    want = random.randint(ROTATION_MIN, ROTATION_MAX)
    width = 360 / ROTATION_SECTORS
    sectors = list(range(ROTATION_SECTORS))
    random.shuffle(sectors)
    picked: list[sqlite3.Row] = []
    with closing(connect()) as conn:
        # One note per longitude sector, in random order, so the set doesn't clump.
        for i in sectors:
            if len(picked) >= want:
                break
            hi = 181 if i == ROTATION_SECTORS - 1 else -180 + (i + 1) * width
            row = pick_random(conn, -180 + i * width, hi, excluded | {r["id"] for r in picked})
            if row:
                picked.append(row)
        # Sparse sectors: top up from anywhere, preferring notes not just shown.
        for skip in (excluded, set()):
            while len(picked) < want:
                row = pick_random(conn, -181, 181, skip | {r["id"] for r in picked})
                if not row:
                    break
                picked.append(row)
    return [dict(r) for r in picked]


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
