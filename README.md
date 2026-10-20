# IT Helpdesk & Complaint Management

Employees report IT problems through a public form (no login). The IT administrator tracks, updates and resolves
them in a secure dashboard. MongoDB Atlas is the source of truth; n8n Cloud mirrors every complaint into a Google
Sheet, so the old Excel workflow keeps working without anyone typing into it.

**Stack:** Next.js (App Router) + TypeScript, Tailwind CSS + shadcn-style components, MongoDB Atlas, n8n Cloud, Google Sheets, Recharts, Zod + React Hook Form, Lucide icons.

## How it fits together

```
Employee ──► /complaint ──► POST /api/complaints
                              1. validate, rate-limit, sanitise
                              2. ONE transaction: complaint + audit entry + sync job   ◄── MongoDB = truth
                              3. respond (the employee never waits for the spreadsheet)
                              4. in the background: send the job to n8n
                                       │
                 n8n workflow A/B ◄────┘  finds the row by exact Complaint ID, appends or updates it,
                      │                   and replies; the app counts it as done ONLY on a confirmed reply
                      ▼
                Google Sheet "IT Complaints"
Admin ──► /admin (session cookie) ──► edit / resolve ──► same transaction pattern ──► n8n workflow B
n8n workflow C (every 15 min) ──► POST /api/internal/sync/run ──► retries anything that failed or was missed
Admin ──► Sheet check ──► compares every complaint with every sheet row; repairs missing rows and wrong statuses
```

Key guarantees: a stored complaint is never lost when n8n or Google is down; a complaint can be resolved exactly once;
only the matching sheet row is ever updated (never the last row, never "all Pending"); the app never reports a sheet
sync as done until n8n confirms it.

## What is built

| Phase | Delivered |
|---|---|
| 1 Foundation | Forest/emerald design system, admin shell, accessible components |
| 2 Data and API | MongoDB schemas, validators and unique indexes, complaint creation API, rate limiting, readable unique IDs |
| 3 Public form | Validated form with counters and priority guidance, duplicate-submit protection, confirmation page |
| 4 Admin security | Argon2id passwords, revocable server-side sessions, CSRF defence, login rate limits, server-side authorization on every page and API |
| 5 Admin workflow | Dashboard with 5 charts and date filters, searchable/sortable/paginated table, details and edit page with optimistic concurrency, atomic resolve, history |
| 6 n8n and Sheets | Three importable workflows, webhook auth, idempotent row writes, formula-injection protection |
| 7 Reliability | Transactional outbox, bounded exponential retries, retry button, audit log, read-only sheet reconciliation with safe repairs |
| 8 Quality and docs | Unit, integration and browser tests; deployment, troubleshooting, verification and API documents; Settings editor for departments and categories |

## Quick start (Windows PowerShell)

```powershell
npm install
Copy-Item .env.example .env.local      # then fill it in: see docs/DEPLOYMENT.md
npm run db:init                         # once per database
npm run admin:create                    # first administrator (hidden password prompt)
npm run dev                             # http://localhost:3000/complaint  and  /admin/login
```

You must set up three external things yourself; until you do, the app shows "Awaiting configuration" for them:
**MongoDB Atlas**, the **Google service account and sheet**, and **n8n**. Exact steps: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) and [`n8n/README.md`](n8n/README.md).

## Documents

| Read this | For |
|---|---|
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Windows setup, Atlas, Google, environment variables, Vercel deployment, monitoring |
| [`n8n/README.md`](n8n/README.md) | Sheet layout, service account, importing the three workflows, every node explained, test URLs vs production URLs |
| [`docs/VERIFICATION.md`](docs/VERIFICATION.md) | Tick-box checklist proving the whole lifecycle on the real stack |
| [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) | Symptom, cause, fix |
| [`docs/API.md`](docs/API.md) | Every endpoint, request, response and status code |

## Commands

| Command | Does |
|---|---|
| `npm run dev` / `build` / `start` | Run, build, serve |
| `npm run typecheck` | TypeScript check |
| `npm run test:unit` | Fast tests, nothing external needed |
| `npm run test:integration` | Real MongoDB behaviour (downloads a test binary once) |
| `npm run test:e2e` | Whole lifecycle in a browser (`npx playwright install chromium` first) |
| `npm run db:init` | Collections, validators, indexes (idempotent) |
| `npm run admin:create` | Create an administrator, or `-- --reset-password` |

## Design decisions worth knowing

- **Times:** stored in UTC; shown in Asia/Karachi; the server's clock decides every timestamp, never the browser's.
- **Complaint ID:** `IT-YYYYMMDD-XXXX` (4 random characters without 0/O/1/I/L). Uniqueness comes from a unique index with retry, not from the format.
- **Duration:** `solveDurationMinutes` = `solvedAt − receivedAt`, nearest minute (halves up), computed inside the same database operation that resolves the complaint. Dashboard averages use resolved complaints only.
- **Free text** is stored as plain text and escaped when displayed (never stripped, so "press <Enter>" survives). In the sheet, text starting with `=`, `+`, `-` or `@` gets a leading apostrophe so it can never run as a formula.
- **Privacy:** logs contain IDs and correlation IDs, never names, descriptions, contact numbers, passwords or tokens. Contact numbers are never sent to the sheet.
- **No CAPTCHA by default**; `src/lib/abuse.ts` is the one place to add it if spam appears.
- **Sessions:** server-side and revocable (not a signed cookie that can't be cancelled); 12 hours maximum, 1 hour idle.

## Project structure

```
src/app/            pages (public /complaint, admin /admin/*) and API routes (/api/*)
src/components/     ui/ (base components), forms/, complaints/, dashboard/, layout/
src/lib/            business logic: complaint-service, complaint-admin-service, dashboard-service,
                    sync-service, reconcile, auth, permissions, n8n, google-sheets, validation, time, range
src/models/         MongoDB document types, validators, indexes
src/proxy.ts        first-layer gate for /admin and /api/admin (real checks are server-side)
n8n/                the three importable workflows + their documentation
scripts/            db:init, admin:create, e2e runner
tests/              unit/, integration/, e2e/, support/ (the fake n8n used by contract and e2e tests)
docs/               deployment, troubleshooting, verification, API
```
