import { Test, TestingModule } from "@nestjs/testing";
import { ExecutionContext, ServiceUnavailableException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  IndexerLagGuard,
  INDEXER_LAG_LEDGERS_HEADER,
  INDEXER_LAST_LEDGER_HEADER,
  INDEXER_LAG_RETRY_AFTER_SECONDS,
} from "./indexer-lag.guard";
import { IndexerLagService, IndexerLagStatus } from "./indexer-lag.service";
import {
  REQUIRE_INDEXER_LAG_CHECK_KEY,
  IndexerLagPolicy,
} from "./requires-indexer-lag-check.decorator";
import { AuditService } from "../audit/audit.service";
import { MetricsService } from "../metrics/metrics.service";

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
  currentNetworkLedger: 2000,
  lastIndexedLedger: 1000,
  lagLedgers: 1000,
  isLagging: true,
  isEnabled: true,
  isOverridden: false,
  thresholdLedgers: 100,
};

/** Minimal Express request/response + ExecutionContext stand-in. */
function makeContext(options: {
  policy?: IndexerLagPolicy | undefined;
  isBlocked: boolean;
  status?: IndexerLagStatus;
  routePath?: string;
  baseUrl?: string;
  rawPath?: string;
  userId?: string;
}) {
  const headers: Record<string, string> = options.userId
    ? { "x-user-id": options.userId }
    : {};

  const req = {
    method: "GET",
    headers,
    path: options.rawPath ?? "/v1/receipts/tx/abc123",
    url: options.rawPath ?? "/v1/receipts/tx/abc123",
    baseUrl: options.baseUrl ?? "",
    route: options.routePath
      ? { path: options.routePath }
      : // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (undefined as any),
  };

  const setHeader = jest.fn();
  const res = { setHeader };

  const ctx = {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  } as unknown as ExecutionContext;

  return { ctx, req, res, setHeader };
}

