import { defineConfig } from "@playwright/test";

// Parallel checkouts can each run the suite on their own port.
const port = Number(process.env.STUDIO_TEST_PORT || 8790);
const chromiumLaunchOptions = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
  : {};
export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: true,
  reporter: process.env.CI ? "github" : "list",
  retries: process.env.CI ? 1 : 0,
  testDir: "./tests/browser",
  // CI runners have two CPUs; more browser workers starve Linux WebKit and time out. Local runs
  // share the machine with agents and previews, so they run one test at a time.
  workers: process.env.CI ? 2 : 1,
  projects: [
    {
      name: "desktop",
      use: { viewport: { width: 1440, height: 1000 }, launchOptions: chromiumLaunchOptions },
    },
    {
      name: "phone",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        launchOptions: chromiumLaunchOptions,
      },
    },
    {
      name: "phone-webkit",
      use: {
        browserName: "webkit",
        viewport: { width: 390, height: 844 },
        isMobile: true,
      },
    },
  ],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: "chromium",
    hasTouch: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node tests/browser/server.mjs",
    reuseExistingServer: false,
    timeout: 30000,
    url: `http://127.0.0.1:${port}/api/ping`,
    env: { PORT: String(port) },
  },
});
