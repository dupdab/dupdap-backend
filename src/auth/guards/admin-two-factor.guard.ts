import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

@Injectable()
export class AdminTwoFactorGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user;
    if (['admin', 'superadmin'].includes(user?.role) && user?.admin2fa === true) return true;
    throw new ForbiddenException('A verified administrator two-factor session is required');
  }
}
