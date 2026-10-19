import { SetMetadata } from '@nestjs/common';

export const REQUIRE_API_KEY_KEY = 'requireApiKey';

/**
 * Mark a route (or controller) as requiring a valid API key.
 *
 * `ApiKeyGuard` treats a missing `x-api-key` header as public access, so that
 * public endpoints can opt out of authentication. Applying this decorator opts
 * the route into strict enforcement: a missing header is rejected with 401
 * instead of being allowed through.
 *
 * Combine with `@RequireScopes()` to also enforce scope requirements.
 *
 * @example
 * \@RequireApiKey()
 * \@RequireScopes('admin')
 * \@Post()
 * trigger() {}
 */
export const RequireApiKey = () => SetMetadata(REQUIRE_API_KEY_KEY, true);
