import { defineConfig } from "@playwright/test";

// Run with `npm run test:e2e`, which starts the database, the fake n8n and the app first
// (see scripts/e2e.ts) and then runs these tests against them.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000, // `next dev` compiles each page on first visit
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3210",
    trace: "retain-on-failure",
  },
});
