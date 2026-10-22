import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { BlockchainWallet } from './entities/blockchain-wallet.entity';
import { SlippageConfig } from './entities/slippage-config.entity';
import { BlockchainWalletService } from './blockchain-wallet.service';
import { PaymentEscrowService } from './payment-escrow.service';
import { SlippageService } from './slippage.service';
import { WalletController } from './wallet.controller';
import { InternalWalletController } from './internal-wallet.controller';
import { SlippageAdminController } from './slippage-admin.controller';
import { WalletProvisionedListener } from './listeners/wallet-provisioned.listener';
import { WalletKeyRotationService } from './wallet-key-rotation.service';
import { WalletKeyRotationAdminController } from './wallet-key-rotation.admin.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { SorobanModule } from '../soroban/soroban.module';
import { EncryptionService } from '../security/encryption.service';
import { InternalServiceGuard } from '../auth/guards/internal-service.guard';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([BlockchainWallet, SlippageConfig]),
    NotificationsModule,
    SorobanModule,
  ],
  providers: [
    EncryptionService,
    BlockchainWalletService,
    PaymentEscrowService,
    SlippageService,
    WalletProvisionedListener,
    InternalServiceGuard,
    WalletKeyRotationService,
  ],
  controllers: [
    WalletController,
    InternalWalletController,
    SlippageAdminController,
    WalletKeyRotationAdminController,
  ],
  exports: [BlockchainWalletService, SlippageService, EncryptionService, WalletKeyRotationService],
})
export class BlockchainWalletModule {}
