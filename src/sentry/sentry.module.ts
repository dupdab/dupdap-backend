import { Global, Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SentryService } from './sentry.service';

/**
 * Provides the Sentry SDK wrapper and initialises the SDK during bootstrap so
 * errors raised before the HTTP server starts are captured as well.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [SentryService],
  exports: [SentryService],
})
export class SentryModule implements OnModuleInit {
  constructor(private readonly sentryService: SentryService) {}

  onModuleInit(): void {
    this.sentryService.init();
  }
}
