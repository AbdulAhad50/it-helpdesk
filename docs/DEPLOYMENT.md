# Setup and deployment guide

Everything from an empty Windows machine to a working production system. Do the steps in order.
Three things must be configured by you (the app cannot do them): MongoDB Atlas, the Google service account, and n8n.
Until each is set up, the app says **"Awaiting configuration"** for it and never pretends it is connected.

## 1. Install the tools (Windows)

1. **Node.js 22 LTS** from <https://nodejs.org> (the installer adds it to PATH). Check in PowerShell: `node -v` (must be 20.19 or newer) and `npm -v`.
2. **Git** from <https://git-scm.com> (needed for Vercel).
3. If PowerShell refuses to run `npm` ("running scripts is disabled"), run once: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

## 2. Get the project and install dependencies

The project is already created (Next.js App Router, TypeScript, Tailwind, shadcn-style components). Unzip it, then:

```powershell
cd it-helpdesk
npm install
```

(For reference, a from-scratch equivalent would be `npx create-next-app@latest` plus the packages in `package.json`. You don't need to do that.)

## 3. MongoDB Atlas (the source of truth)

1. Create a free account and a cluster at <https://cloud.mongodb.com> (the free **M0** tier is enough to start). Choose a region near your users and near your Vercel region.
2. **Database Access → Add New Database User.** Create a dedicated user (for example `helpdesk-app`) with a long random password. Built-in role: **Read and write to any database** is the simplest; for least privilege, restrict it to the `it_helpdesk` database.
3. **Network Access → Add IP Address.**
   * For local development: *Add Current IP Address*.
   * For Vercel: serverless functions don't have fixed IPs, so Atlas can't be restricted to them on the free plan. The common approach is `0.0.0.0/0` (anywhere) **with a strong database password and a dedicated user**. Better options: Vercel's *Secure Compute* / static IPs (paid), or an Atlas private endpoint. Never reuse this password elsewhere.
4. **Connect → Drivers** and copy the connection string. It looks like `mongodb+srv://helpdesk-app:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`. Replace `<password>` (URL-encode special characters, e.g. `@` becomes `%40`).
5. Atlas is required rather than a plain local `mongod`: the app uses **transactions**, which need a replica set (Atlas always is one).

## 4. Google Cloud service account and the spreadsheet

Follow **`n8n/README.md` sections 2 and 3** (prepare the sheet with the 16 headers, create the service account, share the sheet with it). Two different things use that same service account:

* **n8n** writes rows (credential created inside n8n, section 4 of `n8n/README.md`).
* **The app** only *reads* the sheet for the "Sheet check" page. Set `GOOGLE_SHEETS_SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (the `private_key` value from the JSON file). It requests a read-only scope. These three are optional; without them, only the Sheet check page is disabled.

Never commit the JSON key file and never put it in browser code. In `.env.local` the key can be one line with literal `\n` between lines, in quotes; the app repairs it.

## 5. n8n Cloud

Follow **`n8n/README.md` sections 4 to 7**: create the three credentials, import the three workflows, fill the **Config** node in each, activate them, copy the two **Production** webhook URLs.

**Local vs production URLs.** n8n has *test* URLs (`/webhook-test/…`, one call while you press "Listen") and *production* URLs (`/webhook/…`, only while the workflow is Active). The app must always use the production ones. Your laptop can call n8n Cloud, so local development syncs for real. But **n8n Cloud cannot reach `http://localhost:3000`**, so Workflow C (the retry runner) can only call your *deployed* app. Locally you don't need C: the app already attempts each sync right after the response, and you can trigger retries by hand (see `n8n/README.md` section 5).

## 6. Environment variables

Copy `.env.example` to `.env.local` (Windows: `Copy-Item .env.example .env.local`). `.env.local` is git-ignored. Generate each secret separately:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

| Variable | Required | What it is |
|---|---|---|
| `APP_BASE_URL` | yes | `http://localhost:3000` locally; your real https URL in production |
| `MONGODB_URI` | yes | Atlas connection string (secret) |
| `MONGODB_DB_NAME` | no | Defaults to `it_helpdesk` |
| `AUTH_SECRET` | yes | 32+ random characters. Keys the hashing of IPs and login emails for rate limits |
| `N8N_NEW_COMPLAINT_WEBHOOK_URL` | for sync | Production URL of workflow A (https) |
| `N8N_UPDATE_COMPLAINT_WEBHOOK_URL` | for sync | Production URL of workflow B (https) |
| `N8N_WEBHOOK_SECRET` | for sync | 32+ chars. Must equal the n8n *Helpdesk webhook secret* credential value |
| `SYNC_RUNNER_SECRET` | for retries | 32+ chars, **different** from the one above. Must equal what follows `Bearer ` in n8n's *Helpdesk sync runner secret* credential. Empty = the runner endpoint is disabled |
| `GOOGLE_SHEETS_SPREADSHEET_ID`, `GOOGLE_SHEETS_WORKSHEET_NAME`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | for Sheet check | Read-only reconciliation (section 4) |

In **production** (Vercel) set the same variables in the project settings, never in code. Treat `MONGODB_URI`, the two secrets and the private key as passwords.

## 7. Initialise the database and create the first administrator

```powershell
npm run db:init          # collections, validators, unique indexes (run once per environment)
npm run admin:create     # prompts for email, name and a hidden password (min 12 characters)
```

There is no default account and no public sign-up. Lost access: `npm run admin:create -- --email you@company.com --reset-password`.
To run these against the **production** database, set the production `MONGODB_URI` in `.env.local` for that moment (or use `$env:MONGODB_URI="…"` in the same PowerShell window), run the two commands, then restore your local value.

## 8. Run it locally

```powershell
npm run dev
```

* Public form: <http://localhost:3000/complaint>
* Admin: <http://localhost:3000/admin/login>

## 9. Run the tests

| Command | Needs | Covers |
|---|---|---|
| `npm run typecheck` | nothing | TypeScript |
| `npm run test:unit` | nothing | validation, IDs, dates, auth rules, n8n client, workflow logic, UI behaviour |
| `npm run test:integration` | internet once (downloads a MongoDB test binary) | atomic resolve, concurrency, sync queue, reconciliation, pagination, dashboard accuracy |
| `npm run test:e2e` | `npx playwright install chromium` once, plus the above | the whole lifecycle in a real browser (database and n8n are throw-away stand-ins) |

Automated tests never touch your real Atlas database or spreadsheet. **Run the manual checklist in `docs/VERIFICATION.md` against the real stack before go-live**: that is the only thing that proves n8n and Google Sheets are wired correctly.

## 10. Deploy to Vercel

1. Create a **private** GitHub repository and push the project (`.gitignore` already excludes `.env*`, keys and `node_modules`):
   ```powershell
   git init; git add .; git commit -m "IT Helpdesk"; git branch -M main
   git remote add origin https://github.com/<you>/it-helpdesk.git; git push -u origin main
   ```
   Before pushing, run `git status` and confirm no `.env.local` or `*.json` key file is listed.
2. <https://vercel.com> → **Add New → Project** → import the repository. Framework: Next.js (auto-detected). Node.js version: 22.x (Project Settings → General).
3. **Environment Variables:** add everything from section 6 for **Production** (and Preview if you use previews). Set `APP_BASE_URL` to the final https URL (the Vercel URL or your custom domain).
4. **Deploy.** Choose a function region close to your Atlas region (Project Settings → Functions).
5. Atlas **Network Access** must allow Vercel (section 3).
6. Run `npm run db:init` and `npm run admin:create` against the production database (section 7), once.

Notes: complaint submission and admin writes finish their spreadsheet sync *after* the response using Next.js `after()`, which Vercel keeps alive up to the function's `maxDuration` (30 s). Anything that doesn't finish is retried by the runner.

## 11. Connect production n8n and test it

1. In n8n workflow **C**, set **Config → appBaseUrl** to your https app URL and activate it.
2. Make sure the production webhook URLs and both secrets are set in Vercel, then **redeploy** (environment changes apply to new deployments).
3. Run the checks in `docs/VERIFICATION.md`, in particular: submit a complaint on the live site and watch the row appear, resolve it from the admin, and run the **Sheet check** page.

## 12. Monitoring and retrying failures

* **Admin dashboard → System status** shows how many syncs are waiting or need attention.
* **A complaint page** shows its sync state, each job's attempts and last error, and a **Retry sync** button.
* **Sheet check** compares every complaint with the sheet. Run it weekly, and after anyone edits the sheet by hand. "Queue repairs" re-adds missing rows and fixes wrong statuses; duplicates and unknown rows are only reported.
* **Vercel → Logs:** the app writes one JSON line per event (`complaint.created`, `sync.job_processed`, `auth.login.failed`, `reconciliation.completed`…). Every API error response includes a `correlationId`: search the logs for it to find the exact request. Personal data (names, descriptions, contact numbers, passwords, tokens) is never logged.
* **n8n → Executions:** failed runs are saved (they contain complaint text, so set a short retention). Workflow C deliberately fails when something needs attention, so enable n8n's failure notification email.
* **Atlas → Alerts:** add alerts for connection spikes and storage. Note the free M0 tier has **no automated backups**: schedule `mongodump` exports, or use a paid tier with continuous backup.

## 13. Security checklist before go-live

- [ ] `.env.local` and the Google key file are not in Git
- [ ] Atlas user has a strong, unique password; only the needed database is accessible
- [ ] Both webhook secrets are 32+ random characters and different from each other
- [ ] Only the sheet is shared with the service account (nothing else in Drive)
- [ ] The first admin password is strong and not shared; `/admin` works only when signed in (try in a private window)
- [ ] n8n workflow success-data saving is off (default in the provided files) and failure retention is short
