import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { AnchorWebhookGuard } from './anchor-webhook.guard';
import { FiatRampsService } from '../fiat-ramps.service';
import { Sep24TransactionRepository } from '../sep24-transaction.repository';
import { AppConfigService } from '../../config/app-config.service';

describe('AnchorWebhookGuard', () => {
  let guard: AnchorWebhookGuard;
  let mockFiatRampsService: {
    getAnchorSecret: jest.Mock;
    getAllConfiguredAnchorSecrets: jest.Mock;
  };
  let mockSep24Repository: {
    findByAnchorTransactionId: jest.Mock;
  };
  let mockAppConfig: {
    anchorWebhookSecret: string | undefined;
  };

  const TEST_DOMAIN = 'test.anchor.org';
  const TEST_SECRET = 'whsec_test_secret_12345';
  const OTHER_DOMAIN = 'rogue.anchor.org';
  const OTHER_SECRET = 'whsec_rogue_secret_67890';

  beforeEach(() => {
    mockFiatRampsService = {
      getAnchorSecret: jest.fn((domain: string) => {
        if (domain.toLowerCase() === TEST_DOMAIN) return TEST_SECRET;
        if (domain.toLowerCase() === OTHER_DOMAIN) return OTHER_SECRET;
        return undefined;
      }),
      getAllConfiguredAnchorSecrets: jest.fn(() => {
        const map = new Map<string, string>();
        map.set(TEST_DOMAIN, TEST_SECRET);
        map.set(OTHER_DOMAIN, OTHER_SECRET);
        return map;
      }),
    };

    mockSep24Repository = {
      findByAnchorTransactionId: jest.fn(),
    };

    mockAppConfig = {
      anchorWebhookSecret: undefined,
    };

    guard = new AnchorWebhookGuard(
      mockFiatRampsService as unknown as FiatRampsService,
      mockSep24Repository as unknown as Sep24TransactionRepository,
      mockAppConfig as unknown as AppConfigService,
    );
  });

  function createMockContext(req: Record<string, unknown>): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => ({}),
      }),
    } as unknown as ExecutionContext;
  }

  function signPayload(payload: unknown, secret: string): string {
    const bodyStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const hmac = createHmac('sha256', secret).update(Buffer.from(bodyStr)).digest('hex');
    return `sha256=${hmac}`;
  }

  describe('Unauthenticated requests', () => {
    it('throws UnauthorizedException (401) when neither signature nor secret is provided', async () => {
      const req = {
        headers: {},
        query: {},
        body: { id: 'anchor-tx-1', status: 'completed' },
      };

      await expect(guard.canActivate(createMockContext(req))).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException (401) when signature is forged', async () => {
      const body = { id: 'anchor-tx-1', status: 'completed' };
      mockSep24Repository.findByAnchorTransactionId.mockResolvedValue({
        id: 'uuid-1',
        anchor_transaction_id: 'anchor-tx-1',
        anchor_domain: TEST_DOMAIN,
      });

      const req = {
        headers: {
          'x-anchor-signature': `sha256=${'0'.repeat(64)}`,
        },
        query: {},
        body,
        rawBody: Buffer.from(JSON.stringify(body)),
      };

      await expect(guard.canActivate(createMockContext(req))).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException (401) when shared secret is wrong', async () => {
      const body = { id: 'anchor-tx-1', status: 'completed' };
      mockSep24Repository.findByAnchorTransactionId.mockResolvedValue({
        id: 'uuid-1',
        anchor_transaction_id: 'anchor-tx-1',
        anchor_domain: TEST_DOMAIN,
      });

      const req = {
        headers: {
          'x-anchor-secret': 'wrong-secret',
        },
        query: {},
        body,
      };

      await expect(guard.canActivate(createMockContext(req))).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('Per-anchor isolation', () => {
    it('rejects update when transaction belongs to Anchor A but request is signed with Anchor B secret', async () => {
      const body = { id: 'anchor-tx-1', status: 'completed' };
      // Transaction belongs to TEST_DOMAIN
      mockSep24Repository.findByAnchorTransactionId.mockResolvedValue({
        id: 'uuid-1',
        anchor_transaction_id: 'anchor-tx-1',
        anchor_domain: TEST_DOMAIN,
      });

      // Attacker signs with OTHER_SECRET
      const signature = signPayload(body, OTHER_SECRET);

      const req = {
        headers: {
          'x-anchor-signature': signature,
        },
        query: {},
        body,
        rawBody: Buffer.from(JSON.stringify(body)),
      };

      await expect(guard.canActivate(createMockContext(req))).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects update when caller claims a domain different from the transaction record', async () => {
      const body = { id: 'anchor-tx-1', status: 'completed' };
      mockSep24Repository.findByAnchorTransactionId.mockResolvedValue({
        id: 'uuid-1',
        anchor_transaction_id: 'anchor-tx-1',
        anchor_domain: TEST_DOMAIN,
      });

      const req = {
        headers: {
          'x-anchor-domain': OTHER_DOMAIN,
          'x-anchor-secret': OTHER_SECRET,
        },
        query: {},
        body,
      };

      await expect(guard.canActivate(createMockContext(req))).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects update when anchor has no secret configured', async () => {
      const body = { id: 'anchor-tx-1', status: 'completed' };
      mockSep24Repository.findByAnchorTransactionId.mockResolvedValue({
        id: 'uuid-1',
        anchor_transaction_id: 'anchor-tx-1',
        anchor_domain: 'unconfigured.anchor.org',
      });
      mockFiatRampsService.getAnchorSecret.mockReturnValue(undefined);

      const req = {
        headers: {
          'x-anchor-secret': 'any-secret',
        },
        query: {},
        body,
      };

      await expect(guard.canActivate(createMockContext(req))).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('Authenticated requests', () => {
    it('accepts valid HMAC signature for existing transaction', async () => {
      const body = { id: 'anchor-tx-1', status: 'completed', stellar_transaction_id: 'txhash123' };
      mockSep24Repository.findByAnchorTransactionId.mockResolvedValue({
        id: 'uuid-1',
        anchor_transaction_id: 'anchor-tx-1',
        anchor_domain: TEST_DOMAIN,
      });

      const signature = signPayload(body, TEST_SECRET);
      const req: Record<string, unknown> = {
        headers: {
          'x-anchor-signature': signature,
        },
        query: {},
        body,
        rawBody: Buffer.from(JSON.stringify(body)),
      };

      const result = await guard.canActivate(createMockContext(req));
      expect(result).toBe(true);
      expect(req.anchor).toEqual({ domain: TEST_DOMAIN });
    });

    it('accepts valid shared secret in x-anchor-secret header', async () => {
      const body = { id: 'anchor-tx-1', status: 'completed' };
      mockSep24Repository.findByAnchorTransactionId.mockResolvedValue({
        id: 'uuid-1',
        anchor_transaction_id: 'anchor-tx-1',
        anchor_domain: TEST_DOMAIN,
      });

      const req: Record<string, unknown> = {
        headers: {
          'x-anchor-secret': TEST_SECRET,
        },
        query: {},
        body,
      };

      const result = await guard.canActivate(createMockContext(req));
      expect(result).toBe(true);
      expect(req.anchor).toEqual({ domain: TEST_DOMAIN });
    });

    it('accepts valid shared secret in Authorization Bearer header', async () => {
      const body = { id: 'anchor-tx-1', status: 'completed' };
      mockSep24Repository.findByAnchorTransactionId.mockResolvedValue({
        id: 'uuid-1',
        anchor_transaction_id: 'anchor-tx-1',
        anchor_domain: TEST_DOMAIN,
      });

      const req: Record<string, unknown> = {
        headers: {
          authorization: `Bearer ${TEST_SECRET}`,
        },
        query: {},
        body,
      };

      const result = await guard.canActivate(createMockContext(req));
      expect(result).toBe(true);
      expect(req.anchor).toEqual({ domain: TEST_DOMAIN });
    });

    it('accepts valid KYC callback matching configured anchor secret', async () => {
      const body = { status: 'approved' };
      const signature = signPayload(body, TEST_SECRET);

      const req: Record<string, unknown> = {
        headers: {
          'x-anchor-domain': TEST_DOMAIN,
          'x-anchor-signature': signature,
        },
        query: {},
        body,
        rawBody: Buffer.from(JSON.stringify(body)),
      };

      const result = await guard.canActivate(createMockContext(req));
      expect(result).toBe(true);
      expect(req.anchor).toEqual({ domain: TEST_DOMAIN });
    });
  });
});
