# Jira/Confluence Automation Constitution

## Purpose

This constitution defines the non-negotiable principles for the Jira/Confluence automation project. Every specification, plan, task list, and implementation must comply with it. Amendments follow the governance rules at the end of this document.

## Technology Stack

- **Frontend**: React 18 with Vite, written in TypeScript.
- **Backend**: Node.js (current LTS) with Express, written in TypeScript.
- **Database**: PostgreSQL 15, run locally and in CI through Docker.
- **Containers**: Docker and Docker Compose for the database and for any service that needs a reproducible runtime.
- **Package management**: `npm` with a committed lockfile; no mixing of package managers.
- Adding a new runtime, framework, or datastore requires a constitution amendment.

## Core Principles

### 1. Specification First

- Every feature starts with a written specification (`spec.md`) that describes *what* and *why* before any code is written.
- Plans, tasks, and code must trace back to a requirement in the specification.
- Ambiguities are resolved in the specification, not guessed in code.

### 2. Security First

- Jira and Confluence credentials (API tokens, OAuth secrets) are read from environment variables only; they are never committed, logged, or returned to the browser.
- The frontend never calls Atlassian APIs directly; all Jira and Confluence access goes through the backend.
- All external input (request bodies, query strings, webhook payloads, Atlassian responses) is validated with a schema before use.
- Database access uses parameterized queries only; string-built SQL is forbidden.
- Atlassian content (issue text, Confluence pages, ADF) is treated as untrusted and sanitized before rendering or storage.
- Dependencies are kept current, and known high-severity vulnerabilities block a merge.
- Each integration requests the minimum Atlassian scopes and permissions it needs.

### 3. Respect the Atlassian APIs

- Clients handle pagination, rate limits (HTTP 429 with `Retry-After`), and transient failures with bounded retries and backoff.
- Write operations are idempotent or guarded so a retry never duplicates issues, comments, or pages.
- Automated writes to Jira or Confluence support a dry-run mode and are recorded in an audit log.
- API endpoint specifics live in dedicated client modules, not in route handlers or UI components.

### 4. Test-Driven Quality

- New behavior has automated tests written before or alongside the implementation.
- Backend: unit tests for services, integration tests for routes against a real PostgreSQL 15 container.
- Frontend: component tests for logic-bearing components and at least one end-to-end test per primary user flow.
- Atlassian calls are mocked in tests; no test depends on a live Jira or Confluence instance.
- Linting, type checking, and tests must pass in CI before merge.

### 5. Simplicity

- Prefer the simplest design that satisfies the specification; no speculative features or abstractions.
- Use framework features directly (Express middleware, React hooks) before adding libraries.
- Each new dependency must be justified in the plan.

### 6. Reproducible Environments

- A new developer can run the full stack with documented commands: `docker compose up` for PostgreSQL, then `npm install` and `npm run dev`.
- Configuration is supplied through environment variables, with a committed `.env.example` that contains no real secrets.
- Database changes are made only through versioned, forward-only migration files; manual schema edits are forbidden.
- The PostgreSQL image is pinned to major version 15.

### 7. Observability and Reliability

- The backend uses structured logging with request correlation IDs and never logs secrets or personal data.
- Errors are handled centrally in Express middleware and return a consistent error shape.
- The backend exposes a health endpoint that checks database connectivity.
- Long-running or scheduled automation jobs record their status and outcome in the database.

## Architecture Standards

- **Layering**: Express routes → services → repositories/clients. Routes contain no business logic or SQL.
- **API design**: REST over JSON, versioned under `/api/v1`, with consistent status codes and error responses.
- **Frontend**: Function components and hooks only; server state is accessed through a single API client module; no business rules in components.
- **Database**: Tables use singular snake_case names with primary keys, `created_at`/`updated_at` timestamps, and explicit foreign keys and indexes.
- **Project layout**: `frontend/` and `backend/` are separate packages, with shared types kept in a clearly designated location.

## Code Quality Standards

- TypeScript `strict` mode is enabled in both packages; `any` requires a justifying comment.
- ESLint and Prettier are mandatory and enforced in CI.
- Public functions, modules, and API endpoints are documented; comments explain *why*, not *what*.
- Commits are small and focused, with messages that reference the related specification or task.

## User Experience Standards

- The UI always shows loading, empty, and error states for asynchronous data.
- Forms validate input on the client for usability and on the server for correctness.
- Interfaces meet WCAG 2.1 AA basics: keyboard navigation, labels, and sufficient contrast.

## Development Workflow

- Work follows the Spec Kit flow: constitution, specify, clarify, plan, checklist, tasks, analyze, implement, converge.
- Small features may use the shorter path: specify, plan, tasks, implement, converge.
- Changes land through pull requests with review; the main branch is always releasable.
- Every pull request states which specification requirements it satisfies.

## Governance

- This constitution supersedes other practices and conventions in the project.
- Amendments require a written rationale, a version bump, and an update to any affected specifications or plans.
- Plans and reviews must verify compliance; any justified deviation is documented in the plan under a complexity or exceptions note.

**Version**: 1.0.0 | **Ratified**: 2026-10-21 | **Last Amended**: 2026-10-21
