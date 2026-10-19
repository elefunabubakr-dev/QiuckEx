import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import {
  EXCLUDE_PRIVACY_TELEMETRY_KEY,
  isPrivacyDebugPath,
} from '../privacy/privacy-debug.guard';
import { CrashReportingService } from './crash-reporting.service';

/**
 * Interceptor that captures log lines for crash reporting
 * This is a lightweight interceptor that captures request/response logs
 *
 * Registered globally by CrashReportingModule (#1063). Lines go into the
 * current request's own buffer (opened by LogCaptureMiddleware), never into
 * a buffer shared with other requests.
 *
 * Routes decorated with @ExcludePrivacyTelemetry() or matching stealth debug
 * paths (#1215) are excluded from log capture.
 */
@Injectable()
export class LogCaptureInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LogCaptureInterceptor.name);

  constructor(private readonly crashReportingService: CrashReportingService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const handler = context.getHandler?.();
    const targetClass = context.getClass?.();
    const excludedByMetadata =
      (handler && Reflect.getMetadata(EXCLUDE_PRIVACY_TELEMETRY_KEY, handler)) ||
      (targetClass &&
        Reflect.getMetadata(EXCLUDE_PRIVACY_TELEMETRY_KEY, targetClass));

    const request = context.switchToHttp().getRequest();
    const { method, url, originalUrl, path } = request ?? {};

    if (
      excludedByMetadata ||
      isPrivacyDebugPath(originalUrl ?? url ?? path)
    ) {
      return next.handle();
    }

    const timestamp = new Date().toISOString();

    // Capture request log
    this.crashReportingService.captureLogLine(
      `[${timestamp}] ${method} ${url} - Request received`,
    );

    return next.handle().pipe(
      tap({
        next: () => {
          // Capture success log
          const responseTimestamp = new Date().toISOString();
          this.crashReportingService.captureLogLine(
            `[${responseTimestamp}] ${method} ${url} - Request completed`,
          );
        },
        error: (error) => {
          // Capture error log
          const errorTimestamp = new Date().toISOString();
          this.crashReportingService.captureLogLine(
            `[${errorTimestamp}] ${method} ${url} - Request failed: ${error.message}`,
          );
        },
      }),
    );
  }
}
