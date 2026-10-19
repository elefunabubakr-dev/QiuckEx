import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Put,
  Query,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";

import { RateLimitTier } from "../auth/decorators/rate-limit-group.decorator";
import {
  GetProfileQueryDto,
  ProfileResponseDto,
  UpdateProfileDto,
  toProfileResponse,
} from "../dto/profile";
import { UsernamesService } from "../usernames/usernames.service";
import {
  UsernameErrorCode,
  UsernameValidationError,
} from "../usernames/errors";

/**
 * Profile settings for the `/settings` page.
 *
 * Authorization note: this backend has no wallet authentication. `ApiKeyGuard`
 * resolves API keys for automation and never populates a wallet identity, and
 * every other per-wallet route (notification preferences,
 * `POST /username/toggle-public`) already accepts the caller's public key in the
 * request and verifies ownership in application code. These routes follow that
 * existing model for consistency: `UsernamesService` checks the profile's
 * `public_key` against the supplied key and answers 404 on mismatch, so the
 * endpoint cannot be used to discover which usernames exist.
 *
 * Adding real wallet auth is a larger, separate change.
 */
@ApiTags("profile")
@Controller("profile")
export class ProfileController {
  constructor(private readonly usernamesService: UsernamesService) {}

  @Get()
  @RateLimitTier("public-read")
  @ApiOperation({
    summary: "Get the editable profile for a wallet",
    description:
      "Returns the presentation fields shown on the settings page. Works for a " +
      "private profile too, since the owner still needs to see their own values. " +
      "Requires the owning wallet's public key.",
  })
  @ApiResponse({ status: 200, type: ProfileResponseDto })
  @ApiResponse({
    status: 404,
    description: "No such profile, or it is owned by a different wallet",
  })
  @ApiResponse({ status: 400, description: "Invalid username or public key" })
  async getProfile(
    @Query() query: GetProfileQueryDto,
  ): Promise<ProfileResponseDto> {
    return this.run(async () =>
      toProfileResponse(
        await this.usernamesService.getOwnedProfile(query.username, query.publicKey),
      ),
    );
  }

  @Put()
  @RateLimitTier("mutation")
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({
    summary: "Update the editable profile for a wallet",
    description:
      "Partial update: omit a field to leave it unchanged, send null or an " +
      "empty string to clear it. `username` locates the profile and is never " +
      "renamed, because renaming cascades into `username_marketplace`. Requires " +
      "the owning wallet's public key.",
  })
  @ApiResponse({ status: 200, type: ProfileResponseDto })
  @ApiResponse({
    status: 404,
    description: "No such profile, or it is owned by a different wallet",
  })
  @ApiResponse({ status: 400, description: "Validation failed" })
  async updateProfile(
    @Body() dto: UpdateProfileDto,
  ): Promise<ProfileResponseDto> {
    return this.run(async () =>
      toProfileResponse(await this.usernamesService.updateOwnedProfile(dto)),
    );
  }

  /**
   * Map the service's ownership and format errors onto HTTP responses.
   *
   * Mirrors the error mapping the other username routes use, so a caller sees
   * the same `code` and `message` shape regardless of which route it hit.
   */
  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof UsernameValidationError) {
        if (err.code === UsernameErrorCode.NOT_FOUND) {
          throw new NotFoundException({
            code: err.code,
            message: err.message,
          });
        }
        throw new BadRequestException({
          code: err.code,
          message: err.message,
        });
      }
      throw err;
    }
  }
}
