import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';

@Injectable()
export class MetricsGuard implements CanActivate {
  constructor(private configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const token = request.headers['x-metrics-token'];
    const validToken = this.configService.get<string>('METRICS_ENDPOINT_TOKEN');

    if (
      !validToken ||
      typeof token !== 'string' ||
      !MetricsGuard.safeCompare(token, validToken)
    ) {
      throw new UnauthorizedException('Invalid metrics token');
    }

    return true;
  }

  private static safeCompare(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);

    if (bufA.length !== bufB.length) {
      return false;
    }

    return timingSafeEqual(bufA, bufB);
  }
}