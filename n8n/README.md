# n8n integration: Google Sheets sync

MongoDB is the source of truth. n8n is the only thing that writes to Google Sheets, and it only does so
when the helpdesk app asks it to. This folder holds three importable workflows:

| File | Workflow | Purpose |
|---|---|---|
| `new-complaint-sync.json` | **A** | Append one row for a new complaint (idempotent) |
| `resolve-complaint-sync.json` | **B** | Update exactly one existing row (edits and resolutions) |
| `reconciliation.json` | **C** | Every 15 minutes, ask the app to retry failed or missed syncs |

> **Honest status:** these files were generated and checked by automated tests (structure, expressions, and the
> Code-node logic run against realistic payloads), but they have **not been run against a live n8n Cloud instance
> or a real Google Sheet from here**. n8n node versions differ slightly between releases, so after importing,
> open each Google Sheets node once; if n8n shows a warning, re-select the credential, the sheet, and the
> operation. Then run the verification in section 7.

## 1. How a sync works

```
App stores complaint in MongoDB ─ same transaction ─► SyncJob (outbox)
        │ after the response is sent
        ▼
POST  {webhook URL}    header X-Webhook-Secret: <secret>    body: SyncEvent JSON
        ▼
n8n validates → looks up the row by Complaint ID → append / update → replies JSON
        ▼
App marks the job "done" ONLY if the reply says ok:true AND echoes the same eventId + complaintId
```

If n8n or Google Sheets is down, the job stays queued and is retried with exponential backoff
(30 s, 1 m, 2 m … capped at 1 h, 8 attempts). The complaint is never lost and the employee never waits.

### Request (app → n8n)

```json
{
  "schemaVersion": 1,
  "eventId": "complaint.created:IT-20261018-A7K2",
  "eventType": "complaint.created",
  "sentAt": "2026-10-18T05:30:02.114Z",
  "complaintId": "IT-20261018-A7K2",
  "row": { "Complaint ID": "IT-20261018-A7K2", "User Name": "…", "…": "all 16 columns, as text" }
}
```

`eventType` is `complaint.created` (workflow A) or `complaint.updated` / `complaint.resolved` (workflow B). `eventId` is `complaint.created:<id>`, `complaint.updated:<id>:<version>` or `complaint.resolved:<id>:<version>`, so every change has its own idempotency key.
`row` is a full snapshot of how the row should look now, already formatted for the sheet (Asia/Karachi dates,
readable durations, formula-looking text neutralised), so a retry can never apply stale or duplicate changes.
Contact numbers are deliberately **not** sent.

### Response (n8n → app)

| HTTP | Body | Meaning to the app |
|---|---|---|
| 200 | `{ ok: true, result: "appended" \| "already_exists" \| "updated", eventId, complaintId, rowNumber }` | Confirmed by the Sheets node. Job done. |
| 400 | `{ ok: false, error: "invalid_payload", message }` | Bug or tampering. Job marked dead, no retry. |
| 404 | `{ ok: false, error: "row_missing" }` (workflow B) | Sheet and database disagree. **Needs reconciliation; no row is inserted.** Not auto-retried. |
| 409 | `{ ok: false, error: "duplicate_rows" }` | More than one row has this ID. Nothing is updated. Needs reconciliation. |
| 502 | `{ ok: false, error: "sheets_error", message }` | Google Sheets failed. Retried with backoff. |
| 401/403 | n8n's own rejection | Wrong or missing webhook secret. Retried (so fixing the secret recovers without losing anything). |
| other / no `ok` | n8n error pages, timeouts | Retried. A bare `200 OK` is **never** treated as success. |

## 2. Prepare the Google Sheet

1. Create a spreadsheet (any name). Rename the first tab to exactly **`IT Complaints`**.
2. In row 1, put these 16 headers in this exact order (copy the line, paste into cell A1 with "Paste" so each lands in its own column):

```
Complaint ID	User Name	Department	Problem Category	Problem Description	Priority	Received Date	Received Time	Solved Date	Resolve Time	Solve Duration	Work Stuck Reason	Status	Resolution Notes	Resolved By	Last Updated
```

