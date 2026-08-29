import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InternalServiceGuard } from './internal-service.guard';

describe('InternalServiceGuard', () => {
  const SECRET = 'super-secret-value';

  const guardWith = (configured?: string) =>
    new InternalServiceGuard({
      get: () => configured,
    } as unknown as ConfigService);

  const contextWithHeader = (value?: string): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          headers: value === undefined ? {} : { 'x-internal-service-secret': value },
        }),
      }),
    }) as any;

  it('allows a request that presents the correct secret', () => {
    expect(guardWith(SECRET).canActivate(contextWithHeader(SECRET))).toBe(true);
  });

  it('rejects a request with a wrong secret', () => {
    expect(() => guardWith(SECRET).canActivate(contextWithHeader('nope'))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a request with no secret header', () => {
    expect(() => guardWith(SECRET).canActivate(contextWithHeader())).toThrow(
      UnauthorizedException,
    );
  });

  it('fails closed when INTERNAL_SERVICE_SECRET is not configured', () => {
    expect(() => guardWith(undefined).canActivate(contextWithHeader(SECRET))).toThrow(
      UnauthorizedException,
    );
  });
});
