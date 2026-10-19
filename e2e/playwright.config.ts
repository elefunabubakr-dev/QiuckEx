import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the QuickEx browser suites.
 *
 * Two projects share the same test directory but run in very different
 * environments:
 *
 * - `pay-receipt`   FE-67 pay→receipt + #766 a11y audits. These need a fully
 *                   deployed backend, so they only run from
 *                   .github/workflows/frontend-e2e.yml against the preview
 *                   environment (skipped when PREVIEW_BASE_URL is unset).
 * - `visual-theme`  FE-56 theme regression screenshots. Hermetic: the app is
 *                   built+served locally by .github/workflows/
 *                   frontend-theme-regression.yml and every backend call is
 *                   mocked (e2e/tests/theme-mocks.ts). Uses the system Google
 *                   Chrome (`channel: "chrome"`) so no browser download is
 *                   needed — the same binary on CI ubuntu-latest matches the
 *                   committed goldens.
 *
 * Traces and screenshots are captured on first retry so failures are
 * debuggable; flake mitigation relies on web-first assertions rather than
 * fixed sleeps. See e2e/README.md for the theme coverage matrix.
 */
export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "pay-receipt",
      testMatch: /(pay-to-receipt|a11y-pay-flow)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "visual-theme",
      testMatch: /theme-regression\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: process.env.THEME_BASE_URL ?? "http://localhost:3000",
        // System Chrome (no Playwright browser download required); the CI
        // workflow runs on ubuntu-latest, which ships google-chrome-stable.
        channel: "chrome",
        // Video would require Playwright's bundled ffmpeg (a >50MB download)
        // and is not the artifact this suite produces — screenshots are. One
        // less dependency to keep green locally and in CI.
        video: "off",
        // Pin rendering inputs so goldens are byte-stable across machines:
        locale: "en-US",
        timezoneId: "UTC",
        viewport: { width: 1440, height: 900 },
        // colorScheme only affects native controls; the app theme is driven
        // by localStorage, seeded per-test in theme-regression.spec.ts.
        colorScheme: "light",
      },
      expect: {
        toHaveScreenshot: {
          maxDiffPixelRatio: 0.02,
          animations: "disabled",
        },
      },
    },
  ],
});