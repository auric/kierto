import { defineConfig } from "@playwright/test";
import { APP_PORT } from "./tests/e2e/control";

// One server and one data folder for all tests, so the tests run one at a time.
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "*.e2e.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  globalTeardown: "./tests/e2e/teardown.ts",
  use: { baseURL: `http://127.0.0.1:${APP_PORT}`, browserName: "chromium", viewport: { width: 1280, height: 800 } },
  webServer: {
    // The build makes the tests run the current UI.
    command: "bun run build && bun tests/e2e/serve.ts",
    url: `http://127.0.0.1:${APP_PORT}/`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
  },
});
