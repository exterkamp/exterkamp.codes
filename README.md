# exterkamp.codes

Personal site, migrated off GitHub Pages to self-hosted (Angular + FastAPI, Docker Compose).

## Stack

- Frontend: Angular, served via nginx
- Backend: Python / FastAPI (minimal for now — a growth point for future dynamic features)
- Exposure: Cloudflare Tunnel (no inbound ports opened on the host)

## Run with Docker

```bash
docker compose up -d --build
```

Then open http://localhost:8081

## Local development (without Docker)

Backend:

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Frontend (requires Node 22.22+/24.15+ — use `nvm use 24`):

```bash
cd frontend
npm install
npm start
```
