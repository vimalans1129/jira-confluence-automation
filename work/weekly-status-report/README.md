# Weekly Status Report Generator

Web application that builds a weekly status report and PowerPoint deck from Jira Cloud data. See `../spec/` for the constitution, specification, plan and tasks.

## Project layout

```text
backend/    Node.js 24, Express, TypeScript (src/{config,middleware,routes,services,domain,clients,repositories,deck,jobs}, migrations, tests)
frontend/   React 18, Vite, TypeScript (src/{api,components,pages,hooks}, tests)
shared/     Types shared by both packages, if needed
```

The earlier Python prototype and its empty placeholder files were removed in task T0.2. Source files are created by the tasks that implement them; `.gitkeep` files only keep the planned folders in git.

## Quick start

Requires Node.js 24 (see `.nvmrc`) and Docker.

```text
copy .env.example .env      # then fill in the values below
cd backend
npm install
npm run hash-password       # prints the argon2 hash for APP_ADMIN_PASSWORD_HASH
```

Set in `.env`: `POSTGRES_PASSWORD`, `DATABASE_URL` (`postgres://wsr:<password>@localhost:5432/wsr`), `APP_ADMIN_PASSWORD_HASH` and `SESSION_SECRET` (32+ random characters). Then:

```text
docker compose up -d --wait   # from the project root
cd backend
npm run migrate
npm run dev                   # API on http://localhost:3000
```

In a second terminal run `npm install` and `npm run dev` in `frontend/` and open http://localhost:5173. Sign in with your password; `GET http://localhost:3000/api/v1/health` reports the database as up.

## Development commands

Run in `backend/` or `frontend/`:

```text
npm install
npm run lint
npm run typecheck
npm test
npm run format
npm run build
```

Backend tests that need a database run only when `TEST_DATABASE_URL` is set.

## Continuous integration

`.github/workflows/ci.yml` (repository root) runs for both packages: format check, lint, type check, tests, build and `npm audit --audit-level=high` (high or critical findings fail the build). The backend job runs against a PostgreSQL 15 service container, applies migrations, and sets `TEST_DATABASE_URL`. An `e2e` job runs the Playwright test against the mock Jira.

## Database

```text
copy .env.example .env      # then set POSTGRES_PASSWORD and DATABASE_URL
docker compose up -d --wait
cd backend
npm run migrate
```

`npm run migrate` applies pending migrations from `backend/migrations/` (plain SQL files, forward-only, no down sections) and is safe to run repeatedly. It reads `DATABASE_URL` from the environment or from `../.env`. By default Compose starts only PostgreSQL 15.

## Running in containers

Fill in `.env` as in the Quick start (including `APP_ADMIN_PASSWORD_HASH` and `SESSION_SECRET`), then from the project root:

```text
docker compose --profile app up -d --build
```

This builds the backend and frontend images, runs the migrations once (the `migrate` service exits when done), starts the API (internal port 3000) and serves the frontend on http://localhost:8080 (`FRONTEND_PORT` to change), where nginx forwards `/api` to the backend. Both containers run as non-root users and contain no tests, scripts or `.env`; secrets are passed only as environment variables at run time. The backend runs with `NODE_ENV=production`, so the session cookie is `Secure`: browsers accept it over plain http only on `localhost`; use HTTPS in front of any real deployment.

## Backend behavior

- API errors always use `{ "error": { "code", "message", "correlationId", "details?" } }`. Unexpected errors return a generic `INTERNAL_ERROR` and the cause is only logged.
- Every request gets a correlation ID (a valid incoming `x-request-id` is reused), returned in the `x-request-id` header and written to each log line.
- Logs are structured JSON (pino). These fields are always redacted: `password`, `passwordHash`, `token`, `apiToken`, `apiKey`, `secret`, `sessionSecret`, `authorization`, `cookie`, `prompt`, `completion`, `comment`, at the top level and one level deep, plus `set-cookie` headers. The list lives in `backend/src/logger.ts`.
- `GET /api/v1/health` returns 200 when the database answers and 503 `DATABASE_UNAVAILABLE` otherwise; it recovers when the database returns.
- Run the backend with `npm run dev` (needs `DATABASE_URL`, read from the environment or `../.env`). Optional `PORT` (default 3000) and `LOG_LEVEL` (default `info`).

## Authentication

- One shared administrator password. Generate the hash with `npm run hash-password` in `backend/` and put it in `APP_ADMIN_PASSWORD_HASH`.
- `POST /api/v1/auth/login` with `{ "password" }` sets an HttpOnly, SameSite=Strict `wsr_session` cookie (Secure when `NODE_ENV=production`) and returns `{ csrfToken, expiresAt }`. `GET /api/v1/auth/session` returns the same for an existing session; `POST /api/v1/auth/logout` clears the cookie.
- Only `/api/v1/health` and `/api/v1/auth/login` are public. Every other `/api/v1` route returns 401 `UNAUTHENTICATED` without a valid session, including unknown paths.
- State-changing requests must send the CSRF token in the `x-csrf-token` header (403 `CSRF_INVALID`), and an `Origin` header, if present, must match the host (403 `ORIGIN_NOT_ALLOWED`).
- Failed logins are limited to 5 per 15 minutes per client (429 `TOO_MANY_ATTEMPTS` with `Retry-After`).
- Rotation: change `SESSION_SECRET` to invalidate every session; change `APP_ADMIN_PASSWORD_HASH` to rotate the password. Restart the backend afterwards.
- Known limitation: sessions are stateless signed cookies, so logout clears the cookie but a copied cookie stays valid until it expires or the secret changes.

