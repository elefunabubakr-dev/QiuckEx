# Notification preference wallet ownership

All GET, PUT and DELETE preference requests require a fresh wallet signature.
Neither an address in a URL nor an API key with a self-declared owner grants access.
GET is protected too: email, push tokens, webhook endpoints and secrets are private.

## Protocol

1. POST `/notifications/preferences/:publicKey/challenge` with `method` (GET,
   PUT or DELETE), the exact JSON `body` for PUT, or `channel` for DELETE.
2. The response contains `challenge`, `message` and `expiresAt`. Check the
   message's domain, wallet, method, path and body before asking for a signature.
3. Sign the exact UTF-8 `message` bytes with the wallet's Ed25519 key. Return
   the raw 64-byte signature as base64 (not a transaction or signed envelope).
4. Send the intended request with `X-Wallet-Public-Key`, `X-Wallet-Challenge`
   and `X-Wallet-Signature`. Do not log, persist or reuse the proof.

Challenges expire after two minutes, are single-use, bind the method, path and
canonical JSON body, and are capped at 1,000 cached entries and 8 KiB per body.
Missing/invalid/expired/replayed proofs return 401. A valid signature from a
wallet other than the requested owner returns 403, without repository access.

## Mobile integration

`device-token-registration.ts` gets a fresh proof for registration, refresh,
deregistration and offline-queue execution. Authentication failures stop retries;
queued intents never contain a signature. Before registration, a real connected
wallet adapter must call `setNotificationWalletSigner({ publicKey, signMessage })`
from `services/notification-wallet-auth.ts`. `signMessage` must implement the
raw signing contract above; adapt wallet APIs that wrap/hash messages rather
than passing their signatures through blindly. Logout clears the signer after
the deregistration attempt. Never store a private key in this helper.

The current `useWalletContext.tsx` connectors are demo stubs: every wallet option
returns the same demo address, not a real signing provider. They cannot prove
ownership and intentionally fail closed. Restoring an address/session token does
not restore signing authority: reconnect a real adapter first. This patch adds
the authenticated transport, not a production wallet connection implementation.

## Deployment and local checks

The challenge cache is process-local. Multi-instance deployments need sticky
routing for the challenge and request, or a shared store with atomic consumption;
requests landing on a different instance fail closed with 401. Restarting or
cache eviction also invalidates outstanding challenges. Never disable the guard
to work around this. Challenge issuance uses the existing mutation rate tier.
Production CORS permits the wallet proof and device installation headers.

From `app/backend`, run Jest with `--runInBand --config jest.int.config.ts
notification-preferences-auth` and with `--runInBand --config jest.unit.config.ts
wallet-request-auth notification-preferences.controller`. From `app/mobile`, run
Jest with `--runInBand notification-wallet-auth device-token-registration`.
No hosted backend or funded Stellar account is needed.
