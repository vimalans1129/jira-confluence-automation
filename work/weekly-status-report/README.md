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

`.github/workflows/ci.yml` (repository root) runs for both packages: format check, lint, type check, tests, build and `npm audit --audit-level=high` (high or critical findings fail the build). The backend job runs against a PostgreSQL 15 service container, applies migrations, and sets `TEST_DATABASE_URL`.

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
