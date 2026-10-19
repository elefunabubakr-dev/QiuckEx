import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Validates an HMAC-SHA256 webhook signature against a payload and secret.
 *
 * Supports signatures formatted as:
 * - `sha256=<hex>`
 * - raw `<hex>`
 * - `t=<timestamp>,v1=<hex>`
 *
 * Uses constant-time comparison against the computed digest to prevent timing attacks.
 */
export function verifyAnchorSignature(
  payload: Buffer | string | undefined,
  signature: string | undefined,
  secret: string | undefined,
): boolean {
  if (!payload || !signature || !secret) {
    return false;
  }

  const rawBytes = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  if (rawBytes.length === 0) {
    return false;
  }

  // Handle t=<timestamp>,v1=<hex> format
  if (signature.includes('v1=')) {
    const match = /t=([^,]+),v1=([a-fA-F0-9]+)/.exec(signature);
    if (match) {
      const [, timestamp, v1Digest] = match;
      const expectedDigest = createHmac('sha256', secret)
        .update(`${timestamp}.${rawBytes.toString('utf-8')}`)
        .digest('hex');
      if (safeCompareHex(v1Digest, expectedDigest)) {
        return true;
      }
    }
  }

  // Handle sha256=<hex> or raw <hex>
  const providedHex = signature.startsWith('sha256=') ? signature.slice(7) : signature;
  const computedHex = createHmac('sha256', secret).update(rawBytes).digest('hex');

  return safeCompareHex(providedHex, computedHex);
}

/**
 * Validates a shared secret in constant time.
 */
export function verifyAnchorSecret(
  provided: string | undefined,
  expected: string | undefined,
): boolean {
  if (!provided || !expected) {
    return false;
  }
  return safeCompareSecret(provided, expected);
}

/**
 * Constant-time comparison between two hex strings.
 */
export function safeCompareHex(aHex: string, bHex: string): boolean {
  if (!aHex || !bHex) return false;
  try {
    const bufA = Buffer.from(aHex, 'hex');
    const bufB = Buffer.from(bHex, 'hex');
    if (bufA.length !== bufB.length || bufA.length === 0) {
      return false;
    }
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * Constant-time comparison between two UTF-8 strings.
 */
export function safeCompareSecret(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  try {
    const bufA = Buffer.from(provided, 'utf-8');
    const bufB = Buffer.from(expected, 'utf-8');
    if (bufA.length !== bufB.length || bufA.length === 0) {
      return false;
    }
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * Extracts a candidate webhook signature from standard request headers.
 */
export function extractAnchorSignature(headers: Record<string, unknown>): string | undefined {
  const candidates = [
    headers['x-anchor-signature'],
    headers['x-webhook-signature'],
    headers['x-hub-signature-256'],
    headers['x-signature-256'],
    headers['x-signature'],
    headers['signature'],
  ];

  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) {
      return c.trim();
    }
    if (Array.isArray(c) && typeof c[0] === 'string' && c[0].trim()) {
      return c[0].trim();
    }
  }
  return undefined;
}

/**
 * Extracts a candidate shared secret from request headers or query parameters.
 */
export function extractAnchorSecret(
  headers: Record<string, unknown>,
  query?: Record<string, unknown>,
): string | undefined {
  const headerCandidates = [
    headers['x-anchor-secret'],
    headers['x-webhook-secret'],
    headers['x-shared-secret'],
    headers['x-api-key'],
  ];

  for (const c of headerCandidates) {
    if (typeof c === 'string' && c.trim()) {
      return c.trim();
    }
    if (Array.isArray(c) && typeof c[0] === 'string' && c[0].trim()) {
      return c[0].trim();
    }
  }

  // Authorization: Bearer <secret> or SharedSecret <secret> or <secret>
  const auth = headers['authorization'];
  if (typeof auth === 'string' && auth.trim()) {
    const parts = auth.trim().split(' ');
    if (parts.length === 2 && (parts[0].toLowerCase() === 'bearer' || parts[0].toLowerCase() === 'sharedsecret')) {
      return parts[1];
    }
    if (parts.length === 1) {
      return parts[0];
    }
  }

  // Check query parameters
  if (query) {
    const queryCandidates = [query['secret'], query['key'], query['shared_secret'], query['webhook_secret']];
    for (const q of queryCandidates) {
      if (typeof q === 'string' && q.trim()) {
        return q.trim();
      }
    }
  }

  return undefined;
}

/**
 * Extracts an anchor domain from request headers, query, or body.
 */
export function extractAnchorDomain(
  headers: Record<string, unknown>,
  query?: Record<string, unknown>,
  body?: unknown,
): string | undefined {
  const headerCandidates = [headers['x-anchor-domain'], headers['x-anchor-id']];
  for (const c of headerCandidates) {
    if (typeof c === 'string' && c.trim()) return c.trim().toLowerCase();
  }

  if (query) {
    const queryCandidates = [query['anchor'], query['domain'], query['anchorDomain'], query['anchor_domain']];
    for (const q of queryCandidates) {
      if (typeof q === 'string' && q.trim()) return q.trim().toLowerCase();
    }
  }

  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    const bodyCandidates = [b['anchor_domain'], b['anchorDomain'], b['domain'], b['anchor']];
    for (const candidate of bodyCandidates) {
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim().toLowerCase();
    }
  }

  return undefined;
}
