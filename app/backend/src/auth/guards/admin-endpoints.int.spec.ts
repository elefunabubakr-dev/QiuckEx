import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';

import { ApiKeysService } from '../../api-keys/api-keys.service';
import { AuditService } from '../../audit/audit.service';
import { AppConfigService } from '../../config';
import { FeatureFlagsService } from '../../feature-flags/feature-flags.service';
import { NetworkSafetyGuard } from '../../feature-flags/network-safety.guard';
import { SorobanEventIndexerService } from '../../ingestion/soroban-event-indexer.service';
import { SorobanIndexerController } from '../../ingestion/soroban-indexer.controller';
import { AutoMatchService } from '../../reconciliation/auto-match.service';
import { BackfillService } from '../../reconciliation/backfill.service';
import { ReconciliationRunRepository } from '../../reconciliation/reconciliation-run.repository';
import { ReconciliationWorkerService } from '../../reconciliation/reconciliation-worker.service';
import { ReconciliationController } from '../../reconciliation/reconciliation.controller';
import { UnmatchedQueueRepository } from '../../reconciliation/unmatched-queue.repository';
import { ApiKeyGuard } from './api-key.guard';

/**
 * Integration coverage for issue #1045.
 *
 * Boots the real controllers behind the real `ApiKeyGuard` (only the
 * collaborating services are mocked) and asserts over real HTTP that the
 * reconciliation and indexer admin surfaces reject anonymous and
 * under-privileged callers, and admit only `admin`-scoped keys.
 */
