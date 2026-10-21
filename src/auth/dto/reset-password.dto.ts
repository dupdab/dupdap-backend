import { IsEmail, IsString, MinLength, IsOptional, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ResetPasswordDto {
  @ApiPropertyOptional({ description: 'Reset token from the recovery email (valid for 1 hour)' })
  @IsOptional()
  @IsString()
  token?: string;

  @ApiPropertyOptional({
    example: 'merchant@example.com',
    description: 'Required when using a recoveryCode instead of a token',
  })
  @IsOptional()
  @IsEmail()
  @Transform(({ value }) => value?.trim())
  email?: string;

  @ApiPropertyOptional({
    description: 'One-time recovery code issued at registration. Used instead of a token; consumed on use.',
  })
  @IsOptional()
  @IsString()
  recoveryCode?: string;

  @ApiProperty({ example: 'NewSecurePass123!' })
  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/, {
    message:
      'password must contain at least one lowercase letter, one uppercase letter, one number, and one special character',
  })
  password: string;
}
