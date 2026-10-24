import { expect, test, type Page } from "@playwright/test";
import { MongoClient } from "mongodb";

/**
 * The complete lifecycle (spec section 17), against a throw-away database and a fake n8n that runs
 * the real workflow logic. See docs/VERIFICATION.md for the same check against real n8n and Google Sheets.
 */
const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set. Run this with "npm run test:e2e".`);
  return v;
};

const complaintInput = (n: number) => ({
  userName: `E2E Employee ${n}`,
  department: "Sales",
  problemCategory: "Email / Outlook",
  problemDescription: `E2E complaint number ${n}: Outlook keeps asking for the password.`,
  priority: "Normal",
});

async function readSheet() {
  const res = await fetch(`${env("E2E_FAKE_N8N_URL")}/__sheet`, { headers: { "X-Webhook-Secret": env("E2E_WEBHOOK_SECRET") } });
  return (await res.json()) as { rows: Record<string, string | number>[]; transfers: Record<string, string | number>[]; calls: { eventType: string; complaintId: string; status: number }[] };
}

async function waitForSheetRows(n: number) {
  await expect.poll(async () => (await readSheet()).rows.length, { timeout: 30_000, intervals: [500] }).toBe(n);
}

async function signIn(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(env("E2E_ADMIN_EMAIL"));
  await page.getByLabel("Password", { exact: true }).fill(env("E2E_ADMIN_PASSWORD"));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/);
}

test("employee submits → MongoDB → n8n row → admin resolves exactly that complaint → dashboard", async ({ page, request }) => {
  const mongo = await MongoClient.connect(env("E2E_MONGODB_URI"));
  const complaints = mongo.db(env("E2E_DB_NAME")).collection("complaints");

  try {
    // 1. An employee submits a complaint through the public form (no login).
    await page.goto("/complaint");
    await page.getByLabel("Your name").fill("E2E Employee 1");
    await page.getByLabel("Department").click();
    await page.getByRole("option", { name: "Sales" }).click();
    await page.getByLabel("Problem category").click();
    await page.getByRole("option", { name: "Email / Outlook" }).click();
    await page.getByLabel("What's the problem?").fill("E2E complaint number 1: Outlook keeps asking for the password.");
    await page.getByRole("button", { name: "Submit complaint" }).click();

    // 2. The success page shows the generated ID.
    await expect(page.getByRole("heading", { name: /received your complaint/i })).toBeVisible();
    const target = (await page.getByTestId("complaint-id").innerText()).trim();
    expect(target).toMatch(/^IT-\d{8}-[A-Z2-9]{4}$/);

    // 3. MongoDB holds it: Pending, server timestamp, no solve data.
    const stored = await complaints.findOne({ complaintId: target });
    expect(stored).toMatchObject({ status: "Pending", userName: "E2E Employee 1", solvedAt: null, solveDurationMinutes: null });

    // Two other complaints (via the public API) that must stay untouched.
    const others: string[] = [];
    for (const n of [2, 3]) {
      const res = await request.post("/api/complaints", { data: complaintInput(n) });
      expect(res.status()).toBe(201);
      others.push((await res.json()).data.complaintId);
    }

    // 4. n8n appended exactly one matching row per complaint.
    await waitForSheetRows(3);
    const before = (await readSheet()).rows;
    expect(before.map((r) => r["Complaint ID"]).sort()).toEqual([target, ...others].sort());
    expect(before.every((r) => r.Status === "Pending")).toBe(true);
    await expect.poll(async () => (await complaints.findOne({ complaintId: target }))?.syncState, { timeout: 20_000 }).toBe("synced");

    // 5. The admin signs in and opens the complaints table.
    await signIn(page);
    await page.goto("/admin/complaints");
    await expect(page.getByRole("link", { name: target })).toBeVisible();
    for (const id of others) await expect(page.getByRole("link", { name: id })).toBeVisible();

    // 6. The admin resolves ONE selected complaint.
    const row = page.getByRole("row").filter({ hasText: target });
    await row.getByRole("button", { name: "Resolve" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(target).first()).toBeVisible();
    await dialog.getByLabel("Resolution notes").fill("Reset the mailbox profile.");
    await dialog.getByRole("button", { name: `Resolve ${target}` }).click();
    await expect(page.getByText(`${target} resolved`)).toBeVisible();

    // 7. MongoDB records the resolution; the others are unchanged.
    const resolved = await complaints.findOne({ complaintId: target });
    expect(resolved).toMatchObject({ status: "Resolved", resolutionNotes: "Reset the mailbox profile." });
    expect(resolved!.solvedAt).toBeInstanceOf(Date);
    expect(typeof resolved!.solveDurationMinutes).toBe("number");
    for (const id of others) expect(await complaints.findOne({ complaintId: id })).toMatchObject({ status: "Pending", solvedAt: null });

    // 8. n8n updated exactly the matching sheet row, and no other row changed.
    await expect.poll(async () => (await readSheet()).rows.find((r) => r["Complaint ID"] === target)?.Status, { timeout: 30_000 }).toBe("Resolved");
    const after = (await readSheet()).rows;
    expect(after).toHaveLength(3); // no row added
    const row2 = after.find((r) => r["Complaint ID"] === target)!;
    expect(row2["Resolution Notes"]).toBe("Reset the mailbox profile.");
    expect(row2["Resolved By"]).toBe("E2E Admin");
    expect(String(row2["Solve Duration"])).toMatch(/minute|hour|day/);
    for (const id of others) {
      expect(after.find((r) => r["Complaint ID"] === id)).toEqual(before.find((r) => r["Complaint ID"] === id));
    }
    await expect.poll(async () => (await complaints.findOne({ complaintId: target }))?.syncState, { timeout: 20_000 }).toBe("synced");

    // 9. Resolving again is refused and does not change the original resolution.
    const cookies = await page.context().cookies();
    const session = cookies.find((c) => /helpdesk_session/.test(c.name))!;
    const again = await request.post(`/api/admin/complaints/${target}/resolve`, {
      data: { resolutionNotes: "second attempt" },
      headers: { cookie: `${session.name}=${session.value}`, origin: new URL(page.url()).origin },
    });
    expect(again.status()).toBe(409);
    expect((await complaints.findOne({ complaintId: target }))!.solvedAt).toEqual(resolved!.solvedAt);

    // 10. The dashboard reflects 2 pending, 1 resolved and an average resolution time.
    await page.goto("/admin/dashboard?preset=7d");
    const card = (label: string) => page.locator("div", { has: page.getByText(label, { exact: true }) }).last();
    await expect(card("Total complaints")).toContainText("3");
    await expect(card("Pending")).toContainText("2");
    await expect(card("Resolved")).toContainText("1");
    await expect(card("Average resolution time")).not.toContainText("–");
  } finally {
    await mongo.close();
  }
});

test("an unauthenticated visitor can't reach any admin page or API", async ({ page, request }) => {
  await page.goto("/admin/complaints");
  await expect(page).toHaveURL(/\/admin\/login/);
  expect((await request.get("/api/admin/complaints")).status()).toBe(401);
  expect((await request.get("/api/admin/dashboard")).status()).toBe(401);
});

test("item transfer: outlet submits → IT sees it → admin accepts exactly that item → sheet row updated", async ({ page, request }) => {
  const mongo = await MongoClient.connect(env("E2E_MONGODB_URI"));
  const transfers = mongo.db(env("E2E_DB_NAME")).collection("itemtransfers");
  const sheetCount = async () => (await readSheet()).transfers.length;
  const complaintRowsAtStart = (await readSheet()).rows.length; // the first test already added complaint rows
  try {
    // 1. An outlet submits through the public form (no login).
    await page.goto("/");
    await page.getByRole("link", { name: /send an item to it/i }).click();
    await expect(page).toHaveURL(/\/transfer$/);
    await page.getByLabel("Your name").fill("Malir Staff");
    await page.getByLabel("Email").fill("malir@example.com");
    await page.getByLabel("Phone or extension").fill("0300 1234567");
    await page.getByRole("combobox", { name: "Outlet" }).click();
    await page.getByRole("option", { name: "Malir" }).click();
    await page.getByLabel("What is the item?").fill("Receipt printer TM-T20 with a faulty cutter, sent by courier.");
    await page.getByRole("button", { name: "Submit" }).click();

    // 2. Confirmation shows the generated record ID.
    await expect(page.getByRole("heading", { name: /IT has been told/i })).toBeVisible();
    const target = (await page.getByTestId("transfer-id").innerText()).trim();
    expect(target).toMatch(/^TR-\d{8}-[A-Z2-9]{4}$/);

    // 3. MongoDB holds it as "In transit"; the date was set by the server.
    expect(await transfers.findOne({ transferId: target })).toMatchObject({ status: "In transit", direction: "to_it", source: "public", outlet: "Malir", email: "malir@example.com" });

    // 4. Another item (via the API) that must stay untouched; n8n appended one row each.
    const other = await request.post("/api/transfers", { data: { name: "Other Outlet", email: "o@example.com", contact: "ext 204", outlet: "Other", description: "A second item going to IT." } });
    expect(other.status()).toBe(201);
    const otherId = (await other.json()).data.transferId as string;
    await expect.poll(sheetCount, { timeout: 30_000, intervals: [500] }).toBe(2);
    const before = (await readSheet()).transfers;
    expect(before.every((r) => r.Status === "In transit")).toBe(true);
    expect((await readSheet()).rows).toHaveLength(complaintRowsAtStart); // the complaints tab is not affected

    // 5. The admin signs in, opens Item transfers and accepts exactly one.
    await signIn(page);
    await page.goto("/admin/transfers");
    await expect(page.getByRole("link", { name: target })).toBeVisible();
    await page.getByRole("row").filter({ hasText: target }).getByRole("button", { name: "Accept" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(target).first()).toBeVisible();
    await dialog.getByLabel(/notes/i).fill("Arrived intact.");
    await dialog.getByRole("button", { name: "Accept as received" }).click();
    await expect(page.getByText(`${target} received`)).toBeVisible();

    // 6. MongoDB and the sheet record the receipt; the other item is unchanged.
    expect(await transfers.findOne({ transferId: target })).toMatchObject({ status: "Received", receiptNotes: "Arrived intact." });
    expect(await transfers.findOne({ transferId: otherId })).toMatchObject({ status: "In transit" });
    await expect.poll(async () => (await readSheet()).transfers.find((r) => r["Transfer ID"] === target)?.Status, { timeout: 30_000 }).toBe("Received");
    const after = (await readSheet()).transfers;
    expect(after).toHaveLength(2);
    expect(after.find((r) => r["Transfer ID"] === target)).toMatchObject({ "Received By": "E2E Admin", "Receipt Notes": "Arrived intact.", Name: "Malir Staff" });
    expect(after.find((r) => r["Transfer ID"] === otherId)).toEqual(before.find((r) => r["Transfer ID"] === otherId));

    // 7. Accepting again is refused.
    const session = (await page.context().cookies()).find((c) => /helpdesk_session/.test(c.name))!;
    const again = await request.post(`/api/admin/transfers/${target}/accept`, { data: {}, headers: { cookie: `${session.name}=${session.value}`, origin: new URL(page.url()).origin } });
    expect(again.status()).toBe(409);

    // 8. IT records an item going OUT to an outlet with the admin form.
    await page.goto("/admin/transfers/new");
    await page.getByLabel(/recipient name/i).fill("Clifton Manager");
    await page.getByRole("combobox", { name: "Outlet" }).click();
    await page.getByRole("option", { name: "Other" }).click();
    await page.getByLabel("What is the item?").fill("Repaired card reader, returning to the outlet.");
    await page.getByRole("button", { name: "Record item" }).click();
    await expect(page).toHaveURL(/\/admin\/transfers\/TR-/);
    await expect.poll(sheetCount, { timeout: 30_000 }).toBe(3);
    expect((await readSheet()).transfers.find((r) => r.Direction === "From IT")).toMatchObject({ Status: "In transit", "Logged By": "E2E Admin" });
  } finally {
    await mongo.close();
  }
});

test("the transfer pages' admin side is protected", async ({ page, request }) => {
  await page.goto("/admin/transfers");
  await expect(page).toHaveURL(/\/admin\/login/);
  expect((await request.get("/api/admin/transfers")).status()).toBe(401);
  expect((await request.post("/api/admin/transfers/TR-20261018-B3M9/accept", { data: {} })).status()).toBe(401);
});
