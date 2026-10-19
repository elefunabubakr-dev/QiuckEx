import { Controller, Get, Post, Body, Query, UseInterceptors, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { FiatRampsService } from './fiat-ramps.service';
import {
  IdempotencyInterceptor,
  IDEMPOTENCY_KEY_HEADER,
} from '../common/idempotency/idempotency.interceptor';
import { RateLimitTier } from '../auth/decorators/rate-limit-group.decorator';
import { AnchorWebhookGuard } from './guards/anchor-webhook.guard';

@ApiTags('fiat-ramps')
@ApiHeader({
  name: IDEMPOTENCY_KEY_HEADER,
  description:
    'Optional. Supply a unique key to make deposit/withdraw mutations idempotent: retries with the same key and body return the original response; reuse with a different body is rejected.',
  required: false,
})
@UseInterceptors(IdempotencyInterceptor)
@Controller('fiat-ramps')
export class FiatRampsController {
  constructor(private readonly fiatRampsService: FiatRampsService) {}

  @Get('anchors')
  @RateLimitTier("search")
  @ApiOperation({ summary: 'Fetch available anchors based on user location/asset' })
  @ApiResponse({ status: 200, description: 'List of available anchors' })
  async getAvailableAnchors(@Query('assetCode') assetCode: string, @Query('country') country: string) {
    return this.fiatRampsService.getAvailableAnchors(assetCode, country);
  }

  @Post('deposit')
  @RateLimitTier("mutation")
  @ApiOperation({ summary: 'Initiate SEP-24 hosted deposit flow' })
  @ApiResponse({ status: 201, description: 'Deposit flow initiated' })
  async initiateDeposit(@Body() depositDto: { assetCode: string; amount: number; userAccount: string; anchorDomain: string }) {
    return this.fiatRampsService.initiateDeposit(depositDto);
  }

  @Post('withdraw')
  @RateLimitTier("mutation")
  @ApiOperation({ summary: 'Initiate SEP-24 hosted withdrawal flow' })
  @ApiResponse({ status: 201, description: 'Withdrawal flow initiated' })
  async initiateWithdrawal(@Body() withdrawalDto: { assetCode: string; amount: number; userAccount: string; anchorDomain: string }) {
    return this.fiatRampsService.initiateWithdrawal(withdrawalDto);
  }

  @Post('kyc/callback')
  @UseGuards(AnchorWebhookGuard)
  @RateLimitTier("mutation")
  @ApiOperation({ summary: 'Handle KYC redirects and updates' })
  @ApiHeader({
    name: 'X-Anchor-Signature',
    description: 'HMAC-SHA256 signature of the payload (e.g. sha256=<hex>)',
    required: false,
  })
  @ApiHeader({
    name: 'X-Anchor-Secret',
    description: 'Shared secret issued to the anchor',
    required: false,
  })
  @ApiResponse({ status: 200, description: 'Callback acknowledged' })
  @ApiResponse({ status: 401, description: 'Missing or invalid webhook signature/secret' })
  async handleKycCallback(@Body() callbackData: unknown) {
    return this.fiatRampsService.handleKycCallback(callbackData);
  }

  @Post('transaction/status')
  @UseGuards(AnchorWebhookGuard)
  @RateLimitTier("mutation")
  @ApiOperation({ summary: 'Securely handle transaction status updates' })
  @ApiHeader({
    name: 'X-Anchor-Signature',
    description: 'HMAC-SHA256 signature of the payload (e.g. sha256=<hex>)',
    required: false,
  })
  @ApiHeader({
    name: 'X-Anchor-Secret',
    description: 'Shared secret issued to the anchor',
    required: false,
  })
  @ApiResponse({ status: 200, description: 'Status update acknowledged' })
  @ApiResponse({ status: 401, description: 'Missing or invalid webhook signature/secret' })
  async updateTransactionStatus(@Body() statusData: unknown) {
    return this.fiatRampsService.updateTransactionStatus(statusData);
  }
}