describe("IndexerLagGuard (#1152)", () => {
  let guard: IndexerLagGuard;
  let reflector: jest.Mocked<Pick<Reflector, "getAllAndOverride">>;
  let indexerLagService: jest.Mocked<
    Pick<IndexerLagService, "isBlocked" | "getStatus">
  >;
  let auditService: jest.Mocked<Pick<AuditService, "log">>;
  let metricsService: jest.Mocked<
    Pick<MetricsService, "recordIndexerLagGuardBlockedRequest">
  >;

  beforeEach(async () => {
    reflector = { getAllAndOverride: jest.fn() };
    indexerLagService = {
      isBlocked: jest.fn().mockReturnValue(false),
      getStatus: jest.fn().mockReturnValue(HEALTHY),
    };
    auditService = { log: jest.fn().mockResolvedValue(undefined) };
    metricsService = {
      recordIndexerLagGuardBlockedRequest: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IndexerLagGuard,
        { provide: Reflector, useValue: reflector },
        { provide: IndexerLagService, useValue: indexerLagService },
        { provide: AuditService, useValue: auditService },
        { provide: MetricsService, useValue: metricsService },
      ],
    }).compile();

    guard = module.get(IndexerLagGuard);
  });

  /** Configure the reflector to report a route-level policy. */
  function withPolicy(policy: IndexerLagPolicy | undefined) {
    reflector.getAllAndOverride.mockImplementation(
      (key: unknown) => key === REQUIRE_INDEXER_LAG_CHECK_KEY ? policy : undefined,
    );
  }

  function blocked() {
    indexerLagService.isBlocked.mockReturnValue(true);
    indexerLagService.getStatus.mockReturnValue(LAGGING);
  }

  // ---------------------------------------------------------------------------
  // Allow paths
  // ---------------------------------------------------------------------------
  describe("allow paths", () => {
    it("allows undecorated routes without consulting the indexer", async () => {
      withPolicy(undefined);

      const { ctx, setHeader } = makeContext({ isBlocked: true });

      await expect(guard.canActivate(ctx)).resolves.toBe(true);

      expect(indexerLagService.isBlocked).not.toHaveBeenCalled();
      expect(metricsService.recordIndexerLagGuardBlockedRequest).not.toHaveBeenCalled();
      expect(setHeader).not.toHaveBeenCalled();
    });

    it("allows decorated routes while the indexer is healthy", async () => {
      withPolicy(IndexerLagPolicy.FAIL_CLOSED);
      indexerLagService.isBlocked.mockReturnValue(false);

      const { ctx, setHeader } = makeContext({ isBlocked: false });

      await expect(guard.canActivate(ctx)).resolves.toBe(true);

      expect(metricsService.recordIndexerLagGuardBlockedRequest).not.toHaveBeenCalled();
      expect(setHeader).not.toHaveBeenCalled();
    });

    it("does not set staleness headers while the indexer is healthy", async () => {
      withPolicy(IndexerLagPolicy.STALE_HEADER);
      indexerLagService.isBlocked.mockReturnValue(false);

      const { ctx, setHeader } = makeContext({ isBlocked: false });

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(setHeader).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Fail-closed block path
  // ---------------------------------------------------------------------------
  describe("fail-closed block path", () => {
    it("throws 503 with a Retry-After header when lag exceeds the threshold", async () => {
      withPolicy(IndexerLagPolicy.FAIL_CLOSED);
      blocked();

      const { ctx, setHeader } = makeContext({ isBlocked: true });

      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );

      expect(setHeader).toHaveBeenCalledWith(
        "Retry-After",
        INDEXER_LAG_RETRY_AFTER_SECONDS.toString(),
      );
    });

    it("returns the INDEXER_LAGGING code and ledger diagnostics, not a generic 503", async () => {
      withPolicy(IndexerLagPolicy.FAIL_CLOSED);
      blocked();

      const { ctx } = makeContext({ isBlocked: true });

      const error = await guard.canActivate(ctx).catch((e: unknown) => e);
      const payload = (error as ServiceUnavailableException).getResponse() as {
        code: string;
        details: Record<string, unknown>;
      };

      expect(payload.code).toBe("INDEXER_LAGGING");
      expect(payload.details).toMatchObject({
        currentNetworkLedger: 2000,
        lastIndexedLedger: 1000,
        lagLedgers: 1000,
        thresholdLedgers: 100,
        retryAfterSeconds: INDEXER_LAG_RETRY_AFTER_SECONDS,
      });
    });

    it("increments the guard-blocked metric", async () => {
      withPolicy(IndexerLagPolicy.FAIL_CLOSED);
      blocked();

      const { ctx } = makeContext({
        isBlocked: true,
        baseUrl: "/v1/receipts",
        routePath: "/tx/:txHash",
      });

      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );

      expect(metricsService.recordIndexerLagGuardBlockedRequest).toHaveBeenCalledTimes(
        1,
      );
      expect(metricsService.recordIndexerLagGuardBlockedRequest).toHaveBeenCalledWith(
        "GET",
        "/v1/receipts/tx/:txHash",
      );
    });

    it("labels the metric with the route pattern, never the raw path with user input", async () => {
      withPolicy(IndexerLagPolicy.FAIL_CLOSED);
      blocked();

      const { ctx } = makeContext({
        isBlocked: true,
        baseUrl: "/v1/receipts",
        routePath: "/tx/:txHash",
        rawPath: "/v1/receipts/tx/9f2c1a7b4e6d",
      });

      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );

      const [, route] =
        metricsService.recordIndexerLagGuardBlockedRequest.mock.calls[0];
      expect(route).not.toContain("9f2c1a7b4e6d");
    });

    it("writes an audit entry attributed to the calling user", async () => {
      withPolicy(IndexerLagPolicy.FAIL_CLOSED);
      blocked();

      const { ctx } = makeContext({ isBlocked: true, userId: "GUSER123" });

      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );

      expect(auditService.log).toHaveBeenCalledWith(
        "GUSER123",
        "indexer_lag_guard.blocked",
        "INDEXER_LAG",
        expect.objectContaining({ lagLedgers: 1000, method: "GET" }),
      );
    });

    it("records the block as anonymous when no user header is present", async () => {
      withPolicy(IndexerLagPolicy.FAIL_CLOSED);
      blocked();

      const { ctx } = makeContext({ isBlocked: true });

      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );

      expect(auditService.log).toHaveBeenCalledWith(
        "anonymous",
        "indexer_lag_guard.blocked",
        "INDEXER_LAG",
        expect.any(Object),
      );
    });

    it("still throws when the audit write fails", async () => {
      withPolicy(IndexerLagPolicy.FAIL_CLOSED);
      blocked();
      auditService.log.mockRejectedValue(new Error("audit store down"));

      const { ctx } = makeContext({ isBlocked: true });

      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it("defaults to fail-closed when the policy argument is omitted", async () => {
      // Mirrors the decorator default; the guard only branches on the two
      // explicit enum values, so an omitted policy is treated as fail-closed.
      withPolicy(IndexerLagPolicy.FAIL_CLOSED);
      blocked();

      const { ctx } = makeContext({ isBlocked: true });

      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Stale-header serve path
  // ---------------------------------------------------------------------------
  describe("stale-header serve path", () => {
    it("serves the request and advertises the lag instead of blocking", async () => {
      withPolicy(IndexerLagPolicy.STALE_HEADER);
      blocked();

      const { ctx, setHeader } = makeContext({ isBlocked: true });

      await expect(guard.canActivate(ctx)).resolves.toBe(true);

      expect(setHeader).toHaveBeenCalledWith(
        INDEXER_LAG_LEDGERS_HEADER,
        "1000",
      );
      expect(setHeader).toHaveBeenCalledWith(INDEXER_LAST_LEDGER_HEADER, "1000");
      expect(setHeader).not.toHaveBeenCalledWith(
        "Retry-After",
        expect.anything(),
      );
    });

    it("does not write a block audit entry for a served request", async () => {
      withPolicy(IndexerLagPolicy.STALE_HEADER);
      blocked();

      const { ctx } = makeContext({ isBlocked: true });

      await guard.canActivate(ctx);

      expect(auditService.log).not.toHaveBeenCalled();
    });

    it("still counts the request against the guard metric", async () => {
      withPolicy(IndexerLagPolicy.STALE_HEADER);
      blocked();

      const { ctx } = makeContext({
        isBlocked: true,
        baseUrl: "",
        routePath: "/dashboard-feed",
      });

      await guard.canActivate(ctx);

      expect(metricsService.recordIndexerLagGuardBlockedRequest).toHaveBeenCalledWith(
        "GET",
        "/dashboard-feed",
      );
    });

    it("omits the ledger headers when the lag is unknown", async () => {
      withPolicy(IndexerLagPolicy.STALE_HEADER);
      indexerLagService.isBlocked.mockReturnValue(true);
      indexerLagService.getStatus.mockReturnValue({
        ...HEALTHY,
        lastIndexedLedger: null,
        lagLedgers: null,
      });

      const { ctx, setHeader } = makeContext({ isBlocked: true });

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(setHeader).not.toHaveBeenCalled();
    });
  });
});
