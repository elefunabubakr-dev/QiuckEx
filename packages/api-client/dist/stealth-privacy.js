/**
 * Client-side non-custodial stealth-address cryptography (#1215).
 *
 * Performs X25519 ECDH shared-secret derivation and AES-256-GCM stealth
 * envelope decryption locally on the client using Web Crypto (`crypto.subtle`),
 * so private keys never leave the client or transit the network.
 */
function getSubtleCrypto() {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
        throw new Error("Web Crypto API (crypto.subtle) is required for client-side stealth cryptography");
    }
    return subtle;
}
function base64ToBytes(base64) {
    if (!base64 || typeof base64 !== "string") {
        throw new Error("Invalid base64 input");
    }
    const normalized = base64.replace(/\s+/g, "");
    const binary = globalThis.atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}
function bytesToBase64(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) {
        binary += String.fromCharCode(bytes[i]);
    }
    return globalThis.btoa(binary);
}
function bytesToHex(bytes) {
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}
function pemToDer(pem, expectedLabel) {
    if (!pem || typeof pem !== "string") {
        throw new Error(`${expectedLabel} PEM is required`);
    }
    const header = `-----BEGIN ${expectedLabel}-----`;
    const footer = `-----END ${expectedLabel}-----`;
    const trimmed = pem.trim();
    if (!trimmed.includes(header) || !trimmed.includes(footer)) {
        throw new Error(`Invalid ${expectedLabel.toLowerCase()} PEM format`);
    }
    const body = trimmed
        .replace(header, "")
        .replace(footer, "")
        .replace(/\s+/g, "");
    if (!body || !/^[A-Za-z0-9+/=]+$/.test(body)) {
        throw new Error(`Invalid ${expectedLabel.toLowerCase()} PEM body`);
    }
    const bytes = base64ToBytes(body);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
function derToPem(der, label) {
    const b64 = bytesToBase64(new Uint8Array(der));
    const lines = b64.match(/.{1,64}/g) ?? [b64];
    return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}
export async function generateStealthViewKeyPairClient() {
    const subtle = getSubtleCrypto();
    const keyPair = (await subtle.generateKey({ name: "X25519" }, true, [
        "deriveBits",
    ]));
    const spki = await subtle.exportKey("spki", keyPair.publicKey);
    const pkcs8 = await subtle.exportKey("pkcs8", keyPair.privateKey);
    return {
        publicKeyPem: derToPem(spki, "PUBLIC KEY"),
        privateKeyPem: derToPem(pkcs8, "PRIVATE KEY"),
    };
}
export async function deriveSharedSecretHexClient(privateKeyPem, publicKeyPem) {
    if (!privateKeyPem || typeof privateKeyPem !== "string") {
        throw new Error("Private key is required");
    }
    if (!publicKeyPem || typeof publicKeyPem !== "string") {
        throw new Error("Public key is required");
    }
    const subtle = getSubtleCrypto();
    let privateKey;
    try {
        const privateDer = pemToDer(privateKeyPem, "PRIVATE KEY");
        privateKey = await subtle.importKey("pkcs8", privateDer, { name: "X25519" }, false, ["deriveBits"]);
    }
    catch {
        throw new Error("Invalid private key format");
    }
    let publicKey;
    try {
        const publicDer = pemToDer(publicKeyPem, "PUBLIC KEY");
        publicKey = await subtle.importKey("spki", publicDer, { name: "X25519" }, false, []);
    }
    catch {
        throw new Error("Invalid public key format");
    }
    try {
        const sharedBits = await subtle.deriveBits({ name: "X25519", public: publicKey }, privateKey, 256);
        return bytesToHex(new Uint8Array(sharedBits));
    }
    catch {
        throw new Error("Failed to derive shared secret - key mismatch");
    }
}
export async function decryptRecipientEnvelopeClient(envelope, recipientViewPrivateKeyPem) {
    if (!envelope?.ephPublicKeyPem) {
        throw new Error("Envelope is missing ephemeral public key");
    }
    if (!recipientViewPrivateKeyPem ||
        typeof recipientViewPrivateKeyPem !== "string") {
        throw new Error("Recipient view private key is required");
    }
    const subtle = getSubtleCrypto();
    let privateKey;
    try {
        const privateDer = pemToDer(recipientViewPrivateKeyPem, "PRIVATE KEY");
        privateKey = await subtle.importKey("pkcs8", privateDer, { name: "X25519" }, false, ["deriveBits"]);
    }
    catch {
        throw new Error("Invalid recipient view private key format");
    }
    let ephPublicKey;
    try {
        const ephDer = pemToDer(envelope.ephPublicKeyPem, "PUBLIC KEY");
        ephPublicKey = await subtle.importKey("spki", ephDer, { name: "X25519" }, false, []);
    }
    catch {
        throw new Error("Invalid envelope ephemeral public key format");
    }
    let sharedBits;
    try {
        sharedBits = await subtle.deriveBits({ name: "X25519", public: ephPublicKey }, privateKey, 256);
    }
    catch {
        throw new Error("Failed to derive shared secret - key mismatch");
    }
    const keyHash = await subtle.digest("SHA-256", sharedBits);
    const aesKey = await subtle.importKey("raw", keyHash, { name: "AES-GCM" }, false, ["decrypt"]);
    const iv = base64ToBytes(envelope.ivBase64);
    const authTag = base64ToBytes(envelope.authTagBase64);
    const ciphertext = base64ToBytes(envelope.ciphertextBase64);
    if (authTag.byteLength !== 16) {
        throw new Error("Invalid authentication tag format");
    }
    const combined = new Uint8Array(ciphertext.byteLength + authTag.byteLength);
    combined.set(ciphertext, 0);
    combined.set(authTag, ciphertext.byteLength);
    try {
        const plaintextBuffer = await subtle.decrypt({
            name: "AES-GCM",
            iv: iv,
            tagLength: 128,
        }, aesKey, combined);
        return new TextDecoder().decode(plaintextBuffer);
    }
    catch {
        throw new Error("Decryption failed - data may be tampered or key mismatch");
    }
}
