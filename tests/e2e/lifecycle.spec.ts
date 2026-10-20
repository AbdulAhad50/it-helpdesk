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
  return (await res.json()) as { rows: Record<string, string | number>[]; calls: { eventType: string; complaintId: string; status: number }[] };
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
