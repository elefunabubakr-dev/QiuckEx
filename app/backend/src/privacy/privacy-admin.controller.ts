import { Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Request } from "express";

import { RequireScopes } from "../auth/decorators/require-scopes.decorator";
import { ApiKeyGuard } from "../auth/guards/api-key.guard";
import {
  ErasureSubject,
  PrivacyRetentionService,
} from "./privacy-retention.service";
import { RateLimitTier } from "../auth/decorators/rate-limit-group.decorator";

class ErasureRequestDto implements ErasureSubject {
  publicKey?: string;
  username?: string;
  userId?: string;
}

@ApiTags("Admin - Privacy")
@Controller("admin/privacy")
@UseGuards(ApiKeyGuard)
@RequireScopes("admin")
@ApiBearerAuth()
export class PrivacyAdminController {
  constructor(private readonly retentionService: PrivacyRetentionService) {}

  @Post("retention/run")
  @RateLimitTier("mutation")
  @ApiOperation({
    summary: "Run the privacy retention sweeper immediately",
  })
  enforceRetentionNow() {
    return this.retentionService.enforceRetention();
  }

  @Post("erasure")
  @RateLimitTier("mutation")
  @ApiOperation({
    summary: "Service a right-to-erasure request across declared data stores",
  })
  eraseSubject(@Body() body: ErasureRequestDto, @Req() req: Request) {
    const actor =
      req.organizationContext?.organizationId ?? req.apiKey?.id ?? "admin";
    return this.retentionService.eraseSubject(body, actor);
  }
}

