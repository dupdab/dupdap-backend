import { IsEmail, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class TestEmailDto {
  @IsEmail()
  to!: string;

  @IsString()
  @IsNotEmpty()
  templateAlias!: string;

  @IsOptional()
  @IsObject()
  mergeData?: Record<string, unknown>;
}
