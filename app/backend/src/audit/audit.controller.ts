import { Controller, Get, Query, Res, Delete, UseGuards } from '@nestjs/common';
import { AuditService } from './audit.service';
import { QueryAuditLogsDto } from './audit.model';
import { Response } from 'express';
import { RateLimitTier } from '../auth/decorators/rate-limit-group.decorator';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { RequireScopes } from '../auth/decorators/require-scopes.decorator';

@Controller('admin/audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @UseGuards(ApiKeyGuard)
  @RequireScopes('admin')
  @RateLimitTier("public-read")
  queryLogs(@Query() query: QueryAuditLogsDto) {
    return this.auditService.query(query);
  }

  @Get('export')
  @UseGuards(ApiKeyGuard)
  @RequireScopes('admin')
  @RateLimitTier("export")
  async exportCsv(@Res() res: Response) {
    const csv = await this.auditService.exportCsv();
    res.header('Content-Type', 'text/csv');
    res.attachment('audit-logs.csv');
    return res.send(csv);
  }

  @Delete('retention')
  @UseGuards(ApiKeyGuard)
  @RequireScopes('admin')
  @RateLimitTier("mutation")
  applyRetentionStrategy() {
    return this.auditService.applyRetention(90);
  }
}
