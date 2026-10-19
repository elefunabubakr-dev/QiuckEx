import { Test, TestingModule } from "@nestjs/testing";
import { IndexerLagService, IndexerLagStatus } from "./indexer-lag.service";
import { AppConfigService } from "../config";
import { IndexerCheckpointRepository } from "../ingestion/indexer-checkpoint.repository";
import { MetricsService } from "../metrics/metrics.service";

type ConfigOverrides = Partial<{
  indexerLagThresholdLedgers: number;
  indexerLagGuardEnabled: boolean;
  indexerLagGuardOverride: boolean;
  quickexContractId: string | undefined;
  network: "testnet" | "public";
}>;

function makeConfig(overrides: ConfigOverrides = {}): AppConfigService {
  return {
    network: overrides.network ?? "testnet",
    indexerLagThresholdLedgers: overrides.indexerLagThresholdLedgers ?? 100,
    indexerLagGuardEnabled: overrides.indexerLagGuardEnabled ?? true,
    indexerLagGuardOverride: overrides.indexerLagGuardOverride ?? false,
    quickexContractId:
      overrides.quickexContractId === undefined
        ? "C_CONTRACT_ID"
        : overrides.quickexContractId,
  } as unknown as AppConfigService;
}

function horizonResponse(ledger: number): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ core_latest_ledger: ledger }),
  } as unknown as Response;
}

