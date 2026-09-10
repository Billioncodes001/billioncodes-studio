import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  timeout: 45000,
  reporter: "list",
  use: {
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    trace: "retain-on-failure",
    baseURL: "http://127.0.0.1:5213",
  },
  webServer: {
    command: "node e2e/server.mjs",
    env: {
      PORT: "5213",
      DATABASE: join(
        tmpdir(),
        `studio-e2e-${process.pid}-${Date.now()}.sqlite`,
      ),
      STUDIO_PASSWORD: "synthetic-studio-test-password",
    },
    url: "http://127.0.0.1:5213/api/health",
    timeout: 30000,
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
});
