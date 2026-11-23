import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateJwtSecretConfig } from './jwt-secret.validation';

/**
 * Auth module (#835).
 *
 * Loads the JWT configuration through a dedicated validation schema so the
 * application refuses to start when JWT_SECRET is missing or shorter than 32
 * characters, instead of silently accepting weak key material.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      validate: validateJwtSecretConfig,
    }),
  ],
})
export class AuthModule {}
