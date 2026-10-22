import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as StellarSdk from '@stellar/stellar-sdk';
import { AdminAlertModule } from '../alerts/admin-alert.module';
import { SOROBAN_RPC_CLIENT, SOROBAN_RPC_FALLBACK_CLIENT, SorobanService } from './soroban.service';

@Module({
  imports: [ConfigModule, AdminAlertModule],
  providers: [
    {
      provide: SOROBAN_RPC_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const rpcUrl = configService.get<string>('SOROBAN_RPC_URL');
        if (!rpcUrl) {
          throw new Error('SOROBAN_RPC_URL is not configured');
        }

        return new StellarSdk.rpc.Server(rpcUrl);
      },
    },
    {
      provide: SOROBAN_RPC_FALLBACK_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const fallbackUrl = configService.get<string>('SOROBAN_RPC_FALLBACK_URL');
        return fallbackUrl ? new StellarSdk.rpc.Server(fallbackUrl) : undefined;
      },
    },
    SorobanService,
  ],
  exports: [SorobanService],
})
export class SorobanModule {}
