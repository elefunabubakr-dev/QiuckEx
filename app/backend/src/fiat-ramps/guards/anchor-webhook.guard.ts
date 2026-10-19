import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { FiatRampsService } from '../fiat-ramps.service';
import { Sep24TransactionRepository } from '../sep24-transaction.repository';
import { AppConfigService } from '../../config/app-config.service';
import {
  extractAnchorSignature,
  extractAnchorSecret,
  extractAnchorDomain,
  verifyAnchorSignature,
  verifyAnchorSecret,
} from '../anchor-webhook-signature';

export interface AuthenticatedAnchorRequest {
  headers?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
  rawBody?: Buffer;
  anchor?: {
    domain: string;
  };
}

/**
 * Guard that enforces per-anchor HMAC signature or shared secret verification
 * on incoming SEP-24 status updates and KYC callbacks (#1218).
 *
 * Rejects unsigned, forged, or unauthenticated requests with HTTP 401.
 */
@Injectable()
export class AnchorWebhookGuard implements CanActivate {
  private readonly logger = new Logger(AnchorWebhookGuard.name);

  constructor(
    private readonly fiatRampsService: FiatRampsService,
    private readonly sep24Repository: Sep24TransactionRepository,
    private readonly appConfig: AppConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedAnchorRequest>();
    const headers = (request.headers ?? {}) as Record<string, unknown>;
    const query = (request.query ?? {}) as Record<string, unknown>;
    const body = (request.body ?? {}) as Record<string, unknown>;

    const signature = extractAnchorSignature(headers);
    const providedSecret = extractAnchorSecret(headers, query);

    if (!signature && !providedSecret) {
      this.logger.warn('Anchor webhook rejected: missing signature or shared secret');
      throw new UnauthorizedException({
        error: 'UNAUTHORIZED',
        message: 'Missing anchor webhook signature or shared secret',
      });
    }

    // Determine payload bytes for HMAC verification
    const payloadBuffer =
      request.rawBody && request.rawBody.length > 0
        ? request.rawBody
        : Buffer.isBuffer(body)
        ? body
        : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));

    // Resolve anchor domain if specified in headers, query, or body
    let anchorDomain = extractAnchorDomain(headers, query, body);

    // If transaction ID is in payload or query, look up the existing record to verify domain ownership
    const transactionId = (body?.id ?? body?.transaction_id ?? body?.anchor_transaction_id ?? query?.id) as
      | string
      | undefined;

    if (transactionId) {
      const transactionRecord = await this.sep24Repository.findByAnchorTransactionId(transactionId);
      if (transactionRecord) {
        const recordDomain = transactionRecord.anchor_domain.toLowerCase();
        if (anchorDomain && anchorDomain !== recordDomain) {
          this.logger.warn(
            `Anchor webhook rejected: anchor domain mismatch for tx ${transactionId} (claimed: ${anchorDomain}, record: ${recordDomain})`,
          );
          throw new UnauthorizedException({
            error: 'UNAUTHORIZED',
            message: 'Anchor domain does not match transaction record',
          });
        }
        anchorDomain = recordDomain;
      }
    }

    // Case 1: Specific anchor domain is known
    if (anchorDomain) {
      const expectedSecret = this.fiatRampsService.getAnchorSecret(anchorDomain);
      if (!expectedSecret) {
        this.logger.warn(`Anchor webhook rejected: no secret configured for anchor ${anchorDomain}`);
        throw new UnauthorizedException({
          error: 'UNAUTHORIZED',
          message: `No webhook secret configured for anchor ${anchorDomain}`,
        });
      }

      const isValidSignature = signature ? verifyAnchorSignature(payloadBuffer, signature, expectedSecret) : false;
      const isValidSecret = providedSecret ? verifyAnchorSecret(providedSecret, expectedSecret) : false;

      if (!isValidSignature && !isValidSecret) {
        this.logger.warn(`Anchor webhook rejected: invalid signature/secret for anchor ${anchorDomain}`);
        throw new UnauthorizedException({
          error: 'UNAUTHORIZED',
          message: 'Invalid anchor webhook signature or secret',
        });
      }

      request.anchor = { domain: anchorDomain };
      return true;
    }

    // Case 2: Anchor domain not specified; try matching against configured anchors
    const configuredSecrets = this.fiatRampsService.getAllConfiguredAnchorSecrets();

    // Fall back to global default secret if configured
    if (this.appConfig.anchorWebhookSecret && !configuredSecrets.has('*')) {
      configuredSecrets.set('*', this.appConfig.anchorWebhookSecret);
    }

    if (configuredSecrets.size === 0) {
      this.logger.warn('Anchor webhook rejected: no anchor secrets configured');
      throw new UnauthorizedException({
        error: 'UNAUTHORIZED',
        message: 'No anchor webhook secrets configured',
      });
    }

    for (const [domain, secret] of configuredSecrets.entries()) {
      const isValidSignature = signature ? verifyAnchorSignature(payloadBuffer, signature, secret) : false;
      const isValidSecret = providedSecret ? verifyAnchorSecret(providedSecret, secret) : false;

      if (isValidSignature || isValidSecret) {
        request.anchor = { domain };
        return true;
      }
    }

    this.logger.warn('Anchor webhook rejected: credentials do not match any configured anchor');
    throw new UnauthorizedException({
      error: 'UNAUTHORIZED',
      message: 'Invalid anchor webhook signature or secret',
    });
  }
}
