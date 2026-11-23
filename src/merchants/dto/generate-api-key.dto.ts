import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsDate, IsOptional, IsString, MaxDate } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiScope, API_KEY_SCOPES } from '../../auth/scopes';

/** Maximum lifetime allowed for an API key: 365 days from now. */
const oneYearFromNow = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d;
};

export class GenerateApiKeyDto {
  @ApiPropertyOptional({
    type: [String],
    enum: API_KEY_SCOPES,
    description: 'Scopes to assign to the generated API key',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  scopes?: ApiScope[];

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Optional expiry timestamp for the API key (ISO 8601). Maximum 1 year from now.',
    example: '2027-10-18T00:00:00.000Z',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  @MaxDate(oneYearFromNow, {
    message: 'expiresAt must not be more than 1 year from now',
  })
  expiresAt?: Date;
}
