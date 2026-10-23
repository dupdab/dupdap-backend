import {
  Controller,
  Post,
  Body,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { MerchantRole } from '../merchants/entities/merchant.entity';
import { AdminTwoFactorGuard } from '../auth/guards/admin-two-factor.guard';
import { IpAllowlistGuard } from '../security/ip-allowlist.guard';
import { BlockchainWalletService } from '../blockchain-wallet/blockchain-wallet.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from '../audit/entities/audit-log.entity';

interface RotateKeyBody {
  actorId: string;
}

@ApiTags('admin.encryption')
@ApiBearerAuth()
@UseGuards(IpAllowlistGuard, JwtAuthGuard, AdminTwoFactorGuard, RolesGuard)
@Roles(MerchantRole.SUPERADMIN)
@Controller({ path: 'admin/encryption', version: '1' })
export class EncryptionAdminController {
  constructor(
    private readonly walletService: BlockchainWalletService,
    @InjectRepository(AuditLog)
    private readonly auditLogRepo: Repository<AuditLog>,
  ) {}

  @Post('rotate-key')
  @ApiOperation({
    summary: 'Trigger wallet encryption key rotation and re-encrypt all stored wallet secrets with the new key (SUPERADMIN only)',
  })
  @ApiResponse({ status: 200, description: 'Key rotation completed' })
  @ApiResponse({ status: 403, description: 'SUPERADMIN role required' })
  async rotateKey(@Body() body: RotateKeyBody) {
    const actorId = body.actorId;
    if (!actorId) throw new NotFoundException('actorId is required');

    const result = await this.walletService.reencryptWallets(actorId);

    await this.auditLogRepo.save(
      this.auditLogRepo.create({
        actor: actorId,
        action: 'ENCRYPTION_KEY_ROTATED',
        resource: 'blockchain_wallets',
        before: null,
        after: {
          rotated: result.rotated,
          skipped: result.skipped,
          keyVersion: result.keyVersion,
        },
        ip: undefined,
      }),
    );

    return result;
  }
}
