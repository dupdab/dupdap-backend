import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, Max, Min } from 'class-validator';

export class UpdateWebhookRetryConfigDto {
  @ApiProperty({ minimum: 1, maximum: 10, example: 5 })
  @IsInt()
  @Min(1)
  @Max(10)
  maxAttempts: number;

  @ApiProperty({ type: [Number], description: 'Retry delays in milliseconds; each must be at most 24 hours.' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(86_400_000, { each: true })
  retryDelays: number[];
}
