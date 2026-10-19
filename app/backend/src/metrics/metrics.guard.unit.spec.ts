import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MetricsGuard } from './metrics.guard';

describe('MetricsGuard', () => {
  let guard: MetricsGuard;
  let configService: ConfigService;

  const mockExecutionContext = (headers: Record<string, string | undefined>): ExecutionContext => {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          headers,
        }),
      }),
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    configService = {
      get: jest.fn(),
    } as unknown as ConfigService;
    guard = new MetricsGuard(configService);
  });

  it('should allow access when token matches validToken using timingSafeEqual', () => {
    const validToken = 'secret-metrics-token-12345';
    jest.spyOn(configService, 'get').mockReturnValue(validToken);

    const context = mockExecutionContext({
      'x-metrics-token': 'secret-metrics-token-12345',
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should reject when token is incorrect but equal length', () => {
    const validToken = 'secret-metrics-token-12345';
    jest.spyOn(configService, 'get').mockReturnValue(validToken);

    const context = mockExecutionContext({
      'x-metrics-token': 'secret-metrics-token-99999',
    });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(context)).toThrow('Invalid metrics token');
  });

  it('should reject when token length does not match validToken length without throwing unexpected errors', () => {
    const validToken = 'secret-metrics-token-12345';
    jest.spyOn(configService, 'get').mockReturnValue(validToken);

    const shortContext = mockExecutionContext({
      'x-metrics-token': 'short',
    });
    const longContext = mockExecutionContext({
      'x-metrics-token': 'a-much-longer-secret-token-than-configured-1234567890',
    });

    expect(() => guard.canActivate(shortContext)).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(longContext)).toThrow(UnauthorizedException);
  });

  it('should reject when header is missing', () => {
    const validToken = 'secret-metrics-token-12345';
    jest.spyOn(configService, 'get').mockReturnValue(validToken);

    const context = mockExecutionContext({});

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('should reject when configured METRICS_ENDPOINT_TOKEN is missing or empty', () => {
    jest.spyOn(configService, 'get').mockReturnValue(undefined);

    const context = mockExecutionContext({
      'x-metrics-token': 'some-token',
    });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });
});
