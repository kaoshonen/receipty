# AGENTS.md — Receipty

Guidance for AI agents working in this codebase.

---

## 1. Project summary

**Receipty** is a small web app that sends plain-text jobs to an Epson TM-T88IV receipt printer over **USB** or **Ethernet**. It provides a web UI, REST API, SQLite-backed job log, and Docker-first deployment.

- **Stack:** Node 20+, TypeScript, Fastify, better-sqlite3, escpos/escpos-usb
- **Output:** `dist/` (CommonJS), static assets in `public/`
- **Config:** Env vars (`.env` loaded via `dotenv` at startup); optional JSON file via `CONFIG_PATH`. Env overrides file.

---

## 2. Layout

```
src/
  server.ts       # Entry: Fastify app, routes, wiring
  config.ts       # loadConfig(): env + optional JSON, validates and returns AppConfig
  db.ts           # openDb(), migrations from migrations/*.sql
  jobs.ts         # JobRepository (insert, nextQueued, updateStatus, list, getById, latest)
  queue.ts        # JobQueue: one loop, serialized prints, kick() for wake-up
  printer.ts      # createPrinter() → PrinterClient (print, status); USB and Ethernet impls
  escpos.ts       # buildEscPosPayload(text, feedLines, cutMode) → Buffer
  ui.ts           # Server-rendered HTML: renderHome, renderActivity, renderJobDetail, renderLayout
  utils.ts        # sanitizeText, hashText, previewText, withTimeout, sleep, formatIso, escapeHtml
  logger.ts       # AppLogger type (info, warn, error)
  types/escpos.d.ts
public/
  app.js          # Print page: textarea, print, status poll, last-job poll
  activity.js     # Activity: reprint buttons, X-API-Key from localStorage
  styles.css
  receipty-logo.png
migrations/
  001_init.sql    # jobs + migrations table; add new .sql for schema changes
tests/
  config.test.ts  # loadConfig: ethernet, API_KEY when non-localhost, USB
  utils.test.ts   # sanitizeText, buildEscPosPayload
```

---

## 3. Data flow

1. **Submit:** `POST /api/print` → `sanitizeText` → `buildEscPosPayload` (for bytes) → `repo.insert` (queued) → `queue.kick()` → `{ jobId, status: 'queued' }`.
2. **Process:** `JobQueue` takes `repo.nextQueued()`, calls `printer.print(job.text)` (printer builds ESC/POS again), then `repo.updateStatus(id, 'succeeded'|'failed', error?)`.
3. **Printer:** `printer.print(text)` builds payload via `escpos.buildEscPosPayload`, then:
   - **USB:** `USB_DEVICE_PATH` → raw write to path; else escpos-usb by VID/PID.
   - **Ethernet:** TCP to `PRINTER_HOST:PRINTER_PORT`, retries with jitter.
4. **Read:** `GET /api/jobs`, `GET /api/status`, `GET /readyz` (503 if printer disconnected). Printer status is cached ~2s.

---

## 4. Config and environment

- **Required:** `PRINTER_MODE` (`usb`|`ethernet`). In `usb`: `USB_VENDOR_ID`, `USB_PRODUCT_ID`. In `ethernet`: `PRINTER_HOST`.
- **API key:** If `APP_HOST` is not localhost, `API_KEY` is required; use `X-API-Key` for `/api/*`. Constant-time compare in `server.ts`.
- **Precedence:** `process.env` over optional `CONFIG_PATH` JSON. `dotenv/config` runs first in `server.ts`, so `.env` is loaded for `npm run dev` and when not running under Docker/Compose.

See `README.md` and `.env.example` for full tables. Do not document or rely on env vars that are not in `config.ts` or `.env.example`.

---

## 5. Conventions

### 5.1 Database

- **better-sqlite3** (sync). WAL. Migrations: `migrations/*.sql` sorted by filename; `migrations` table stores `(id, applied_at)`. `db.ts` creates parent dir of `DB_PATH` and runs migrations on open.
- **Jobs:** `id`, `created_at`, `updated_at`, `mode`, `status` (`queued`|`printing`|`succeeded`|`failed`), `bytes`, `preview`, `text_hash`, `text`, `error`. Repo uses `snake_case` in DB; `JobInsert` uses `textHash` (camelCase) and is converted on insert.

### 5.2 Logging and errors

- `AppLogger` = `{ info, warn, error }`. Fastify logger is passed into `createPrinter` and `JobQueue`. Use structured: `logger.info({ jobId }, 'job succeeded')`. Config is logged as `redacted` (API_KEY obscured).
- Uncaught config errors: `loadConfig()` throws; server exits. Printer/queue errors: job status `failed`, `error` = stack or message; no process exit.