3. Copy the spreadsheet ID from its URL: `https://docs.google.com/spreadsheets/d/<THIS PART>/edit`.
4. Don't add formulas, filters that hide rows, or extra header rows. Don't sort the sheet by hand while testing
   (row numbers are read fresh each time, so sorting is safe, but a header row must stay in row 1).

## 3. Google service account (no browser login, no expiring tokens)

1. [Google Cloud Console](https://console.cloud.google.com) → create a project (e.g. `it-helpdesk`).
2. **APIs & Services → Library** → enable **Google Sheets API** (also enable **Google Drive API** if n8n asks for it).
3. **IAM & Admin → Service Accounts → Create** (no roles needed). Open it → **Keys → Add key → JSON**. A file downloads. Treat it like a password.
4. Open your spreadsheet → **Share** → paste the service account's email (`…@…iam.gserviceaccount.com`) → **Editor**.
   Share *only this spreadsheet* with it.
5. Never commit the JSON file. It is only ever pasted into n8n (step 4), never into the app.

## 4. Create credentials in n8n Cloud

| Credential | Type | Fields | Used by |
|---|---|---|---|
| **Helpdesk Google service account** | *Google Service Account API* | Service Account Email and Private Key from the JSON file (`client_email`, `private_key`) | Google Sheets nodes in A and B |
| **Helpdesk webhook secret** | *Header Auth* | Name `X-Webhook-Secret`, Value = the app's `N8N_WEBHOOK_SECRET` | Webhook nodes in A and B |
| **Helpdesk sync runner secret** | *Header Auth* | Name `Authorization`, Value = `Bearer ` + the app's `SYNC_RUNNER_SECRET` | HTTP Request node in C |

Generate the two secrets (different values, 32+ characters each):

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## 5. Import and configure the workflows

For each of the three files: n8n → **Workflows → ⋯ → Import from file**.

1. **A and B:** open the **Config** node and replace `PASTE_SPREADSHEET_ID_HERE` with your spreadsheet ID. Keep `sheetName` as `IT Complaints`.
2. **A and B:** on the **Webhook** node choose the *Helpdesk webhook secret* credential. On every **Google Sheets** node choose the *Helpdesk Google service account* credential.
3. **C:** open **Config**, set `appBaseUrl` to your deployed app (for example `https://helpdesk.example.com`, https, no trailing slash). On **Run Sync Retries** choose the *Helpdesk sync runner secret* credential.
4. **Do not change the Cell Format option (RAW) on the Sheets write nodes.** It is what stops Google from evaluating complaint text as formulas.
5. Toggle each workflow **Active**.
6. Open the Webhook node in A and B and copy the **Production URL** (it contains `/webhook/`, **not** `/webhook-test/`).

### Test URL vs production URL, and localhost

* The **Test URL** (`/webhook-test/…`) only works for one call while you click *Listen for test event* in the editor. The app must never use it.
* The **Production URL** (`/webhook/…`) only works while the workflow is **Active**. Put these in `.env.local` / Vercel:

```
N8N_NEW_COMPLAINT_WEBHOOK_URL=https://<you>.app.n8n.cloud/webhook/helpdesk/complaint-created
N8N_UPDATE_COMPLAINT_WEBHOOK_URL=https://<you>.app.n8n.cloud/webhook/helpdesk/complaint-updated
N8N_WEBHOOK_SECRET=<secret 1>
SYNC_RUNNER_SECRET=<secret 2>
```

* **App → n8n works from your laptop** (your app can call n8n Cloud's public URL), so you can run `npm run dev` and sync for real.
* **n8n → app does not work for `localhost`:** n8n Cloud cannot reach `http://localhost:3000`. Workflow C (the retry runner) therefore needs the **deployed**
  app URL. While developing locally you don't need C: the app already tries the sync right after each submission. To retry locally, trigger it yourself:

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/internal/sync/run -Headers @{ Authorization = "Bearer <SYNC_RUNNER_SECRET>" }
```

## 6. Node-by-node reference

### Workflow A: New complaint sync

| # | Node | Type | Configuration | Success → | Failure → |
|---|---|---|---|---|---|
| 1 | **Webhook** | Webhook v2 | POST `/helpdesk/complaint-created`; auth *Header Auth*; respond via *Respond to Webhook* node | Config | wrong/missing secret: n8n answers 403 itself |
| 2 | **Config** | Set v3.4 | `spreadsheetId`, `sheetName`; keeps the incoming fields | Validate Payload | |
| 3 | **Validate Payload** | Code v2 | Rejects unless: `schemaVersion = 1`; `eventType = complaint.created`; ID matches `IT-########-XXXX`; `eventId = complaint.created:<id>`; all 16 columns present as text (≤ 4000 chars); `row["Complaint ID"]` equals `complaintId`. Outputs `valid` and `reason`. | Valid? | |
| 4 | **Valid?** | IF v2.2 | `{{ $json.valid }}` is true | true → Find Rows | false → Respond Invalid Payload |
| 5 | **Find Rows by Complaint ID** | Google Sheets v4.5 | Read; filter column `Complaint ID` = `{{ $json.complaintId }}`; *Always Output Data* on; service-account auth | Evaluate Matches | **error output** → Respond Sheets Error |
| 6 | **Evaluate Matches** | Code v2 | Counts rows whose `Complaint ID` equals the ID exactly (trimmed): 0 → `append`, 1 → `exists`, >1 → `duplicate` | Needs Append? | |
| 7 | **Needs Append?** | IF v2.2 | `{{ $json.action }}` equals `append` | true → Append Row | false → Already Exists? |
| 8 | **Append Row** | Google Sheets v4.5 | Operation *Append*; maps each of the 16 columns explicitly, e.g. `{{ $('Validate Payload').first().json.row["User Name"] }}`; **Cell Format RAW** | Respond Appended | **error output** → Respond Sheets Error |
| 9 | **Already Exists?** | IF v2.2 | `{{ $json.action }}` equals `exists` | true → Respond Already Exists | false → Respond Duplicate Rows |
| 10 | **Respond Appended** | Respond to Webhook | 200 `{ ok:true, result:"appended", eventId, complaintId, rowNumber }` | | |
| 11 | **Respond Already Exists** | Respond to Webhook | 200 `{ ok:true, result:"already_exists", … }` (duplicate delivery, no second row) | | |
| 12 | **Respond Duplicate Rows** | Respond to Webhook | 409 `duplicate_rows` (integrity error, nothing written) | | |
| 13 | **Respond Invalid Payload** | Respond to Webhook | 400 `invalid_payload` with the reason | | |
| 14 | **Respond Sheets Error** | Respond to Webhook | 502 `sheets_error` with a ≤ 200 char message | | |

### Workflow B: Update or resolve complaint sync

Nodes 1–6 mirror workflow A with these differences: path `/helpdesk/complaint-updated`; **Validate Payload** accepts
`complaint.updated` or `complaint.resolved` and requires `eventId` to start with `<eventType>:<complaintId>`;
**Evaluate Matches** returns `missing` / `update` / `duplicate` and the matched `row_number`.

| # | Node | Type | Configuration | Success → | Failure → |
|---|---|---|---|---|---|
| 7 | **Can Update?** | IF v2.2 | `{{ $json.action }}` equals `update` (exactly one match) | true → Update Row | false → Row Missing? |
| 8 | **Update Row** | Google Sheets v4.5 | Operation *Update*; **matching column `row_number`** = the single verified row; writes only: Department, Problem Category, Priority, Solved Date, Resolve Time, Solve Duration, Work Stuck Reason, Status, Resolution Notes, Resolved By, Last Updated; **RAW** | Respond Updated | **error output** → Respond Sheets Error |
| 9 | **Row Missing?** | IF v2.2 | action equals `missing` | true → Respond Row Missing | false → Respond Duplicate Rows |
| 10 | **Respond Updated** | Respond to Webhook | 200 `{ ok:true, result:"updated", …, rowNumber }` | | |
| 11 | **Respond Row Missing** | Respond to Webhook | 404 `row_missing`. **No row is inserted.** | | |
| 12 | **Respond Duplicate Rows** | Respond to Webhook | 409 `duplicate_rows`; nothing updated | | |

Isolation guarantees: the row is chosen by an exact `Complaint ID` match, confirmed to be the *only* match, then
written **by its row number**. There is no "last row" logic and no status-based update, and the workflow contains no
Append node at all. Complaint ID, User Name, Problem Description, Received Date and Received Time are never overwritten.
Re-delivering the same event rewrites identical values, so retries are safe.

### Workflow C: Sync retry runner

| # | Node | Type | Configuration | Success → | Failure → |
|---|---|---|---|---|---|
| 1 | **Every 15 Minutes** | Schedule Trigger v1.2 | every 15 min (≈ 2,900 executions/month; raise the interval if your plan is tight) | Config | |
| 2 | **Config** | Set v3.4 | `appBaseUrl` | Run Sync Retries | |
| 3 | **Run Sync Retries** | HTTP Request v4.2 | POST `{appBaseUrl}/api/internal/sync/run`, 60 s timeout, *Header Auth* credential (`Authorization: Bearer …`) | Needs Attention? | HTTP error ⇒ the execution fails (shows red in n8n) |
| 4 | **Needs Attention?** | IF v2.2 | `{{ $json.data.queue.needsAttention }}` > 0 | true → Raise Alert | false → end |
| 5 | **Raise Alert** | Stop and Error v1 | Fails the run on purpose with a message | | n8n's failure notifications fire |

Workflow C currently **retries**. Comparing every MongoDB complaint with every sheet row (reconciliation) is added in Phase 7.

## 7. Verify it end to end

1. **n8n alone.** With A active, post a sample event straight to the production URL (use your own secret and an ID in the right format):

```powershell
$body = @{ schemaVersion=1; eventId="complaint.created:IT-20261018-TEST"; eventType="complaint.created"; sentAt=(Get-Date).ToUniversalTime().ToString("o"); complaintId="IT-20261018-TEST"
  row=[ordered]@{ "Complaint ID"="IT-20261018-TEST"; "User Name"="Test User"; "Department"="IT"; "Problem Category"="Other"; "Problem Description"="Webhook test"; "Priority"="Normal";
  "Received Date"="18-Oct-2026"; "Received Time"="10:30 AM"; "Solved Date"=""; "Resolve Time"=""; "Solve Duration"=""; "Work Stuck Reason"=""; "Status"="Pending"; "Resolution Notes"=""; "Resolved By"=""; "Last Updated"="18-Oct-2026 10:30 AM" } } | ConvertTo-Json -Depth 5
Invoke-RestMethod -Method Post -Uri "<PRODUCTION URL A>" -Headers @{ "X-Webhook-Secret"="<secret 1>" } -ContentType "application/json" -Body $body
```

   Expect `ok: True, result: appended` and one new row. Run it again: expect `already_exists` and still one row. (Delete the test row afterwards. Real complaint IDs avoid the characters 0, 1, I, L and O, and so does this test ID.)
2. **Wrong secret.** Repeat with a bad secret: expect 403 and no row.
3. **Through the app.** Submit a real complaint at `/complaint`. Within a few seconds a row appears. In MongoDB the complaint shows `googleSheetSynced: true`, `syncState: "synced"`, and the admin dashboard says nothing is waiting.
4. **Outage behaviour.** Deactivate workflow A, submit a complaint: it is stored, the dashboard shows 1 waiting. Reactivate A and call the runner (or wait for C): the row appears and the queue empties.

## 8. Privacy and operations

* Success executions are not saved (`saveDataSuccessExecution: none`) so employee names and problem text don't pile up in n8n. **Failed executions are saved** (needed for debugging) and do contain that text: set a short execution-data retention in your n8n settings.
* Rotate `N8N_WEBHOOK_SECRET` / `SYNC_RUNNER_SECRET` by changing the value in both n8n and the app environment together.
* If the service-account key leaks: delete the key in Google Cloud, create a new one, update the n8n credential.
* Anything the dashboard reports as *needs attention* can be retried from that complaint's page (**Retry sync**). If the cause was a missing sheet row (`row_missing`), restore or add the row first (the Complaint ID must match exactly), then retry; the workflows never insert a row on an update.
