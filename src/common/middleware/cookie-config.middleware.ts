import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * Issue #840: session-related cookies must always be issued with
 * `Secure`, `HttpOnly` and `SameSite=Strict`.
 *
 * This middleware enforces those attributes on every `Set-Cookie` header
 * written during the request, regardless of how the cookie was set
 * (`res.cookie(...)`, `res.setHeader('Set-Cookie', ...)`, etc.).
 */
const REQUIRED_ATTRIBUTES: ReadonlyArray<[RegExp, string]> = [
  [/;\s*secure\b/i, '; Secure'],
  [/;\s*httponly\b/i, '; HttpOnly'],
  [/;\s*samesite\s*=\s*[^;]*/i, '; SameSite=Strict'],
];

export function hardenSetCookieHeader(header: string): string {
  let hardened = header;
  for (const [pattern, attribute] of REQUIRED_ATTRIBUTES) {
    hardened = pattern.test(hardened)
      ? hardened.replace(pattern, attribute)
      : `${hardened}${attribute}`;
  }
  return hardened;
}

@Injectable()
export class CookieConfigMiddleware implements NestMiddleware {
  use(_req: Request, res: Response, next: NextFunction) {
    const originalSetHeader = res.setHeader.bind(res);

    res.setHeader = ((name: string, value: number | string | readonly string[]) => {
      if (typeof name === 'string' && name.toLowerCase() === 'set-cookie') {
        const hardened = Array.isArray(value)
          ? value.map((cookie) => hardenSetCookieHeader(String(cookie)))
          : hardenSetCookieHeader(String(value));
        return originalSetHeader(name, hardened);
      }
      return originalSetHeader(name, value as string | number | readonly string[]);
    }) as Response['setHeader'];

    next();
  }
}
