import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { ErrorResponseDto } from './dto/error-response.dto';

export function ApiErrors() {
  return applyDecorators(...[400, 401, 403, 404, 500].map(status =>
    ApiResponse({ status, type: ErrorResponseDto, description: {
      400: 'Invalid request', 401: 'Authentication required', 403: 'Insufficient permissions',
      404: 'Resource not found', 500: 'Internal server error',
    }[status] }),
  ));
}
