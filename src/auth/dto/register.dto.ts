import { IsEmail, IsString, MinLength, IsOptional, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({ example: 'merchant@example.com' })
  @IsEmail()
  @Transform(({ value }) => value?.trim())
  email: string;

  @ApiProperty({ example: 'SecurePass123!' })
  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/, {
    message:
      'password must contain at least one lowercase letter, one uppercase letter, one number, and one special character',
  })
  password: string;

  @ApiProperty({ example: 'Acme Corp' })
  @IsString()
  @Transform(({ value }) => value?.trim())
  businessName: string;

  @ApiPropertyOptional({ example: 'retail' })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => value?.trim())
  businessType?: string;

  @ApiPropertyOptional({ example: 'NG' })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => value?.trim())
  country?: string;
}
