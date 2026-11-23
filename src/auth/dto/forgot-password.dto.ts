import { IsEmail, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class ForgotPasswordDto {
  @ApiProperty({ example: 'merchant@example.com' })
  @IsEmail()
  @Transform(({ value }) => value?.trim())
  email: string;
}

export class VerifyEmailDto {
  @ApiProperty({ description: 'Signed verification token from the registration email' })
  @IsString()
  token: string;
}
