import {
  Controller,
  BadRequestException,
  Post,
  Req,
  UseGuards,
  Get,
  Put,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Request } from "express";
import { WalletRequestAuthService } from "../auth/wallet-request-auth.service";
import { WalletRequestGuard } from "../auth/guards/wallet-request.guard";
import { NotificationWalletChallengeDto } from "./dto/notification-wallet-challenge.dto";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiHeader,
} from "@nestjs/swagger";

import { NotificationPreferencesRepository } from "./notification-preferences.repository";
import {
  UpsertNotificationPreferenceDto,
  NotificationPreferenceResponseDto,
} from "./dto/notification-preferences.dto";
import type { NotificationChannel } from "./types/notification.types";
import { RateLimitTier } from "../auth/decorators/rate-limit-group.decorator";

/**
 * REST API for managing per-wallet notification preferences.
 *
 * Routes are keyed by Stellar public key (the wallet address), which serves
 * as the user identity throughout the system.
 *
 * Reads and writes require a single-use signature bound to the exact request.
 */
@ApiTags("Notifications")
@ApiHeader({
  name: "X-Wallet-Public-Key",
  description: "Signing Stellar G-address",
})
@ApiHeader({
  name: "X-Wallet-Challenge",
  description: "Single-use challenge identifier",
})
@ApiHeader({
  name: "X-Wallet-Signature",
  description: "Base64 Ed25519 signature of the challenge message",
})
@ApiResponse({
  status: 401,
  description: "Missing, invalid, expired, or replayed wallet proof",
})
@ApiResponse({
  status: 403,
  description: "Signing wallet does not own the requested preferences",
})
@Controller("notifications/preferences")
export class NotificationPreferencesController {
  private readonly logger = new Logger(NotificationPreferencesController.name);

  constructor(
    private readonly prefsRepo: NotificationPreferencesRepository,
    private readonly proofs: WalletRequestAuthService,
  ) {}

  @Post(":publicKey/challenge")
  @RateLimitTier("mutation")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Create a single-use wallet ownership challenge for a preference request",
  })
  createChallenge(
    @Param("publicKey") publicKey: string,
    @Body() dto: NotificationWalletChallengeDto,
    @Req() request: Request,
  ) {
    if (dto.method === "DELETE" && !dto.channel)
      throw new BadRequestException("DELETE requires a channel");
    if (dto.method !== "DELETE" && dto.channel)
      throw new BadRequestException("Only DELETE accepts a channel");
    if (dto.method === "PUT" && !dto.body)
      throw new BadRequestException("PUT requires the request body");
    if (dto.method !== "PUT" && dto.body)
      throw new BadRequestException("Only PUT accepts a body");
    const path =
      request.originalUrl.split("?")[0].replace(/\/challenge$/, "") +
      (dto.channel ? `/${dto.channel}` : "");
    return this.proofs.issue(
      publicKey,
      dto.method,
      path,
      dto.method === "PUT" ? dto.body : null,
    );
  }

  /**
   * GET /notifications/preferences/:publicKey
   * List all notification preferences for a wallet.
   */
  @Get(":publicKey")
  @UseGuards(WalletRequestGuard)
  @RateLimitTier("public-read")
  @ApiOperation({ summary: "List notification preferences for a wallet" })
  @ApiParam({ name: "publicKey", description: "Stellar public key (G...)" })
  @ApiResponse({ status: 200, type: [NotificationPreferenceResponseDto] })
  async listPreferences(
    @Param("publicKey") publicKey: string,
  ): Promise<NotificationPreferenceResponseDto[]> {
    // Returns both enabled and disabled; client can filter as needed
    const all = await this.prefsRepo.getEnabledPreferences(publicKey);
    return all.map(this.toResponse);
  }

  /**
   * PUT /notifications/preferences/:publicKey
   * Create or update a channel preference for a wallet.
   */
  @Put(":publicKey")
  @UseGuards(WalletRequestGuard)
  @RateLimitTier("mutation")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Create or update a notification channel preference",
  })
  @ApiParam({ name: "publicKey", description: "Stellar public key (G...)" })
  @ApiResponse({ status: 200, type: NotificationPreferenceResponseDto })
  async upsertPreference(
    @Param("publicKey") publicKey: string,
    @Body() dto: UpsertNotificationPreferenceDto,
  ): Promise<NotificationPreferenceResponseDto> {
    this.logger.log(
      `Upserting ${dto.channel} preference for ${publicKey.slice(0, 8)}...`,
    );

    const pref = await this.prefsRepo.upsertPreference(publicKey, dto.channel, {
      email: dto.email,
      pushToken: dto.pushToken,
      webhookUrl: dto.webhookUrl,
      webhookSecret: dto.webhookSecret,
      events: dto.events ?? null,
      minAmountStroops:
        dto.minAmountStroops !== undefined
          ? BigInt(dto.minAmountStroops)
          : undefined,
      enabled: dto.enabled,
    });

    return this.toResponse(pref);
  }

  /**
   * DELETE /notifications/preferences/:publicKey/:channel
   * Opt-out of a specific notification channel (soft disable).
   */
  @Delete(":publicKey/:channel")
  @UseGuards(WalletRequestGuard)
  @RateLimitTier("mutation")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Opt-out of a notification channel (soft disable)" })
  @ApiParam({ name: "publicKey", description: "Stellar public key (G...)" })
  @ApiParam({ name: "channel", enum: ["email", "push", "webhook"] })
  @ApiResponse({ status: 204, description: "Channel disabled" })
  async disableChannel(
    @Param("publicKey") publicKey: string,
    @Param("channel") channel: NotificationChannel,
  ): Promise<void> {
    this.logger.log(`Disabling ${channel} for ${publicKey.slice(0, 8)}...`);
    await this.prefsRepo.disableChannel(publicKey, channel);
  }

  // ---------------------------------------------------------------------------

  private toResponse(pref: {
    id: string;
    publicKey: string;
    channel: NotificationChannel;
    email?: string;
    pushToken?: string;
    webhookUrl?: string;
    webhookSecret?: string;
    events: string[] | null;
    minAmountStroops: bigint;
    enabled: boolean;
  }): NotificationPreferenceResponseDto {
    const dto = new NotificationPreferenceResponseDto();
    dto.id = pref.id;
    dto.publicKey = pref.publicKey;
    dto.channel = pref.channel;
    dto.email = pref.email;
    dto.pushToken = pref.pushToken;
    dto.webhookUrl = pref.webhookUrl;
    dto.webhookSecret = pref.webhookSecret;
    dto.events = pref.events as NotificationPreferenceResponseDto["events"];
    dto.minAmountStroops = pref.minAmountStroops.toString();
    dto.enabled = pref.enabled;
    return dto;
  }
}
