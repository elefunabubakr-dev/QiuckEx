/**
 * Client-side non-custodial stealth-address cryptography (#1215).
 *
 * Performs X25519 ECDH shared-secret derivation and AES-256-GCM stealth
 * envelope decryption locally on the client using Web Crypto (`crypto.subtle`),
 * so private keys never leave the client or transit the network.
 */
export interface StealthEnvelope {
    ephPublicKeyPem: string;
    ivBase64: string;
    authTagBase64: string;
    ciphertextBase64: string;
    algorithm: "aes-256-gcm";
}
export interface StealthViewKeyPair {
    publicKeyPem: string;
    privateKeyPem: string;
}
export declare function generateStealthViewKeyPairClient(): Promise<StealthViewKeyPair>;
export declare function deriveSharedSecretHexClient(privateKeyPem: string, publicKeyPem: string): Promise<string>;
export declare function decryptRecipientEnvelopeClient(envelope: StealthEnvelope, recipientViewPrivateKeyPem: string): Promise<string>;
