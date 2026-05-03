# Contour — Session Startup Checklist

## Every session (in order)

1. **Start ngrok tunnel** (new terminal, leave it running)
   ```
   ngrok http --url=cylinder-jurist-oozy.ngrok-free.dev 8000
   ```

2. **Start the backend** (new terminal)
   ```
   cd "C:\Users\peytonhl\Documents\Fun\Claude Projects\IMDb for Music\backend" && .venv\Scripts\activate && uvicorn main:app --reload
   ```

3. **Start the frontend** (new terminal, from the `frontend/` folder)
   ```
   npm run dev
   ```

4. **Open the app** at `http://localhost:5173`

---

## When models change (adding tables or columns)

Run these in the backend terminal **before** starting the backend:
```
.venv\Scripts\alembic revision --autogenerate -m "describe what changed"
.venv\Scripts\alembic upgrade head
```
This updates the database without losing any data.

---

## One-time setup (already done)

- [x] ngrok installed and authtoken configured
- [x] Static ngrok domain: `cylinder-jurist-oozy.ngrok-free.dev`
- [x] Spotify Dashboard redirect URI set to `https://cylinder-jurist-oozy.ngrok-free.dev/auth/callback`
- [x] `backend/.env` configured with Spotify credentials, JWT secret, and ngrok redirect URI
- [x] Python venv set up with all dependencies (`pip install -r requirements.txt`)
- [x] Node modules installed (`npm install` in `frontend/`)

---

## Ports

| Service  | URL                                          |
|----------|----------------------------------------------|
| Frontend | http://localhost:5173                        |
| Backend  | http://localhost:8000                        |
| ngrok    | https://cylinder-jurist-oozy.ngrok-free.dev  |
| API docs | http://localhost:8000/docs                   |
