import { FeatureFlagsController } from './feature-flags.controller';
import { Reflector } from '@nestjs/core';
import { Type } from '@nestjs/common';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { REQUIRED_SCOPES_KEY } from '../auth/decorators/require-scopes.decorator';

describe('FeatureFlagsController', () => {
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
  });

  const adminRoutes = [
    { method: 'listFlags', path: 'admin/feature-flags' },
    { method: 'getFlag', path: 'admin/feature-flags/:key' },
    { method: 'updateFlag', path: 'admin/feature-flags/:key' },
  ];

  const publicRoutes = [
    { method: 'evaluateFlag', path: 'feature-flags/:key/evaluate' },
    { method: 'getSnapshot', path: 'feature-flags/snapshot' },
  ];

  describe('admin routes', () => {
    for (const route of adminRoutes) {
      it(`should have ApiKeyGuard and RequireScopes('admin') on ${route.method}`, () => {
        const methodName = route.method as keyof FeatureFlagsController;
        const method = FeatureFlagsController.prototype[methodName];

        // Check for ApiKeyGuard
        const guards = reflector.getAllAndOverride<Type<unknown>[]>('__guards__', [method, FeatureFlagsController]);
        expect(guards).toContain(ApiKeyGuard);

        // Check for RequireScopes('admin')
        const requiredScopes = reflector.getAllAndOverride<string[]>(REQUIRED_SCOPES_KEY, [method, FeatureFlagsController]);
        expect(requiredScopes).toEqual(['admin']);
      });
    }
  });

  describe('public routes', () => {
    for (const route of publicRoutes) {
      it(`should NOT have ApiKeyGuard or RequireScopes('admin') on ${route.method}`, () => {
        const methodName = route.method as keyof FeatureFlagsController;
        const method = FeatureFlagsController.prototype[methodName];

        // Check for ApiKeyGuard - should not be present (or if present, it should be from a parent class? but we override)
        const guards = reflector.getAllAndOverride<Type<unknown>[]>('__guards__', [method, FeatureFlagsController]);
        // We expect that the method does not have ApiKeyGuard from its own decorators.
        // However, the controller class might have guards? In our case, we didn't add any at the class level.
        // So we expect guards to be undefined or not contain ApiKeyGuard.
        // But note: the method might inherit guards from the class? We didn't set any at the class level.
        // Let's check that the guards array does not contain ApiKeyGuard.
        // If guards is undefined, that's fine.
        if (guards) {
          expect(guards).not.toContain(ApiKeyGuard);
        }

        // Check for RequireScopes - should not be present
        const requiredScopes = reflector.getAllAndOverride<string[]>(REQUIRED_SCOPES_KEY, [method, FeatureFlagsController]);
        if (requiredScopes) {
          expect(requiredScopes).not.toEqual(['admin']);
        }
      });
    }
  });
});
