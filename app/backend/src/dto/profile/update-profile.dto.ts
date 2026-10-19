import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
} from "class-validator";

import { IsStellarPublicKey, IsUsername } from "../validators";

/** Mirrors the `bio` maxLength on the settings textarea. */
export const PROFILE_BIO_MAX_LENGTH = 160;

/** Mirrors the twitter input's maxLength. */
export const PROFILE_TWITTER_HANDLE_MAX_LENGTH = 15;

/** Mirrors the discord input's maxLength. */
export const PROFILE_DISCORD_HANDLE_MAX_LENGTH = 32;

/** Mirrors the github input's maxLength. */
export const PROFILE_GITHUB_HANDLE_MAX_LENGTH = 39;

/** Mirrors the `usernames_primary_color_format_chk` database constraint. */
export const PROFILE_PRIMARY_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/**
 * Trim a submitted value and collapse "blank" to `null`.
 *
 * The settings page's text inputs submit `""` when the user clears a field,
 * while the columns are nullable with NULL meaning "not configured". Empty
 * string is not a meaningful value for any presentation field, so the two are
 * collapsed at the boundary instead of in every call site.
 *
 * `undefined` is passed through rather than collapsed, because it means the
 * caller omitted the key entirely and the stored value must be left alone.
 * Collapsing it to `null` would make every partial update clear every field the
 * client happened not to send. Non-strings are also passed through so that
 * `@IsString` / `@IsUrl` report a type error rather than it being swallowed
 * here.
 */
const blankToNull = ({ value }: { value: unknown }): unknown => {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

/**
 * Like `blankToNull`, but also drops a leading `@`.
 *
 * The settings page builds `https://twitter.com/${handle}`, so a pasted
 * `@stellar` would otherwise produce a dead link.
 */
const handleToColumn = ({ value }: { value: unknown }): unknown => {
  const normalized = blankToNull({ value });
  if (typeof normalized !== "string") {
    return normalized;
  }
  return normalized.replace(/^@+/, "");
};

/**
 * Body of `PUT /profile`.
 *
 * Every presentation field is optional. An omitted field is left untouched,
 * while `null` or `""` clears it, so the settings page can update one field
 * without re-sending the rest.
 *
 * `username` locates the profile but never renames it: `username_marketplace`
 * has an `ON DELETE CASCADE` FK to `usernames.username`, so a rename here would
 * silently destroy the user's marketplace listings.
 */
export class UpdateProfileDto {
  @ApiProperty({
    description: "Profile to update. Locates the row; never renames it.",
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

  @ApiPropertyOptional({
    description:
      "Profile accent colour as a #RRGGBB hex string. Omit to leave unchanged; " +
      "null or empty string clears it.",
    example: "#6366f1",
    nullable: true,
  })
  @IsOptional()
  @Matches(PROFILE_PRIMARY_COLOR_PATTERN, {
    message:
      "primaryColor must be a hex colour in #RRGGBB form, or an empty string to clear it",
  })
  @Transform(blankToNull)
  primaryColor?: string | null;

  @ApiPropertyOptional({
    description:
      "Absolute https URL of the avatar. Omit to leave unchanged; null or " +
      "empty string clears it.",
    example: "https://cdn.example.com/avatar/alice.png",
    nullable: true,
  })
  @IsOptional()
  @IsUrl(
    { protocols: ["https"], require_protocol: true },
    { message: "avatarUrl must be an absolute https URL" },
  )
  @Transform(blankToNull)
  avatarUrl?: string | null;

  @ApiPropertyOptional({
    description:
      "Free-text bio. Omit to leave unchanged; null or empty string clears it.",
    example: "Building the future of payments on Stellar",
    maxLength: PROFILE_BIO_MAX_LENGTH,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(PROFILE_BIO_MAX_LENGTH, {
    message: `bio must be at most ${PROFILE_BIO_MAX_LENGTH} characters`,
  })
  @Transform(blankToNull)
  bio?: string | null;

  @ApiPropertyOptional({
    description:
      "X/Twitter handle without the leading @. Omit to leave unchanged; null " +
      "or empty string clears it.",
    example: "stellarorg",
    maxLength: PROFILE_TWITTER_HANDLE_MAX_LENGTH,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(PROFILE_TWITTER_HANDLE_MAX_LENGTH, {
    message: `twitterHandle must be at most ${PROFILE_TWITTER_HANDLE_MAX_LENGTH} characters`,
  })
  @Transform(handleToColumn)
  twitterHandle?: string | null;

  @ApiPropertyOptional({
    description:
      "Discord display name. Omit to leave unchanged; null or empty string " +
      "clears it.",
    example: "user#1234",
    maxLength: PROFILE_DISCORD_HANDLE_MAX_LENGTH,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(PROFILE_DISCORD_HANDLE_MAX_LENGTH, {
    message: `discordHandle must be at most ${PROFILE_DISCORD_HANDLE_MAX_LENGTH} characters`,
  })
  @Transform(blankToNull)
  discordHandle?: string | null;

  @ApiPropertyOptional({
    description:
      "GitHub handle without the leading @. Omit to leave unchanged; null or " +
      "empty string clears it.",
    example: "stellar",
    maxLength: PROFILE_GITHUB_HANDLE_MAX_LENGTH,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(PROFILE_GITHUB_HANDLE_MAX_LENGTH, {
    message: `githubHandle must be at most ${PROFILE_GITHUB_HANDLE_MAX_LENGTH} characters`,
  })
  @Transform(handleToColumn)
  githubHandle?: string | null;
}
