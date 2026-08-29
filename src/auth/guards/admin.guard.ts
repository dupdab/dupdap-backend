import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Observable } from 'rxjs';
import { MerchantRole } from '../../merchants/entities/merchant.entity';

const ADMIN_ROLES: MerchantRole[] = [MerchantRole.ADMIN, MerchantRole.SUPERADMIN];

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !ADMIN_ROLES.includes(user.role)) {
      throw new ForbiddenException('Admin access required');
    }

    return true;
  }
}