describe("IndexerLagService (#1152)", () => {
  let checkpointRepo: jest.Mocked<
    Pick<IndexerCheckpointRepository, "getLastLedger">
  >;
  let metrics: jest.Mocked<
    Pick<MetricsService, "recordIndexerLag" | "setIndexerLagGuardStatus">
  >;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    checkpointRepo = {
      getLastLedger: jest.fn().mockResolvedValue(0),
    };
    metrics = {
      recordIndexerLag: jest.fn(),
      setIndexerLagGuardStatus: jest.fn(),
    };
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  async function makeService(
    configOverrides: ConfigOverrides = {},
  ): Promise<IndexerLagService> {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IndexerLagService,
        { provide: AppConfigService, useValue: makeConfig(configOverrides) },
        { provide: IndexerCheckpointRepository, useValue: checkpointRepo },
        { provide: MetricsService, useValue: metrics },
      ],
    }).compile();

    return module.get(IndexerLagService);
  }

  /** Poll Horizon + the checkpoint once and return the resulting status. */
  async function poll(
    service: IndexerLagService,
    networkLedger: number,
    indexedLedger: number | null,
  ): Promise<IndexerLagStatus> {
    global.fetch = jest.fn().mockResolvedValue(horizonResponse(networkLedger)) as unknown as typeof fetch;
    checkpointRepo.getLastLedger.mockResolvedValue(indexedLedger);
    await service.pollHorizon();
    return service.getStatus();
  }

  // ---------------------------------------------------------------------------
  // Thresholds
  // ---------------------------------------------------------------------------
  describe("lag thresholds", () => {
    it("reports no lag when the indexer has caught up to the network", async () => {
      const service = await makeService();

      const status = await poll(service, 1000, 1000);

      expect(status.lagLedgers).toBe(0);
      expect(status.isLagging).toBe(false);
    });

    it("does not lag at exactly the threshold", async () => {
      const service = await makeService({ indexerLagThresholdLedgers: 100 });

      const status = await poll(service, 1000, 900);

      expect(status.lagLedgers).toBe(100);
      expect(status.isLagging).toBe(false);
    });

    it("lags one ledger past the threshold", async () => {
      const service = await makeService({ indexerLagThresholdLedgers: 100 });

      const status = await poll(service, 1000, 899);

      expect(status.lagLedgers).toBe(101);
      expect(status.isLagging).toBe(true);
    });

    it("clamps negative lag to zero so a future checkpoint does not read as healthy", async () => {
      const service = await makeService();

      const status = await poll(service, 1000, 1500);

      expect(status.lagLedgers).toBe(0);
      expect(status.isLagging).toBe(false);
    });

    it("honours a custom threshold", async () => {
      const service = await makeService({ indexerLagThresholdLedgers: 5 });

      await expect(poll(service, 1000, 996)).resolves.toMatchObject({
        lagLedgers: 4,
        isLagging: false,
      });
      await expect(poll(service, 1000, 990)).resolves.toMatchObject({
        lagLedgers: 10,
        isLagging: true,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Status transitions / degraded inputs
  // ---------------------------------------------------------------------------
  describe("status transitions", () => {
    it("reports unknown lag before the first successful poll", async () => {
      const service = await makeService();

      const status = service.getStatus();

      expect(status.currentNetworkLedger).toBeNull();
      expect(status.lastIndexedLedger).toBeNull();
      expect(status.lagLedgers).toBeNull();
      expect(status.isLagging).toBe(false);
    });

    it("keeps the last known ledgers when the indexer-status fetch fails", async () => {
      const service = await makeService();
      await poll(service, 1000, 500);
      expect(service.getStatus().lagLedgers).toBe(500);

      global.fetch = jest
        .fn()
        .mockResolvedValue({ ok: false, status: 503 } as unknown as Response) as unknown as typeof fetch;
      await service.pollHorizon();

      const status = service.getStatus();
      expect(status.currentNetworkLedger).toBe(1000);
      expect(status.lastIndexedLedger).toBe(500);
      expect(status.lagLedgers).toBe(500);
      expect(status.isLagging).toBe(true);
    });

    it("keeps the last known indexer ledger when the checkpoint lookup throws", async () => {
      const service = await makeService();
      await poll(service, 1000, 1000);

      checkpointRepo.getLastLedger.mockRejectedValue(new Error("checkpoint table missing"));
      global.fetch = jest.fn().mockResolvedValue(horizonResponse(2000)) as unknown as typeof fetch;
      await service.pollHorizon();

      expect(service.getStatus().lastIndexedLedger).toBe(1000);
      expect(service.getStatus().lagLedgers).toBe(1000);
      expect(service.getStatus().isLagging).toBe(true);
    });

    it("stays unblocked when no contract id is configured, because lag is unknowable", async () => {
      const service = await makeService({ quickexContractId: null });
      global.fetch = jest.fn().mockResolvedValue(horizonResponse(5000)) as unknown as typeof fetch;

      await service.pollHorizon();

      const status = service.getStatus();
      expect(status.lastIndexedLedger).toBeNull();
      expect(status.lagLedgers).toBeNull();
      expect(status.isLagging).toBe(false);
      expect(service.isBlocked()).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // isBlocked
  // ---------------------------------------------------------------------------
  describe("isBlocked", () => {
    it("blocks when enabled, not overridden, and lagging", async () => {
      const service = await makeService();
      await poll(service, 1000, 100);

      expect(service.isBlocked()).toBe(true);
    });

    it("does not block when healthy", async () => {
      const service = await makeService();
      await poll(service, 1000, 1000);

      expect(service.isBlocked()).toBe(false);
    });

    it("does not block when the guard is disabled, even while lagging", async () => {
      const service = await makeService({ indexerLagGuardEnabled: false });
      await poll(service, 1000, 100);

      expect(service.getStatus().isLagging).toBe(true);
      expect(service.isBlocked()).toBe(false);
    });

    it("does not block when an operator has overridden the guard", async () => {
      const service = await makeService({ indexerLagGuardOverride: true });
      await poll(service, 1000, 100);

      expect(service.getStatus().isLagging).toBe(true);
      expect(service.getStatus().isOverridden).toBe(true);
      expect(service.isBlocked()).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Metrics
  // ---------------------------------------------------------------------------
  describe("metric emission", () => {
    it("publishes the guard status gauge for each state", async () => {
      const healthy = await makeService();
      await poll(healthy, 1000, 1000);
      expect(metrics.setIndexerLagGuardStatus).toHaveBeenLastCalledWith(1);

      metrics.setIndexerLagGuardStatus.mockClear();
      const lagging = await makeService();
      await poll(lagging, 1000, 100);
      expect(metrics.setIndexerLagGuardStatus).toHaveBeenLastCalledWith(3);

      metrics.setIndexerLagGuardStatus.mockClear();
      const disabled = await makeService({ indexerLagGuardEnabled: false });
      await poll(disabled, 1000, 1000);
      expect(metrics.setIndexerLagGuardStatus).toHaveBeenLastCalledWith(0);

      metrics.setIndexerLagGuardStatus.mockClear();
      const overridden = await makeService({ indexerLagGuardOverride: true });
      await poll(overridden, 1000, 100);
      expect(metrics.setIndexerLagGuardStatus).toHaveBeenLastCalledWith(2);
    });

    it("records the observed lag in ledgers", async () => {
      const service = await makeService();

      await poll(service, 1000, 400);

      expect(metrics.recordIndexerLag).toHaveBeenCalledWith(600);
    });
  });
});
