# MW4Trackstats Design Specification

Date: 2026-11-19
Status: Approved

## 1. Product Intent & System Flow

MW4Trackstats is a public web application for looking up Call of Duty (MW4 Multiplayer, DMZ, Warzone Battle Royale, and Warzone Resurgence) Season 01 combat records using an Activision ID.

Because Call of Duty's public stats bot operates via `@CODCombatRecord` on X (`https://x.com/CODCombatRecord/status/2122766555675328664`), MW4Trackstats bridges web users to that bot safely with caching, request deduplication, rate limiting, a serialized worker queue, live SSE progress updates, and structured Vision/OCR extraction:

1. User enters an Activision ID (`Name#1234567`) and submits.
2. Backend checks SQLite cache (`CACHE_TTL_MINUTES=30`). If a fresh record exists, it returns `200 OK` immediately without touching external services.
3. If uncached, backend checks for an active in-flight job for the same normalized ID. If one exists, it deduplicates and returns `202 Accepted` with the existing `jobId`.
4. Otherwise, backend enqueues a new job in SQLite (`202 Accepted`) and streams real-time steps via SSE (`GET /api/stats/jobs/:jobId/stream`) with polling fallback (`GET /api/stats/jobs/:jobId`):
   - `queued` -> `posting_tweet` -> `waiting_bot_reply` -> `downloading_image` -> `parsing_image` -> `completed` (or `failed`).
5. Serialized worker posts `@CODCombatRecord Call of Duty <ActivisionID>` under the pinned tweet (`2122766555675328664`), captures the bot reply image URL (`pbs.twimg.com`), downloads it safely to local storage, extracts all 4 modes x 5 metrics via Gemini (`gemini-3.5-flash` structured JSON output, with Tesseract/mock fallback), caches the result for 30 minutes, and emits completion.

## 2. Combat Record Data Model (4 Modes x 5 Metrics)

Derived directly from `@CODCombatRecord`'s Season 01 card:

- **MW4 Multiplayer (`multiplayer`):** `timePlayed`, `timePlayedMinutes`, `kills`, `kdRatio`, `highestStreak`, `wins`
- **DMZ (`dmz`):** `timePlayed`, `timePlayedMinutes`, `playerEliminations`, `hostileEliminations`, `containersOpened`, `successfulExfils`
- **Warzone Battle Royale (`battleRoyale`):** `timePlayed`, `timePlayedMinutes`, `kills`, `kdRatio`, `highestKillsPerGame`, `wins`
- **Warzone Resurgence (`resurgence`):** `timePlayed`, `timePlayedMinutes`, `kills`, `kdRatio`, `highestKillsPerGame`, `wins`

Critical parsing invariants:
- `"--"` in unplayed modes is normalized to `null` (never `0`).
- `"0.00"` or `"0"` is preserved as `0`.
- Duration strings (`"4D 18H"`, `"1H 34M"`, `"14M"`) are converted to integer minutes (`6840`, `94`, `14`) for charting/comparison while keeping the original display string.
- Canonical `activisionId` is always the player-submitted ID (preserving non-ASCII names even when the rendered card displays tofu boxes like `#5745488`), while `parsedActivisionId` from OCR is stored alongside for verification.

## 3. Provider & Public-Site Protections

- **X Provider (`X_PROVIDER=mock|playwright|api`):**
  - `mock`: Default zero-config demo mode; simulates realistic staged progress and generates a 1280x720 PNG card image saved in `server/data/images/`.
  - `playwright`: Persistent Chromium profile (`PLAYWRIGHT_USER_DATA_DIR`), configured once via `npm run x:login`. Detects login/CAPTCHA/challenge walls and aborts cleanly with `X_AUTH_REQUIRED` / `X_CHALLENGE_REQUIRED` without attempting any bypass.
  - `api`: Official X API v2 adapter (`POST /2/tweets` + `GET /2/tweets/search/recent`).
- **Image Parser (`PARSER_PROVIDER=gemini|tesseract|mock`):**
  - `gemini`: Uses `@google/genai` with default model `gemini-3.5-flash` and `responseJsonSchema`, validated through Zod. Falls back cleanly if `GEMINI_API_KEY` is omitted.
  - `tesseract`: Local crop + `sharp` contrast preprocessing + `tesseract.js`.
  - `mock`: Deterministic demo parser matching `mockXProvider`.
- **Public Protections:**
  - `node:sqlite` (Node 24 built-in, WAL mode) behind repository interfaces.
  - Sliding-window IP rate limiter (separate limits for uncached writes vs cached reads).
  - Serialized X worker (`concurrency = 1`) with `X_COOLDOWN_MS`.
  - SSRF allowlist (`pbs.twimg.com`, `ton.twimg.com`, HTTPS only, 10 MB limit, MIME check) and strict filename validation for `/api/images/:filename`.
  - Stale-cache fallback returned alongside in-flight or failed jobs when available.

## 4. UI Direction (`unslop` + `modern-web-guidance` + i18n)

- **Default language:** English (`en`) with a header language switcher supporting English (`en`) and Turkish (`tr`), persisted in `localStorage` and synced to `<html lang>`.
- **Character:** `disciplined, technical, sharp`
- **Palette:** Neutral dark graphite ramp (`#0f0f10`, `#141415`, `#19191b`, `#232325`), 8% primary-text hairlines, three text roles (`#ededed`, `#a1a1a6`, `#85858b`), single tactical amber accent (`#eab308` / ink `#12110f`). Semantic green (`#4cc38a`), semantic red (`#e5484d`).
- **Typography:** `IBM Plex Sans` for UI + `IBM Plex Mono` (`tabular-nums`) for figures, Activision IDs, queue timers, and meta. Weights 400–500 (600 max on wordmark), sentence case everywhere, no uppercase wide tracking, no italic emphasis.
- **Zero slop:** No gradients, glows, emojis, exclamation marks, trailing periods on headings/labels/buttons, pulsing decorative badges, or `transition-all`. Icons strictly `lucide-react` 16px stroke 1.5.
- **Web platform craft:** `<meta name="color-scheme" content="dark">`, `:user-invalid` + JS `aria-invalid` + dynamic `aria-describedby` + polite `aria-live` error announcer (hint positioned above input), single-row horizontal `role="tablist"` with `border-block-end` active indicator, arrow-key roving focus, `hidden="until-found"` tab panels with `beforematch`, and native `<dialog>` for inspecting the original card image.
