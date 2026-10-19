import { ApiProperty } from "@nestjs/swagger";

import type { ProfileResult } from "../../usernames/usernames.repository";

/**
 * Wire shape of a profile, as returned by `GET /profile`, `PUT /profile` and
 * the public `GET /username/:username`.
 *
 * camelCase on the wire, snake_case in the database. The conversion lives in
 * `toProfileResponse` below so every surface returns the same keys in the same
 * order and the frontend never has to branch on which endpoint it called.
 */
export class ProfileResponseDto {
  @ApiProperty({
    description: "Unique identifier for the profile row",
    example: "123e4567-e89b-12d3-a456-426614174000",
  })
  id!: string;

  @ApiProperty({
    description: "Username (normalized, lowercase)",
    example: "alice",
  })
  username!: string;

  @ApiProperty({
    description: "Stellar public key of the profile owner",
    example: "GBXGQ55JMQ4L2B6E7S8Y9Z0A1B2C3D4E5F6G7H8I7YWR",
  })
  publicKey!: string;

  @ApiProperty({
    description: "Whether the profile is visible to other users",
    example: true,
  })
  isPublic!: boolean;

  @ApiProperty({
    description:
      "Profile accent colour as a #RRGGBB hex string, or null to use the app default",
    example: "#6366f1",
    nullable: true,
  })
  primaryColor!: string | null;

  @ApiProperty({
    description: "Absolute https URL of the avatar, or null for the initial avatar",
    example: "https://cdn.example.com/avatar/alice.png",
    nullable: true,
  })
  avatarUrl!: string | null;

  @ApiProperty({
    description: "Free-text bio, or null when unset",
    example: "Building the future of payments on Stellar",
    nullable: true,
  })
  bio!: string | null;

  @ApiProperty({
    description: "X/Twitter handle without the leading @, or null when unset",
    example: "stellarorg",
    nullable: true,
  })
  twitterHandle!: string | null;

  @ApiProperty({
    description: "Discord display name, or null when unset",
    example: "user#1234",
    nullable: true,
  })
  discordHandle!: string | null;

  @ApiProperty({
    description: "GitHub handle without the leading @, or null when unset",
    example: "stellar",
    nullable: true,
  })
  githubHandle!: string | null;

  @ApiProperty({
    description: "Username creation timestamp",
    example: "2025-02-19T08:00:00Z",
  })
  createdAt!: string;
}

/**
 * Convert a persistence-shaped profile to its wire shape.
 *
 * `null` is passed through rather than collapsed to `""`, so the client can tell
 * "not configured" from "configured as blank" and render its own fallbacks.
 */
export function toProfileResponse(profile: ProfileResult): ProfileResponseDto {
  return {
    id: profile.id,
    username: profile.username,
    publicKey: profile.public_key,
    isPublic: profile.is_public,
    primaryColor: profile.primary_color,
    avatarUrl: profile.avatar_url,
    bio: profile.bio,
    twitterHandle: profile.twitter_handle,
    discordHandle: profile.discord_handle,
    githubHandle: profile.github_handle,
    createdAt: profile.created_at,
  };
}
