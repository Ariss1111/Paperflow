import os from "node:os";
import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT || 3210);
const AI_PORT = Number(process.env.E2E_AI_PORT || 3211);
const AI_MOCK_PORT = Number(process.env.E2E_AI_MOCK_PORT || 4599);
const tmp = os.tmpdir();

// Uses an installed Microsoft Edge (or Chrome via E2E_CHANNEL=chrome) so no browser download is needed.
export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "tests/e2e/global-setup.ts",
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
  webServer: [
    {
      command: `"${process.execPath}" node_modules/next/dist/bin/next dev -p ${PORT}`,
      url: `http://localhost:${PORT}/api/capabilities`,
      reuseExistingServer: true,
      timeout: 180_000,
      env: { DEV_MAILBOX: "1", DATA_DIR: `${tmp}/pagelyt-e2e`, RATE_LIMIT_SIGNUPS_PER_MIN: "100" },
    },
    // the same app with AI pointed at the stand-in Claude API in tests/e2e/ai.spec.ts
    {
      command: `"${process.execPath}" node_modules/next/dist/bin/next dev -p ${AI_PORT}`,
      url: `http://localhost:${AI_PORT}/api/capabilities`,
      reuseExistingServer: true,
      timeout: 180_000,
      env: { ANTHROPIC_API_KEY: "sk-ant-e2e", ANTHROPIC_BASE_URL: `http://127.0.0.1:${AI_MOCK_PORT}`, DATA_DIR: `${tmp}/pagelyt-e2e-ai` },
    },
  ],
});
