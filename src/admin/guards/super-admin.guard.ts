import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { MerchantRole } from '@prisma/client';
import { Merchant } from '@prisma/client';

/**
 * Guard that restricts access to SUPERADMIN merchants only.
 *
 * Expects `request.user` to be populated by an upstream authentication
 * guard with the authenticated Merchant record.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const merchant: Merchant | undefined = request.user;

    if (!merchant || merchant.role !== MerchantRole.SUPERADMIN) {
      throw new ForbiddenException('Superadmin access required');
    }

    return true;
  }
}
