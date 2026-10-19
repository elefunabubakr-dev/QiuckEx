import { HealthService } from "./health.service";

describe("HealthService", () => {
  let service: HealthService;
  let fetchSpy: jest.SpyInstance;

  let supabase: {
    checkHealth: jest.Mock;
    getClient: jest.Mock;
  };
  let horizon: { getBaseUrl: jest.Mock };
  let config: {
    supabaseUrl: string;
    supabaseAnonKey: string;
    network: string;
    isPaymentSigningConfigured: boolean;
    ingestionLagThresholdSeconds: number;
  };
  let jobQueueService: Record<string, jest.Mock>;
  let jobRepository: { listJobs: jest.Mock };
  let cursorRepository: { getLatestContractCursor: jest.Mock };
  let sorobanRpc: { getNetworkPassphrase: jest.Mock };

  function healthySupabaseClient() {
    const resolveNoError = jest.fn().mockResolvedValue({ error: null });
    return {
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          order: jest.fn(() => ({ limit: resolveNoError })),
          limit: resolveNoError,
        })),
      })),
    };
  }

  function failingSupabaseClient() {
    const resolveError = jest
      .fn()
      .mockResolvedValue({ error: { message: "db unreachable" } });
    return {
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          order: jest.fn(() => ({ limit: resolveError })),
          limit: resolveError,
        })),
      })),
    };
  }

  function buildService(): HealthService {
    return new HealthService(
      supabase as never,
      horizon as never,
      config as never,
      jobQueueService as never,
      jobRepository as never,
      cursorRepository as never,
      sorobanRpc as never,
    );
  }

  beforeEach(() => {
    jest.useFakeTimers();

    supabase = {
      checkHealth: jest.fn().mockResolvedValue(true),
      getClient: jest.fn(healthySupabaseClient),
    };
    horizon = {
      getBaseUrl: jest.fn().mockReturnValue("https://horizon.example.com"),
    };
    config = {
      supabaseUrl: "https://db.example.com",
      supabaseAnonKey: "anon-key",
      network: "testnet",
      isPaymentSigningConfigured: false,
      ingestionLagThresholdSeconds: 300,
    };
    jobQueueService = {};
    jobRepository = { listJobs: jest.fn().mockResolvedValue([]) };
    cursorRepository = {
      getLatestContractCursor: jest.fn().mockResolvedValue(null),
    };
    sorobanRpc = {
      getNetworkPassphrase: jest
        .fn()
        .mockResolvedValue("Test SDF Network ; September 2015"),
    };

    fetchSpy = jest
      .spyOn(global, "fetch")
      .mockResolvedValue({ ok: true, status: 200 } as Response);

    service = buildService();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe("liveness (getHealthStatus)", () => {
    it("reports the process is alive without touching any external service", async () => {
      const status = await service.getHealthStatus();

      expect(status).toEqual({
        status: "ok",
        version: expect.any(String),
        uptime: expect.any(Number),
      });

      expect(supabase.checkHealth).not.toHaveBeenCalled();
      expect(supabase.getClient).not.toHaveBeenCalled();
      expect(horizon.getBaseUrl).not.toHaveBeenCalled();
      expect(sorobanRpc.getNetworkPassphrase).not.toHaveBeenCalled();
      expect(jobRepository.listJobs).not.toHaveBeenCalled();
      expect(cursorRepository.getLatestContractCursor).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("readiness (getReadinessStatus) — all healthy", () => {
    it("reports ready with every dependency up", async () => {
      const result = await service.getReadinessStatus();

      expect(result.ready).toBe(true);
      expect(result.degraded).toBe(false);

      const names = result.checks.map((c) => c.name);
      expect(names).toEqual(
        expect.arrayContaining([
          "supabase",
          "environment",
          "migrations",
          "queue",
          "horizon",
          "soroban_rpc",
          "ingestion",
        ]),
      );

      for (const check of result.checks) {
        expect(check.status).toBe("up");
      }
    });
  });

  describe("readiness — each critical dependency failing independently", () => {
    const cases: Array<{
      name: string;
      checkName: string;
      fail: () => void;
    }> = [
      {
        name: "database (supabase)",
        checkName: "supabase",
        fail: () => supabase.checkHealth.mockResolvedValue(false),
      },
      {
        name: "migrations",
        checkName: "migrations",
        fail: () => supabase.getClient.mockImplementation(failingSupabaseClient),
      },
      {
        name: "job queue",
        checkName: "queue",
        fail: () =>
          jobRepository.listJobs.mockRejectedValue(new Error("queue down")),
      },
      {
        name: "horizon",
        checkName: "horizon",
        fail: () =>
          fetchSpy.mockRejectedValue(new Error("connection refused")),
      },
      {
        name: "soroban rpc",
        checkName: "soroban_rpc",
        fail: () =>
          sorobanRpc.getNetworkPassphrase.mockRejectedValue(
            new Error("rpc 503 unavailable"),
          ),
      },
    ];

    it.each(cases)(
      "is not ready when $name is down",
      async ({ checkName, fail }) => {
        fail();

        const result = await service.getReadinessStatus();

        expect(result.ready).toBe(false);

        const failed = result.checks.find((c) => c.name === checkName);
        expect(failed?.status).toBe("down");
        expect(failed?.error).toBeDefined();
      },
    );
  });

  describe("readiness — degraded vs hard failure", () => {
    it("marks a timed-out dependency as degraded but stays ready", async () => {
      sorobanRpc.getNetworkPassphrase.mockRejectedValue(new Error("Timeout"));

      const result = await service.getReadinessStatus();

      expect(result.ready).toBe(true);
      expect(result.degraded).toBe(true);

      const soroban = result.checks.find((c) => c.name === "soroban_rpc");
      expect(soroban?.status).toBe("degraded");
    });

    it("distinguishes a timed-out dependency (degraded) from a hard failure (down)", async () => {
      fetchSpy.mockRejectedValue(new Error("Timeout"));
      sorobanRpc.getNetworkPassphrase.mockRejectedValue(
        new Error("rpc unreachable"),
      );

      const result = await service.getReadinessStatus();

      expect(result.ready).toBe(false);
      expect(result.degraded).toBe(true);

      const horizonCheck = result.checks.find((c) => c.name === "horizon");
      const sorobanCheck = result.checks.find((c) => c.name === "soroban_rpc");
      expect(horizonCheck?.status).toBe("degraded");
      expect(sorobanCheck?.status).toBe("down");
    });

    it("reports degraded per-dependency status even when still ready", async () => {
      fetchSpy.mockRejectedValue(new Error("Timeout"));

      const result = await service.getReadinessStatus();

      expect(result.ready).toBe(true);
      expect(result.degraded).toBe(true);

      const horizonCheck = result.checks.find((c) => c.name === "horizon");
      expect(horizonCheck?.status).toBe("degraded");
    });
  });

  describe("ingestion lag (checkIngestionLag)", () => {
    const NOW = new Date("2026-01-01T00:00:00.000Z");

    function cursorUpdatedAgo(seconds: number) {
      return {
        id: "contract:CTEST",
        paging_token: "99-5",
        ledger_sequence: 42,
        updated_at: new Date(NOW.getTime() - seconds * 1000).toISOString(),
      };
    }

    beforeEach(() => {
      jest.setSystemTime(NOW);
    });

    it("reports the real lag in seconds for a recently updated cursor", async () => {
      cursorRepository.getLatestContractCursor.mockResolvedValue(
        cursorUpdatedAgo(30),
      );

      const result = await service.checkIngestionLag();

      expect(result.status).toBe("up");
      expect(result.lagSeconds).toBe(30);
      expect(result.lastSuccess).toBe(cursorUpdatedAgo(30).updated_at);
    });

    it("reports the real lag and a degraded status for a stale cursor", async () => {
      cursorRepository.getLatestContractCursor.mockResolvedValue(
        cursorUpdatedAgo(900),
      );

      const result = await service.checkIngestionLag();

      expect(result.status).toBe("degraded");
      expect(result.lagSeconds).toBe(900);
      expect(result.details).toContain("900s");
      expect(result.details).toContain("300s");
    });

    it("stays up when the lag is exactly at the threshold", async () => {
      // Mirrors IndexerLagService, which flags lag only when it strictly
      // exceeds the threshold.
      cursorRepository.getLatestContractCursor.mockResolvedValue(
        cursorUpdatedAgo(300),
      );

      const result = await service.checkIngestionLag();

      expect(result.status).toBe("up");
      expect(result.lagSeconds).toBe(300);
    });

    it("degrades once the lag exceeds the threshold by one second", async () => {
      cursorRepository.getLatestContractCursor.mockResolvedValue(
        cursorUpdatedAgo(301),
      );

      const result = await service.checkIngestionLag();

      expect(result.status).toBe("degraded");
      expect(result.lagSeconds).toBe(301);
    });

    it("honours a custom threshold", async () => {
      config.ingestionLagThresholdSeconds = 60;
      cursorRepository.getLatestContractCursor.mockResolvedValue(
        cursorUpdatedAgo(120),
      );

      const result = await service.checkIngestionLag();

      expect(result.status).toBe("degraded");
      expect(result.lagSeconds).toBe(120);
      expect(result.details).toContain("60s");
    });

    it("keeps the no-cursor branch unchanged", async () => {
      cursorRepository.getLatestContractCursor.mockResolvedValue(null);

      const result = await service.checkIngestionLag();

      expect(result).toEqual({
        status: "up",
        lagSeconds: 0,
        details: "No ingestion cursor found (service may not be active)",
        lastSuccess: NOW.toISOString(),
      });
    });

    it("reports down when the cursor read throws", async () => {
      cursorRepository.getLatestContractCursor.mockRejectedValue(
        new Error("db unreachable"),
      );

      const result = await service.checkIngestionLag();

      expect(result.status).toBe("down");
      expect(result.lagSeconds).toBeUndefined();
      expect(result.details).toBe("db unreachable");
    });

    it("reports down when the cursor timestamp cannot be parsed", async () => {
      cursorRepository.getLatestContractCursor.mockResolvedValue({
        id: "contract:CTEST",
        paging_token: "99-5",
        ledger_sequence: 42,
        updated_at: "not-a-timestamp",
      });

      const result = await service.checkIngestionLag();

      expect(result.status).toBe("down");
      expect(result.details).toContain("invalid updated_at");
    });

    it("clamps a future cursor timestamp to zero lag instead of going negative", async () => {
      cursorRepository.getLatestContractCursor.mockResolvedValue({
        id: "contract:CTEST",
        paging_token: "99-5",
        ledger_sequence: 42,
        updated_at: new Date(NOW.getTime() + 60_000).toISOString(),
      });

      const result = await service.checkIngestionLag();

      expect(result.status).toBe("up");
      expect(result.lagSeconds).toBe(0);
    });

    it("uses the newest cursor rather than an exact literal stream id", async () => {
      cursorRepository.getLatestContractCursor.mockResolvedValue(
        cursorUpdatedAgo(10),
      );

      await service.checkIngestionLag();

      expect(cursorRepository.getLatestContractCursor).toHaveBeenCalledTimes(
        1,
      );
    });
  });

  describe("ingestion lag is surfaced by the readiness endpoint", () => {
    const NOW = new Date("2026-01-01T00:00:00.000Z");

    beforeEach(() => {
      jest.setSystemTime(NOW);
    });

    it("stays ready but reports degraded when the cursor is stale", async () => {
      cursorRepository.getLatestContractCursor.mockResolvedValue({
        id: "contract:CTEST",
        paging_token: "99-5",
        ledger_sequence: 42,
        updated_at: new Date(NOW.getTime() - 900_000).toISOString(),
      });

      const result = await service.getReadinessStatus();

      expect(result.ready).toBe(true);
      expect(result.degraded).toBe(true);

      const ingestionCheck = result.checks.find((c) => c.name === "ingestion");
      expect(ingestionCheck?.status).toBe("degraded");
      expect(ingestionCheck?.lagSeconds).toBe(900);
    });

    it("does not report degraded when the cursor is fresh", async () => {
      cursorRepository.getLatestContractCursor.mockResolvedValue({
        id: "contract:CTEST",
        paging_token: "99-5",
        ledger_sequence: 42,
        updated_at: new Date(NOW.getTime() - 1_000).toISOString(),
      });

      const result = await service.getReadinessStatus();

      expect(result.ready).toBe(true);
      expect(result.degraded).toBe(false);
    });
  });

  describe("public status (getPublicStatus)", () => {
    const NOW = new Date("2026-01-01T00:00:00.000Z");

    beforeEach(() => {
      jest.setSystemTime(NOW);
    });

    it("reports the last processed ledger from the newest contract cursor", async () => {
      cursorRepository.getLatestContractCursor.mockResolvedValue({
        id: "contract:CTEST",
        paging_token: "12345-3",
        ledger_sequence: 12345,
        updated_at: NOW.toISOString(),
      });

      const result = await service.getPublicStatus();

      expect(result.lastLedger).toBe(12345);
      expect(result.status).toBe("operational");
    });

    it("defaults lastLedger to 0 when no cursor exists", async () => {
      cursorRepository.getLatestContractCursor.mockResolvedValue(null);

      const result = await service.getPublicStatus();

      expect(result.lastLedger).toBe(0);
      expect(result.status).toBe("operational");
    });

    it("reports a degraded ingestion component when the cursor is stale", async () => {
      cursorRepository.getLatestContractCursor.mockResolvedValue({
        id: "contract:CTEST",
        paging_token: "99-5",
        ledger_sequence: 42,
        updated_at: new Date(NOW.getTime() - 900_000).toISOString(),
      });

      const result = await service.getPublicStatus();

      expect(result.status).toBe("degraded");

      const ingestion = result.components.find((c) => c.name === "ingestion");
      expect(ingestion?.status).toBe("degraded");
    });

    it("does not leak ingestion lag details on the public status page", async () => {
      cursorRepository.getLatestContractCursor.mockResolvedValue({
        id: "contract:CTEST",
        paging_token: "99-5",
        ledger_sequence: 42,
        updated_at: new Date(NOW.getTime() - 900_000).toISOString(),
      });

      const result = await service.getPublicStatus();

      const ingestion = result.components.find((c) => c.name === "ingestion");
      expect(ingestion).not.toHaveProperty("detail");
      expect(JSON.stringify(result)).not.toContain("900s");
    });
  });
});
