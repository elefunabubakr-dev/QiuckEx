import { Controller, Get, Query, UseGuards } from "@nestjs/common";

import { ApiKeyGuard } from "../auth/guards/api-key.guard";
import { RequireScopes } from "../auth/decorators/require-scopes.decorator";
import { OperationsService } from "./operations.service";
import { RateLimitTier } from "../auth/decorators/rate-limit-group.decorator";

@Controller("admin/operations")
@UseGuards(ApiKeyGuard)
export class OperationsController {
  constructor(
    private readonly operationsService: OperationsService,
  ) {}

  @Get("indexer")
  @RateLimitTier("public-read")
  @RequireScopes("admin")
  async getIndexerStatus() {
    return this.operationsService.getIndexerStatus();
  }

  @Get("ingestion")
  @RateLimitTier("public-read")
  @RequireScopes("admin")
  async getIngestionStatus() {
    return this.operationsService.getIngestionStatus();
  }

  @Get("webhooks")
  @RateLimitTier("public-read")
  @RequireScopes("admin")
  async getWebhookBacklog() {
    return this.operationsService.getWebhookBacklog();
  }

  @Get("errors")
  @RateLimitTier("public-read")
  @RequireScopes("admin")
  async getRecentErrors(
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.operationsService.getRecentErrors(
      Number(page ?? 1),
      Number(limit ?? 50),
    );
  }
}