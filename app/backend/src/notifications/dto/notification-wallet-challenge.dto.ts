import { IsIn, IsObject, IsOptional } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class NotificationWalletChallengeDto {
  @ApiProperty({ enum: ["GET", "PUT", "DELETE"] })
  @IsIn(["GET", "PUT", "DELETE"])
  method!: "GET" | "PUT" | "DELETE";

  @ApiPropertyOptional({ enum: ["email", "push", "webhook"] })
  @IsOptional()
  @IsIn(["email", "push", "webhook"])
  channel?: string;

  @ApiPropertyOptional({
    description: "The exact JSON body of the upcoming PUT request",
  })
  @IsOptional()
  @IsObject()
  body?: Record<string, unknown>;
}
