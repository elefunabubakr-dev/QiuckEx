# Indexer Lag Guard — Route Inventory & Operations Runbook

**Issue:** [#1152](https://github.com/Pulsefy/QiuckEx/issues/1152) — *BE-W9: Apply and Test the Indexer Lag Guard on Indexed-Data Routes*

The guard (`IndexerLagGuard`) was registered globally but had no decorated routes,
so it never fired. This document records which routes are now protected, why each
one got the policy it got, and what to do when the guard trips in production.

---

## 1. How the guard decides

`IndexerLagService` polls Horizon once a minute and reads the ingestion
checkpoint, then derives lag:

```
lagLedgers = max(0, currentNetworkLedger - lastIndexedLedger)
isLagging  = lagLedgers > INDEXER_LAG_THRESHOLD_LEDGERS
isBlocked  = INDEXER_LAG_GUARD_ENABLED && !INDEXER_LAG_GUARD_OVERRIDE && isLagging
```

Only routes carrying `@RequiresIndexerLagCheck()` are evaluated. Every other
route — including live Horizon/RPC reads — is passed straight through, so the
guard has no effect on write paths, auth, or non-indexed data.

### Two policies

| Policy | Behaviour while lagging | Chosen when |
| --- | --- | --- |
| `FAIL_CLOSED` | `503` + `Retry-After: 60` + `X-QuickEx-Indexer-*` headers | A partial answer would be *silently wrong*, or the route triggers work whose result depends on a complete view of history. |
| `STALE_HEADER` | `200` with `X-QuickEx-Indexer-*` headers | The route is a browse surface that is useful-but-incomplete, and the client can be told how stale it is. |

### Environment

| Variable | Default | Notes |
| --- | --- | --- |
| `INDEXER_LAG_GUARD_ENABLED` | `true` | Master switch. When false, nothing is blocked and `indexer_lag_guard_status` reports `0`. |
| `INDEXER_LAG_GUARD_OVERRIDE` | `false` | Kills the guard without a redeploy during an incident. Status reports `2`. |
| `INDEXER_LAG_THRESHOLD_LEDGERS` | `100` | Lag above this many ledgers trips the guard. |
| `QUICKEX_CONTRACT_ID` | — | **Required.** See the warning below. |

> **The guard is a silent no-op without `QUICKEX_CONTRACT_ID`.**
> Lag is measured against the ingestion checkpoint, and the checkpoint is keyed
> by contract. With no contract id there is no checkpoint to read, `lagLedgers`
> stays `null`, and `isLagging` can never become true. The service now logs a
> warning at startup when the guard is enabled but `QUICKEX_CONTRACT_ID` is
> unset — treat that warning as a misconfiguration, not noise.

---

## 2. Route inventory

### `FAIL_CLOSED` — `503` while lagging

| Route | Method | Why it must not serve stale data |
| --- | --- | --- |
| `/transaction-timeline` | `GET` | Every event kind is read from indexed tables. A partially-written timeline reads as "this transaction did fewer things than it did" — a correctness bug, not a cosmetic one. |
| `/v1/receipts/tx/:txHash` | `GET` | Joins live Horizon/RPC data against the indexed receipts table, so lagging returns a receipt with silently missing indexed metadata. |
| `/reconciliation/status` | `GET` | Reports on worker conclusions derived from indexed data. |
| `/reconciliation/history` | `GET` | Lists runs; each run's verdict depends on a complete view. |
| `/reconciliation/history/:runId` | `GET` | Per-run report. |
| `/reconciliation/trigger` | `POST` | Enqueues work; running it against a stale index produces wrong match decisions. |
| `/reconciliation/backfill` | `POST` | Same reasoning as `trigger`. |
| `/reconciliation/backfill/status` | `GET` | Progress over the indexed range. |
| `/reconciliation/auto-match/status` | `GET` | Auto-match worker state. |
| `/reconciliation/auto-match/trigger` | `POST` | Enqueues auto-match work. |
| `/reconciliation/auto-match/process` | `POST` | Enqueues auto-match work. |
| `/reconciliation/unmatched` | `GET` | Lists unmatched items from the indexed queue. |
| `/reconciliation/unmatched/:id` | `GET` | Single unmatched item. |

### `STALE_HEADER` — `200` + headers while lagging

| Route | Method | Headers |
| --- | --- | --- |
| `/dashboard-feed` | `GET` | `X-QuickEx-Indexer-Lag-Ledgers`, `X-QuickEx-Indexer-Last-Ledger` |
| `/v1/receipts/address/:address` | `GET` | same |

The feed is ordered newest-first, so a lagging reader still gets the most recent
activity and can be told how far back the index actually reaches. Same for
address receipt history.

### Deliberately unguarded

| Route | Reason |
| --- | --- |
| `/v1/receipts/verify-hash` | A pure function of the caller's own body. Indexer state cannot make its answer wrong, and callers must be able to verify integrity precisely when the indexer is misbehaving. |
| `/reconciliation/unmatched/:id/resolve` | Operator remedy. Must stay reachable during a lag episode so the queue can be drained. |
| `/reconciliation/unmatched/:id` (`DELETE`) | Same. |
| `/transactions` and all other live RPC/Horizon reads | Not indexed; the guard has nothing to say about them. |
| All write/compose/simulate paths | Out of scope — the guard protects reads against a stale index, it does not gate submissions. |

---

## 3. Client contract

Fail-closed response:

```http
HTTP/1.1 503 Service Unavailable
Retry-After: 60
X-QuickEx-Indexer-Lag-Ledgers: 4000
X-QuickEx-Indexer-Last-Ledger: 1000
Content-Type: application/json
```

```json
{
  "error": {
    "code": "INDEXER_LAGGING",
    "message": "Indexer is currently lagging behind the network. Risky operations are temporarily disabled. Please retry later.",
    "request_id": "…",
    "details": {
      "currentNetworkLedger": 5000,
      "lastIndexedLedger": 1000,
      "lagLedgers": 4000,
      "thresholdLedgers": 100,
      "retryAfterSeconds": 60
    }
  }
}
```

`code` is the stable, machine-readable discriminator — branch on it, not on the
message text. `details` carries the ledger diagnostics.

Stale-header response: a normal `200` body plus
`X-QuickEx-Indexer-Lag-Ledgers` and `X-QuickEx-Indexer-Last-Ledger`, so a client
can show "indexed through ledger 1000" without a second request.

---

## 4. Metrics

| Metric | Type | Labels | Meaning |
| --- | --- | --- | --- |
| `indexer_lag_guard_blocked_requests_total` | counter | `method`, `route` | Guarded requests rejected. `route` is the Express route template (`/v1/receipts/tx/:txHash`), never the raw path, so label cardinality stays bounded. |
| `indexer_lag_ledgers` | gauge | — | Current lag in ledgers. |
| `indexer_lag_guard_status` | gauge | — | `0` disabled, `1` healthy, `2` overridden, `3` lagging. |

Alert on `indexer_lag_guard_status == 3` sustained for more than two poll
intervals (~3 minutes). A single blip is usually a slow Horizon poll.

---

## 5. Runbook

### The guard is blocking traffic

1. **Confirm it is real lag, not a bug.**
   ```promql
   indexer_lag_ledgers
   rate(indexer_lag_guard_blocked_requests_total[5m])
   ```
   Also check for a startup warning about a missing `QUICKEX_CONTRACT_ID` — if
   lag is `null` the guard cannot be the cause.

2. **Check the indexer is making progress**, not wedged. Compare
   `indexer_lag_ledgers` across two minutes. A rising or flat-high value means
   ingestion is stuck; a falling value means it is catching up and the guard
   will clear itself within one poll interval.

3. **If ingestion is wedged**, that is the incident — the guard is doing its job.
   Escalate to whoever owns ingestion. Do not raise the threshold.

4. **To unblock traffic during an incident** (operator override):
   ```
   INDEXER_LAG_GUARD_OVERRIDE=true
   ```
   Status gauge flips to `2`. This is a deliberate, visible bypass — use it only
   when stale answers are judged more damaging than degraded availability, and
   revert it once the indexer recovers.

5. **To disable entirely** (e.g. the guard itself is misbehaving):
   ```
   INDEXER_LAG_GUARD_ENABLED=false
   ```
   Status gauge flips to `0`.

### Raising the threshold

`INDEXER_LAG_THRESHOLD_LEDGERS` should reflect how many ledgers behind is
tolerable for the `FAIL_CLOSED` routes above. Setting it too high defeats the
guard; too low and ordinary catch-up trips it. On Stellar Testnet, ledgers close
roughly every 5 seconds, so the default of 100 is ~8 minutes.

---

## 6. Tests

| File | What it covers |
| --- | --- |
| `src/indexer-lag/indexer-lag.service.unit.spec.ts` | Lag derivation, threshold boundary, contract-id gating, Horizon/checkpoint failure tolerance, status gauge values. |
| `src/indexer-lag/indexer-lag.guard.unit.spec.ts` | Undecorated pass-through, fail-closed 503 + `Retry-After` + `code` + `details`, stale-header policy, route-template metric labels, audit logging. |
| `src/indexer-lag/indexer-lag.guard.int.spec.ts` | Boots a real Nest app with the guard as a global `APP_GUARD` and the real `GlobalHttpExceptionFilter`, drives it over HTTP, and asserts the block → recovery transition, the metric, and that every production route carries the intended policy. |

Run them with:

```bash
cd app/backend
pnpm test:unit
pnpm test:int
```
