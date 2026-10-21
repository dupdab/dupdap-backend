import { IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Matches, Min } from 'class-validator';

export class CreateNotificationTemplateDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9-]+$/, { message: 'name must be lowercase letters, digits or hyphens' })
  name!: string;

  @IsString()
  @IsNotEmpty()
  subject!: string;

  @IsString()
  @IsNotEmpty()
  htmlBody!: string;
}

export class UpdateNotificationTemplateDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  subject?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  htmlBody?: string;
}

export class PreviewNotificationTemplateDto {
  @IsOptional()
  @IsObject()
  testData?: Record<string, unknown>;
}

export class RollbackNotificationTemplateDto {
  @IsInt()
  @Min(1)
  version!: number;
}
