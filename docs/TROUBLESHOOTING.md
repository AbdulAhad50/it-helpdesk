# Troubleshooting

Find the symptom, then the fix. Every API error includes a `correlationId`; search for it in the logs.

## Setup and database

| Symptom | Cause | Fix |
|---|---|---|
| App crashes at start or every page errors: `Invalid environment configuration: …` | A required variable is missing or too short | Compare `.env.local` with `.env.example`. `AUTH_SECRET`, `N8N_WEBHOOK_SECRET` and `SYNC_RUNNER_SECRET` need 32+ characters |
| Form says the system is temporarily unavailable; logs show `db.unavailable` | Atlas unreachable | Check Atlas **Network Access** (your IP changed? Vercel allowed?), the password in `MONGODB_URI`, and that the cluster isn't paused (free clusters pause after inactivity) |
| `Transaction numbers are only allowed on a replica set member or mongos` | Using a plain local `mongod` | Use Atlas (always a replica set), or start a local single-node replica set |
| `npm run db:init` says `MONGODB_URI is not set` | Scripts read `.env.local` | Create `.env.local` in the project folder (not `.env.example`) |
| Duplicate complaint IDs possible / unique errors missing | Indexes were never created | Run `npm run db:init` once per environment |
| `npm install` fails on `@node-rs/argon2` | Unsupported Node version or no prebuilt binary | Use Node 22 LTS (64-bit); delete `node_modules` and retry |
| `npm` is blocked in PowerShell | Execution policy | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| PowerShell `curl` behaves oddly | `curl` is an alias for `Invoke-WebRequest` | Use `curl.exe` or `Invoke-RestMethod` (examples in the READMEs) |
| Dates look a day off | Dates are displayed in Karachi time (UTC+5) and stored in UTC | Expected. A complaint at 00:30 Karachi time belongs to the new day |

## Admin sign-in

| Symptom | Cause | Fix |
|---|---|---|
| "Incorrect email or password" and you're sure | Wrong account, or none exists | Run `npm run admin:create`; or reset with `--reset-password` (this also signs out all sessions) |
| "Too many sign-in attempts" (429) | 10 attempts per IP or 8 per account in 15 minutes | Wait; the `Retry-After` header says how long |
| Signed in but bounced back to the login page (production build on `http://localhost`) | Production cookies are `Secure` | Use `npm run dev` locally, or test on the https deployment. Safari won't accept `Secure` cookies on plain localhost |
| Suddenly signed out | 12-hour limit, 1 hour idle, or password changed elsewhere | Sign in again |

## Spreadsheet sync (n8n)

Start at the complaint's page: **Spreadsheet sync** shows the state, the last error, and each job's attempts.

| Symptom (dashboard / complaint page) | Cause | Fix |
|---|---|---|
| "Awaiting configuration" | n8n URLs or secret missing | Set the four n8n variables (`docs/DEPLOYMENT.md` §6) and redeploy. Queued complaints sync automatically afterwards |
| "n8n rejected the request. Check that the webhook secret matches." | `N8N_WEBHOOK_SECRET` ≠ the n8n Header Auth credential value, or header name isn't exactly `X-Webhook-Secret` | Make them identical. Retries recover on their own once fixed |
| "n8n webhook not found. Check the URL and that the workflow is active." | Test URL used, workflow inactive, or wrong path | Use the **Production** URL; activate the workflow |
| "n8n did not respond in time" / "Couldn't reach n8n" | n8n outage or network | Automatic retries (30 s up to 1 h, 8 attempts) |
| "Google Sheets sync failed: …" | Sheets API error from n8n (quota, permission, sheet renamed) | Check the n8n execution for the node error; confirm the sheet is shared with the service account and the tab is named `IT Complaints` |
| "n8n replied, but its answer didn't confirm this event" | Workflow modified so it no longer replies `ok:true` with the same event/complaint ID | Re-import the original workflow JSON; don't edit the Respond nodes |
| **Needs reconciliation**: "No sheet row has this Complaint ID" | Row was deleted or never written | Run **Sheet check → Run check and queue repairs** (re-adds it), or add the row by hand, then **Retry sync** |
| **Needs reconciliation**: "N rows share this Complaint ID" | Duplicate rows in the sheet | Delete the extra row(s) by hand, then run **Sheet check**. Nothing is changed automatically |
| **Sync failed** (retries used up) | Long outage or persistent error | Fix the cause, then **Retry sync** on the complaint |
| Complaints stay "waiting" although n8n is configured | Immediate sync was cut short and Workflow C isn't running | Activate workflow C with the deployed `appBaseUrl`; set `SYNC_RUNNER_SECRET` in both places |
| n8n workflow C fails with 401 | Bearer secret mismatch | The credential value must be `Bearer ` followed by exactly `SYNC_RUNNER_SECRET` |
| n8n workflow C fails with 503 "not configured" | `SYNC_RUNNER_SECRET` empty in the app | Set it and redeploy |
| Text in the sheet starts with an apostrophe | Formula protection: text beginning with `=`, `+`, `-` or `@` is prefixed with `'` | Intended. It stops the cell becoming a formula, including in later CSV exports |
| Google Sheets node shows a warning after importing | n8n versions differ slightly | Open each Sheets node, re-select the credential, spreadsheet and operation; keep **Cell Format = RAW** |
| Row 1 isn't the 16 expected headers (Sheet check refuses) | Headers edited | Restore the exact headers and order (`n8n/README.md` §2) |
| Sheet check: "service account can't read this spreadsheet" | Not shared, or wrong ID / tab name | Share the sheet with the service account email; check `GOOGLE_SHEETS_SPREADSHEET_ID` and `GOOGLE_SHEETS_WORKSHEET_NAME` |
| Sheet check: "private key could not be read" | Key pasted wrongly | Paste the whole `private_key` value including the BEGIN/END lines; quotes and `\n` sequences are fine |

## Using the app

| Symptom | Cause | Fix |
|---|---|---|
| "Already resolved" when resolving | Someone resolved it first, or it was double-clicked | Expected and safe: the original resolution time is kept |
| "Someone else changed this complaint" when saving | Another admin saved first | Click **Reload latest**, re-apply your change |
| Employee says it didn't submit but IT sees two | The network dropped after the server saved it | The form warns about this case. Resolve the duplicate; no data is lost |
| A department or category you removed still shows on old complaints | Removing an option doesn't change existing complaints | Intended |
| "Too many submissions" on the public form | 8 per 15 minutes per connection | Wait, or (for a shared office network) raise `SUBMISSION_RATE_LIMIT` in `src/lib/constants.ts` |
| Spam submissions | Public form has no CAPTCHA by default | Implement `verifyHuman()` in `src/lib/abuse.ts` (e.g. Cloudflare Turnstile) and add the token to the form. The API already calls it |

## Tests

| Symptom | Fix |
|---|---|
| Integration tests fail to start | They download a MongoDB binary once. Check internet/proxy access to `fastdl.mongodb.org`; run `npm run test:unit` meanwhile |
| `npm test` reports failures only under `tests/integration` | Same cause. `npm run test:unit` needs nothing external |
| Playwright: "Executable doesn't exist" | `npx playwright install chromium` |
| `npm run test:e2e` times out waiting for the app | First `next dev` compile is slow; free port 3210; look at the app output printed above the failure |
