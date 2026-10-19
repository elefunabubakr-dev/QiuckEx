/**
 * Integration test for the indexer lag guard (#1152).
 *
 * Boots a real Nest application with the guard registered the same way
 * `IndexerLagModule` registers it (as a global APP_GUARD) and the real
 * `GlobalHttpExceptionFilter` in front, then drives it over HTTP with
 * supertest. This proves the full contract a client actually observes: the
 * status code, the stable error code, the `Retry-After` header, the guard
 * metric increment, and recovery once lag drops.
 *
 * The indexer status is stubbed at the service boundary so the test does not
 * depend on a live Horizon instance.
 */

import {
  Controller,
  Get,
  INestApplication,
} from "@nestjs/common";
import { Reflector, APP_GUARD } from "@nestjs/core";
import { Test, TestingModule } from "@nestjs/testing";
import * as request from "supertest";

import { IndexerLagGuard } from "./indexer-lag.guard";
import { IndexerLagService, IndexerLagStatus } from "./indexer-lag.service";
import {
  RequiresIndexerLagCheck,
  IndexerLagPolicy,
  REQUIRE_INDEXER_LAG_CHECK_KEY,
} from "./requires-indexer-lag-check.decorator";
import { AuditService } from "../audit/audit.service";
import { MetricsService } from "../metrics/metrics.service";
import { AppConfigService } from "../config";
import { GlobalHttpExceptionFilter } from "../common/filters/global-http-exception.filter";

// ── Test-only controllers mirroring the audited production routes ──────────

@Controller("int/indexed")
class FailClosedTestController {
  @Get("timeline")
  @RequiresIndexerLagCheck(IndexerLagPolicy.FAIL_CLOSED)
  getTimeline() {
    return { ok: true };
  }
}

@Controller("int/feed")
class StaleHeaderTestController {
  @Get()
  @RequiresIndexerLagCheck(IndexerLagPolicy.STALE_HEADER)
  getFeed() {
    return { ok: true };
  }
}

@Controller("int/live")
class UndecoratedTestController {
  @Get()
  getLive() {
    return { ok: true };
  }
}

const HEALTHY: IndexerLagStatus = {
  currentNetworkLedger: 1000,
  lastIndexedLedger: 1000,
  lagLedgers: 0,
  isLagging: false,
  isEnabled: true,
  isOverridden: false,
  thresholdLedgers: 100,
};

const LAGGING: IndexerLagStatus = {
  currentNetworkLedger: 5000,
  lastIndexedLedger: 1000,
  lagLedgers: 4000,
  isLagging: true,
  isEnabled: true,
  isOverridden: false,
  thresholdLedgers: 100,
};

