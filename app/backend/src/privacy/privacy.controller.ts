import { Body, Controller, Header, Post, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { IsNotEmpty, IsObject, IsString } from "class-validator";
import { PrivacyService, StealthEnvelope } from "./privacy.service";
import {
  ExcludePrivacyTelemetry,
  PRIVACY_DEBUG_WARNING,
  PrivacyDebugGuard,
} from "./privacy-debug.guard";
import { RateLimitTier } from "../auth/decorators/rate-limit-group.decorator";
import { RequireApiKey } from "../auth/decorators/require-api-key.decorator";
import { RequireScopes } from "../auth/decorators/require-scopes.decorator";
import { ApiKeyGuard } from "../auth/guards/api-key.guard";

export class EncryptRecipientDto {
  @IsString()
  @IsNotEmpty()
  recipientAddress!: string;

  @IsString()
  @IsNotEmpty()
  recipientViewPublicKeyPem!: string;
}

export class DeriveSecretDto {
  @IsString()
  @IsNotEmpty()
  privateKeyPem!: string;

  @IsString()
  @IsNotEmpty()
  publicKeyPem!: string;
}

export class DecryptEnvelopeDto {
  @IsObject()
  @IsNotEmpty()
  envelope!: StealthEnvelope;

  @IsString()
  @IsNotEmpty()
  recipientViewPrivateKeyPem!: string;
}

@ApiTags("privacy")
@Controller("privacy")
export class PrivacyController {
  constructor(private readonly privacyService: PrivacyService) {}

  @Post("encrypt-recipient")
  @RateLimitTier("mutation")
  @ApiOperation({
    summary: "Encrypt recipient metadata using recipient view public key",
    description:
      "Production-safe non-custodial stealth encryption. Accepts only the recipient's public view key (SPKI PEM); private keys never leave the client.",
  })
  encryptRecipient(@Body() body: EncryptRecipientDto) {
    return this.privacyService.encryptRecipientForViewKey(
      body.recipientAddress,
      body.recipientViewPublicKeyPem,
    );
  }

  @Post("derive-shared-secret")
  @RateLimitTier("mutation")
  @UseGuards(PrivacyDebugGuard, ApiKeyGuard)
  @RequireApiKey()
  @RequireScopes("admin")
  @ExcludePrivacyTelemetry()
  @ApiBearerAuth()
  @ApiHeader({
    name: "X-API-Key",
    description: "Admin-scoped API key (local/dev debug only)",
    required: true,
  })
  @Header("X-Privacy-Debug-Warning", PRIVACY_DEBUG_WARNING)
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary:
      "Derive X25519 shared secret (local/dev-only admin debug endpoint; disabled in production)",
    deprecated: true,
    description:
      "WARNING: Local/dev-only integration testing helper. Disabled in production and gated behind PRIVACY_DEBUG_ENDPOINTS_ENABLED=true plus an admin-scoped API key. Production stealth-address flows must perform ECDH derivation client-side.",
  })
  deriveSharedSecret(@Body() body: DeriveSecretDto) {
    return {
      sharedSecretHex: this.privacyService.deriveSharedSecretHex(
        body.privateKeyPem,
        body.publicKeyPem,
      ),
      warning: PRIVACY_DEBUG_WARNING,
    };
  }

  @Post("decrypt-recipient")
  @RateLimitTier("mutation")
  @UseGuards(PrivacyDebugGuard, ApiKeyGuard)
  @RequireApiKey()
  @RequireScopes("admin")
  @ExcludePrivacyTelemetry()
  @ApiBearerAuth()
  @ApiHeader({
    name: "X-API-Key",
    description: "Admin-scoped API key (local/dev debug only)",
    required: true,
  })
  @Header("X-Privacy-Debug-Warning", PRIVACY_DEBUG_WARNING)
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary:
      "Decrypt recipient metadata envelope (local/dev-only admin debug endpoint; disabled in production)",
    deprecated: true,
    description:
      "WARNING: Local/dev-only integration testing helper. Disabled in production and gated behind PRIVACY_DEBUG_ENDPOINTS_ENABLED=true plus an admin-scoped API key. Production stealth-address flows must decrypt envelopes client-side.",
  })
  decryptRecipient(@Body() body: DecryptEnvelopeDto) {
    return {
      recipientAddress: this.privacyService.decryptRecipientEnvelope(
        body.envelope,
        body.recipientViewPrivateKeyPem,
      ),
      warning: PRIVACY_DEBUG_WARNING,
    };
  }
}
