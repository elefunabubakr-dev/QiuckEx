import {
  BadRequestException,
  INestApplication,
  ValidationPipe,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as request from "supertest";
import { ApiKeyGuard } from "../src/auth/guards/api-key.guard";
import { CustomThrottlerGuard } from "../src/auth/guards/custom-throttler.guard";
import { IdempotencyModule } from "../src/common/idempotency/idempotency.module";
import { CrashReportingController } from "../src/crash-reporting/crash-reporting.controller";
import { CrashReportingService } from "../src/crash-reporting/crash-reporting.service";
import { CrashReportingRepository } from "../src/crash-reporting/crash-reporting.repository";
import { RedactionService } from "../src/crash-reporting/redaction.service";
import { mapValidationErrors } from "../src/common/utils/validation-error.mapper";

describe("CrashReportingModule wiring", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [IdempotencyModule],
      controllers: [CrashReportingController],
      providers: [
        CrashReportingService,
        RedactionService,
        {
          provide: CrashReportingRepository,
          useValue: {
            createCrashReport: jest.fn().mockResolvedValue("test-report-id"),
            getCrashReportsByUser: jest.fn(),
            getAllCrashReports: jest.fn(),
            getUserSettings: jest.fn(),
            updateUserSettings: jest.fn(),
            deleteOldReports: jest.fn(),
          },
        },
      ],
    })
      .overrideGuard(ApiKeyGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideGuard(CustomThrottlerGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    app = moduleRef.createNestApplication();

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: false,
        transform: true,
        exceptionFactory: (errors) => {
          const mapped = mapValidationErrors(errors);

          return new BadRequestException({
            code: "VALIDATION_ERROR",
            message: mapped.message,
            fields: mapped.fields,
          });
        },
      }),
    );

    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it("serves POST /crash-reporting/submit on the booted app", async () => {
    const response = await request(app.getHttpServer())
      .post("/crash-reporting/submit")
      .send({
        userMessage: "Test crash report",
        error: { name: "TestError", message: "test message", stack: "Error: test" },
        environment: "test",
        route: "/test",
        reproductionSteps: "test steps",
      })
      .expect(201);

    expect(response.body.id).toBeDefined();
  });
});