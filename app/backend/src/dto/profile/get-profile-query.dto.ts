import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";

import { IsStellarPublicKey, IsUsername } from "../validators";

/**
 * Locates a profile for the settings routes.
 *
 * Identity note: this backend has no wallet authentication. `ApiKeyGuard`
 * resolves API keys for automation, not wallets, and `request.publicKey` is
 * never populated anywhere. Every existing per-wallet route (notification
 * preferences, `POST /username/toggle-public`) therefore takes the caller's
 * public key in the request and verifies ownership in application code. The
 * profile routes follow the same model rather than introducing a second,
 * incompatible auth mechanism; closing that gap is tracked separately.
 */
export class GetProfileQueryDto {
  @ApiProperty({
    description: "Profile to load",
    example: "alice_123",
  })
  @IsString()
  @IsNotEmpty()
  @IsUsername()
  username!: string;

  @ApiProperty({
    description: "Stellar public key of the wallet that owns the profile",
    example: "GBXGQ55IMY5OMHDMZV5ZLX5XNRM3MHZJXUIBZ4QKOW3S6GXQ2KJQ2Q",
  })
  @IsString()
  @IsNotEmpty()
  @IsStellarPublicKey({
    message: "Public key must be a valid Stellar public key",
  })
  publicKey!: string;
}
