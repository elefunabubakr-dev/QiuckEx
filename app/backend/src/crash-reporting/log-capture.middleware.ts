import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

import { isPrivacyDebugPath } from '../privacy/privacy-debug.guard';
import { runWithLogScope } from './log-capture.context';

/**
 * Opens a fresh log-capture scope for every HTTP request (#1063).
 *
 * Excluded stealth privacy debug endpoints (#1215) bypass log scope creation
 * so private-key debug requests can never be captured into crash logs.
 */
@Injectable()
export class LogCaptureMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    if (isPrivacyDebugPath(req.originalUrl ?? req.url ?? req.path)) {
      next();
      return;
    }
    runWithLogScope(() => next());
  }
}
