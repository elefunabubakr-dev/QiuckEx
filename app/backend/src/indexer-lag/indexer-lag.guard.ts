import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request, Response } from "express";
import { AuditService } from "../audit/audit.service";
import { MetricsService } from "../metrics/metrics.service";
import { SorobanErrorCode } from "../common/soroban-errors";
import { IndexerLagService } from "./indexer-lag.service";
import {
  REQUIRE_INDEXER_LAG_CHECK_KEY,
  IndexerLagPolicy,
} from "./requires-indexer-lag-check.decorator";

/**
 * Advertises how far behind the network the indexer was when the response was
 * produced. Emitted only on `STALE_HEADER` routes while lag is above the
 * configured threshold.
 */
export const INDEXER_LAG_LEDGERS_HEADER = "X-QuickEx-Indexer-Lag-Ledgers";

/**
 * The last ledger the indexer had processed when the response was produced.
 */
export const INDEXER_LAST_LEDGER_HEADER = "X-QuickEx-Indexer-Last-Ledger";

/**
 * Seconds a client should wait before retrying a fail-closed route. Matches the
 * indexer lag poll interval, so one retry is enough to see a fresh status.
 */
export const INDEXER_LAG_RETRY_AFTER_SECONDS = 60;

@Injectable()
export class IndexerLagGuard implements CanActivate {
  private readonly logger = new Logger(IndexerLagGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly indexerLagService: IndexerLagService,
    private readonly auditService: AuditService,
    private readonly metricsService: MetricsService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const policy = this.reflector.getAllAndOverride<IndexerLagPolicy>(
      REQUIRE_INDEXER_LAG_CHECK_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );

    // Undecorated routes are never touched: this guard exists to protect
    // indexed-data reads, not to police the whole API surface.
    if (policy === undefined) {
      return true;
    }

    if (!this.indexerLagService.isBlocked()) {
      return true;
    }

    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const status = this.indexerLagService.getStatus();
    // The express route pattern, never req.path: the raw path embeds user
    // input (tx hashes, addresses) and would explode metric label cardinality.
    const route = this.resolveRoute(req);

    this.metricsService.recordIndexerLagGuardBlockedRequest(req.method, route);

    if (policy === IndexerLagPolicy.STALE_HEADER) {
      this.applyStalenessHeaders(res, status.lagLedgers, status.lastIndexedLedger);
      this.logger.warn(
        `IndexerLagGuard served ${req.method} ${route} with a staleness header due to indexer lag (lag=${status.lagLedgers})`,
      );
      return true;
    }

    const userId = (req.headers["x-user-id"] as string | undefined)?.trim();

    try {
      await this.auditService.log(
        userId ?? "anonymous",
        "indexer_lag_guard.blocked",
        "INDEXER_LAG",
        {
          ...status,
          method: req.method,
          path: req.path,
          route,
        },
      );
    } catch (error) {
      this.logger.error("Failed to audit indexer lag guard block", error);
    }

    this.logger.warn(
      `IndexerLagGuard blocked ${req.method} ${route} due to indexer lag (lag=${status.lagLedgers})`,
    );

    if (typeof res?.setHeader === "function") {
      res.setHeader("Retry-After", INDEXER_LAG_RETRY_AFTER_SECONDS.toString());
    }
    this.applyStalenessHeaders(res, status.lagLedgers, status.lastIndexedLedger);

    // `code` (not `error`) is what GlobalHttpExceptionFilter reads back, and
    // `details` is what carries the ledger diagnostics to the caller.
    throw new ServiceUnavailableException({
      code: SorobanErrorCode.INDEXER_LAGGING,
      message:
        "Indexer is currently lagging behind the network. Risky operations are temporarily disabled. Please retry later.",
      details: {
        currentNetworkLedger: status.currentNetworkLedger,
        lastIndexedLedger: status.lastIndexedLedger,
        lagLedgers: status.lagLedgers,
        thresholdLedgers: status.thresholdLedgers,
        retryAfterSeconds: INDEXER_LAG_RETRY_AFTER_SECONDS,
      },
    });
  }

  private applyStalenessHeaders(
    res: Response,
    lagLedgers: number | null,
    lastIndexedLedger: number | null,
  ): void {
    if (typeof res?.setHeader !== "function") {
      return;
    }
    if (lagLedgers !== null) {
      res.setHeader(INDEXER_LAG_LEDGERS_HEADER, lagLedgers.toString());
    }
    if (lastIndexedLedger !== null) {
      res.setHeader(INDEXER_LAST_LEDGER_HEADER, lastIndexedLedger.toString());
    }
  }

  private resolveRoute(req: Request): string {
    const routePath = req.route?.path;
    if (typeof routePath === "string" && routePath.length > 0) {
      return `${req.baseUrl ?? ""}${routePath}`;
    }
    return req.path ?? req.url;
  }
}
