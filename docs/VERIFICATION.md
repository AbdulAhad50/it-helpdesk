# Verification checklist: the complete complaint lifecycle

Run this against the **real** stack (real Atlas database, real n8n workflows, real Google Sheet), first with a
test spreadsheet and then once on production. Automated tests use stand-ins, so this checklist is what proves the
integrations are really connected. Tick each box; stop and fix at the first failure (see `TROUBLESHOOTING.md`).

**Use a test spreadsheet** (a copy with the same 16 headers) while verifying. Keep a note of the complaint IDs you create, and delete the test rows afterwards.

## A. Prerequisites
- [ ] `npm run db:init` has been run on this database; an admin exists and can sign in
- [ ] n8n workflows A, B and C are **Active**; production webhook URLs and both secrets are set in the app
- [ ] The sheet's row 1 holds the 16 headers exactly (`n8n/README.md` §2)
- [ ] Admin dashboard → System status shows n8n as configured and "Nothing waiting"

## B. n8n and the sheet on their own (no app)
- [ ] Posting the sample event from `n8n/README.md` §7 returns `ok: True, result: appended` and adds **one** row
- [ ] Posting it again returns `already_exists` and the sheet still has **one** row
- [ ] A wrong secret returns 403 and adds no row
- [ ] Delete the test row

## C. Employee submits (public form)
- [ ] Open `/complaint` in a private window (not signed in). Submit with only the required fields. Priority defaults to **Normal**
- [ ] Submitting an empty form shows a message under each required field and sends nothing
- [ ] The success page shows an ID like `IT-20261018-A7K2` and the received time in Karachi time
- [ ] In Atlas, the `complaints` document exists with `status: "Pending"`, `solvedAt: null`, `receivedAt` set by the server (not by your browser clock), `version: 1`
- [ ] Within seconds the sheet has **exactly one** new row for that ID: Status `Pending`, Received Date/Time filled, all Solved/Resolve/Duration/Work Stuck cells blank
- [ ] The Atlas document now shows `googleSheetSynced: true` and `syncState: "synced"`
- [ ] Submit two more complaints (different departments). The sheet has exactly three rows, no duplicates

## D. Admin views and edits
- [ ] `/admin/dashboard` in a signed-out window redirects to login
- [ ] Sign in. Dashboard (Last 7 days) shows Total 3, Pending 3, Resolved 0, average resolution time "–"
- [ ] `/admin/complaints` lists the three, Pending rows highlighted; search by part of the ID and by a name works; each filter and sort works; page size 10 paginates
- [ ] Open complaint #1, change **Priority** to Critical and add a Work Stuck Reason, Save. The history shows the change; the sheet row's Priority and Work Stuck Reason update; the **other two rows are unchanged**
- [ ] Open complaint #1 in two tabs, save a change in tab A, then save in tab B: tab B shows "Someone else changed this complaint" and does not overwrite

## E. Resolve exactly one complaint
- [ ] In the table, click **Resolve** on complaint #1 only. The dialog shows its ID and summary. Add resolution notes, confirm
- [ ] A success message appears with the solve duration
- [ ] Atlas: complaint #1 has `status: "Resolved"`, `solvedAt`, `solveDurationMinutes` (equal to the minutes between `receivedAt` and `solvedAt`), `resolvedBy` = your admin ID. **Complaints #2 and #3 are untouched** (still Pending, `version` unchanged)
- [ ] Sheet: complaint #1's row now has Solved Date, Resolve Time, Solve Duration (e.g. `2 hours 15 minutes`), Resolution Notes, Status `Resolved`, Resolved By = your name, Last Updated. **Rows #2 and #3 are byte-for-byte unchanged and no row was added**
- [ ] Click Resolve on the same complaint again (or use a second browser): "Already resolved", and `solvedAt` in Atlas has **not** changed
- [ ] The complaint page's History shows submitted, updated, resolved, with who and when
- [ ] Dashboard now shows Pending 2, Resolved 1, and an average resolution time that matches the duration above

## F. Failure handling
- [ ] Deactivate workflow A. Submit a complaint: the employee still sees success. The complaint is stored; the dashboard shows "1 waiting to sync"; its page says "Waiting to sync"
- [ ] Reactivate A, then (production) wait for workflow C, or (locally) call the runner endpoint. The row appears, the queue empties, state becomes Synced
- [ ] Delete a complaint's row from the sheet by hand. Run **Sheet check**: it reports 1 missing. **Run check and queue repairs**: the row reappears, and a second check reports no problems
- [ ] Copy a row so an ID appears twice. **Sheet check** reports a duplicate and changes nothing; delete the extra row, re-run: no problems
- [ ] Change a row's Status cell by hand. Sheet check reports a status difference; repairs fix it

## G. Security spot checks
- [ ] Signed out, `GET /api/admin/complaints` returns 401, and so does every other `/api/admin/*` route
- [ ] Five wrong passwords then a right one still work; eleven rapid attempts return 429
- [ ] The browser's developer tools show no secrets, no database IDs and no webhook URLs in page source or network responses
- [ ] Complaint text starting with `=` (e.g. `=1+1`) appears in the sheet as text with a leading apostrophe, not as a calculated cell
- [ ] The Vercel logs contain `complaint.created` lines with IDs but no names, descriptions or contact numbers

Sign-off: ______________________  Date: ______________  Environment: ☐ test sheet  ☐ production
