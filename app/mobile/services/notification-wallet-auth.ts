/** The wallet provider signs a plain UTF-8 message, returning raw Ed25519 bytes as base64. */
export interface NotificationWalletSigner {
  publicKey: string;
  signMessage(message: string): Promise<string>;
}

export class NotificationWalletAuthError extends Error {}
let activeSigner: NotificationWalletSigner | null = null;

/** Install only after a real wallet connection; never derive identity from a demo/session token. */
export function setNotificationWalletSigner(
  signer: NotificationWalletSigner | null,
): void {
  activeSigner = signer;
}

export function clearNotificationWalletSigner(): void {
  activeSigner = null;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export async function createNotificationProofHeaders(args: {
  url: string;
  publicKey: string;
  method: "PUT" | "DELETE" | "GET";
  body?: Record<string, unknown>;
  channel?: "push" | "email" | "webhook";
}): Promise<Record<string, string>> {
  const signer = activeSigner;
  if (!signer || signer.publicKey !== args.publicKey)
    throw new NotificationWalletAuthError(
      "A connected wallet capable of signing is required for notification preferences",
    );
  const challengeUrl =
    (args.channel ? args.url.slice(0, -(args.channel.length + 1)) : args.url) +
    "/challenge";
  const response = await fetch(challengeUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      method: args.method,
      channel: args.channel,
      body: args.body,
    }),
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403)
      throw new NotificationWalletAuthError("Wallet challenge was rejected");
    throw new Error(`Wallet challenge failed: HTTP ${response.status}`);
  }
  const challenge = (await response.json()) as {
    challenge: string;
    message: string;
    expiresAt: number;
  };
  let message: Record<string, unknown>;
  try {
    message = JSON.parse(challenge.message) as Record<string, unknown>;
    if (!message || typeof message !== "object" || Array.isArray(message))
      throw new Error("Invalid message");
  } catch {
    throw new NotificationWalletAuthError("Invalid wallet challenge");
  }
  if (
    message.domain !== "QuickEx wallet request v1" ||
    message.publicKey !== signer.publicKey ||
    message.method !== args.method ||
    message.path !== new URL(args.url).pathname ||
    canonicalJson(message.body) !== canonicalJson(args.body ?? null) ||
    message.nonce !== challenge.challenge ||
    !/^[a-f0-9]{64}$/.test(challenge.challenge) ||
    message.expiresAt !== challenge.expiresAt ||
    !Number.isSafeInteger(challenge.expiresAt) ||
    challenge.expiresAt <= Date.now() ||
    challenge.expiresAt > Date.now() + 130_000
  )
    throw new NotificationWalletAuthError(
      "Wallet challenge does not match this request",
    );
  if (activeSigner !== signer)
    throw new NotificationWalletAuthError("Wallet changed before signing");
  let signature: string;
  try {
    signature = await signer.signMessage(challenge.message);
  } catch {
    throw new NotificationWalletAuthError(
      "Wallet signature was rejected or unavailable",
    );
  }
  if (activeSigner !== signer || !/^[A-Za-z0-9+/]{86}==$/.test(signature))
    throw new NotificationWalletAuthError(
      "Wallet changed or returned an invalid signature",
    );
  return {
    "X-Wallet-Public-Key": signer.publicKey,
    "X-Wallet-Challenge": challenge.challenge,
    "X-Wallet-Signature": signature,
  };
}
