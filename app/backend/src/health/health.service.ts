import { Injectable, Logger } from "@nestjs/common";
import { SupabaseService } from "../supabase/supabase.service";
import { HorizonService } from "../stellar/horizon.service";
import { AppConfigService } from "../config/app-config.service";
import { sanitizeErrorMessage } from "../common/utils/redaction.util";
import { JobQueueService } from "../job-queue/job-queue.service";
import { JobRepository } from "../job-queue/job.repository";
import { CursorRepository } from "../ingestion/cursor.repository";
import { SorobanRpcService } from "../transactions/soroban-rpc.service";

export type DependencyStatus = "up" | "degraded" | "down";

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly startTime = Date.now();
  private readonly version = "0.1.0"; // Should ideally be injected or read from package.json

  constructor(
    private readonly supabase: SupabaseService,
    private readonly horizon: HorizonService,
    private readonly config: AppConfigService,
    private readonly jobQueueService: JobQueueService,
    private readonly jobRepository: JobRepository,
    private readonly cursorRepository: CursorRepository,
    private readonly sorobanRpcService: SorobanRpcService,
  ) {}

  private isTimeoutError(err: unknown): boolean {
    return err instanceof Error && err.message === "Timeout";
  }

  /**
   * Performs a simple ping to Supabase to verify connectivity.
   */
  async checkSupabase(): Promise<{
    status: DependencyStatus;
    latency?: number;
    details?: string;
    lastSuccess?: string;
  }> {
    const start = Date.now();
    try {
      // We wrap it in a Promise.race to handle timeouts.
      const timeout = new Promise<boolean>((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), 3000),
      );

      const isHealthy = await Promise.race([
        this.supabase.checkHealth(),
        timeout,
      ]);
      const latency = Date.now() - start;

      if (!isHealthy) {
        return {
          status: "down",
          details: "Supabase health check returned unhealthy",
        };
      }

      return {
        status: "up",
        latency,
        lastSuccess: new Date().toISOString(),
      };
    } catch (err) {
      const safeMessage = sanitizeErrorMessage((err as Error).message);
      this.logger.warn(
        `Supabase health check failed or timed out: ${safeMessage}`,
      );
      return {
        status: this.isTimeoutError(err) ? "degraded" : "down",
        details: safeMessage,
      };
    }
  }

  /**
   * Validates that critical environment variables are loaded.
   * Reports readiness without exposing sensitive values.
   */
  checkEnvironment(): { status: "up" | "down"; details: string[] } {
    const details: string[] = [];
    let hasCriticalIssue = false;

    // Check database configuration
    if (!this.config.supabaseUrl || !this.config.supabaseAnonKey) {
      details.push("Missing database configuration");
      hasCriticalIssue = true;
    } else {
      details.push("Database configuration loaded");
    }

    // Check network configuration
    if (!this.config.network) {
      details.push("Missing Stellar network configuration");
      hasCriticalIssue = true;
    } else {
      details.push(`Network: ${this.config.network}`);
    }

    // Check Horizon connectivity configuration
    try {
      // HorizonService will use default URLs if custom URL not provided
      details.push("Horizon configuration ready");
    } catch (err) {
      const safeMessage = sanitizeErrorMessage((err as Error).message);
      details.push(`Horizon config error: ${safeMessage}`);
      hasCriticalIssue = true;
    }

    // Check payment signing capability (optional but important)
    if (this.config.isPaymentSigningConfigured) {
      details.push("Payment signing configured");
    } else {
      details.push("Payment signing not configured (read-only mode)");
    }

    if (hasCriticalIssue) {
      return {
        status: "down",
        details,
      };
    }

    return { status: "up", details };
  }

  /**
   * Checks job queue health by verifying database connectivity and job processing.
   */
  async checkQueue(): Promise<{
    status: DependencyStatus;
    latency?: number;
    details?: string;
    lastSuccess?: string;
  }> {
    const start = Date.now();
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), 5000),
      );

      // Check if we can query the jobs table
      const check = Promise.race([
        this.jobRepository.listJobs({ limit: 1 }),
        timeout,
      ]);

      await check;
      const latency = Date.now() - start;

      return {
        status: "up",
        latency,
        lastSuccess: new Date().toISOString(),
      };
    } catch (err) {
      const safeMessage = sanitizeErrorMessage((err as Error).message);
      this.logger.warn(`Queue health check failed: ${safeMessage}`);
      return {
        status: this.isTimeoutError(err) ? "degraded" : "down",
        details: safeMessage,
      };
    }
  }

  /**
   * Checks Horizon reachability with timeout.
   */
  async checkHorizon(): Promise<{
    status: DependencyStatus;
    latency?: number;
    details?: string;
    lastSuccess?: string;
  }> {
    const start = Date.now();
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), 5000),
      );

      // Try to fetch a known account or root endpoint
      const horizonUrl = this.horizon.getBaseUrl();
      const check = Promise.race([
        fetch(`${horizonUrl}/`, { method: "HEAD" }),
        timeout,
      ]);

      const response = await check;
      const latency = Date.now() - start;

      if (!response.ok) {
        throw new Error(`Horizon returned ${response.status}`);
      }

      return {
        status: "up",
        latency,
        lastSuccess: new Date().toISOString(),
      };
    } catch (err) {
      const safeMessage = sanitizeErrorMessage((err as Error).message);
      this.logger.warn(`Horizon health check failed: ${safeMessage}`);
      return {
        status: this.isTimeoutError(err) ? "degraded" : "down",
        details: safeMessage,
      };
    }
  }

  /**
   * Checks Soroban RPC reachability with timeout.
   */
  async checkSorobanRpc(): Promise<{
    status: DependencyStatus;
    latency?: number;
    details?: string;
    lastSuccess?: string;
  }> {
    const start = Date.now();
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), 5000),
      );

      const check = Promise.race([
        this.sorobanRpcService.getNetworkPassphrase(),
        timeout,
      ]);

      await check;
      const latency = Date.now() - start;

      return {
        status: "up",
        latency,
        lastSuccess: new Date().toISOString(),
      };
    } catch (err) {
      const safeMessage = sanitizeErrorMessage((err as Error).message);
      this.logger.warn(`Soroban RPC health check failed: ${safeMessage}`);
      return {
        status: this.isTimeoutError(err) ? "degraded" : "down",
        details: safeMessage,
      };
    }
  }

  /**
   * Checks ingestion lag by comparing the newest cursor's update time to now.
   *
   * The lag is derived from the cursor's actual `updated_at` timestamp and is
   * compared against a configured threshold, mirroring the strict `>` semantics
   * used by IndexerLagService (`lag > threshold` means lagging). A stale cursor
   * is reported as `degraded`; an unreadable cursor is reported as `down`.
   */
  async checkIngestionLag(): Promise<{
    status: DependencyStatus;
    lagSeconds?: number;
    details?: string;
    lastSuccess?: string;
  }> {
    const thresholdSeconds = this.config.ingestionLagThresholdSeconds;

    try {
      // Cursors are stored per contract as `contract:<contractId>`, so the
      // most recently updated one is used as the pipeline's progress marker.
      const cursor = await this.cursorRepository.getLatestContractCursor();

      if (!cursor) {
        return {
          status: "up",
          lagSeconds: 0,
          details: "No ingestion cursor found (service may not be active)",
          lastSuccess: new Date().toISOString(),
        };
      }

      const lastUpdatedMs = Date.parse(cursor.updated_at);
      if (Number.isNaN(lastUpdatedMs)) {
        return {
          status: "down",
          details: "Ingestion cursor has an invalid updated_at timestamp",
        };
      }

      // Clamp to 0 so clock skew on the database host cannot report negative lag.
      const lagSeconds = Math.max(
        0,
        Math.floor((Date.now() - lastUpdatedMs) / 1000),
      );
      const lastSuccess = new Date(lastUpdatedMs).toISOString();

      if (lagSeconds > thresholdSeconds) {
        return {
          status: "degraded",
          lagSeconds,
          details: `Ingestion cursor is ${lagSeconds}s behind (threshold ${thresholdSeconds}s)`,
          lastSuccess,
        };
      }

      return {
        status: "up",
        lagSeconds,
        details: `Ingestion cursor is ${lagSeconds}s behind (threshold ${thresholdSeconds}s)`,
        lastSuccess,
      };
    } catch (err) {
      const safeMessage = sanitizeErrorMessage((err as Error).message);
      this.logger.warn(`Ingestion lag check failed: ${safeMessage}`);
      return {
        status: "down",
        details: safeMessage,
      };
    }
  }

  /**
   * Checks if database migrations are applied by querying the schema_migrations table.
   * This is a Supabase/PostgreSQL specific check.
   */
  async checkMigrations(): Promise<{
    status: "up" | "down";
    details?: string;
    lastSuccess?: string;
  }> {
    try {
      const client = this.supabase.getClient();

      // Try to query the schema_migrations table (Supabase migration tracking)
      const { error } = await client
        .from("schema_migrations")
        .select("version")
        .order("version", { ascending: false })
        .limit(1);

      if (error) {
        // If the table doesn't exist, it might be a different migration system
        // Try checking if critical tables exist as a fallback
        const { error: tablesError } = await client
          .from("usernames")
          .select("id")
          .limit(1);

        if (tablesError) {
          throw new Error("Critical database tables not found");
        }

        return {
          status: "up",
          details: "Migration table not found, but critical tables exist",
          lastSuccess: new Date().toISOString(),
        };
      }

      return {
        status: "up",
        details: "Migrations table accessible",
        lastSuccess: new Date().toISOString(),
      };
    } catch (err) {
      const safeMessage = sanitizeErrorMessage((err as Error).message);
      this.logger.warn(`Migration check failed: ${safeMessage}`);
      return {
        status: "down",
        details: safeMessage,
      };
    }
  }

  /**
   * Returns shallow health status for /health.
   */
  async getHealthStatus() {
    return {
      status: "ok",
      version: this.version,
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
    };
  }

  /**
   * Performs deep dependency checks for /ready.
   */
  async getReadinessStatus() {
    const [supabase, env, migrations, queue, horizon, sorobanRpc, ingestion] =
      await Promise.all([
        this.checkSupabase(),
        Promise.resolve(this.checkEnvironment()),
        this.checkMigrations(),
        this.checkQueue(),
        this.checkHorizon(),
        this.checkSorobanRpc(),
        this.checkIngestionLag(),
      ]);

    // Critical dependencies: database, migrations, queue, horizon, soroban RPC.
    // A hard failure (down) means the app cannot serve traffic safely.
    // A degraded dependency (e.g. timed out) is reported separately so that
    // transient slowness is distinguishable from a real outage.
    // Ingestion is deliberately excluded from the hard-failure gate: a stale or
    // unreadable cursor still leaves reads servable, so it only contributes to
    // the degraded signal.
    const criticalChecks = [supabase, migrations, queue, horizon, sorobanRpc];
    const hasHardFailure = criticalChecks.some(
      (check) => check.status === "down",
    );
    const degraded =
      criticalChecks.some((check) => check.status === "degraded") ||
      ingestion.status !== "up";
    const ready = !hasHardFailure;

    return {
      ready,
      degraded,
      timestamp: new Date().toISOString(),
      checks: [
        {
          name: "supabase",
          status: supabase.status,
          latency: supabase.latency ? `${supabase.latency}ms` : undefined,
          lastSuccess:
            supabase.status === "up" ? new Date().toISOString() : undefined,
          error: supabase.status === "down" ? supabase.details : undefined,
        },
        {
          name: "environment",
          status: env.status,
          details: env.details,
        },
        {
          name: "migrations",
          status: migrations.status,
          details: migrations.details,
          lastSuccess: migrations.lastSuccess,
          error: migrations.status === "down" ? migrations.details : undefined,
        },
        {
          name: "queue",
          status: queue.status,
          latency: queue.latency ? `${queue.latency}ms` : undefined,
          lastSuccess: queue.lastSuccess,
          error: queue.status === "down" ? queue.details : undefined,
        },
        {
          name: "horizon",
          status: horizon.status,
          latency: horizon.latency ? `${horizon.latency}ms` : undefined,
          lastSuccess: horizon.lastSuccess,
          error: horizon.status === "down" ? horizon.details : undefined,
        },
        {
          name: "soroban_rpc",
          status: sorobanRpc.status,
          latency: sorobanRpc.latency ? `${sorobanRpc.latency}ms` : undefined,
          lastSuccess: sorobanRpc.lastSuccess,
          error: sorobanRpc.status === "down" ? sorobanRpc.details : undefined,
        },
        {
          name: "ingestion",
          status: ingestion.status,
          lagSeconds: ingestion.lagSeconds,
          details: ingestion.details,
          lastSuccess: ingestion.lastSuccess,
          error: ingestion.status === "down" ? ingestion.details : undefined,
        },
      ],
    };
  }

  /**
   * Returns public-safe status for the status page.
   * No sensitive operational details are exposed.
   * Suitable for caching and public consumption.
   */
  async getPublicStatus() {
    const [horizon, sorobanRpc, ingestion] = await Promise.all([
      this.checkHorizon(),
      this.checkSorobanRpc(),
      this.checkIngestionLag(),
    ]);

    // Determine overall status based on critical external dependencies.
    // Ingestion can only lower the overall status to "degraded": a stale
    // pipeline still serves reads, so it is not a platform-wide outage.
    const someDown = horizon.status === "down" || sorobanRpc.status === "down";
    const allUp =
      horizon.status === "up" &&
      sorobanRpc.status === "up" &&
      ingestion.status === "up";

    const overallStatus = allUp
      ? "operational"
      : someDown
        ? "down"
        : "degraded";

    // Get network info (safe to expose)
    const network = this.config.network || "unknown";

    // Report the last processed ledger from the newest contract cursor.
    // Cursors are stored per contract (`contract:<contractId>`), so the
    // literal "contract:*" id used previously never resolved a row.
    let lastLedger = 0;
    try {
      const cursor = await this.cursorRepository.getLatestContractCursor();
      lastLedger = cursor?.ledger_sequence ?? 0;
    } catch {
      // Silently fail - not critical for public status
      lastLedger = 0;
    }

    return {
      status: overallStatus,
      network,
      lastLedger,
      timestamp: new Date().toISOString(),
      version: this.version,
      components: [
        {
          name: "horizon",
          status: horizon.status === "up" ? "operational" : "down",
          detail: horizon.status === "up" ? `Network: ${network}` : undefined,
        },
        {
          name: "soroban_rpc",
          status: sorobanRpc.status === "up" ? "operational" : "down",
        },
        {
          name: "ingestion",
          status:
            ingestion.status === "up"
              ? "operational"
              : ingestion.status === "degraded"
                ? "degraded"
                : "down",
        },
      ],
    };
  }
}
