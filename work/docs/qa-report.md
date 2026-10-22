# QA Report: Weekly Status Report Generator

## Summary

- **Date**: 2026-10-22
- **Application**: `weekly-status-report/` (React 18 + Vite frontend, Express + TypeScript backend, PostgreSQL 15)
- **Environment**: local development. Compose PostgreSQL, backend on http://localhost:3000, frontend on http://localhost:5173, tested in Chrome 155 through Chrome DevTools.
- **Overall status**: pass, with one environment limitation (Jira is not configured in the dev instance, by request).

## Environment setup

- `.env` was missing, so a local one was generated with development-only credentials (database password, session secret, Argon2 admin hash). Jira and LLM settings were left blank.
- `docker compose up -d --wait` started PostgreSQL (healthy). `npm run migrate` reported no pending migrations.
- Backend and frontend were started with `npm run dev`. Health check `GET /api/v1/health` returned 200 with the database up.

## Pages visited

| # | Page | URL | Result |
|---|------|-----|--------|
| 1 | Sign in | `http://localhost:5173/` (logged out) | Pass |
| 2 | Dashboard tab | `http://localhost:5173/` (logged in) | Pass |
| 3 | Report tab | `http://localhost:5173/` (logged in) | Pass, screenshot unreliable |
| 4 | Overrides tab | `http://localhost:5173/` (logged in) | Pass |

The application is a single-page app with no hyperlinks. The tabs switch content without changing the URL.

## Elements tested

| Area | Elements | Result |
|------|----------|--------|
| Sign in | "Password" textbox, "Sign in" button | Login with the generated admin password succeeded |
| Session | Page reload while signed in | Session persisted (`/api/v1/auth/session` OK) |
| Header | "Sign out" button | Present, not exercised |
| Generate panel | Week date field and picker, "Time zone" textbox, "Dry run" checkbox, "Generate" button | Rendered. Generate returned a handled error (see bug 1) |
| Deck actions | "Download deck", "Regenerate deck" | Regenerate returned 200. Download clicked, file save not confirmed |
| Tabs | "Dashboard", "Report", "Overrides" buttons | All switch views correctly |
| Dashboard | Overall status badge, milestone progress table (Workstream 1 to 20, "No Epic"), Trend chart, "Number of weeks" dropdown, "Trend data" table | Rendered with data |
| Report | Status overrides list, "Completed this week", "Planned next week", "Overdue items", "Key risks and issues" | Rendered with data |
| Overrides | "Applies to" and "Status" dropdowns, "Reason (required)" textarea, "Save override", "Current overrides" table with "Remove override" buttons | Rendered with 3 existing overrides, not modified |

## Automated end-to-end tests

The Playwright suite ran against the project's mock Jira on a temporary `wsr_e2e` database, which was dropped afterwards. The `wsr` database was not touched.

| Test | Result |
|------|--------|
| Sign in, generate against the mock Jira, see the report and download the deck | Pass |
| A dry run shows metrics without offering a deck | Pass |
| Two consecutive weeks give a trend, and an override shows everywhere | Pass |

Result: 3 passed. Frontend `npm run lint`, `npm run typecheck` and `npm run format` also pass.

## Bugs and issues found

| # | Severity | Issue | Status |
|---|----------|-------|--------|
| 1 | Medium (environment) | `POST /api/v1/reports` returns 409 `JIRA_NOT_CONFIGURED` because the `JIRA_*` variables are blank in `.env`. The UI shows the error message correctly. | Not fixed, by request. Generation passes against the mock Jira in the e2e suite |
| 2 | Low | `GET /favicon.ico` returned 404, logged as a console error | Fixed |
| 3 | Info | Chrome verbose hint: password forms should have a hidden username field | Open, optional |
| 4 | Info | Backend logs `DECK_TRUNCATED` when rebuilding a deck. Expected: the deck is capped at 25 slides and the data has 20 workstreams. | No action |
| 5 | Info | 401 console errors on the session check while signed out | Expected behavior |
| 6 | Tooling | Full-page screenshots of the Report tab timed out or returned stale output | Workaround: viewport and JPEG screenshots |

## Fixes applied

- **Favicon 404**: added `<link rel="icon" href="data:," />` to `frontend/index.html`. After the fix the console showed no errors or warnings on a fresh load. The 401 and verbose messages above came from earlier loads.

## Browser console check

After a hard reload, the console contained only Vite debug messages and the React DevTools info message. There were no JavaScript errors or warnings.

## Current status

- **Servers**: PostgreSQL, backend (`3000`) and frontend (`5173`) are running and healthy.
- **Tests**: 3 of 3 end-to-end tests pass. Lint, type check and format checks pass.
- **Open items**:
  + Configure Jira, or run the mock Jira, to use Generate in the dev instance.
  + Optional: add a hidden username field to the sign-in form.
  + Not tested: sign out, invalid password and rate limiting, saving or removing overrides, changing the trend week range, confirming a downloaded `.pptx`.