describe('Admin endpoint API key enforcement (#1045)', () => {
  let app: INestApplication;

  const mockWorker = {
    running: false,
    getLastReport: jest.fn().mockReturnValue(null),
    triggerManually: jest.fn().mockResolvedValue({ runId: 'run-1' }),
  };

  const mockBackfill = {
    startBackfill: jest.fn().mockResolvedValue({ status: 'completed' }),
    getBackfillProgress: jest.fn().mockReturnValue(null),
  };

  const mockAutoMatch = {
    running: false,
    runAutoMatchCycle: jest.fn().mockResolvedValue({ processed: 0 }),
    processTransaction: jest.fn().mockResolvedValue({ matched: false }),
  };

  const mockUnmatchedQueue = {
    listPending: jest.fn().mockResolvedValue([]),
    findById: jest.fn().mockResolvedValue(null),
    resolve: jest.fn().mockResolvedValue({ id: 'u1' }),
    dismiss: jest.fn().mockResolvedValue({ id: 'u1' }),
  };

  const mockRunHistory = {
    listRuns: jest.fn().mockResolvedValue([]),
    findById: jest.fn().mockResolvedValue(null),
  };

  const mockIndexer = {
    indexLedgerRange: jest.fn().mockResolvedValue({ events: 0 }),
    listUnparsedEvents: jest.fn().mockResolvedValue([]),
    replayUnparsedEvents: jest.fn().mockResolvedValue({ replayed: 0 }),
    replaySingleEvent: jest.fn().mockResolvedValue({ replayed: 0 }),
    replaySpecificBatch: jest.fn().mockResolvedValue({ replayed: 0 }),
  };

  const mockApiKeysService = {
    validateKey: jest.fn(),
    isOverQuota: jest.fn().mockReturnValue(false),
  };

  const mockFeatureFlags = {
    evaluateFlag: jest.fn().mockResolvedValue({ enabled: true }),
    evaluateFlagFresh: jest.fn().mockResolvedValue({ enabled: true }),
  };

  const mockAudit = {
    log: jest.fn().mockResolvedValue(undefined),
  };

  /** Make `validateKey` resolve a valid record carrying exactly `scopes`. */
  function validKeyWith(scopes: string[]): void {
    mockApiKeysService.validateKey.mockResolvedValue({
      record: {
        id: 'api-key-id',
        name: 'test key',
        scopes,
        request_count: 0,
        monthly_quota: 1000,
        organization_id: null,
      },
      hasScope: (scope: string) => scopes.includes(scope),
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ReconciliationController, SorobanIndexerController],
      providers: [
        { provide: ApiKeysService, useValue: mockApiKeysService },
        { provide: ReconciliationWorkerService, useValue: mockWorker },
        { provide: BackfillService, useValue: mockBackfill },
        { provide: AutoMatchService, useValue: mockAutoMatch },
        { provide: UnmatchedQueueRepository, useValue: mockUnmatchedQueue },
        { provide: ReconciliationRunRepository, useValue: mockRunHistory },
        { provide: SorobanEventIndexerService, useValue: mockIndexer },
        { provide: FeatureFlagsService, useValue: mockFeatureFlags },
        { provide: AuditService, useValue: mockAudit },
        { provide: AppConfigService, useValue: { isTestnet: true } },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockApiKeysService.isOverQuota.mockReturnValue(false);
    mockApiKeysService.validateKey.mockReset();
    // Default: an admin key, so each test opts into the failure it targets.
    validKeyWith(['admin']);
  });

  describe('route protection is declared', () => {
    it('guards ReconciliationController at the class level', () => {
      const guards = Reflect.getMetadata('__guards__', ReconciliationController);

      expect(guards).toBeDefined();
      expect(guards).toContain(ApiKeyGuard);
    });

    it('guards SorobanIndexerController at the class level', () => {
      const guards = Reflect.getMetadata('__guards__', SorobanIndexerController);

      expect(guards).toBeDefined();
      expect(guards).toContain(ApiKeyGuard);
    });

    it('keeps the backfill safety guard in addition to the API key guard', () => {
      const guards = Reflect.getMetadata('__guards__', ReconciliationController.prototype.startBackfill);

      expect(guards).toBeDefined();
      expect(guards).toContain(NetworkSafetyGuard);
    });

    it('requires the admin scope on both controllers', () => {
      expect(Reflect.getMetadata('requiredScopes', ReconciliationController)).toEqual(['admin']);
      expect(Reflect.getMetadata('requiredScopes', SorobanIndexerController)).toEqual(['admin']);
    });
  });

  describe('ReconciliationController', () => {
    it('rejects a manual run trigger with no API key', async () => {
      const res = await request(app.getHttpServer()).post('/reconciliation/trigger').send();

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('MISSING_API_KEY');
      expect(mockWorker.triggerManually).not.toHaveBeenCalled();
    });

    it('rejects a manual run trigger with an invalid API key', async () => {
      mockApiKeysService.validateKey.mockResolvedValue(null);

      const res = await request(app.getHttpServer())
        .post('/reconciliation/trigger')
        .set('x-api-key', 'not-a-real-key')
        .send();

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('INVALID_API_KEY');
      expect(mockWorker.triggerManually).not.toHaveBeenCalled();
    });

    it('rejects a manual run trigger for a key without the admin scope', async () => {
      validKeyWith(['transactions:read']);

      const res = await request(app.getHttpServer())
        .post('/reconciliation/trigger')
        .set('x-api-key', 'member-key')
        .send();

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('INSUFFICIENT_SCOPE');
      expect(mockWorker.triggerManually).not.toHaveBeenCalled();
    });

    it('allows a manual run trigger for an admin-scoped key', async () => {
      const res = await request(app.getHttpServer())
        .post('/reconciliation/trigger')
        .set('x-api-key', 'admin-key')
        .send();

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ runId: 'run-1' });
      expect(mockWorker.triggerManually).toHaveBeenCalledTimes(1);
    });

    it('rejects a backfill trigger with no API key', async () => {
      const res = await request(app.getHttpServer())
        .post('/reconciliation/backfill')
        .send({ fromLedger: 1, toLedger: 10 });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('MISSING_API_KEY');
      expect(mockBackfill.startBackfill).not.toHaveBeenCalled();
    });

    it('rejects a backfill trigger for a key without the admin scope', async () => {
      validKeyWith(['support:read']);

      const res = await request(app.getHttpServer())
        .post('/reconciliation/backfill')
        .set('x-api-key', 'member-key')
        .send({ fromLedger: 1, toLedger: 10 });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('INSUFFICIENT_SCOPE');
      expect(mockBackfill.startBackfill).not.toHaveBeenCalled();
    });

    it('still reaches the backfill handler for an admin-scoped key', async () => {
      const res = await request(app.getHttpServer())
        .post('/reconciliation/backfill')
        .set('x-api-key', 'admin-key')
        .send({ fromLedger: 1, toLedger: 10 });

      expect(res.status).toBe(200);
      expect(mockBackfill.startBackfill).toHaveBeenCalledTimes(1);
    });

    it('protects read routes as well as mutations', async () => {
      const routes = [
        '/reconciliation/status',
        '/reconciliation/history',
        '/reconciliation/backfill/status',
        '/reconciliation/auto-match/status',
        '/reconciliation/unmatched',
      ];

      for (const route of routes) {
        const res = await request(app.getHttpServer()).get(route);

        expect([401, 403]).toContain(res.status);
        expect(res.body.error).toBe('MISSING_API_KEY');
      }

      expect(mockRunHistory.listRuns).not.toHaveBeenCalled();
    });

    it('protects manual review mutations', async () => {
      const resolve = await request(app.getHttpServer())
        .post('/reconciliation/unmatched/u1/resolve')
        .send({});

      expect(resolve.status).toBe(401);
      expect(resolve.body.error).toBe('MISSING_API_KEY');

      const dismiss = await request(app.getHttpServer()).delete('/reconciliation/unmatched/u1');

      expect(dismiss.status).toBe(401);
      expect(dismiss.body.error).toBe('MISSING_API_KEY');

      expect(mockUnmatchedQueue.resolve).not.toHaveBeenCalled();
      expect(mockUnmatchedQueue.dismiss).not.toHaveBeenCalled();
    });
  });

  describe('SorobanIndexerController', () => {
    it('rejects a reindex trigger with no API key', async () => {
      const res = await request(app.getHttpServer())
        .post('/indexer/reindex')
        .send({ contractId: 'c1', fromLedger: 1, toLedger: 10 });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('MISSING_API_KEY');
      expect(mockIndexer.indexLedgerRange).not.toHaveBeenCalled();
    });

    it('rejects a reindex trigger with an invalid API key', async () => {
      mockApiKeysService.validateKey.mockResolvedValue(null);

      const res = await request(app.getHttpServer())
        .post('/indexer/reindex')
        .set('x-api-key', 'not-a-real-key')
        .send({ contractId: 'c1', fromLedger: 1, toLedger: 10 });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('INVALID_API_KEY');
      expect(mockIndexer.indexLedgerRange).not.toHaveBeenCalled();
    });

    it('rejects a reindex trigger for a key without the admin scope', async () => {
      validKeyWith(['transactions:read']);

      const res = await request(app.getHttpServer())
        .post('/indexer/reindex')
        .set('x-api-key', 'member-key')
        .send({ contractId: 'c1', fromLedger: 1, toLedger: 10 });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('INSUFFICIENT_SCOPE');
      expect(mockIndexer.indexLedgerRange).not.toHaveBeenCalled();
    });

    it('allows a reindex trigger for an admin-scoped key', async () => {
      const res = await request(app.getHttpServer())
        .post('/indexer/reindex')
        .set('x-api-key', 'admin-key')
        .send({ contractId: 'c1', fromLedger: 1, toLedger: 10 });

      expect(res.status).toBe(200);
      expect(mockIndexer.indexLedgerRange).toHaveBeenCalledTimes(1);
    });
  });
});
