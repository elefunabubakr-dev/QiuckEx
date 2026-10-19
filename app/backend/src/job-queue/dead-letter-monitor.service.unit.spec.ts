/**
 * Dead Letter Queue Monitor - Unit Tests
 *
 * Verifies that per-type queue depth / DLQ depth / oldest-job-age metrics
 * are published, and that alerts fire (and clear) when configurable
 * thresholds are crossed.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { DeadLetterQueueMonitorService } from './dead-letter-monitor.service';
import { JobRepository } from './job.repository';
import { JobQueueMetricsService } from './job-queue-metrics.service';
import { SentryService } from '../sentry/sentry.service';
import { AppConfigService } from '../config';
import { JobStatus, JobType } from './types';

describe('DeadLetterQueueMonitorService', () => {
  let service: DeadLetterQueueMonitorService;
  let repository: jest.Mocked<JobRepository>;
  let metrics: jest.Mocked<JobQueueMetricsService>;
  let sentry: jest.Mocked<SentryService>;

  const jobTypeCount = Object.values(JobType).length;

  beforeEach(async () => {
    const mockRepository = {
      getOldestAgeSeconds: jest.fn().mockResolvedValue(null),
      countByTypeAndStatus: jest.fn().mockResolvedValue(0),
    };

    const mockMetrics = {
      setPendingOldestAgeSeconds: jest.fn(),
      setDlqOldestAgeSeconds: jest.fn(),
      setDlqAlertActive: jest.fn(),
    };

    const mockSentry = {
      captureMessage: jest.fn(),
      captureException: jest.fn(),
    };

    const mockConfig = {
      dlqMonitorEnabled: true,
      dlqAlertDepthThreshold: 50,
      dlqAlertAgeThresholdMs: 3600000, // 1 hour
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeadLetterQueueMonitorService,
        { provide: JobRepository, useValue: mockRepository },
        { provide: JobQueueMetricsService, useValue: mockMetrics },
        { provide: AppConfigService, useValue: mockConfig },
        { provide: SentryService, useValue: mockSentry },
      ],
    }).compile();

    service = module.get(DeadLetterQueueMonitorService);
    repository = module.get(JobRepository) as jest.Mocked<JobRepository>;
    metrics = module.get(JobQueueMetricsService) as jest.Mocked<JobQueueMetricsService>;
    sentry = module.get(SentryService) as jest.Mocked<SentryService>;
  });

  describe('checkQueueHealth', () => {
    it('should publish pending and DLQ oldest-age gauges for every job type', async () => {
      repository.getOldestAgeSeconds.mockResolvedValue(120);
      repository.countByTypeAndStatus.mockResolvedValue(3);

      await service.checkQueueHealth();

      expect(metrics.setPendingOldestAgeSeconds).toHaveBeenCalledTimes(jobTypeCount);
      expect(metrics.setDlqOldestAgeSeconds).toHaveBeenCalledTimes(jobTypeCount);
      expect(metrics.setPendingOldestAgeSeconds).toHaveBeenCalledWith(
        JobType.WEBHOOK_DELIVERY,
        120,
      );
    });

    it('should not run when the monitor is disabled', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          DeadLetterQueueMonitorService,
          { provide: JobRepository, useValue: repository },
          { provide: JobQueueMetricsService, useValue: metrics },
          { provide: SentryService, useValue: { captureMessage: jest.fn(), captureException: jest.fn() } },
          {
            provide: AppConfigService,
            useValue: {
              dlqMonitorEnabled: false,
              dlqAlertDepthThreshold: 50,
              dlqAlertAgeThresholdMs: 3600000,
            },
          },
        ],
      }).compile();

      const disabledService = module.get(DeadLetterQueueMonitorService);

      await disabledService.checkQueueHealth();

      expect(repository.countByTypeAndStatus).not.toHaveBeenCalled();
    });

    it('should fire a depth alert when DLQ depth meets the threshold', async () => {
      repository.countByTypeAndStatus.mockImplementation(async (type: JobType) =>
        type === JobType.WEBHOOK_DELIVERY ? 50 : 0,
      );

      await service.checkQueueHealth();

      expect(metrics.setDlqAlertActive).toHaveBeenCalledWith(
        JobType.WEBHOOK_DELIVERY,
        'depth',
        true,
      );
    });

    it('should not fire a depth alert when DLQ depth is below the threshold', async () => {
      repository.countByTypeAndStatus.mockResolvedValue(49);

      await service.checkQueueHealth();

      expect(metrics.setDlqAlertActive).toHaveBeenCalledWith(
        JobType.WEBHOOK_DELIVERY,
        'depth',
        false,
      );
    });

    it('should fire an age alert when the oldest DLQ job exceeds the age threshold', async () => {
      repository.getOldestAgeSeconds.mockImplementation(
        async (type: JobType, status: JobStatus) =>
          status === JobStatus.FAILED && type === JobType.RECURRING_PAYMENT ? 4000 : null,
      );

      await service.checkQueueHealth();

      expect(metrics.setDlqAlertActive).toHaveBeenCalledWith(
        JobType.RECURRING_PAYMENT,
        'age',
        true,
      );
    });

    it('should treat a repeatedly failing type differently from a one-off failure via sustained alert state', async () => {
      // First tick: a single DLQ entry below threshold — no alert.
      repository.countByTypeAndStatus.mockResolvedValue(1);
      await service.checkQueueHealth();
      expect(metrics.setDlqAlertActive).toHaveBeenCalledWith(
        JobType.WEBHOOK_DELIVERY,
        'depth',
        false,
      );

      // Second tick: depth has grown past the threshold — sustained failures now alert.
      repository.countByTypeAndStatus.mockImplementation(async (type: JobType) =>
        type === JobType.WEBHOOK_DELIVERY ? 50 : 0,
      );
      await service.checkQueueHealth();
      expect(metrics.setDlqAlertActive).toHaveBeenCalledWith(
        JobType.WEBHOOK_DELIVERY,
        'depth',
        true,
      );
    });

    it('should clear a previously firing alert once depth drops back below the threshold', async () => {
      repository.countByTypeAndStatus.mockImplementation(async (type: JobType) =>
        type === JobType.WEBHOOK_DELIVERY ? 50 : 0,
      );
      await service.checkQueueHealth();
      const logSpy = jest.spyOn(service['logger'], 'log');

      repository.countByTypeAndStatus.mockResolvedValue(0);
      await service.checkQueueHealth();

      expect(metrics.setDlqAlertActive).toHaveBeenCalledWith(
        JobType.WEBHOOK_DELIVERY,
        'depth',
        false,
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Dead letter queue alert cleared',
          type: JobType.WEBHOOK_DELIVERY,
          reason: 'depth',
        }),
      );
    });

    it('should continue checking other job types when one lookup fails', async () => {
      repository.countByTypeAndStatus.mockImplementation(async (type: JobType) => {
        if (type === JobType.WEBHOOK_DELIVERY) {
          throw new Error('db unavailable');
        }
        return 0;
      });

      await expect(service.checkQueueHealth()).resolves.not.toThrow();

      // Other types still get checked despite the failure for one type.
      expect(metrics.setDlqAlertActive).toHaveBeenCalledWith(
        JobType.RECURRING_PAYMENT,
        'depth',
        false,
      );
    });

    it('should report to Sentry with warning severity when an alert transitions to firing', async () => {
      repository.countByTypeAndStatus.mockImplementation(async (type: JobType) =>
        type === JobType.WEBHOOK_DELIVERY ? 50 : 0,
      );

      await service.checkQueueHealth();

      expect(sentry.captureMessage).toHaveBeenCalledWith(
        expect.stringContaining('Dead letter queue alert firing for webhook_delivery (depth)'),
        'warning',
        expect.objectContaining({
          type: JobType.WEBHOOK_DELIVERY,
          reason: 'depth',
          dlqDepth: 50,
          depthThreshold: 50,
        }),
      );
    });

    it('should report to Sentry with info severity when an alert transitions from firing to clear', async () => {
      repository.countByTypeAndStatus.mockImplementation(async (type: JobType) =>
        type === JobType.WEBHOOK_DELIVERY ? 50 : 0,
      );
      await service.checkQueueHealth();
      expect(sentry.captureMessage).toHaveBeenCalledTimes(1);

      repository.countByTypeAndStatus.mockResolvedValue(0);
      await service.checkQueueHealth();

      expect(sentry.captureMessage).toHaveBeenCalledTimes(2);
      expect(sentry.captureMessage).toHaveBeenLastCalledWith(
        expect.stringContaining('Dead letter queue alert cleared for webhook_delivery (depth)'),
        'info',
        expect.objectContaining({
          type: JobType.WEBHOOK_DELIVERY,
          reason: 'depth',
          dlqDepth: 0,
          depthThreshold: 50,
        }),
      );
    });

    it('should invoke Sentry exactly once per firing transition, not once per cron tick', async () => {
      repository.countByTypeAndStatus.mockImplementation(async (type: JobType) =>
        type === JobType.WEBHOOK_DELIVERY ? 50 : 0,
      );

      // Tick 1: alert transitions to firing -> invokes Sentry
      await service.checkQueueHealth();
      expect(sentry.captureMessage).toHaveBeenCalledTimes(1);

      // Tick 2: alert remains firing -> should NOT invoke Sentry again
      await service.checkQueueHealth();
      expect(sentry.captureMessage).toHaveBeenCalledTimes(1);

      // Tick 3: alert still firing -> should NOT invoke Sentry again
      await service.checkQueueHealth();
      expect(sentry.captureMessage).toHaveBeenCalledTimes(1);

      // Transition to clear -> invokes Sentry once for clear
      repository.countByTypeAndStatus.mockResolvedValue(0);
      await service.checkQueueHealth();
      expect(sentry.captureMessage).toHaveBeenCalledTimes(2);

      // Remains clear -> should NOT invoke Sentry again
      await service.checkQueueHealth();
      expect(sentry.captureMessage).toHaveBeenCalledTimes(2);
    });

    it('should ensure metrics gauges are updated alongside Sentry notifications', async () => {
      repository.countByTypeAndStatus.mockImplementation(async (type: JobType) =>
        type === JobType.WEBHOOK_DELIVERY ? 50 : 0,
      );

      await service.checkQueueHealth();

      expect(metrics.setDlqAlertActive).toHaveBeenCalledWith(
        JobType.WEBHOOK_DELIVERY,
        'depth',
        true,
      );
      expect(sentry.captureMessage).toHaveBeenCalledWith(
        expect.stringContaining('Dead letter queue alert firing'),
        'warning',
        expect.anything(),
      );
    });
  });
});
