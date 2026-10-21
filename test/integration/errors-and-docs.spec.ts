import { ArgumentsHost, BadRequestException, ForbiddenException, HttpException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { AllExceptionsFilter } from '../../src/core/filters/all-exceptions.filter';
import { runWithCorrelationId } from '../../src/common/correlation-id.context';
import { documentationApp } from '../../scripts/export-openapi';
import { createOpenApiDocument } from '../../src/common/swagger';

describe('Canonical errors', () => {
  it.each([
    new BadRequestException(['email invalid']), new UnauthorizedException(),
    new ForbiddenException(), new NotFoundException(), new Error('failure'),
    new HttpException('raw string', 400), new HttpException({ message: 'custom' }, 422),
  ])('normalizes %p and preserves correlation ID', exception => {
    const json = jest.fn();
    const response = { status: jest.fn().mockReturnThis(), json, setHeader: jest.fn() };
    const host = { switchToHttp: () => ({ getRequest: () => ({ url: '/test' }), getResponse: () => response }) } as ArgumentsHost;
    const filter = new AllExceptionsFilter({} as any, { get: () => undefined } as any);
    runWithCorrelationId('request-123', () => filter.catch(exception, host));
    expect(Object.keys(json.mock.calls[0][0]).sort()).toEqual(['error', 'message', 'requestId', 'statusCode']);
    expect(json.mock.calls[0][0].requestId).toBe('request-123');
    expect(response.setHeader).toHaveBeenCalledWith('X-Request-ID', 'request-123');
  });
});

describe('OpenAPI admin coverage', () => {
  it('exports every admin operation with bearer security and canonical error schemas', async () => {
    const app = await documentationApp();
    try {
      const spec = createOpenApiDocument(app, 'test');
      const paths = Object.entries(spec.paths).filter(([path]) => path.startsWith('/api/v1/admin'));
      expect(paths.length).toBeGreaterThan(20);
      for (const [, path] of paths) for (const operation of Object.values(path!)) {
        expect(operation.summary).toBeTruthy();
        expect(operation.security).toContainEqual({ bearer: [] });
        for (const code of [400, 401, 403, 404, 500])
          expect(operation.responses[code].content['application/json'].schema.$ref).toBe('#/components/schemas/ErrorResponseDto');
      }
    } finally { await app.close(); }
  });
});
