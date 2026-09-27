import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { MerchantRole } from '../../merchants/entities/merchant.entity';

describe('AdminGuard', () => {
  const guard = new AdminGuard();

  const contextFor = (user: unknown): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as any;

  it('allows a merchant with the ADMIN role (shape produced by JwtStrategy)', () => {
    const context = contextFor({
      merchantId: 'm-1',
      email: 'admin@example.com',
      role: MerchantRole.ADMIN,
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows a merchant with the SUPERADMIN role', () => {
    const context = contextFor({ merchantId: 'm-2', role: MerchantRole.SUPERADMIN });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects a regular MERCHANT', () => {
    const context = contextFor({ merchantId: 'm-3', role: MerchantRole.MERCHANT });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('rejects when there is no authenticated user', () => {
    expect(() => guard.canActivate(contextFor(undefined))).toThrow(ForbiddenException);
  });

  it('rejects the legacy isAdmin flag that is never actually populated', () => {
    const context = contextFor({ merchantId: 'm-4', isAdmin: true });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