describe("Indexer lag guard over HTTP (#1152)", () => {
  let app: INestApplication;
  let isBlocked: boolean;
  let status: IndexerLagStatus;
  let metricsService: {
    recordIndexerLagGuardBlockedRequest: jest.Mock;
    setIndexerLagGuardStatus: jest.Mock;
    recordIndexerLag: jest.Mock;
  };

  beforeEach(async () => {
    isBlocked = false;
    status = HEALTHY;

    const lagServiceStub = {
      isBlocked: () => isBlocked,
      getStatus: () => status,
    };

    metricsService = {
      recordIndexerLagGuardBlockedRequest: jest.fn(),
      setIndexerLagGuardStatus: jest.fn(),
      recordIndexerLag: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [
        FailClosedTestController,
        StaleHeaderTestController,
        UndecoratedTestController,
      ],
      providers: [
        { provide: IndexerLagService, useValue: lagServiceStub },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: MetricsService, useValue: metricsService },
        { provide: Reflector, useClass: Reflector },
        { provide: APP_GUARD, useClass: IndexerLagGuard },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(
      new GlobalHttpExceptionFilter({
        isProduction: false,
      } as AppConfigService),
    );
    await app.init();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  /** Put the indexer into a lagging state. */
  function startLagging() {
    isBlocked = true;
    status = LAGGING;
  }

  /** Let the indexer catch back up. */
  function recover() {
    isBlocked = false;
    status = HEALTHY;
  }

  it("blocks a fail-closed decorated route with 503, a stable code and Retry-After", async () => {
    startLagging();

    const res = await request(app.getHttpServer())
      .get("/int/indexed/timeline")
      .expect(503);

    expect(res.body.error.code).toBe("INDEXER_LAGGING");
    expect(res.headers["retry-after"]).toBe("60");
    expect(res.body.error.details).toMatchObject({
      currentNetworkLedger: 5000,
      lastIndexedLedger: 1000,
      lagLedgers: 4000,
      thresholdLedgers: 100,
    });
  });

  it("serves the same route with 200 once the lag recovers", async () => {
    startLagging();
    await request(app.getHttpServer()).get("/int/indexed/timeline").expect(503);

    recover();

    const res = await request(app.getHttpServer())
      .get("/int/indexed/timeline")
      .expect(200);

    expect(res.body).toEqual({ ok: true });
  });

  it("never blocks a route that is not decorated", async () => {
    startLagging();

    const res = await request(app.getHttpServer())
      .get("/int/live")
      .expect(200);

    expect(res.body).toEqual({ ok: true });
    expect(metricsService.recordIndexerLagGuardBlockedRequest).not.toHaveBeenCalled();
  });

  it("serves a stale-header route with the lag advertised", async () => {
    startLagging();

    const res = await request(app.getHttpServer())
      .get("/int/feed")
      .expect(200);

    expect(res.body).toEqual({ ok: true });
    expect(res.headers["x-quickex-indexer-lag-ledgers"]).toBe("4000");
    expect(res.headers["x-quickex-indexer-last-ledger"]).toBe("1000");
    expect(res.headers["retry-after"]).toBeUndefined();
  });

  it("increments the guard-blocked metric once per blocked request and not at all when healthy", async () => {
    await request(app.getHttpServer()).get("/int/indexed/timeline").expect(200);
    expect(
      metricsService.recordIndexerLagGuardBlockedRequest,
    ).not.toHaveBeenCalled();

    startLagging();
    await request(app.getHttpServer()).get("/int/indexed/timeline").expect(503);
    await request(app.getHttpServer()).get("/int/indexed/timeline").expect(503);

    expect(
      metricsService.recordIndexerLagGuardBlockedRequest,
    ).toHaveBeenCalledTimes(2);
    expect(
      metricsService.recordIndexerLagGuardBlockedRequest,
    ).toHaveBeenCalledWith("GET", "/int/indexed/timeline");
  });

  it("labels the metric with the route template rather than the raw request path", async () => {
    startLagging();

    await request(app.getHttpServer()).get("/int/indexed/timeline").expect(503);

    const [, route] =
      metricsService.recordIndexerLagGuardBlockedRequest.mock.calls[0];
    expect(route).toBe("/int/indexed/timeline");
  });
});

describe("Production routes carry the guard decorator (#1152)", () => {
  // Imported lazily so this file's HTTP fixture is not coupled to their modules.
  /* eslint-disable @typescript-eslint/no-var-requires */
  const reflector = new Reflector();

  function policyFor(controller: unknown, handler: string): unknown {
    const target = (controller as Record<string, () => void>)[handler];
    return reflector.getAllAndOverride(REQUIRE_INDEXER_LAG_CHECK_KEY, [
      target,
      controller as unknown as () => void,
    ]);
  }

  it("fails closed on the transaction timeline read", () => {
    const {
      TransactionTimelineController,
    } = require("../transaction-timeline/transaction-timeline.controller");

    expect(policyFor(TransactionTimelineController.prototype, "getTimeline")).toBe(
      IndexerLagPolicy.FAIL_CLOSED,
    );
  });

  it("serves the dashboard feed with a staleness header", () => {
    const {
      DashboardFeedController,
    } = require("../dashboard-feed/dashboard-feed.controller");

    expect(policyFor(DashboardFeedController.prototype, "getFeed")).toBe(
      IndexerLagPolicy.STALE_HEADER,
    );
  });

  it("fails closed on the single-receipt read and serves the address history with a header", () => {
    const { ReceiptsController } = require("../receipts/receipts.controller");

    expect(
      policyFor(ReceiptsController.prototype, "getByTxHash"),
    ).toBe(IndexerLagPolicy.FAIL_CLOSED);
    expect(
      policyFor(ReceiptsController.prototype, "getByAddress"),
    ).toBe(IndexerLagPolicy.STALE_HEADER);
  });

  it("leaves receipt hash verification unguarded so integrity can be checked during lag", () => {
    const { ReceiptsController } = require("../receipts/receipts.controller");

    expect(
      policyFor(ReceiptsController.prototype, "verifyHash"),
    ).toBeUndefined();
  });

  it("leaves the transactions controller unguarded because it reads live Horizon", () => {
    const {
      TransactionsController,
    } = require("../transactions/transactions.controller");

    expect(
      policyFor(TransactionsController.prototype, "getTransactions"),
    ).toBeUndefined();
  });

  it("fails closed on every reconciliation read and worker trigger", () => {
    const {
      ReconciliationController,
    } = require("../reconciliation/reconciliation.controller");

    for (const handler of [
      "listHistory",
      "getRun",
      "getStatus",
      "trigger",
      "startBackfill",
      "getBackfillStatus",
      "getAutoMatchStatus",
      "triggerAutoMatch",
      "processTransaction",
      "listUnmatched",
      "getUnmatched",
    ]) {
      expect(policyFor(ReconciliationController.prototype, handler)).toBe(
        IndexerLagPolicy.FAIL_CLOSED,
      );
    }
  });

  it("leaves the reconciliation remedy routes available during a lag episode", () => {
    const {
      ReconciliationController,
    } = require("../reconciliation/reconciliation.controller");

    expect(
      policyFor(ReconciliationController.prototype, "resolveUnmatched"),
    ).toBeUndefined();
    expect(
      policyFor(ReconciliationController.prototype, "dismissUnmatched"),
    ).toBeUndefined();
  });
  /* eslint-enable @typescript-eslint/no-var-requires */
});
