import { AuditController } from '../audit.controller';
import { Reflector } from '@nestjs/core';
import { Type } from '@nestjs/common';
import { ApiKeyGuard } from '../../auth/guards/api-key.guard';
import { REQUIRED_SCOPES_KEY } from '../../auth/decorators/require-scopes.decorator';

describe('AuditController', () => {
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
  });

  const adminRoutes = [
    { method: 'queryLogs', path: '' },
    { method: 'exportCsv', path: 'export' },
    { method: 'applyRetentionStrategy', path: 'retention' },
  ];

  // There are no public routes in the audit controller; all routes are admin.
  // But note: the controller is prefixed with 'admin/audit', so all routes are under admin.

  describe('admin routes', () => {
    for (const route of adminRoutes) {
      it(`should have ApiKeyGuard and RequireScopes('admin') on ${route.method}`, () => {
        const methodName = route.method as keyof AuditController;
        const method = AuditController.prototype[methodName];

        // Check for ApiKeyGuard
        const guards = reflector.getAllAndOverride<Type<unknown>[]>('__guards__', [method, AuditController]);
        expect(guards).toContain(ApiKeyGuard);

        // Check for RequireScopes('admin')
        const requiredScopes = reflector.getAllAndOverride<string[]>(REQUIRED_SCOPES_KEY, [method, AuditController]);
        expect(requiredScopes).toEqual(['admin']);
      });
    }
  });
});
