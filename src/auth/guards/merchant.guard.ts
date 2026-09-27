import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Observable } from 'rxjs';

/**
 * Guards routes that must be scoped to an authenticated merchant.
 *
 * This guard assumes it runs after an authentication guard (e.g.
 * JwtAuthGuard) has already populated `request.user`. It only verifies
 * that a `merchantId` claim is present on the authenticated user so
 * downstream handlers can safely scope queries/mutations to it.
 */
@Injectable()
export class MerchantGuard implements CanActivate {
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.merchantId) {
      throw new ForbiddenException('Merchant context is required');
    }

    return true;
  }
}
