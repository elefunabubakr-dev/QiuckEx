import { createHmac } from 'crypto';
import {
  verifyAnchorSignature,
  verifyAnchorSecret,
  extractAnchorSignature,
  extractAnchorSecret,
  extractAnchorDomain,
  safeCompareHex,
  safeCompareSecret,
} from './anchor-webhook-signature';

describe('anchor-webhook-signature', () => {
  const SECRET = 'test-secret-key-12345';
  const PAYLOAD = JSON.stringify({ id: 'anchor-tx-100', status: 'completed' });

  function makeSignature(payload: string, secret: string, prefix = 'sha256='): string {
    const digest = createHmac('sha256', secret).update(Buffer.from(payload)).digest('hex');
    return `${prefix}${digest}`;
  }

  describe('verifyAnchorSignature', () => {
    it('verifies a valid sha256= HMAC signature', () => {
      const sig = makeSignature(PAYLOAD, SECRET, 'sha256=');
      expect(verifyAnchorSignature(Buffer.from(PAYLOAD), sig, SECRET)).toBe(true);
    });

    it('verifies a valid raw hex HMAC signature (without prefix)', () => {
      const sig = makeSignature(PAYLOAD, SECRET, '');
      expect(verifyAnchorSignature(Buffer.from(PAYLOAD), sig, SECRET)).toBe(true);
    });

    it('verifies a valid t=<timestamp>,v1=<hex> signature', () => {
      const ts = '1690000000';
      const digest = createHmac('sha256', SECRET)
        .update(`${ts}.${PAYLOAD}`)
        .digest('hex');
      const sig = `t=${ts},v1=${digest}`;
      expect(verifyAnchorSignature(Buffer.from(PAYLOAD), sig, SECRET)).toBe(true);
    });

    it('rejects an invalid/tampered signature', () => {
      const bogusSig = `sha256=${'0'.repeat(64)}`;
      expect(verifyAnchorSignature(Buffer.from(PAYLOAD), bogusSig, SECRET)).toBe(false);
    });

    it('rejects when signed with the wrong secret', () => {
      const wrongSig = makeSignature(PAYLOAD, 'wrong-secret');
      expect(verifyAnchorSignature(Buffer.from(PAYLOAD), wrongSig, SECRET)).toBe(false);
    });

    it('rejects when payload has been tampered with', () => {
      const sig = makeSignature(PAYLOAD, SECRET);
      const tampered = JSON.stringify({ id: 'anchor-tx-100', status: 'failed' });
      expect(verifyAnchorSignature(Buffer.from(tampered), sig, SECRET)).toBe(false);
    });

    it('rejects when payload is empty or undefined', () => {
      const sig = makeSignature(PAYLOAD, SECRET);
      expect(verifyAnchorSignature(Buffer.from(''), sig, SECRET)).toBe(false);
      expect(verifyAnchorSignature(undefined, sig, SECRET)).toBe(false);
    });

    it('rejects when signature or secret is missing', () => {
      expect(verifyAnchorSignature(Buffer.from(PAYLOAD), undefined, SECRET)).toBe(false);
      expect(verifyAnchorSignature(Buffer.from(PAYLOAD), 'sig', undefined)).toBe(false);
    });
  });

  describe('verifyAnchorSecret', () => {
    it('returns true when provided secret matches expected secret', () => {
      expect(verifyAnchorSecret('my-secret-key', 'my-secret-key')).toBe(true);
    });

    it('returns false when secret does not match', () => {
      expect(verifyAnchorSecret('wrong-key', 'my-secret-key')).toBe(false);
    });

    it('returns false when either secret is missing', () => {
      expect(verifyAnchorSecret(undefined, 'secret')).toBe(false);
      expect(verifyAnchorSecret('secret', undefined)).toBe(false);
    });
  });

  describe('safeCompareHex and safeCompareSecret', () => {
    it('returns false on length mismatch without throwing', () => {
      expect(safeCompareHex('abc', 'abcdef')).toBe(false);
      expect(safeCompareSecret('short', 'much-longer-string')).toBe(false);
    });
  });

  describe('extractAnchorSignature', () => {
    it('extracts signature from x-anchor-signature', () => {
      expect(extractAnchorSignature({ 'x-anchor-signature': 'sha256=abc' })).toBe('sha256=abc');
    });

    it('extracts signature from x-hub-signature-256', () => {
      expect(extractAnchorSignature({ 'x-hub-signature-256': 'sha256=def' })).toBe('sha256=def');
    });

    it('extracts signature from x-webhook-signature', () => {
      expect(extractAnchorSignature({ 'x-webhook-signature': 'sha256=ghi' })).toBe('sha256=ghi');
    });

    it('returns undefined when no signature header is present', () => {
      expect(extractAnchorSignature({})).toBeUndefined();
    });
  });

  describe('extractAnchorSecret', () => {
    it('extracts secret from x-anchor-secret', () => {
      expect(extractAnchorSecret({ 'x-anchor-secret': 'sec123' })).toBe('sec123');
    });

    it('extracts secret from Authorization Bearer header', () => {
      expect(extractAnchorSecret({ authorization: 'Bearer sec-token' })).toBe('sec-token');
    });

    it('extracts secret from Authorization SharedSecret header', () => {
      expect(extractAnchorSecret({ authorization: 'SharedSecret sec-shared' })).toBe('sec-shared');
    });

    it('extracts secret from query param secret or key', () => {
      expect(extractAnchorSecret({}, { secret: 'query-secret' })).toBe('query-secret');
      expect(extractAnchorSecret({}, { key: 'query-key' })).toBe('query-key');
    });

    it('returns undefined when no secret is found', () => {
      expect(extractAnchorSecret({})).toBeUndefined();
    });
  });

  describe('extractAnchorDomain', () => {
    it('extracts domain from x-anchor-domain header', () => {
      expect(extractAnchorDomain({ 'x-anchor-domain': 'TEST.anchor.org' })).toBe('test.anchor.org');
    });

    it('extracts domain from query param', () => {
      expect(extractAnchorDomain({}, { anchor: 'eu.anchor.org' })).toBe('eu.anchor.org');
    });

    it('extracts domain from body', () => {
      expect(extractAnchorDomain({}, {}, { anchor_domain: 'us.anchor.org' })).toBe('us.anchor.org');
    });

    it('returns undefined when no domain is present', () => {
      expect(extractAnchorDomain({}, {}, {})).toBeUndefined();
    });
  });
});
