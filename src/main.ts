import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const isProduction = nodeEnv === 'production';
  const isDevelopment = nodeEnv === 'development';

  // Issue #943: TypeORM synchronize must be hard-disabled outside development.
  // Never trust the env var alone — force it off in code for non-dev environments.
  const requestedSynchronize = process.env.TYPEORM_SYNCHRONIZE === 'true';
  const synchronize = isDevelopment ? requestedSynchronize : false;

  if (isProduction && requestedSynchronize) {
    // eslint-disable-next-line no-console
    console.error(
      '[fatal] TYPEORM_SYNCHRONIZE=true is not allowed in production. ' +
        'TypeORM synchronize can silently drop columns. Refusing to start.',
    );
    process.exit(1);
  }

  // Expose the resolved value so the TypeORM config reads the guarded flag.
  process.env.TYPEORM_SYNCHRONIZE = synchronize ? 'true' : 'false';

  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();
