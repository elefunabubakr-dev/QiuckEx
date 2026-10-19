# Frontend Performance & Offline

This document covers the frontend performance guardrails and offline strategy
introduced in FE-64…FE-67.

## Service Worker & Offline Caching (FE-64)

The service worker (`app/frontend/public/sw.js`) applies a deliberate strategy
per asset class. The routing logic is mirrored (and unit-tested) in
`app/frontend/src/lib/sw-cache-strategy.ts`:

| Asset class                        | Strategy          | Rationale                                  |
| ---------------------------------- | ----------------- | ------------------------------------------ |
| Payment-critical API (`/api/payments`, `/api/links`, `/api/transactions`, `/api/receipts`, `/api/pay*`) | **network-only**  | Never serve stale money-related data       |
| Other API reads (`/api/*`)         | network-first     | Fresh-first, cache as a resilience fallback |
| Hashed static assets (`/_next/static/`, images, fonts) | cache-first       | Immutable — safe to serve from cache        |
| Navigations                        | network, else `/offline` | Predictable offline route                   |

Caches are **versioned** (`CACHE_VERSION`); the `activate` handler deletes any
cache whose name doesn't match the current version, so a deploy invalidates old
entries without a hard reload. Register the worker from a client component via
`registerServiceWorker()` (`src/lib/register-sw.ts`); it no-ops outside
production.

### Manual offline check

1. `npm run build && npm run start` in `app/frontend`.
2. Load the app, then in DevTools → Application → Service Workers confirm the
   worker is activated.
3. Switch DevTools → Network to **Offline** and navigate to a new route — the
   `/offline` page renders instead of a browser error.

## Bundle-Size Budgets (FE-65)

Per-route first-load JS is measured during CI (`build` job) by
`scripts/bundle-budget.mjs` and enforced against `app/frontend/bundle-budgets.json`.
CI fails when a route exceeds its budget beyond the configured `tolerance`, and
prints the size delta against the base branch.

**Adjusting a budget deliberately:** edit the route's `maxBytes` in
`bundle-budgets.json` in the same PR that grows the route, with a note in the PR
description explaining why. Prefer code-splitting or trimming dependencies
before raising a budget.

### Current budgets are a baseline, not a target

The budgets FE-65 shipped with were roughly 2–4× below what the app actually
builds, so the gate failed on the merge commit that introduced it. They have
been reset to the sizes measured on `main` on 2026-08-28, which makes the check
a **ratchet**: it catches regressions from today forward, but it does not
certify that today's sizes are acceptable.

| Route | Measured | Budget now | Original FE-65 budget |
| --- | --- | --- | --- |
| `/dashboard` | 436 KB | 460 KB | 225 KB |
| `/generator` | 489 KB | 505 KB | 254 KB |
| `/` | 432 KB | 445 KB | 186 KB |
| `/pay` | 397 KB | 410 KB | 195 KB |
| `/discovery` | 358 KB | 370 KB | 215 KB |

Those original numbers are a reasonable ambition. Ratchet the budgets back down
as routes are code-split and dependencies trimmed; the gate will hold each
improvement in place.

### `/dashboard` remediation (2026-10-18)

`/dashboard` was measured at 834 KB (838 KB re-measured with
`scripts/bundle-budget.mjs` before the change). A bundle analysis of its
first-load chunks showed a single largest contributor: a ~411 KB chunk
containing `recharts` (plus its `immer`/`react-redux` dependencies), pulled in
only by `AnalyticsDashboard`. That component is now loaded with `next/dynamic`
(`ssr: false`, with a skeleton placeholder), so the charts load after the page
shell instead of in first-load JS.

| | First-load JS |
| --- | --- |
| Before | 838 KB (budget 860 KB) |
| After | 436 KB (budget 460 KB) |
| Original FE-65 budget | 225 KB |

**Remaining gap to the original budget: ~211 KB.** What is left is mostly
framework code shared by every route (`react-dom`/Next runtime, ~346 KB raw) and
`i18next` from the root layout (~42 KB), which are not dashboard-specific. Closing
the rest of the gap needs app-wide work (shared layout dependencies) rather than
further changes to the dashboard route.

## Core Web Vitals (FE-66)

`frontend-web-vitals.yml` builds the app in **production** mode, serves it, and
runs Lighthouse (`scripts/collect-vitals.mjs`) to measure **LCP, CLS, INP** for
`/pay`, `/receipt`, and `/dashboard`. `scripts/web-vitals.mjs` evaluates the
results against the web.dev thresholds (classification mirrored and unit-tested
in `src/lib/vitals-thresholds.ts`) and reports a delta against the base branch.

**Policy:** a metric landing in the **poor** band fails the build by default;
pass `--flag-only` to downgrade to a non-blocking flag.

## End-to-End: Pay → Receipt (FE-67)

`e2e/` contains a Playwright suite that walks link creation → testnet payment →
receipt (`e2e/tests/pay-to-receipt.spec.ts`), asserting the receipt reference
and status match the backend response. It runs in CI (`frontend-e2e.yml`)
against a preview/ephemeral environment, uploads screenshots + traces on
failure, and relies on web-first assertions (no fixed sleeps) for stability.
