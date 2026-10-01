# exterkamp.codes

Personal site, migrated off GitHub Pages to self-hosted (Angular + FastAPI, Docker Compose).

## Stack

- Frontend: Angular, served via nginx
- Backend: Python / FastAPI (minimal for now — a growth point for future dynamic features)
- Exposure: Cloudflare Tunnel (no inbound ports opened on the host)

## Run with Docker

Production (frontend + backend + Cloudflare tunnel):

```bash
docker compose --profile tunnel up -d --build
```

Local dev (frontend + backend only, no tunnel, reachable from other devices on
your LAN or Tailscale, not just this machine):

```bash
docker compose -p exterkamp-codes-site-dev -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

The `-p` isn't optional — it puts this stack in its own project/network so it
can never collide with the container the real tunnel forwards to. See the
comment at the top of `docker-compose.dev.yml`.

Then open http://localhost:8086, or from another device, the host's LAN or
Tailscale IP on the same port (e.g. http://192.168.1.174:8086 or
http://100.105.102.51:8086). Set `DEV_PORT` if 8086 is taken by something
else on this host.

## Local development (without Docker)

Backend:

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Notes are stored in SQLite at `/data/notes.db`; set `NOTES_DB` to put it elsewhere
(e.g. `NOTES_DB=./notes.db`). In Docker it lives on the `notes-data` volume. Backend tests:
`pip install -r requirements-dev.txt && python -m pytest`.

Frontend (requires Node 22.22+/24.15+ — use `nvm use 24`):

```bash
cd frontend
npm install
npm start
```
