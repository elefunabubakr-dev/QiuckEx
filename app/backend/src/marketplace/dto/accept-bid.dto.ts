import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';
import { IsStellarPublicKey } from '../../dto/validators';

export class AcceptBidDto {
  @ApiProperty({ example: 'GBXGQ55JMQ4L2B6E7S8Y9Z0A1B2C3D4E5F6G7H8I7YWR' })
  @IsString()
  @IsNotEmpty()
  @IsStellarPublicKey({ message: 'Public key must be a valid Stellar public key' })
  sellerPublicKey!: string;

  @ApiProperty({
    example: 'a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0',
    description: 'Confirmed Stellar transaction hash proving payment from bidder to seller',
  })
  @IsString()
  @IsNotEmpty({ message: 'Payment transaction hash is required to accept a bid' })
  @Matches(/^[a-fA-F0-9]{64}$/, {
    message: 'paymentTxHash must be a valid 64-character hexadecimal Stellar transaction hash',
  })
  paymentTxHash!: string;
}
