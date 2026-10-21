import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class OptionalJwtGuard extends AuthGuard('jwt') {
  handleRequest(err: unknown, user: unknown): unknown {
    if (err) throw err;
    return user ?? null;
  }
}
