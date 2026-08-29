import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import type { SentryConfig } from '../config/sentry.config';

/** Headers that may carry credentials; removed entirely from captured events. */
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'proxy-authorization',
  'x-api-key',
  'x-auth-token',
]);

/**
 * Field names that are always treated as sensitive, matched case-insensitively.
 * Covers credentials, secrets, tokens, bank/card details and PII found across
 * this codebase (auth DTOs, webhook secrets, wallet secret keys, settlement
 * partner keys, merchant payloads).
 */
const SENSITIVE_FIELD_NAMES = new Set([
  // credentials & secrets
  'password',
  'passphrase',
  'pwd',
  'passwordhash',
  'secret',
  'secretkey',
  'apikey',
  'apikeyhash',
  'privatekey',
  'privkey',
  'mnemonic',
  'seed',
  'seedphrase',
  'totpsecret',
  'otpsecret',
  'otpauth',
  'jwt',
  // tokens
  'token',
  'accesstoken',
  'refreshtoken',
  'authtoken',
  'idtoken',
  'downloadtoken',
  'partnerkey',
  'sendgridkey',
  'webhooksecret',
  // bank / card details
  'bankaccount',
  'bankaccountnumber',
  'accountnumber',
  'accountno',
  'iban',
  'bic',
  'sortcode',
  'routingnumber',
  'cardnumber',
  'cvv',
  'cvv2',
  'cvc',
  // PII
  'email',
]);

/**
 * Substrings that mark a field name as sensitive even when the full name is
 * not in the denylist (e.g. `userEmail`, `customerIban`, `stripeSecretKey`).
 */
const SENSITIVE_KEY_SUBSTRINGS = [
  'password',
  'passphrase',
  'secret',
  'apikey',
  'api_key',
  'privatekey',
  'privkey',
  'mnemonic',
  'seedphrase',
  'totpsecret',
  'bankaccount',
  'accountnumber',
  'cardnumber',
  'cvv',
  'iban',
  'email',
  'jwt',
];

/**
 * High-signal patterns redacted from free-form strings (error messages,
 * breadcrumb messages, source context lines) where field-name scrubbing does
 * not apply.
 */
const SECRET_PATTERNS: RegExp[] = [
  // JWT access/refresh tokens
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  // Bearer tokens
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi,
  // PEM-encoded private keys
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  // Stellar secret keys (56-char base32 starting with S)
  /\bS[A-Z2-7]{55}\b/g,
  // AWS access key IDs
  /\bAKIA[0-9A-Z]{16}\b/g,
  // GitHub tokens (classic + fine-grained PATs)
  /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/g,
];

const REDACTED = '[REDACTED]';

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  if (SENSITIVE_FIELD_NAMES.has(normalized)) {
    return true;
  }
  return SENSITIVE_KEY_SUBSTRINGS.some((substring) => normalized.includes(substring));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function redactSecretPatterns(value: string): string {
  let result = value;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, REDACTED);
  }
  return result;
}

function scrubValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactSecretPatterns(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item));
  }
  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      result[key] = isSensitiveKey(key) ? REDACTED : scrubValue(nested);
    }
    return result;
  }
  return value;
}

function redactFrameSource(frame: {
  context_line?: string | null;
  pre_context?: string[];
  post_context?: string[];
}): void {
  if (typeof frame.context_line === 'string') {
    frame.context_line = redactSecretPatterns(frame.context_line);
  }
  if (frame.pre_context) {
    frame.pre_context = frame.pre_context.map((line) => redactSecretPatterns(line));
  }
  if (frame.post_context) {
    frame.post_context = frame.post_context.map((line) => redactSecretPatterns(line));
  }
}

/**
 * Sanitizes a Sentry event before it leaves the process: removes credential
 * headers, recursively redacts known-sensitive fields in the request body,
 * extra/user/context data, breadcrumbs and stack frame vars, and redacts
 * secret values embedded in free-form strings (error messages, breadcrumb
 * messages, source context lines).
 */
export function scrubSentryEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  if (event.request?.headers) {
    const headers = event.request.headers as Record<string, unknown>;
    for (const header of Object.keys(headers)) {
      if (SENSITIVE_HEADERS.has(header.toLowerCase())) {
        delete headers[header];
      }
    }
  }

  if (event.request?.data) {
    event.request.data = scrubValue(event.request.data) as typeof event.request.data;
  }

  if (event.extra) {
    event.extra = scrubValue(event.extra) as typeof event.extra;
  }

  if (event.user) {
    event.user = scrubValue(event.user) as typeof event.user;
  }

  if (event.contexts) {
    event.contexts = scrubValue(event.contexts) as typeof event.contexts;
  }

  if (typeof event.message === 'string') {
    event.message = redactSecretPatterns(event.message);
  }

  if (Array.isArray(event.breadcrumbs)) {
    for (const breadcrumb of event.breadcrumbs) {
      if (breadcrumb.data) {
        breadcrumb.data = scrubValue(breadcrumb.data) as typeof breadcrumb.data;
      }
      if (typeof breadcrumb.message === 'string') {
        breadcrumb.message = redactSecretPatterns(breadcrumb.message);
      }
    }
  }

  if (event.exception?.values) {
    for (const exception of event.exception.values) {
      if (typeof exception.value === 'string') {
        exception.value = redactSecretPatterns(exception.value);
      }
      const frames = exception.stacktrace?.frames;
      if (frames) {
        for (const frame of frames) {
          if (frame.vars && typeof frame.vars === 'object') {
            frame.vars = scrubValue(frame.vars) as typeof frame.vars;
          }
          redactFrameSource(frame);
        }
      }
    }
  }

  return event;
}

@Injectable()
export class SentryService {
  private readonly logger = new Logger(SentryService.name);
  private initialized = false;

  constructor(private readonly configService: ConfigService) {}

  init(): void {
    const cfg = this.configService.get<SentryConfig>('sentry');
    if (!cfg?.enabled || !cfg.dsn) {
      this.logger.log('Sentry is disabled (no DSN or test environment)');
      return;
    }

    Sentry.init({
      dsn: cfg.dsn,
      environment: cfg.environment,
      tracesSampleRate: cfg.tracesSampleRate,
      profilesSampleRate: cfg.profilesSampleRate,
      // Never attach PII (IP addresses, user details, etc.) to captured events.
      sendDefaultPii: false,
      integrations: [
        Sentry.httpIntegration(),
      ],
      beforeSend: scrubSentryEvent,
    });

    this.initialized = true;
    this.logger.log(`Sentry initialized (env=${cfg.environment}, traces=${cfg.tracesSampleRate})`);
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}
