# IT Helpdesk & Complaint Management: Phases 1–6

Status of this drop: **Phase 1 (design system), Phase 2 (MongoDB layer + complaint API) and Phase 3 (public form + success page), Phase 4 (admin authentication), Phase 5 (dashboard, complaints table, edit and resolve) and Phase 6 (n8n + Google Sheets sync)**.
Not built yet: sheet-vs-database reconciliation (rest of Phase 7), the departments/categories editor in Settings, and the end-to-end browser test (Phase 8). Spreadsheet sync is **awaiting configuration** until you follow
[`n8n/README.md`](n8n/README.md): complaints are stored in MongoDB with a queued sync job, and nothing claims they reached Google Sheets.

## Run it on Windows (PowerShell)

1. Install Node.js 22 LTS from nodejs.org. Check: `node -v`.
2. In the project folder: `npm install`
3. Create a MongoDB Atlas cluster (free M0 is fine), a database user, and add your IP under Network Access.
   Use Atlas rather than a bare local `mongod`: the outbox uses **transactions**, which need a replica set.
4. `Copy-Item .env.example .env.local`, then set `MONGODB_URI` and a random `AUTH_SECRET`:
   `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
5. `npm run db:init` creates collections, `$jsonSchema` validators and all indexes. **Required once per environment**; the unique indexes are what guarantee unique complaint IDs.
6. `npm run dev`, then open http://localhost:3000/complaint (the public form) or http://localhost:3000/design-system (dev-only style reference).

7. Create the first administrator (no default account exists; there is no public sign-up):
   `npm run admin:create` (prompts for email, name and a hidden password; min 12 characters).
   Then sign in at http://localhost:3000/admin/login.
   Lost access? `npm run admin:create -- --email you@company.com --reset-password` (also signs out every session).

## Admin workflow (Phase 5)
- **Dashboard** (`/admin/dashboard`): Today / Last 7 days / Last 30 days / custom range (by date received, Karachi time). Five summary cards and five charts, all computed by one MongoDB aggregation, not in the browser. Average resolution time uses resolved complaints only.
- **Complaints** (`/admin/complaints`): server-side search (ID or name), filters (status, priority, department, category, received dates), sorting (received, priority, status) and pagination. Every filter lives in the URL, so views can be bookmarked. Default view lists Pending first, newest first. Pending rows are highlighted.
- **Complaint page** (`/admin/complaints/IT-…`): full details, edit form, resolution, spreadsheet-sync status with a Retry button, and the complete history (who changed what, when).
- **Resolve**: a confirmation dialog, then ONE atomic MongoDB operation that checks the complaint is still Pending and records the time, the duration and the administrator together. A second click, a second admin, or a repeated request gets a clear "already resolved" and cannot change the original resolution time.
- **Edit**: priority, department, category, work stuck reason and resolution notes only. The ID, employee, description, received time and status can't be changed. Edits use optimistic concurrency: if someone else changed the complaint first, you are asked to reload rather than silently overwriting them.
- Every edit and resolution is saved together with its audit entry and its spreadsheet-sync job in a single transaction.
- Admin API (all require a signed-in session; unsafe methods also require a same-origin request): `GET /api/admin/complaints`, `GET|PATCH /api/admin/complaints/[id]`, `POST …/[id]/resolve`, `POST …/[id]/sync`, `GET /api/admin/dashboard`, `GET /api/admin/audit-logs`. URLs use the human complaint ID, never the database ID.

## Spreadsheet sync (Phase 6)
Follow **[`n8n/README.md`](n8n/README.md)** to prepare the sheet, create the Google service account, import the three workflows
(`n8n/*.json`) and set `N8N_NEW_COMPLAINT_WEBHOOK_URL`, `N8N_UPDATE_COMPLAINT_WEBHOOK_URL`, `N8N_WEBHOOK_SECRET`, `SYNC_RUNNER_SECRET`.
- After a complaint is stored, the app tries the sync once in the background (employees never wait). Failures retry with bounded exponential backoff (30 s → 1 h, 8 attempts).
- A sync is recorded as done **only** when n8n replies that the Google Sheets node succeeded and echoes the same event ID.
- The dashboard shows how many complaints are waiting or need attention.
- Workflow C (every 15 min) calls `POST /api/internal/sync/run`, protected by `SYNC_RUNNER_SECRET`. With no secret set, that endpoint is disabled.

## Admin security model (Phase 4)
- **Passwords:** Argon2id (19 MiB, 2 passes). Policy: 12 to 128 characters, no common passwords, no email name inside.
- **Sessions:** random 256-bit token in an HttpOnly, SameSite=Lax cookie (`__Host-` prefixed and Secure in production). Only a SHA-256 hash is stored in MongoDB, so logout is real revocation. Sessions end after 12 hours, or 1 hour idle.
- **Authorization is server-side on every call:** `requireAdminPage()` in each admin page and `requireAdminApi()` in each admin API route validate the session against the database. `src/proxy.ts` is only a cheap first gate (no cookie → login / 401).
- **CSRF:** SameSite=Lax + Origin must match the host on unsafe methods + JSON-only bodies.
- **Login hardening:** per-IP (10) and per-account (8) attempts per 15 minutes; identical error for unknown email, wrong password and disabled account; a dummy hash is verified for unknown emails so timing doesn't reveal them.
- **Local note:** a production build (`npm start`) on plain `http://localhost` sets a Secure cookie, which Chrome, Edge and Firefox accept on localhost but Safari does not. `npm run dev` is unaffected.

## Try the API

```powershell
curl.exe -X POST http://localhost:3000/api/complaints -H "Content-Type: application/json" `
  -d '{\"userName\":\"Ayesha Khan\",\"department\":\"Sales\",\"problemCategory\":\"Email / Outlook\",\"problemDescription\":\"Outlook keeps asking for my password.\"}'
```
Success returns `201` with `complaintId`, `receivedAt`, `status: "Pending"`, `spreadsheetSync: "pending"`.
Errors use `{ ok:false, error:{ code, message, fieldErrors?, correlationId } }`.

## Tests
- `npm run test:unit`: validation, IDs, time/duration (no database needed)
- `npm run test:integration`: needs internet once (downloads a MongoDB binary) and uses an in-memory replica set; includes the login → logout lifecycle, session expiry and rate-limit tests
- `npm run typecheck`, `npm run build`

## Design decisions in this drop
- Duration field is `solveDurationMinutes`: nearest minute, halves up (documented in `src/lib/time.ts`).
- Complaint ID: `IT-YYYYMMDD-XXXX` (Karachi date + 4 random chars, no 0/O/1/I/L). Uniqueness comes from the unique index plus retry on duplicate key.
- Rate limiting is MongoDB-backed (works on serverless); IPs are stored only as keyed hashes.
- Free text is stored as plain text with control characters stripped and **escaped on render**, not HTML-stripped (stripping would corrupt text like "press <Enter>").
- CAPTCHA hook: `src/lib/abuse.ts`, already awaited by the API.
"# it-helpdesk" 
