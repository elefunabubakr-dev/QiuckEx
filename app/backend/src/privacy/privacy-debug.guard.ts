import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  Optional,
  SetMetadata,
} from "@nestjs/common";
import type { Request, Response } from "express";

import { AppConfigService } from "../config";

/**
 * Metadata key marking routes that handle sensitive debug material and must
 * be excluded from crash-reporting, request-body logging, Sentry, and audit capture (#1215).
 */
export const EXCLUDE_PRIVACY_TELEMETRY_KEY = "excludePrivacyTelemetry";

/**
 * Decorator that excludes a route or controller from crash-reporting,
 * request-body logging, Sentry context capture, and audit log persistence (#1215).
 */
export const ExcludePrivacyTelemetry = () =>
  SetMetadata(EXCLUDE_PRIVACY_TELEMETRY_KEY, true);

export const PRIVACY_DEBUG_PATHS: readonly string[] = [
  "/privacy/derive-shared-secret",
  "/privacy/decrypt-recipient",
];

export const PRIVACY_DEBUG_WARNING =
  "WARNING: Local/dev-only debug endpoint. Never transmit private keys over the network in production; perform X25519 ECDH shared-secret derivation and envelope decryption client-side.";

export const PRIVACY_DEBUG_DISABLED_IN_PRODUCTION_CODE =
  "PRIVACY_DEBUG_DISABLED_IN_PRODUCTION";

export const PRIVACY_DEBUG_FLAG_REQUIRED_CODE =
  "PRIVACY_DEBUG_FLAG_REQUIRED";

/**
 * Returns true when a request URL or route path targets one of the
 * local/dev-only stealth privacy debug endpoints (#1215).
 */
export function isPrivacyDebugPath(urlOrPath?: string): boolean {
  if (!urlOrPath || typeof urlOrPath !== "string") {
    return false;
  }
  const normalized = urlOrPath.split("?")[0].replace(/\/+$/, "").toLowerCase();
  return PRIVACY_DEBUG_PATHS.some(
    (debugPath) =>
      normalized === debugPath || normalized.endsWith(debugPath),
  );
}

/**
 * Non-production + explicit opt-in guard for stealth-address debug endpoints (#1215).
 *
 * Used alongside `ApiKeyGuard` + `@RequireScopes("admin")` so that:
 * 1. Production environments (`NODE_ENV=production` or `ENVIRONMENT_NAME=production`)
 *    always reject requests with 403 `PRIVACY_DEBUG_DISABLED_IN_PRODUCTION`.
 * 2. Non-production environments reject requests with 403 `PRIVACY_DEBUG_FLAG_REQUIRED`
 *    unless `PRIVACY_DEBUG_ENDPOINTS_ENABLED=true` is explicitly configured.
 * 3. Only admin-scoped API keys (`@RequireScopes("admin")`) may invoke the endpoints
 *    when enabled in local/dev testing, and every invocation emits an explicit warning.
 */
@Injectable()
export class PrivacyDebugGuard implements CanActivate {
  private readonly logger = new Logger(PrivacyDebugGuard.name);

  constructor(@Optional() private readonly config?: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    const nodeEnv =
      this.config?.nodeEnv ?? process.env.NODE_ENV ?? "development";
    const environmentName =
      this.config?.environmentName ?? process.env.ENVIRONMENT_NAME;
    const isProduction =
      this.config?.isProduction === true ||
      nodeEnv === "production" ||
      environmentName === "production";

    if (isProduction) {
      this.logger.warn(
        `Blocked stealth privacy debug endpoint ${req.method} ${req.path ?? req.url} in production environment`,
      );
      throw new ForbiddenException({
        code: PRIVACY_DEBUG_DISABLED_IN_PRODUCTION_CODE,
        error: PRIVACY_DEBUG_DISABLED_IN_PRODUCTION_CODE,
        message:
          "Stealth private-key derivation and decryption endpoints are disabled in production to preserve non-custodial security. Perform ECDH derivation and decryption client-side.",
      });
    }

    const debugFlagEnabled =
      this.config !== undefined
        ? this.config.privacyDebugEndpointsEnabled
        : process.env.PRIVACY_DEBUG_ENDPOINTS_ENABLED?.trim().toLowerCase() ===
          "true";

    if (!debugFlagEnabled) {
      this.logger.warn(
        `Blocked stealth privacy debug endpoint ${req.method} ${req.path ?? req.url} (PRIVACY_DEBUG_ENDPOINTS_ENABLED is not enabled)`,
      );
      throw new ForbiddenException({
        code: PRIVACY_DEBUG_FLAG_REQUIRED_CODE,
        error: PRIVACY_DEBUG_FLAG_REQUIRED_CODE,
        message:
          "Stealth private-key debug endpoints are disabled by default. Set PRIVACY_DEBUG_ENDPOINTS_ENABLED=true in a local/dev non-production environment to enable integration testing.",
      });
    }

    this.logger.warn(
      `${PRIVACY_DEBUG_WARNING} (invoked on ${req.method} ${req.path ?? req.url})`,
    );

    if (res && typeof res.setHeader === "function") {
      res.setHeader("X-Privacy-Debug-Warning", PRIVACY_DEBUG_WARNING);
    }

    return true;
  }
}
