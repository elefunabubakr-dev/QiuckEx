import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { buildCorsOptions } from "../../config/cors.config";
import { Keypair } from "@stellar/stellar-sdk";
import request = require("supertest");
import { WalletRequestAuthService } from "../../auth/wallet-request-auth.service";
import { WalletRequestGuard } from "../../auth/guards/wallet-request.guard";
import { NotificationPreferencesController } from "../notification-preferences.controller";
import { NotificationPreferencesRepository } from "../notification-preferences.repository";

const owner = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1));
const attacker = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2));
const route = (key = owner.publicKey()) => `/notifications/preferences/${key}`;
const body = {
  channel: "webhook",
  webhookUrl: "https://example.com/events",
  webhookSecret: "owner-secret",
  enabled: true,
};

describe("notification preference ownership (HTTP)", () => {
  let app: INestApplication;
  const pref = {
    id: "pref-1",
    publicKey: owner.publicKey(),
    ...body,
    events: null,
    minAmountStroops: 0n,
  };
  const repo = {
    getEnabledPreferences: jest.fn().mockResolvedValue([pref]),
    upsertPreference: jest.fn().mockResolvedValue(pref),
    disableChannel: jest.fn().mockResolvedValue(undefined),
  };
  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [NotificationPreferencesController],
      providers: [
        WalletRequestAuthService,
        WalletRequestGuard,
        { provide: NotificationPreferencesRepository, useValue: repo },
      ],
    }).compile();
    app = module.createNestApplication();
    app.enableCors(
      buildCorsOptions({
        nodeEnv: "production",
        allowedOrigins: ["https://app.example.com"],
      }),
    );
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  async function proof(
    method: string,
    keypair = owner,
    payload?: Record<string, unknown>,
    channel?: string,
    target = keypair.publicKey(),
  ) {
    const result = await request(app.getHttpServer())
      .post(`${route(target)}/challenge`)
      .send({ method, body: payload, channel })
      .expect(200);
    return {
      "X-Wallet-Public-Key": keypair.publicKey(),
      "X-Wallet-Challenge": result.body.challenge,
      "X-Wallet-Signature": keypair
        .sign(Buffer.from(result.body.message, "utf8"))
        .toString("base64"),
    };
  }
  it("allows production browser preflights for proof headers", async () => {
    const response = await request(app.getHttpServer())
      .options(route())
      .set("Origin", "https://app.example.com")
      .set("Access-Control-Request-Method", "PUT")
      .set(
        "Access-Control-Request-Headers",
        "x-wallet-public-key,x-wallet-challenge,x-wallet-signature,x-device-installation-id",
      )
      .expect(204);
    const allowed =
      response.headers["access-control-allow-headers"].toLowerCase();
    for (const header of [
      "x-wallet-public-key",
      "x-wallet-challenge",
      "x-wallet-signature",
      "x-device-installation-id",
    ])
      expect(allowed).toContain(header);
  });
  it("allows an owner to read sensitive fields, update preferences and disable their channel", async () => {
    const get = await request(app.getHttpServer())
      .get(route())
      .set(await proof("GET"))
      .expect(200);
    expect(get.body[0].webhookSecret).toBe("owner-secret");
    await request(app.getHttpServer())
      .put(route())
      .set(await proof("PUT", owner, body))
      .send(body)
      .expect(200);
    await request(app.getHttpServer())
      .delete(`${route()}/webhook`)
      .set(await proof("DELETE", owner, undefined, "webhook"))
      .expect(204);
    expect(repo.upsertPreference).toHaveBeenCalledWith(
      owner.publicKey(),
      "webhook",
      expect.objectContaining({ webhookSecret: "owner-secret" }),
    );
    expect(repo.disableChannel).toHaveBeenCalledWith(
      owner.publicKey(),
      "webhook",
    );
  });
  it.each(["GET", "PUT", "DELETE"])(
    "rejects unauthenticated %s before repository access",
    async (method) => {
      if (method === "GET")
        await request(app.getHttpServer()).get(route()).expect(401);
      if (method === "PUT")
        await request(app.getHttpServer()).put(route()).send(body).expect(401);
      if (method === "DELETE")
        await request(app.getHttpServer())
          .delete(`${route()}/webhook`)
          .expect(401);
      expect(repo.getEnabledPreferences).not.toHaveBeenCalled();
      expect(repo.upsertPreference).not.toHaveBeenCalled();
      expect(repo.disableChannel).not.toHaveBeenCalled();
    },
  );
  it.each(["GET", "PUT", "DELETE"])(
    "rejects another wallet with a valid signature for %s",
    async (method) => {
      const headers = await proof(
        method,
        attacker,
        method === "PUT" ? body : undefined,
        method === "DELETE" ? "webhook" : undefined,
        owner.publicKey(),
      );
      if (method === "GET")
        await request(app.getHttpServer())
          .get(route())
          .set(headers)
          .expect(403);
      if (method === "PUT")
        await request(app.getHttpServer())
          .put(route())
          .set(headers)
          .send(body)
          .expect(403);
      if (method === "DELETE")
        await request(app.getHttpServer())
          .delete(`${route()}/webhook`)
          .set(headers)
          .expect(403);
      expect(repo.getEnabledPreferences).not.toHaveBeenCalled();
      expect(repo.upsertPreference).not.toHaveBeenCalled();
      expect(repo.disableChannel).not.toHaveBeenCalled();
    },
  );
  it("rejects a changed webhook secret without consuming the valid original request", async () => {
    const headers = await proof("PUT", owner, body);
    await request(app.getHttpServer())
      .put(route())
      .set(headers)
      .send({ ...body, webhookSecret: "attacker-secret" })
      .expect(401);
    expect(repo.upsertPreference).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .put(route())
      .set(headers)
      .send(body)
      .expect(200);
  });
  it("rejects replay and allows only one simultaneous use", async () => {
    const headers = await proof("GET");
    const results = await Promise.all([
      request(app.getHttpServer()).get(route()).set(headers),
      request(app.getHttpServer()).get(route()).set(headers),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
    await request(app.getHttpServer()).get(route()).set(headers).expect(401);
    expect(repo.getEnabledPreferences).toHaveBeenCalledTimes(1);
  });
  it("binds proofs to method and channel", async () => {
    await request(app.getHttpServer())
      .delete(`${route()}/webhook`)
      .set(await proof("GET"))
      .expect(401);
    await request(app.getHttpServer())
      .delete(`${route()}/email`)
      .set(await proof("DELETE", owner, undefined, "webhook"))
      .expect(401);
    expect(repo.disableChannel).not.toHaveBeenCalled();
  });
  it("rejects expired proofs", async () => {
    const headers = await proof("GET");
    jest.spyOn(Date, "now").mockReturnValue(Date.now() + 120_001);
    await request(app.getHttpServer()).get(route()).set(headers).expect(401);
    expect(repo.getEnabledPreferences).not.toHaveBeenCalled();
  });
  it("rejects invalid signatures and arbitrary API keys", async () => {
    const headers = await proof("GET");
    headers["X-Wallet-Signature"] = Buffer.alloc(64).toString("base64");
    await request(app.getHttpServer()).get(route()).set(headers).expect(401);
    await request(app.getHttpServer())
      .get(route())
      .set("X-API-Key", "not-wallet-proof")
      .expect(401);
    expect(repo.getEnabledPreferences).not.toHaveBeenCalled();
  });
  it("validates challenges without reading stored preferences", async () => {
    await request(app.getHttpServer())
      .post(`${route("invalid")}/challenge`)
      .send({ method: "GET" })
      .expect(400);
    for (const payload of [
      { method: "PATCH" },
      { method: "PUT" },
      { method: "DELETE" },
      { method: "GET", body: {} },
      { method: "GET", channel: "push" },
      { method: "PUT", body: { padding: "x".repeat(8193) } },
    ]) {
      await request(app.getHttpServer())
        .post(`${route()}/challenge`)
        .send(payload)
        .expect(400);
    }
    expect(repo.getEnabledPreferences).not.toHaveBeenCalled();
  });
});
