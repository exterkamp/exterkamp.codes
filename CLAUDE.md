# CLAUDE.md

Personal site: Angular frontend (`frontend/`) and a minimal FastAPI backend (`backend/`), deployed with Docker Compose. See `README.md` for the Docker setup.

## Node version

The Angular CLI needs Node 24.15+ (22.22+ also works). The default `node` on this machine may be older, so check `node -v` first. nvm has v24 under `~/.nvm/versions/node/`. `frontend/scripts/dev.sh` picks it automatically; for other commands put its `bin` directory on `PATH`.

## Running the frontend dev server

Use `devrun` (see the global guidance), with the committed script. It reads `$PORT`, installs `node_modules` if missing, and binds to `127.0.0.1`:

```bash
devrun up --name web --port-env PORT -- bash frontend/scripts/dev.sh
devrun url web
```

Set `HOST=0.0.0.0` in the environment to reach it from other devices on the LAN.

The dev server proxies `/api` to `http://localhost:8000` (`frontend/proxy.conf.json`), a fixed port, so only one backend at a time can serve it.

## Tests

```bash
cd frontend
npx ng test --watch=false
```

## ASCII globe

The land/ocean data in `frontend/src/app/components/ascii-globe/land-data.ts` is generated. To regenerate it, run `python3 frontend/scripts/bake-land.py` (needs Pillow). Don't edit it by hand.
