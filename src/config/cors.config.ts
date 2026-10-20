/** CORS origin helpers (#542). Pure functions for unit testing. */

export function parseAllowedOrigins(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

/** True when the request origin is permitted. */
export function isOriginAllowed(origin: string | undefined, allowedOrigins: string[]): boolean {
  if (!origin) return true; // same-origin / non-browser clients
  return allowedOrigins.includes(origin);
}

/**
 * Startup validation: in production CORS must be an explicit allow-list.
 * Throws when ALLOWED_ORIGINS is missing or contains a wildcard.
 */
export function validateCorsConfig(nodeEnv: string | undefined, allowedOrigins: string[]): void {
  if (nodeEnv === 'production') {
    if (allowedOrigins.length === 0) {
      throw new Error('CORS misconfigured: ALLOWED_ORIGINS must be set in production');
    }
    if (allowedOrigins.includes('*')) {
      throw new Error('CORS misconfigured: wildcard "*" is not allowed in production');
    }
  }
}
