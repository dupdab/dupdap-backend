import { MerchantMember } from '../merchants/entities/merchant-member.entity';
import { TeamService } from '../merchants/team.service';
import { TeamController } from '../merchants/team.controller';
import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt.guard';
import { RolesGuard } from './guards/roles.guard';
import { RateLimitService } from './rate-limit.service';
import { Merchant } from '../merchants/entities/merchant.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { CacheModule } from '../cache/cache.module';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AdminAlertModule } from '../alerts/admin-alert.module';
import { EmailModule } from '../email/email.module';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([Merchant, MerchantMember, AuditLog]),
    AdminAlertModule,
    CacheModule,
    EmailModule,
    NotificationsModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.get('JWT_EXPIRES_IN', '7d') },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController, TeamController],
  providers: [TeamService, RateLimitService, AuthService, JwtStrategy, JwtAuthGuard, RolesGuard],
  exports: [TeamService, RateLimitService, AuthService, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
