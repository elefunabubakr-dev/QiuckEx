import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { Keypair } from "@stellar/stellar-sdk";
import {
  canonicalJson,
  WalletRequestAuthService,
} from "../wallet-request-auth.service";

const wallet = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3));
const publicKey = wallet.publicKey();
const path = `/notifications/preferences/${publicKey}`;
describe("WalletRequestAuthService", () => {
  it("canonicalizes nested key order but preserves array order", () => {
    expect(canonicalJson({ z: [{ b: 2, a: 1 }], a: true })).toBe(
      canonicalJson({ a: true, z: [{ a: 1, b: 2 }] }),
    );
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });
  it("accepts reordered JSON fields without permitting changed values", () => {
    const proofs = new WalletRequestAuthService();
    const challenge = proofs.issue(publicKey, "PUT", path, {
      channel: "push",
      enabled: true,
    });
    expect(() =>
      proofs.authorize({
        publicKey,
        targetPublicKey: publicKey,
        method: "PUT",
        path,
        challenge: challenge.challenge,
        signature: wallet
          .sign(Buffer.from(challenge.message))
          .toString("base64"),
        body: { enabled: true, channel: "push" },
      }),
    ).not.toThrow();
  });
  it("does not accept a challenge from another server instance or restart", () => {
    const challenge = new WalletRequestAuthService().issue(
      publicKey,
      "GET",
      path,
      null,
    );
    expect(() =>
      new WalletRequestAuthService().authorize({
        publicKey,
        targetPublicKey: publicKey,
        method: "GET",
        path,
        body: null,
        challenge: challenge.challenge,
        signature: wallet
          .sign(Buffer.from(challenge.message))
          .toString("base64"),
      }),
    ).toThrow(UnauthorizedException);
  });
  it("rejects oversized bodies and invalid wallet addresses", () => {
    const proofs = new WalletRequestAuthService();
    expect(() => proofs.issue("invalid", "GET", path, null)).toThrow(
      BadRequestException,
    );
    expect(() =>
      proofs.issue(publicKey, "PUT", path, { data: "x".repeat(8193) }),
    ).toThrow(BadRequestException);
  });
});
