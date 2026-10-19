# QuickEx E2E (Playwright)

Browser-level tests for the QuickEx web app.

## Projects

| Project       | Specs                          | Needs                                                      |
| ------------- | ------------------------------ | ---------------------------------------------------------- |
| `pay-receipt` | `pay-to-receipt`, `a11y-pay-flow` | A deployed backend (runs in CI against the preview env)  |
| `visual-theme`| `theme-regression`             | A local build served on `localhost:3000` (hermetic)       |

Run a single project with `npx playwright test --project=<name>`.

## FE-56 — Theme regression coverage

### Why

Theme bugs (a surface that stays light in dark mode, a chart boundary that
vanishes, text that fails contrast) are cheap to introduce and expensive to
notice in code review. This suite locks the theming of the highest-risk
screens in **both light and dark mode** so regressions surface in CI instead
of after merge.

### Covered surfaces (light + dark)

| Surface                  | Screenshot goldens                                        | Backend mocked |
| ------------------------ | --------------------------------------------------------- | -------------- |
| Public payment (active)  | `pay-active-{theme}.png`                                  | `payment-links/status` |
| Public payment (paid)    | `pay-paid-{theme}.png`                                    | `payment-links/status` |
| Dashboard overview       | `dashboard-{theme}.png`                                   | `analytics/report`, `payments/recent` |
| Dashboard analytics      | `dashboard-analytics-{theme}.png` (chart block)           | `analytics/report` |
| Profile settings         | `settings-{theme}.png` (top) + `settings-bottom-{theme}.png` (Social Links fold) | — |
| Admin console            | `admin-{theme}.png`                                       | `health`, `admin/feature-flags`, `admin/audit` |

Most captures are fixed-size viewport shots (1440x900). The public payment and
admin captures are full-page. The analytics and Social Links captures pin the
target section to the top of the viewport first so the image size stays
constant even when content flow shifts by a pixel; full-page captures of
content-heavy tall screens are avoided for the same reason (a 2px height delta
fails a screenshot comparison on dimensions, not color).

Every screenshot sits on top of the shared header/footer (theme toggle,
notification bell, locale switcher) and the bootstrap/feature-flag providers,
so those are goldened implicitly.

A second, baseline-free layer — the *theme token contract* — asserts the CSS
custom properties from `app/frontend/src/app/globals.css` resolve to expected
values and that `<html>`'s theme class + `color-scheme` flip correctly on
every covered route. It catches "theme never applied" regressions even when
pixel goldens are intentionally regenerated.

### Determinism

Goldens only stay useful if every run renders identically:

- **Frozen clock** — `page.clock.install` pins `Date`/timers/rAF at
  `2026-01-15T12:00:00Z`, so countdowns, "2h ago" feed labels and audit
  timestamps are fixed.
- **Mocked backend** — every API call is intercepted with fixed fixtures
  (`e2e/tests/theme-mocks.ts`); a catch-all route returns 501 so nothing can
  hang on the network.
- **Pinned rendering** — viewport `1440x900`, `locale: en-US`,
  `timezoneId: UTC`, and `colorScheme` are set at the project level.
- **Settled animations** — recharts animations are fast-forwarded with
  `page.clock.runFor` before the analytics screenshot.
- **Environment-tolerant** — dashboard/settings shots allow
  `maxDiffPixelRatio: 0.04` because blurred glows, shadows and SVG charts
  rasterize marginally differently across Chrome builds/GPU vs software
  rendering. Exact colors are still pinned by the theme token contract;
  `pay`/`admin` stay at the stricter `0.02`.

> Goldens are OS/browser specific. They are generated on Linux with the system
> Google Chrome (`channel: "chrome"`), matching CI's `ubuntu-latest`. Always
> regenerate through CI or an identical Linux/Chrome environment; do not
> regenerate from macOS/Windows and commit the result.

### Running locally

```bash
# 1. Serve the app (this job also runs it with the same flags):
cd app/frontend && npm ci && \
  NEXT_PUBLIC_QUICKEX_API_URL=https://api.quickex.test \
  NEXT_PUBLIC_STELLAR_NETWORK=testnet \
  NEXT_PUBLIC_SITE_URL=http://localhost:3000 npm run build && npm start &

# 2. From e2e/ :
npm install          # @playwright/test only — no browser download needed
npm run test:theme           # compare against committed goldens
npm run test:theme:update    # regenerate goldens (review + commit the PNGs)
```

### Regenerating goldens in CI

Run the **Visual Theme Regression** workflow (`frontend-theme-regression.yml`)
with the `update-baselines` input enabled. It rebuilds the app, runs
`--update-snapshots`, and uploads the freshly generated PNGs as an artifact.
Commit those images to update the golden set.

### Keeping expectations honest

- If the palette in `globals.css` changes on purpose, update
  `TOKEN_EXPECTATIONS` in `theme-regression.spec.ts` **and** regenerage the
  goldens in the same PR.
- If a fix intentionally changes a covered screen's layout, regenerate only
  the affected golden and make sure the diff is exactly the intended change.