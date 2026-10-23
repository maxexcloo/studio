import { defineConfig } from "@playwright/test";

// Parallel checkouts can each run the suite on their own port.
const port = Number(process.env.STUDIO_TEST_PORT || 8790);
export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: true,
  reporter: process.env.CI ? "github" : "list",
  retries: process.env.CI ? 1 : 0,
  testDir: "./tests/browser",
  workers: process.env.CI ? 4 : undefined,
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "phone", use: { viewport: { width: 390, height: 844 }, isMobile: true } },
  ],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: "chromium",
    hasTouch: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
  },
  webServer: {
    command: "node tests/browser/server.mjs",
    reuseExistingServer: false,
    timeout: 30000,
    url: `http://127.0.0.1:${port}/api/ping`,
    env: { PORT: String(port) },
  },
});
