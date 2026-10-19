import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { randomBytes } from "crypto";
import { LRUCache } from "lru-cache";

export function canonicalJson(value: unknown): string {
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

interface Challenge {
  message: string;
  publicKey: string;
  method: string;
  path: string;
  body: string;
  expiresAt: number;
}

/** Single-use, request-bound wallet proof. No secrets or signed transactions. */
@Injectable()
export class WalletRequestAuthService {
  private readonly challenges = new LRUCache<string, Challenge>({
    max: 1000,
    ttl: 120_000,
  });

  issue(publicKey: string, method: string, path: string, body: unknown) {
    if (!StrKey.isValidEd25519PublicKey(publicKey))
      throw new BadRequestException("Invalid Stellar public key");
    const serialized = canonicalJson(body);
    if (Buffer.byteLength(serialized, "utf8") > 8192)
      throw new BadRequestException("Wallet proof payload is too large");
    const nonce = randomBytes(32).toString("hex");
    const expiresAt = Date.now() + 120_000;
    const message = canonicalJson({
      domain: "QuickEx wallet request v1",
      publicKey,
      method,
      path,
      body: JSON.parse(serialized),
      nonce,
      expiresAt,
    });
    this.challenges.set(nonce, {
      message,
      publicKey,
      method,
      path,
      body: serialized,
      expiresAt,
    });
    return { challenge: nonce, message, expiresAt };
  }

  authorize(args: {
    publicKey: string;
    targetPublicKey: string;
    challenge: string;
    signature: string;
    method: string;
    path: string;
    body: unknown;
  }): void {
    const challenge = this.challenges.get(args.challenge);
    const invalid = () =>
      new UnauthorizedException({
        code: "INVALID_WALLET_PROOF",
        message: "A fresh, valid wallet proof is required",
      });
    if (
      !challenge ||
      challenge.expiresAt <= Date.now() ||
      !StrKey.isValidEd25519PublicKey(args.publicKey) ||
      !/^[A-Za-z0-9+/]{86}==$/.test(args.signature)
    )
      throw invalid();
    try {
      if (
        !Keypair.fromPublicKey(args.publicKey).verify(
          Buffer.from(challenge.message, "utf8"),
          Buffer.from(args.signature, "base64"),
        )
      )
        throw invalid();
    } catch {
      throw invalid();
    }
    if (
      args.publicKey !== args.targetPublicKey ||
      args.publicKey !== challenge.publicKey
    )
      throw new ForbiddenException({
        code: "WALLET_MISMATCH",
        message: "Wallet proof does not control this wallet",
      });
    if (
      challenge.method !== args.method ||
      challenge.path !== args.path ||
      challenge.body !== canonicalJson(args.body)
    )
      throw invalid();
    // No await between checking and deletion: only one request can consume it.
    this.challenges.delete(args.challenge);
  }
}
