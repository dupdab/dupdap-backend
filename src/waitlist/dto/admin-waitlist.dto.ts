import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class WaitlistQueryDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) minReferrals?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsIn(['createdAt', 'referralCount', 'email']) sortBy?: 'createdAt' | 'referralCount' | 'email';
  @IsOptional() @IsIn(['ASC', 'DESC']) order?: 'ASC' | 'DESC';
}

export class WaitlistNotifyDto {
  @IsString() subject: string;
  @IsString() body: string;
  @IsOptional() @IsIn(['all', 'filter']) target?: 'all' | 'filter';
  @IsOptional() @IsString() country?: string;
}
