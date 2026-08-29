import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SentryService, scrubSentryEvent } from './sentry.service';

type SentryEvent = Parameters<typeof scrubSentryEvent>[0];

describe('SentryService', () => {
  let service: SentryService;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    configService = {
      get: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SentryService,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<SentryService>(SentryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('init', () => {
    it('should not initialize when SENTRY_DSN is not set', () => {
      configService.get.mockReturnValue({
        dsn: '',
        tracesSampleRate: 0.1,
        profilesSampleRate: 0.05,
        environment: 'test',
        enabled: false,
      });

      service.init();
      expect(service.isInitialized()).toBe(false);
    });

    it('should not initialize in test environment', () => {
      configService.get.mockReturnValue({
        dsn: 'https://test@example.com/1',
        tracesSampleRate: 1.0,
        profilesSampleRate: 1.0,
        environment: 'test',
        enabled: false,
      });

      service.init();
      expect(service.isInitialized()).toBe(false);
    });

    it('should initialize when DSN is set and not in test', () => {
      configService.get.mockReturnValue({
        dsn: 'https://test@example.com/1',
        tracesSampleRate: 0.1,
        profilesSampleRate: 0.05,
        environment: 'production',
        enabled: true,
      });

      service.init();
      expect(service.isInitialized()).toBe(true);
    });
  });

  describe('scrubSentryEvent', () => {
    it('removes credential headers case-insensitively', () => {
      const event = {
        request: {
          headers: {
            authorization: 'Bearer abc123',
            Cookie: 'session=secret',
            'x-api-key': 'k_123',
            'content-type': 'application/json',
          },
          data: { email: 'customer@example.com' },
        },
      } as unknown as SentryEvent;

      scrubSentryEvent(event);

      const headers = event.request!.headers as Record<string, string>;
      expect(headers.authorization).toBeUndefined();
      expect(headers.Cookie).toBeUndefined();
      expect(headers['x-api-key']).toBeUndefined();
      expect(headers['content-type']).toBe('application/json');
    });

    it('redacts sensitive fields recursively in the request body', () => {
      const event = {
        request: {
          data: {
            email: 'customer@example.com',
            password: 'hunter2',
            bank: { accountNumber: '0123456789', iban: 'GB29NWBK60161331926819' },
            card: { cardNumber: '4111111111111111', cvv: '123' },
            items: [{ apiKey: 'sk_live_abc' }],
            amountUsd: 42,
          },
        },
      } as unknown as SentryEvent;

      scrubSentryEvent(event);

      const data = event.request!.data as Record<string, any>;
      expect(data.email).toBe('[REDACTED]');
      expect(data.password).toBe('[REDACTED]');
      expect(data.bank.accountNumber).toBe('[REDACTED]');
      expect(data.bank.iban).toBe('[REDACTED]');
      expect(data.card.cardNumber).toBe('[REDACTED]');
      expect(data.card.cvv).toBe('[REDACTED]');
      expect(data.items[0].apiKey).toBe('[REDACTED]');
      expect(data.amountUsd).toBe(42);
    });

    it('redacts sensitive fields in extra, user and contexts', () => {
      const event = {
        extra: { partnerApiKey: 'pk_xyz', settlementId: 's-1', counts: { ok: 1 } },
        user: { id: 'u1', email: 'admin@example.com' },
        contexts: { runtime: { apiKeyHash: 'abc' }, os: { name: 'linux' } },
      } as unknown as SentryEvent;

      scrubSentryEvent(event);

      const extra = event.extra as Record<string, any>;
      expect(extra.partnerApiKey).toBe('[REDACTED]');
      expect(extra.settlementId).toBe('s-1');
      expect(extra.counts.ok).toBe(1);
      expect((event.user as any).email).toBe('[REDACTED]');
      expect((event.user as any).id).toBe('u1');
      expect((event.contexts as any).runtime.apiKeyHash).toBe('[REDACTED]');
      expect((event.contexts as any).os.name).toBe('linux');
    });

    it('redacts breadcrumb data and secret patterns in breadcrumb messages', () => {
      const jwt =
        'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
      const event = {
        breadcrumbs: [
          { message: `POST /payments with ${jwt}`, data: { email: 'x@y.z' } },
          { message: 'all good', data: { count: 3 } },
        ],
      } as unknown as SentryEvent;

      scrubSentryEvent(event);

      const breadcrumbs = event.breadcrumbs as any[];
      expect(breadcrumbs[0].message).not.toContain(jwt);
      expect(breadcrumbs[0].message).toContain('[REDACTED]');
      expect(breadcrumbs[0].data.email).toBe('[REDACTED]');
      expect(breadcrumbs[1].message).toBe('all good');
      expect(breadcrumbs[1].data.count).toBe(3);
    });

    it('redacts secret patterns in exception values and stack frame vars', () => {
      const bearer = 'Bearer tok_12345'; // redacted via pattern (starts with Bearer)
      const stellarSecret = `S${'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.repeat(2).slice(0, 55)}`;
      const event = {
        exception: {
          values: [
            {
              type: 'Error',
              value: `Transfer failed for ${bearer}`,
              stacktrace: {
                frames: [{ vars: { secretKey: stellarSecret } }],
              },
            },
          ],
        },
      } as unknown as SentryEvent;

      scrubSentryEvent(event);

      const exception = (event.exception as any).values[0];
      expect(exception.value).not.toContain('tok_12345');
      expect(exception.value).toContain('[REDACTED]');
      expect(exception.stacktrace.frames[0].vars.secretKey).toBe('[REDACTED]');
    });

    it('redacts PEM private keys and AWS keys in messages', () => {
      const pem = `-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFA\n-----END PRIVATE KEY-----`;
      const event = {
        message: `config error: ${pem} aws key AKIAIOSFODNN7EXAMPLE`,  
      } as unknown as SentryEvent;

      scrubSentryEvent(event);

      expect(event.message).not.toContain('MIIEvQIBADANBgkqhkiG9w0BAQEFA');
      expect(event.message).not.toContain('AKIAIOSFODNN7EXAMPLE');
      expect(event.message).toContain('[REDACTED]');
    });

    it('leaves non-sensitive data intact', () => {
      const event = {
        request: { data: { merchantId: 'm1', amountUsd: 9.99, tags: ['a', 'b'] } },
        extra: { settlementId: 's-1' },
      } as unknown as SentryEvent;

      scrubSentryEvent(event);

      const data = event.request!.data as Record<string, any>;
      expect(data.merchantId).toBe('m1');
      expect(data.amountUsd).toBe(9.99);
      expect(data.tags).toEqual(['a', 'b']);
      expect((event.extra as any).settlementId).toBe('s-1');
    });
  });
});

