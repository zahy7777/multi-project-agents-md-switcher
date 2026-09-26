import { defineConfig } from "@playwright/test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const testRoot =
  process.env.PROMPTDOCK_E2E_ROOT ??
  mkdtempSync(path.join(os.tmpdir(), "promptdock-e2e-"));
const codexHome = path.join(testRoot, "codex");
const applicationData = path.join(testRoot, "data");
const port = 4381;

mkdirSync(codexHome, { recursive: true });
writeFileSync(
  path.join(codexHome, "AGENTS.md"),
  "# Isolated Codex user rules\n",
  "utf8",
);
process.env.PROMPTDOCK_E2E_ROOT = testRoot;

const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  globalTeardown: "./e2e/global-teardown.ts",
  timeout: 45_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL,
    browserName: "chromium",
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm start",
    url: `${baseURL}/api/health`,
    timeout: 60_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      PORT: String(port),
      PROMPTDOCK_DATA_DIR: applicationData,
      CODEX_HOME: codexHome,
    },
    stdout: "ignore",
    stderr: "pipe",
  },
});
