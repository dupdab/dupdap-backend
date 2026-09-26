import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import * as Sentry from '@sentry/nestjs';

interface RequestWithUser {
  user?: { merchantId?: string; email?: string; role?: string };
}

@Injectable()
export class SentryInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    Sentry.withScope((scope) => {
      if (user) {
        scope.setUser({ id: user.merchantId, email: user.email });
        scope.setTag('user_type', 'merchant');
        if (user.role) {
          scope.setTag('merchant_role', user.role);
        }
      }
      scope.setTag('handler', `${context.getClass().name}.${context.getHandler().name}`);
    });

    return next.handle();
  }
}

