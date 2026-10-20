# API reference

All responses use one envelope. Success: `{ "ok": true, "data": … }`. Failure:
`{ "ok": false, "error": { "code", "message", "fieldErrors"?, "correlationId" } }`. Every response carries an `x-correlation-id` header and `Cache-Control: no-store`.
Internal errors never expose stack traces. Admin URLs use the human complaint ID (e.g. `IT-20261018-A7K2`), never the database ID.

**Admin authentication:** an HttpOnly session cookie from `POST /api/admin/auth/login`. Unsafe methods (POST, PUT, PATCH, DELETE) also need a same-origin `Origin` header (browsers send it) and a JSON body.

## Public

| Method and path | Purpose | Notes |
|---|---|---|
| `POST /api/complaints` | Submit a complaint | Body: `userName`, `department`, `problemCategory`, `problemDescription`, optional `priority` (default `Normal`), `contactNumber`. `201` → `{ complaintId, receivedAt, status: "Pending", spreadsheetSync: "pending" }`. `422` field errors · `429` rate limited (8 per 15 min per connection) · `413` over 16 KB · `503` database unavailable. Unknown fields (status, timestamps…) are ignored |
| `GET /api/complaints/confirmation/[complaintId]` | Limited confirmation | Returns only ID, status, priority, category, received time. `404` unknown · `429` over 60 per 15 min |

## Admin: authentication

| Method and path | Purpose | Status codes |
|---|---|---|
| `POST /api/admin/auth/login` `{ email, password }` | Sign in, sets the session cookie | `200` · `401` (same answer for unknown email, wrong password, disabled account) · `422` · `429` (10 per IP, 8 per account / 15 min) |
| `POST /api/admin/auth/logout` | Ends the session on the server | `200` · `401` |
| `GET /api/admin/auth/me` | Current admin | `200` · `401` |
| `POST /api/admin/auth/change-password` `{ currentPassword, newPassword }` | Signs out all other sessions | `200` · `400` wrong current password · `422` weak password · `429` |

## Admin: complaints

| Method and path | Purpose | Notes |
|---|---|---|
| `GET /api/admin/complaints` | List | Query: `q`, `status` (Pending, Resolved), `priority`, `department`, `category`, `from`, `to` (YYYY-MM-DD, Karachi days, inclusive), `sort` (`received`, `priority`, `status`), `dir` (`asc`, `desc`), `page`, `pageSize` (10, 25, 50, 100). Returns `{ items, total, page, pageSize, totalPages }`. `422` on invalid parameters |
| `GET /api/admin/complaints/[id]` | One complaint | `{ complaint, history, syncJobs }`. `404` |
| `PATCH /api/admin/complaints/[id]` | Edit | Body: `version` (required, the version you saw) plus any of `priority`, `department`, `problemCategory`, `workStuckReason`, `resolutionNotes` (blank = clear). `200` → `{ changed, version, spreadsheetSync }` (a no-op returns `changed: false`). `409 STALE_VERSION` if someone else edited first · `422` · `404`. Immutable fields are not accepted |
| `POST /api/admin/complaints/[id]/resolve` | Resolve | Body: optional `workStuckReason`, `resolutionNotes`. `200` → `{ complaintId, solvedAt, solveDurationMinutes, spreadsheetSync: "pending" }`. `409 ALREADY_RESOLVED` · `404`. Atomic: concurrent calls cannot both succeed |
| `POST /api/admin/complaints/[id]/sync` | Re-queue this complaint's failed syncs | `200` → `{ requeued }` · `409 NOTHING_TO_RETRY` · `404` |

## Admin: dashboard, history, settings, reconciliation

| Method and path | Purpose | Notes |
|---|---|---|
| `GET /api/admin/dashboard` | Metrics | Query: `preset` (`today`, `7d`, `30d`, `custom`), `from`, `to` for custom (max 366 days). Returns totals, average resolution minutes (resolved only), per-day series, by department, by category. `422` on a bad range |
| `GET /api/admin/audit-logs` | Audit history, newest first | Query: `complaintId`, `page`, `pageSize` (≤ 100) |
| `GET /api/admin/settings/form-options` | Current departments and categories | |
| `PUT /api/admin/settings/form-options` | Replace them | Body: `{ departments: string[], categories: string[] }`; 1 to 50 each, unique ignoring case, ≤ 100 chars. `422` field errors |
| `GET /api/admin/reconciliation` | Last sheet check and whether Google read access is configured | |
| `POST /api/admin/reconciliation` `{ repair?: boolean }` | Compare the sheet with MongoDB | With `repair: true`, re-adds missing rows and fixes wrong statuses only (max 200). `503` not configured · `422` sheet unreadable or headers wrong · `502` Google unreachable · `429` (6 per hour) |

## Internal

| Method and path | Purpose | Notes |
|---|---|---|
| `POST /api/internal/sync/run` | Retry due spreadsheet syncs | `Authorization: Bearer <SYNC_RUNNER_SECRET>`. Called by n8n workflow C. `503` if no secret is configured (disabled, never open) · `401` wrong secret |

## Common error codes
`VALIDATION_FAILED` 422 · `UNAUTHENTICATED` 401 · `FORBIDDEN_ORIGIN` 403 · `NOT_FOUND` 404 · `ALREADY_RESOLVED` / `STALE_VERSION` / `NOTHING_TO_RETRY` 409 · `RATE_LIMITED` 429 (with `Retry-After`) · `SERVICE_UNAVAILABLE` 503 (database down; nothing was saved) · `INTERNAL_ERROR` 500.