### 5.3 APIs and UI

- **Body limit:** `config.maxChars * 4` for `POST /api/print`. Rate limit: `@fastify/rate-limit`, `global: false`; opt-in per route with `config: { rateLimit: true }`.
- **HTML:** `ui.ts` returns full documents. `escapeHtml` for all user/DB content. Scripts: `renderLayout(..., extraScripts)`; `app.js` on home, `activity.js` on activity.
- **Frontend:** Vanilla JS, no build. `localStorage` key `receipt_api_key` for API key when `requiresApiKey`. Status/print/reprint use `fetch` and `X-API-Key` when present.

### 5.4 Printing and ESC/POS

- `buildEscPosPayload`: normalizes trailing newline, appends `\n`(0x0a) × `feedLines`, then GS V (0x1d,0x56,0x00|0x01) for full/partial cut. `cutMode: 'none'` = no cut. Only printable ASCII + `\n`, `\t`; `sanitizeText` strips the rest.
- **One writer:** `JobQueue` processes one job at a time; `kick()` ensures a single loop with `pendingKick` when busy. Do not add concurrent print paths.

---

## 6. Commands

| Command | Purpose |
|--------|----------|
| `npm run dev` | `tsx src/server.ts`; needs `.env` (or env) and free `APP_PORT` (default 3000). |
| `npm run dev:clean` | Source `.env`, kill listeners on `APP_PORT` and `node dist/server.js`, then `npm run dev`. Prefer for restarts. |
| `npm run build` | `tsc` → `dist/`. |
| `npm start` | `node dist/server.js`. |
| `npm run test` | `vitest run`. |
| `npm run test:watch` | `vitest`. |

Docker:

- `docker compose --profile ethernet up --build` or `--profile usb`. Profiles required. `env_file: .env`. Ethernet: `PRINTER_HOST`, `PRINTER_PORT`. USB: `USB_VENDOR_ID`, `USB_PRODUCT_ID`, `USB_DEVICE_PATH`; device mapping and optionally `/dev/bus/usb`.

---

## 7. Important files (by concern)

| Concern | Files |
|---------|-------|
| Adding routes | `server.ts` |
| Config / env | `config.ts`, `.env.example` |
| DB schema | `migrations/*.sql`, `db.ts` |
| Job lifecycle | `jobs.ts`, `queue.ts` |
| Printer I/O | `printer.ts`, `escpos.ts` |
| HTML / pages | `ui.ts` |
| Print page UX | `public/app.js` |
| Activity / reprint | `public/activity.js` |

---

## 8. Patterns to follow

- **Config:** Add new keys in `config.ts` with `get()`, validation, and `redacted`; then use `config` in server/printer/queue. Keep env/file precedence.
- **Migrations:** New `migrations/NNN_desc.sql`; no edits to `001_init.sql` for new schema.
- **Reprint:** Reuse `sanitizeText(job.text)`, same validations as print, then `repo.insert` + `queue.kick()`. Do not re-use same job id.
- **Tests:** Vitest, `tests/`. Restore `process.env` in `afterEach` when mutating env (see `config.test.ts`). Cover config and utils; add tests when changing `sanitizeText`, `buildEscPosPayload`, or `loadConfig`.
- **Docs:** Update `README.md` and `.env.example` when adding env or behavior. `docs/DEV_NOTES.md` for dev-only workflow. `receipt-printer-webapp-prd.md` is the product spec.

---

## 9. Patterns to avoid

- Do not add a generic `dotenv` load in `config.ts`; `server.ts` already has `import 'dotenv/config'` at the top.
- Do not bypass `sanitizeText` or `buildEscPosPayload` for user-supplied print content.
- Do not add concurrent print workers or parallel writes to the same printer.
- Do not require `CONFIG_PATH` or a JSON file; both are optional. Do not assume `.env` exists in Docker; Compose injects env.
- Do not log or expose `API_KEY`; use `redacted` in config logs.
- Do not change `JobQueue` to process multiple jobs in parallel; the design is one-at-a-time to avoid device conflicts.

---

## 10. Future work

- **`docs/Wishlist.md`:** Canonical list of open tasks (e.g. print control page: feed, cut, status with printer confirmation). Pick one task, branch `feature/<slug>`, implement, test, open PR; mark `[x]` when merged.
- **PRD:** `receipt-printer-webapp-prd.md` defines scope, NFRs, and constraints. Align new features with it.

---

## 11. Quick checks before PR

- [ ] `npm run build`
- [ ] `npm run test`
- [ ] `npm run dev` (or `dev:clean`) and smoke-test print + activity + reprint
- [ ] New or changed env in `config.ts` and `.env.example` (and `README` if user-facing)
