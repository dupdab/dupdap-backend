import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { MerchantGuard } from './merchant.guard';

describe('MerchantGuard', () => {
  const guard = new MerchantGuard();

  const contextFor = (user: unknown): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as any;

  it('allows a request with merchantId present', () => {
    expect(guard.canActivate(contextFor({ merchantId: 'm-1', email: 'm@example.com' }))).toBe(
      true,
    );
  });

  it('rejects when there is no authenticated user', () => {
    expect(() => guard.canActivate(contextFor(undefined))).toThrow(ForbiddenException);
  });

  it('rejects when merchantId is missing', () => {
    expect(() => guard.canActivate(contextFor({ email: 'm@example.com' }))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects when merchantId is empty', () => {
    expect(() => guard.canActivate(contextFor({ merchantId: '' }))).toThrow(ForbiddenException);
  });
});
