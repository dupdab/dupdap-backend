import { ApiProperty } from '@nestjs/swagger';

export class ErrorResponseDto {
  @ApiProperty({ example: 400 }) statusCode: number;
  @ApiProperty({ example: 'Bad Request' }) error: string;
  @ApiProperty({ oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] }) message: string | string[];
  @ApiProperty({ format: 'uuid' }) requestId: string;
}
