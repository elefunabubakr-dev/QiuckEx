import {
  ArgumentsHost,
  ExecutionContext,
  INestApplication,
  InternalServerErrorException,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { generateKeyPairSync } from "crypto";
import { of } from "rxjs";
import * as request from "supertest";

import { ApiKeysService } from "../api-keys/api-keys.service";
import { AuditService } from "../audit/audit.service";
import { ApiKeyGuard } from "../auth/guards/api-key.guard";
import { LoggingInterceptor } from "../common/interceptors/logging.interceptor";
import { AppConfigService } from "../config";
import { CrashCaptureFilter } from "../crash-reporting/crash-capture.filter";
import { CrashReportingService } from "../crash-reporting/crash-reporting.service";
import { currentLogScope } from "../crash-reporting/log-capture.context";
import { LogCaptureInterceptor } from "../crash-reporting/log-capture.interceptor";
import { LogCaptureMiddleware } from "../crash-reporting/log-capture.middleware";
import { RedactionService } from "../crash-reporting/redaction.service";
import { SentryExceptionFilter } from "../sentry/sentry.filter";
import { SentryService } from "../sentry/sentry.service";
import { SupabaseService } from "../supabase/supabase.service";
import { PrivacyController } from "./privacy.controller";
import {
  EXCLUDE_PRIVACY_TELEMETRY_KEY,
  PRIVACY_DEBUG_DISABLED_IN_PRODUCTION_CODE,
  PRIVACY_DEBUG_FLAG_REQUIRED_CODE,
  PRIVACY_DEBUG_WARNING,
  PrivacyDebugGuard,
  isPrivacyDebugPath,
} from "./privacy-debug.guard";
import { PrivacyService } from "./privacy.service";

describe("PrivacyController & Non-Custodial Security Controls (#1215)", () => {
  let app: INestApplication;

  const mockConfig = {
    nodeEnv: "development" as "development" | "production" | "test",
    environmentName: "development" as
      | "development"
      | "staging"
      | "production"
      | "test"
      | undefined,
    isProduction: false,
    privacyDebugEndpointsEnabled: false,
  };

  const mockApiKeysService = {
    validateKey: jest.fn(),
    isOverQuota: jest.fn().mockReturnValue(false),
  };

  function validKeyWith(scopes: string[]): void {
    mockApiKeysService.validateKey.mockResolvedValue({
      record: {
        id: "key-1",
        name: "test-key",
        scopes,
        request_count: 0,
        monthly_quota: 1000,
        organization_id: null,
      },
      hasScope: (scope: string) => scopes.includes(scope),
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PrivacyController],
      providers: [
        PrivacyService,
        PrivacyDebugGuard,
        ApiKeyGuard,
        { provide: AppConfigService, useValue: mockConfig },
        { provide: ApiKeysService, useValue: mockApiKeysService },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig.nodeEnv = "development";
    mockConfig.environmentName = "development";
    mockConfig.isProduction = false;
    mockConfig.privacyDebugEndpointsEnabled = false;
    mockApiKeysService.isOverQuota.mockReturnValue(false);
    validKeyWith(["admin"]);
  });

  describe("Guard and telemetry metadata declarations", () => {
    it("leaves POST /privacy/encrypt-recipient accessible for public-key-only stealth encryption", () => {
      const guards = Reflect.getMetadata(
        "__guards__",
        PrivacyController.prototype.encryptRecipient,
      );
      expect(guards).toBeUndefined();
    });

    it("gates deriveSharedSecret and decryptRecipient with PrivacyDebugGuard, ApiKeyGuard, and admin scope", () => {
      const deriveGuards = Reflect.getMetadata(
        "__guards__",
        PrivacyController.prototype.deriveSharedSecret,
      );
      const decryptGuards = Reflect.getMetadata(
        "__guards__",
        PrivacyController.prototype.decryptRecipient,
      );

      expect(deriveGuards).toEqual([PrivacyDebugGuard, ApiKeyGuard]);
      expect(decryptGuards).toEqual([PrivacyDebugGuard, ApiKeyGuard]);

      expect(
        Reflect.getMetadata(
          "requiredScopes",
          PrivacyController.prototype.deriveSharedSecret,
        ),
      ).toEqual(["admin"]);
      expect(
        Reflect.getMetadata(
          "requiredScopes",
          PrivacyController.prototype.decryptRecipient,
        ),
      ).toEqual(["admin"]);
    });

    it("marks deriveSharedSecret and decryptRecipient with @ExcludePrivacyTelemetry()", () => {
      expect(
        Reflect.getMetadata(
          EXCLUDE_PRIVACY_TELEMETRY_KEY,
          PrivacyController.prototype.deriveSharedSecret,
        ),
      ).toBe(true);
      expect(
        Reflect.getMetadata(
          EXCLUDE_PRIVACY_TELEMETRY_KEY,
          PrivacyController.prototype.decryptRecipient,
        ),
      ).toBe(true);
    });
  });

  describe("Production stealth flow (public-key only)", () => {
    it("encrypts recipient metadata using only recipientViewPublicKeyPem in production", async () => {
      mockConfig.nodeEnv = "production";
      mockConfig.environmentName = "production";
      mockConfig.isProduction = true;

      const { publicKey } = generateKeyPairSync("x25519");
      const recipientViewPublicKeyPem = publicKey
        .export({ format: "pem", type: "spki" })
        .toString();

      const res = await request(app.getHttpServer())
        .post("/privacy/encrypt-recipient")
        .send({
          recipientAddress:
            "GDSTESTRECIPIENTADDRESS00000000000000000000000000000000000",
          recipientViewPublicKeyPem,
        });

      expect(res.status).toBe(201);
      expect(res.body.algorithm).toBe("aes-256-gcm");
      expect(res.body.ephPublicKeyPem).toContain("BEGIN PUBLIC KEY");
      expect(res.body.ciphertextBase64).toBeDefined();
    });
  });

  describe("Debug endpoints: non-production + explicit flag + admin guard enforcement", () => {
    const alice = generateKeyPairSync("x25519");
    const bob = generateKeyPairSync("x25519");
    const alicePrivatePem = alice.privateKey
      .export({ format: "pem", type: "pkcs8" })
      .toString();
    const bobPublicPem = bob.publicKey
      .export({ format: "pem", type: "spki" })
      .toString();

    it("blocks POST /privacy/derive-shared-secret in production even with flag and admin key", async () => {
      mockConfig.nodeEnv = "production";
      mockConfig.environmentName = "production";
      mockConfig.isProduction = true;
      mockConfig.privacyDebugEndpointsEnabled = true;

      const res = await request(app.getHttpServer())
        .post("/privacy/derive-shared-secret")
        .set("x-api-key", "admin-key")
        .send({
          privateKeyPem: alicePrivatePem,
          publicKeyPem: bobPublicPem,
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe(PRIVACY_DEBUG_DISABLED_IN_PRODUCTION_CODE);
    });

    it("blocks POST /privacy/decrypt-recipient in production even with flag and admin key", async () => {
      mockConfig.nodeEnv = "production";
      mockConfig.environmentName = "production";
      mockConfig.isProduction = true;
      mockConfig.privacyDebugEndpointsEnabled = true;

      const res = await request(app.getHttpServer())
        .post("/privacy/decrypt-recipient")
        .set("x-api-key", "admin-key")
        .send({
          envelope: {
            ephPublicKeyPem: bobPublicPem,
            ivBase64: "aXY=",
            authTagBase64: "dGFn",
            ciphertextBase64: "Y3Q=",
            algorithm: "aes-256-gcm",
          },
          recipientViewPrivateKeyPem: alicePrivatePem,
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe(PRIVACY_DEBUG_DISABLED_IN_PRODUCTION_CODE);
    });

    it("blocks debug endpoints in development when PRIVACY_DEBUG_ENDPOINTS_ENABLED is false (default)", async () => {
      mockConfig.privacyDebugEndpointsEnabled = false;

      const deriveRes = await request(app.getHttpServer())
        .post("/privacy/derive-shared-secret")
        .set("x-api-key", "admin-key")
        .send({
          privateKeyPem: alicePrivatePem,
          publicKeyPem: bobPublicPem,
        });

      expect(deriveRes.status).toBe(403);
      expect(deriveRes.body.code).toBe(PRIVACY_DEBUG_FLAG_REQUIRED_CODE);
    });

    it("rejects anonymous callers (401 MISSING_API_KEY) when flag is enabled in dev", async () => {
      mockConfig.privacyDebugEndpointsEnabled = true;

      const res = await request(app.getHttpServer())
        .post("/privacy/derive-shared-secret")
        .send({
          privateKeyPem: alicePrivatePem,
          publicKeyPem: bobPublicPem,
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe("MISSING_API_KEY");
    });

    it("rejects non-admin API keys (403 INSUFFICIENT_SCOPE) when flag is enabled in dev", async () => {
      mockConfig.privacyDebugEndpointsEnabled = true;
      validKeyWith(["links:read"]);

      const res = await request(app.getHttpServer())
        .post("/privacy/derive-shared-secret")
        .set("x-api-key", "member-key")
        .send({
          privateKeyPem: alicePrivatePem,
          publicKeyPem: bobPublicPem,
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("INSUFFICIENT_SCOPE");
    });

    it("permits admin caller in local/dev when PRIVACY_DEBUG_ENDPOINTS_ENABLED=true and returns explicit warning", async () => {
      mockConfig.privacyDebugEndpointsEnabled = true;
      validKeyWith(["admin"]);

      const deriveRes = await request(app.getHttpServer())
        .post("/privacy/derive-shared-secret")
        .set("x-api-key", "admin-key")
        .send({
          privateKeyPem: alicePrivatePem,
          publicKeyPem: bobPublicPem,
        });

      expect(deriveRes.status).toBe(201);
      expect(deriveRes.body.sharedSecretHex).toMatch(/^[0-9a-f]{64}$/);
      expect(deriveRes.body.warning).toBe(PRIVACY_DEBUG_WARNING);
      expect(deriveRes.headers["x-privacy-debug-warning"]).toBe(
        PRIVACY_DEBUG_WARNING,
      );
      expect(deriveRes.headers["cache-control"]).toBe("no-store");

      const recipientAddress =
        "GDSTESTRECIPIENTADDRESS00000000000000000000000000000000000";
      const encryptRes = await request(app.getHttpServer())
        .post("/privacy/encrypt-recipient")
        .send({
          recipientAddress,
          recipientViewPublicKeyPem: alice.publicKey
            .export({ format: "pem", type: "spki" })
            .toString(),
        });

      const decryptRes = await request(app.getHttpServer())
        .post("/privacy/decrypt-recipient")
        .set("x-api-key", "admin-key")
        .send({
          envelope: encryptRes.body,
          recipientViewPrivateKeyPem: alicePrivatePem,
        });

      expect(decryptRes.status).toBe(201);
      expect(decryptRes.body.recipientAddress).toBe(recipientAddress);
      expect(decryptRes.body.warning).toBe(PRIVACY_DEBUG_WARNING);
      expect(decryptRes.headers["x-privacy-debug-warning"]).toBe(
        PRIVACY_DEBUG_WARNING,
      );
    });
  });

  describe("Exclusion from crash-reporting, audit logs, Sentry, and request logging", () => {
    it("identifies stealth privacy debug paths accurately", () => {
      expect(isPrivacyDebugPath("/privacy/derive-shared-secret")).toBe(true);
      expect(isPrivacyDebugPath("/privacy/decrypt-recipient?foo=1")).toBe(true);
      expect(isPrivacyDebugPath("/privacy/encrypt-recipient")).toBe(false);
    });

    it("LogCaptureMiddleware does not open a crash-reporting log scope for debug privacy routes", () => {
      const middleware = new LogCaptureMiddleware();
      let capturedScope: unknown = "unset";

      middleware.use(
        {
          originalUrl: "/privacy/derive-shared-secret",
          url: "/privacy/derive-shared-secret",
          path: "/privacy/derive-shared-secret",
        } as never,
        {} as never,
        () => {
          capturedScope = currentLogScope();
        },
      );

      expect(capturedScope).toBeUndefined();
    });

    it("LogCaptureInterceptor skips log capture for debug privacy endpoints", () => {
      const mockCrashService = {
        captureLogLine: jest.fn(),
      } as unknown as CrashReportingService;
      const interceptor = new LogCaptureInterceptor(mockCrashService);

      const context = {
        getHandler: () => PrivacyController.prototype.deriveSharedSecret,
        getClass: () => PrivacyController,
        switchToHttp: () => ({
          getRequest: () => ({
            method: "POST",
            url: "/privacy/derive-shared-secret",
            originalUrl: "/privacy/derive-shared-secret",
          }),
        }),
      } as unknown as ExecutionContext;

      interceptor
        .intercept(context, { handle: () => of({ ok: true }) })
        .subscribe();

      expect(mockCrashService.captureLogLine).not.toHaveBeenCalled();
    });

    it("CrashCaptureFilter skips crash report capture for debug privacy endpoints", async () => {
      const mockCrashService = {
        captureCrash: jest.fn().mockResolvedValue("report-1"),
      } as unknown as CrashReportingService;
      const filter = new CrashCaptureFilter(mockCrashService);

      const jsonMock = jest.fn();
      const statusMock = jest.fn().mockReturnValue({ json: jsonMock });
      const host = {
        switchToHttp: () => ({
          getRequest: () => ({
            method: "POST",
            url: "/privacy/decrypt-recipient",
            originalUrl: "/privacy/decrypt-recipient",
            headers: {},
            user: { id: "user-1" },
          }),
          getResponse: () => ({
            status: statusMock,
          }),
        }),
      } as unknown as ArgumentsHost;

      await filter.catch(new InternalServerErrorException("boom"), host);

      expect(mockCrashService.captureCrash).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(500);
    });

    it("RedactionService redacts PEM private keys and privateKeyPem fields", () => {
      const redaction = new RedactionService();
      const { privateKey } = generateKeyPairSync("x25519");
      const pem = privateKey
        .export({ format: "pem", type: "pkcs8" })
        .toString();

      expect(redaction.redact(`Leaked key: ${pem}`)).toBe(
        "Leaked key: [REDACTED_PRIVATE_KEY]\n",
      );

      const redactedObj = redaction.redactObject({
        privateKeyPem: pem,
        recipientViewPrivateKeyPem: pem,
        safeField: "ok",
      }) as Record<string, unknown>;

      expect(redactedObj.privateKeyPem).toBe("[REDACTED]");
      expect(redactedObj.recipientViewPrivateKeyPem).toBe("[REDACTED]");
      expect(redactedObj.safeField).toBe("ok");
    });

    it("AuditService skips debug privacy derive/decrypt events and redacts any private key metadata", async () => {
      const insertMock = jest.fn().mockResolvedValue({ error: null });
      const mockSupabase = {
        getClient: () => ({
          from: () => ({ insert: insertMock }),
        }),
      } as unknown as SupabaseService;

      const auditService = new AuditService(mockSupabase);

      await auditService.log(
        "admin",
        "privacy.derive-shared-secret",
        "/privacy/derive-shared-secret",
        { privateKeyPem: "secret" },
      );
      await auditService.log(
        "admin",
        "privacy.decrypt-recipient",
        "/privacy/decrypt-recipient",
        { recipientViewPrivateKeyPem: "secret" },
      );

      expect(insertMock).not.toHaveBeenCalled();

      const { privateKey } = generateKeyPairSync("x25519");
      const pem = privateKey
        .export({ format: "pem", type: "pkcs8" })
        .toString();

      await auditService.log("admin", "privacy.erasure.completed", "user-1", {
        privateKeyPem: pem,
        recipientViewPrivateKeyPem: pem,
        rawPem: pem,
        preserved: "yes",
      });

      expect(insertMock).toHaveBeenCalledTimes(1);
      const persisted = insertMock.mock.calls[0][0];
      expect(persisted.metadata).toEqual({
        privateKeyPem: "[REDACTED_PRIVATE_KEY]",
        recipientViewPrivateKeyPem: "[REDACTED_PRIVATE_KEY]",
        rawPem: "[REDACTED_PRIVATE_KEY]",
        preserved: "yes",
      });
    });

    it("LoggingInterceptor omits request body for debug privacy endpoints and redacts privateKeyPem", () => {
      const interceptor = new LoggingInterceptor();
      const logSpy = jest
        .spyOn((interceptor as unknown as { logger: { log: jest.Mock } }).logger, "log")
        .mockImplementation(() => undefined);

      const context = {
        getHandler: () => PrivacyController.prototype.deriveSharedSecret,
        getClass: () => PrivacyController,
        switchToHttp: () => ({
          getRequest: () => ({
            method: "POST",
            url: "/privacy/derive-shared-secret",
            originalUrl: "/privacy/derive-shared-secret",
            body: { privateKeyPem: "SENSITIVE_KEY_MATERIAL" },
            route: { path: "/privacy/derive-shared-secret" },
          }),
        }),
      } as unknown as ExecutionContext;

      interceptor
        .intercept(context, { handle: () => of({ ok: true }) })
        .subscribe();

      expect(logSpy).toHaveBeenCalledTimes(1);
      const loggedPayload = JSON.parse(logSpy.mock.calls[0][0]);
      expect(loggedPayload.body).toBeUndefined();
      expect(logSpy.mock.calls[0][0]).not.toContain("SENSITIVE_KEY_MATERIAL");
    });

    it("SentryExceptionFilter skips reporting exceptions on debug privacy endpoints", () => {
      const mockSentry = {
        captureException: jest.fn(),
      } as unknown as SentryService;
      const filter = new SentryExceptionFilter(
        mockSentry,
        mockConfig as unknown as AppConfigService,
      );

      const host = {
        switchToHttp: () => ({
          getRequest: () => ({
            method: "POST",
            url: "/privacy/derive-shared-secret",
            originalUrl: "/privacy/derive-shared-secret",
            headers: {},
            body: { privateKeyPem: "SENSITIVE" },
          }),
        }),
      } as unknown as ArgumentsHost;

      expect(() =>
        filter.catch(new InternalServerErrorException("err"), host),
      ).toThrow(InternalServerErrorException);
      expect(mockSentry.captureException).not.toHaveBeenCalled();
    });
  });
});
