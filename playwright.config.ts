import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT || 3210);

// Uses an installed Microsoft Edge (or Chrome via E2E_CHANNEL=chrome) so no browser download is needed.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 180_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: process.env.E2E_CHANNEL || "msedge",
    viewport: { width: 1400, height: 900 },
    acceptDownloads: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `"${process.execPath}" node_modules/next/dist/bin/next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/api/capabilities`,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
