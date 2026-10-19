import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { createHmac } from 'crypto';
import { FiatRampsController } from './fiat-ramps.controller';
import { FiatRampsService } from './fiat-ramps.service';
import { Sep24TransactionRepository } from './sep24-transaction.repository';
import { AnchorClientService } from './anchor-client.service';
import { AppConfigService } from '../config/app-config.service';
import { AnchorWebhookGuard } from './guards/anchor-webhook.guard';
import { Sep24InternalStatus } from './types/sep24.types';

import { IdempotencyStore } from '../common/idempotency/idempotency-store.service';
import { IdempotencyInterceptor } from '../common/idempotency/idempotency.interceptor';

describe('FiatRampsController Webhook Security (#1218)', () => {
  let app: INestApplication;
  let sep24Repository: {
    create: jest.Mock;
    findByAnchorTransactionId: jest.Mock;
    updateStatus: jest.Mock;
  };
  let anchorClient: {
    discoverAnchorCapabilities: jest.Mock;
    performSep10Auth: jest.Mock;
    initiateSep24Transaction: jest.Mock;
  };

  const LEGIT_ANCHOR_DOMAIN = 'test.anchor.org';
  const LEGIT_ANCHOR_SECRET = 'whsec_legit_secret_123';
  const ROGUE_ANCHOR_DOMAIN = 'rogue.anchor.org';
  const ROGUE_ANCHOR_SECRET = 'whsec_rogue_secret_456';

  const mockAppConfig = {
    stellarNetworkPassphrase: 'Test SDF Network ; September 2015',
    stellarSecretKey: 'SCX6A3F3XCFW7IT3MY6DSZWULY4U6O5PZHILY3SAPU4QZIHUEO7JZLLS',
    anchorDirectoryJson: JSON.stringify([
      {
        domain: LEGIT_ANCHOR_DOMAIN,
        name: 'Legit Anchor',
        type: 'bank',
        webhookSecret: LEGIT_ANCHOR_SECRET,
      },
      {
        domain: ROGUE_ANCHOR_DOMAIN,
        name: 'Rogue Anchor',
        type: 'bank',
        webhookSecret: ROGUE_ANCHOR_SECRET,
      },
    ]),
    anchorWebhookSecrets: {},
    anchorWebhookSecret: undefined,
  };

  function computeHmac(payload: unknown, secret: string): string {
    const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return `sha256=${createHmac('sha256', secret).update(Buffer.from(raw)).digest('hex')}`;
  }

  beforeEach(async () => {
    jest.clearAllMocks();

    sep24Repository = {
      create: jest.fn(),
      findByAnchorTransactionId: jest.fn(),
      updateStatus: jest.fn().mockResolvedValue(undefined),
    };

    anchorClient = {
      discoverAnchorCapabilities: jest.fn(),
      performSep10Auth: jest.fn(),
      initiateSep24Transaction: jest.fn(),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [FiatRampsController],
      providers: [
        FiatRampsService,
        AnchorWebhookGuard,
        {
          provide: IdempotencyStore,
          useValue: {
            begin: jest.fn().mockReturnValue(undefined),
            complete: jest.fn(),
          },
        },
        IdempotencyInterceptor,
        { provide: Sep24TransactionRepository, useValue: sep24Repository },
        { provide: AnchorClientService, useValue: anchorClient },
        { provide: AppConfigService, useValue: mockAppConfig },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('POST /fiat-ramps/transaction/status', () => {
    const existingTransaction = {
      id: 'uuid-1234',
      anchor_transaction_id: 'anchor-tx-999',
      anchor_domain: LEGIT_ANCHOR_DOMAIN,
      type: 'deposit',
      status: Sep24InternalStatus.Initiated,
      anchor_status: null,
      stellar_tx_hash: null,
      amount: '100',
      asset_code: 'USDC',
      asset_issuer: null,
      user_account: 'GABC123',
      interactive_url: null,
    };

    const statusPayload = {
      id: 'anchor-tx-999',
      status: 'completed',
      stellar_transaction_id: 'stellar-hash-abc',
    };

    it('rejects an unsigned status update with 401 and DOES NOT mutate the sep24 record', async () => {
      sep24Repository.findByAnchorTransactionId.mockResolvedValue(existingTransaction);

      const res = await request(app.getHttpServer())
        .post('/fiat-ramps/transaction/status')
        .send(statusPayload);

      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/missing anchor webhook signature/i);
      expect(sep24Repository.updateStatus).not.toHaveBeenCalled();
    });

    it('rejects a forged status update with 401 and DOES NOT mutate the sep24 record', async () => {
      sep24Repository.findByAnchorTransactionId.mockResolvedValue(existingTransaction);

      const res = await request(app.getHttpServer())
        .post('/fiat-ramps/transaction/status')
        .set('x-anchor-signature', `sha256=${'0'.repeat(64)}`)
        .send(statusPayload);

      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/invalid anchor webhook signature/i);
      expect(sep24Repository.updateStatus).not.toHaveBeenCalled();
    });

    it('rejects a status update when signed with a secret from a different anchor (per-anchor secret isolation)', async () => {
      sep24Repository.findByAnchorTransactionId.mockResolvedValue(existingTransaction);

      // Signed with ROGUE_ANCHOR_SECRET instead of LEGIT_ANCHOR_SECRET
      const rogueSignature = computeHmac(statusPayload, ROGUE_ANCHOR_SECRET);

      const res = await request(app.getHttpServer())
        .post('/fiat-ramps/transaction/status')
        .set('x-anchor-signature', rogueSignature)
        .send(statusPayload);

      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/invalid anchor webhook signature/i);
      expect(sep24Repository.updateStatus).not.toHaveBeenCalled();
    });

    it('accepts a validly HMAC-signed status update and mutates the sep24 record', async () => {
      sep24Repository.findByAnchorTransactionId.mockResolvedValue(existingTransaction);

      const legitSignature = computeHmac(statusPayload, LEGIT_ANCHOR_SECRET);

      const res = await request(app.getHttpServer())
        .post('/fiat-ramps/transaction/status')
        .set('x-anchor-signature', legitSignature)
        .send(statusPayload);

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ status: 'acknowledged' });
      expect(sep24Repository.updateStatus).toHaveBeenCalledWith(
        'uuid-1234',
        Sep24InternalStatus.Completed,
        'completed',
        'stellar-hash-abc',
      );
    });

    it('accepts a status update with a valid per-anchor shared secret header (X-Anchor-Secret)', async () => {
      sep24Repository.findByAnchorTransactionId.mockResolvedValue(existingTransaction);

      const res = await request(app.getHttpServer())
        .post('/fiat-ramps/transaction/status')
        .set('x-anchor-secret', LEGIT_ANCHOR_SECRET)
        .send(statusPayload);

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ status: 'acknowledged' });
      expect(sep24Repository.updateStatus).toHaveBeenCalledWith(
        'uuid-1234',
        Sep24InternalStatus.Completed,
        'completed',
        'stellar-hash-abc',
      );
    });

    it('accepts a status update with Authorization Bearer token matching the anchor secret', async () => {
      sep24Repository.findByAnchorTransactionId.mockResolvedValue(existingTransaction);

      const res = await request(app.getHttpServer())
        .post('/fiat-ramps/transaction/status')
        .set('Authorization', `Bearer ${LEGIT_ANCHOR_SECRET}`)
        .send(statusPayload);

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ status: 'acknowledged' });
      expect(sep24Repository.updateStatus).toHaveBeenCalledWith(
        'uuid-1234',
        Sep24InternalStatus.Completed,
        'completed',
        'stellar-hash-abc',
      );
    });
  });

  describe('POST /fiat-ramps/kyc/callback', () => {
    const kycPayload = { status: 'approved', customer_id: 'cust-123' };

    it('rejects an unsigned KYC callback with 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/fiat-ramps/kyc/callback')
        .send(kycPayload);

      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/missing anchor webhook signature/i);
    });

    it('rejects a forged KYC callback with 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/fiat-ramps/kyc/callback')
        .set('x-anchor-domain', LEGIT_ANCHOR_DOMAIN)
        .set('x-anchor-signature', `sha256=${'0'.repeat(64)}`)
        .send(kycPayload);

      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/invalid anchor webhook signature/i);
    });

    it('accepts a validly signed KYC callback', async () => {
      const signature = computeHmac(kycPayload, LEGIT_ANCHOR_SECRET);

      const res = await request(app.getHttpServer())
        .post('/fiat-ramps/kyc/callback')
        .set('x-anchor-domain', LEGIT_ANCHOR_DOMAIN)
        .set('x-anchor-signature', signature)
        .send(kycPayload);

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ status: 'acknowledged' });
    });

    it('accepts a KYC callback with valid shared secret', async () => {
      const res = await request(app.getHttpServer())
        .post('/fiat-ramps/kyc/callback')
        .set('x-anchor-domain', LEGIT_ANCHOR_DOMAIN)
        .set('x-anchor-secret', LEGIT_ANCHOR_SECRET)
        .send(kycPayload);

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ status: 'acknowledged' });
    });
  });
});
