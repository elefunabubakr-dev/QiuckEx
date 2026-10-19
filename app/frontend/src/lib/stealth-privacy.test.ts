import { describe, expect, it } from "vitest";
import { PrivacyService } from "../../../backend/src/privacy/privacy.service";
import {
  decryptRecipientEnvelopeClient,
  deriveSharedSecretHexClient,
  generateStealthViewKeyPairClient,
} from "./stealth-privacy";

describe("Client-side non-custodial stealth cryptography (#1215)", () => {
  const backendPrivacyService = new PrivacyService();

  it("generates an X25519 view keypair and decrypts a server-encrypted stealth envelope purely client-side", async () => {
    const recipientViewKeys = await generateStealthViewKeyPairClient();
    const recipientAddress =
      "GDSTESTRECIPIENTADDRESS00000000000000000000000000000000000";

    // Server only ever receives the recipient's PUBLIC view key
    const envelope = backendPrivacyService.encryptRecipientForViewKey(
      recipientAddress,
      recipientViewKeys.publicKeyPem,
    );

    // Client decrypts the envelope locally using its private key (no network call)
    const decryptedAddress = await decryptRecipientEnvelopeClient(
      envelope,
      recipientViewKeys.privateKeyPem,
    );

    expect(decryptedAddress).toBe(recipientAddress);
  });

  it("derives identical X25519 shared secrets client-side between counterpart keypairs", async () => {
    const alice = await generateStealthViewKeyPairClient();
    const bob = await generateStealthViewKeyPairClient();

    const aliceSharedHex = await deriveSharedSecretHexClient(
      alice.privateKeyPem,
      bob.publicKeyPem,
    );
    const bobSharedHex = await deriveSharedSecretHexClient(
      bob.privateKeyPem,
      alice.publicKeyPem,
    );

    // Also matches backend reference implementation
    const backendReferenceHex = backendPrivacyService.deriveSharedSecretHex(
      alice.privateKeyPem,
      bob.publicKeyPem,
    );

    expect(aliceSharedHex).toMatch(/^[0-9a-f]{64}$/);
    expect(aliceSharedHex).toBe(bobSharedHex);
    expect(aliceSharedHex).toBe(backendReferenceHex);
  });

  it("rejects tampered ciphertext or invalid key material during client-side decryption", async () => {
    const recipientViewKeys = await generateStealthViewKeyPairClient();
    const wrongKeys = await generateStealthViewKeyPairClient();
    const envelope = backendPrivacyService.encryptRecipientForViewKey(
      "GDSTESTRECIPIENTADDRESS00000000000000000000000000000000000",
      recipientViewKeys.publicKeyPem,
    );

    await expect(
      decryptRecipientEnvelopeClient(envelope, wrongKeys.privateKeyPem),
    ).rejects.toThrow(/Decryption failed/i);

    await expect(
      decryptRecipientEnvelopeClient(
        { ...envelope, ciphertextBase64: "dGFtcGVyZWQ=" },
        recipientViewKeys.privateKeyPem,
      ),
    ).rejects.toThrow(/Decryption failed/i);

    await expect(
      deriveSharedSecretHexClient("invalid-pem", recipientViewKeys.publicKeyPem),
    ).rejects.toThrow(/Invalid private key format/i);
  });
});