## Reports (Phase 1)

- **Jira layer**: `backend/src/jira` holds the client (retries, error mapping, ADF to text), enrichment (changelog, comments, sprint) and the incremental sync into `issue_history`. Connection settings come from `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY` and `JIRA_BOARD_ID`.
- **Validation gate**: `POST /api/v1/validate` checks the connection and field choices and records `validation_passed_at`. Report generation is refused until it passes (and again after the field settings change).
- **Reports API** (all under `/api/v1`, session and CSRF required):
  - `POST /reports` with `{ weekStart?, timeZone?, dryRun? }` returns 202 and a job. Jobs run one at a time, time out after 10 minutes, and a restart marks unfinished jobs `JOB_INTERRUPTED`.
  - `GET /reports/latest`, `GET /reports/:id` (status, stage, warnings), `GET /reports/:id/data` (the report; 410 once past the 52-week retention).
  - `GET /reports/:id/deck` downloads `Weekly_Status_<KEY>_<YYYY-MM-DD>.pptx`; `POST /reports/:id/deck` rebuilds it from stored data without calling Jira. Dry runs have no deck.
- **Deck**: 16:9, slides in order title, executive summary, milestones, completed, planned, risks and appendix. Tables hold at most 10 rows per slide, the deck is capped at 25 slides (the rest is summarized and a `DECK_TRUNCATED` warning is added), and issue keys link to Jira. The trend slide arrives in Phase 2.
- **UI**: sign in, then pick a week and time zone (or leave blank for last week), optionally tick dry run, and generate. Progress is polled; the Dashboard tab shows overall RAG with reasons and milestone progress, the Report tab shows completed, planned and risks.

### Running against the mock Jira

```text
cd backend
npm run mock-jira                      # mock Jira on http://localhost:4010 (MOCK_JIRA_ISSUES, MOCK_JIRA_LATENCY_MS, MOCK_JIRA_PORT)
# in ../.env: JIRA_BASE_URL=http://localhost:4010, JIRA_EMAIL=dev@example.com, JIRA_API_TOKEN=x, JIRA_PROJECT_KEY=DEMO, JIRA_BOARD_ID=1
npm run migrate
npm run seed                           # records validation_passed_at; add -- --reset to clear jobs and the history cache
npm run dev                            # backend on :3000
cd ../frontend && npm run dev          # UI on :5173
```

The mock's data is dated around 2026-10-21, so pick a week such as 2026-10-14 in the UI. `npm run bench:sync` times a sync against the mock.

### End-to-end test

`cd frontend && npx playwright install chromium && npm run e2e` starts the mock Jira, the backend and Vite, seeds validation, and drives sign-in, generation, the report view and the deck download. It needs PostgreSQL with migrations applied; set `E2E_DATABASE_URL` if it is not `postgres://wsr:change-me@localhost:5432/wsr`. CI runs it in the `e2e` job.

## Technology choices

Confirmed in task T0.1 with a throwaway spike (Node.js 24, Windows). Exact versions are pinned by the lockfiles added in T0.3.

| Concern | Choice | Version tested | Spike result |
|---------|--------|----------------|--------------|
| Deck generation | `pptxgenjs` | 4.0.0 | 16:9 layout, 3 slides from a 25-row table split at 10 rows per slide, 25 Jira hyperlinks inside table cells; verified by reading the generated file |
| Validation | `zod` | 4.6.7 | Schema accepts and rejects as expected |
| Migrations | `node-pg-migrate` | 9.0.0 | CLI loads on Node 24; requires Node 20.11 or later; used with `up` only (forward-only, no `down` files) |
| Password hashing | `argon2` | 0.45.1 | Hash and verify work, including a wrong-password check |
| Database driver | `pg` | 8.23.1 | Installs; used by migrations and repositories |

### Dependency audit note

`pptxgenjs` 4.0.0 pulls in `image-size` 1.x, which `npm audit` reports with two high-severity denial-of-service findings (JXL, HEIF and ICNS parsers). The constitution blocks merges on high-severity findings, so the backend `package.json` must pin `"overrides": { "image-size": "^2.0.3" }`. With that override the spike reported 0 vulnerabilities and the deck still built correctly. Do not upgrade to `pptxgenjs` 4.0.1, which depends on a vulnerable `image-size` range without an override.

`argon2` runs an install script; allow it explicitly in the backend and in CI when npm asks for install-script approval.
