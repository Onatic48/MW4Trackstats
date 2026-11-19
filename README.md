# MW4Trackstats

Public Call of Duty Season 01 combat record lookup application powered by `@CODCombatRecord` on X, SQLite caching (`node:sqlite`), a serialized deduplicating job queue, SSE live progress tracking, and Gemini (`gemini-3.5-flash`) / Tesseract OCR image extraction.

## Architecture Overview

- `shared/` (`@mw4trackstats/shared`): Canonical types (`CombatRecordStats`, `JobStatusResponse`), Activision ID validator, and duration/number normalizers (`"--"` -> `null`, `0.00` preserved as `0`).
- `server/` (`@mw4trackstats/server`): Express 5 API + SQLite WAL repositories (`node:sqlite`) + serialized worker queue + X access adapters (`mock`, `playwright`, `api`) + Vision/OCR parsers (`gemini`, `tesseract`, `mock`) + SSRF-safe media downloader.
- `client/` (`@mw4trackstats/client`): React 19 + Vite + Tailwind v4 interface with English default (`en`) and Turkish (`tr`) language switcher.

## API Endpoints

- `POST /api/stats` — Validates Activision ID, returns cached stats immediately (`200`) if within `CACHE_TTL_MINUTES` (default 30), deduplicates active in-flight lookups (`202`), or enqueues a new X worker job (`202`).
- `GET /api/stats/jobs/:jobId` — Polling endpoint for job state, queue position, result, or stale fallback.
- `GET /api/stats/jobs/:jobId/stream` — Server-Sent Events (SSE) stream for step-by-step live updates.
- `GET /api/stats/recent` — Recent cached player lookups.
- `GET /api/stats/player/:activisionId` — Direct cached record lookup.
- `GET /api/images/:filename` — Serves downloaded `@CODCombatRecord` card images safely.
- `GET /api/auth/me`, `GET /api/auth/x/login`, `GET /callback`, `POST /api/auth/logout` — X OAuth 2.0 PKCE user sign-in flow so public visitors can look up uncached players with their own X account (`tweet.read`, `tweet.write`, `users.read`, `offline.access`).
- `GET /api/health` — Reports active X adapter, parser provider, Gemini model, OAuth 2.0 status, and queue count.

## Quick Start (Zero-Config Demo Mode)

The repository includes `.env` configured with `X_PROVIDER=mock` and `PARSER_PROVIDER=mock` so you can run and test the entire pipeline immediately without external credentials:

```bash
npm install
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend API: `http://127.0.0.1:3001`
- Try sample IDs in the UI such as `CaptainPrice#1412123` or `Operator#5745488` (which mirrors the Season 01 card layout including `--` for unplayed Battle Royale and `0.00` K/D in Resurgence).

## Connecting Real X (`@CODCombatRecord`) + Gemini Vision (`gemini-3.5-flash`)

1. Copy `.env.example` to `.env` (or edit `.env`).
2. Add your Google Gemini API key and keep `gemini-3.5-flash`:
   ```env
   PARSER_PROVIDER=gemini
   GEMINI_API_KEY=your_gemini_api_key
   GEMINI_MODEL=gemini-3.5-flash
   ```
3. Choose your X access mode:
   - **Option A — Official X API v2 (Recommended live mode, `X_PROVIDER=api`):**
     Create an App in the X Developer Portal with **Read and Write** permissions and **Type of App: Web App, Automated App or Bot**:
     - For **Per-Visitor Sign In (recommended for `@CODCombatRecord`'s 5 requests/day/account limit):**
       Set Callback URI to `http://127.0.0.1:3001/callback` and add your **OAuth 2.0 Keys** to `.env`:
       ```env
       X_PROVIDER=api
       X_OAUTH2_CLIENT_ID=your_oauth2_client_id
       X_OAUTH2_CLIENT_SECRET=your_oauth2_client_secret
       X_OAUTH2_REDIRECT_URI=http://127.0.0.1:3001/callback
       ```
     - For **Server Account Fallback (optional OAuth 1.0a):**
       Add `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET` (and optional `X_API_BEARER_TOKEN`).
     Verify your configuration before starting the server:
     ```bash
     npm run x:verify
     ```
   - **Option B — Local Demo Adapter (`X_PROVIDER=mock`):**
     Set `X_PROVIDER=mock` and `PARSER_PROVIDER=mock` in `.env` for offline UI/queue testing without X credentials.
   - **Option C — Playwright Session (`X_PROVIDER=playwright`):**
     Optional fallback if X does not trigger onboarding anti-bot checks on your machine (`npx playwright install chromium` + `npm run x:login`).

## Verification Commands

```bash
npm run typecheck
npm run test
npm run build
```

Production start (after `npm run build` and setting `SERVE_CLIENT_DIST=true` in `.env`):

```bash
npm start
```
