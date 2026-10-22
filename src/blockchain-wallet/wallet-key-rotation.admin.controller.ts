import {
  ApiOperation as AdminOperation,
  ApiResponse as AdminResponse,
  ApiBearerAuth as AdminBearer,
} from '@nestjs/swagger';
import { ApiErrors } from '../common/api-errors.decorator';
import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsInt, Max, Min } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';
import { Auditable } from '../audit/decorators/auditable.decorator';
import {
  WalletKeyRotationResult,
  WalletKeyRotationService,
} from './wallet-key-rotation.service';

export class RotateWalletKeysDto {
  /** Records processed per database round trip. */
  @ApiProperty({ required: false, minimum: 1, maximum: 1000, default: 100 })
  @IsInt()
  @Min(1)
  @Max(1000)
  @IsInt()
  batchSize?: number;

  /** Inspect the records without writing anything. */
  @ApiProperty({ required: false, default: false })
  @IsBoolean()
  dryRun?: boolean;
}

@ApiTags('Admin - Security')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
@ApiErrors()
@AdminBearer('bearer')
@Controller('admin/security/wallet-keys')
export class WalletKeyRotationAdminController {
  constructor(private readonly rotationService: WalletKeyRotationService) {}

  @AdminResponse({ status: 200, description: 'Successful response' })
  @Get()
  @ApiOperation({
    summary: 'Encryption key ring status',
    description:
      'Returns the active encryption key version, every known key version and how many wallets are stored per key version.',
  })
  async getStatus() {
    return this.rotationService.getKeyRingStatus();
  }

  @AdminResponse({ status: 201, description: 'Successful response' })
  @Post('rotate')
  @ApiOperation({
    summary: 'Rotate wallet encryption keys',
    description:
      'Re-encrypts every Stellar wallet secret that is not encrypted with the active key. The old key stays registered for decryption until every record has been rotated.',
  })
  @Auditable({ action: 'WALLET_KEY_ROTATION', resource: 'blockchain_wallets' })
  async rotate(
    @Body() dto: RotateWalletKeysDto,
    @Req() req: { user?: { merchantId?: string; email?: string; role?: string }; ip?: string },
  ): Promise<WalletKeyRotationResult> {
    const result = await this.rotationService.rotateWallets({
      batchSize: dto?.batchSize,
      dryRun: dto?.dryRun,
    });

    await this.rotationService.auditRotation(
      req?.user?.merchantId ?? req?.user?.email ?? 'unknown',
      result,
      req?.ip,
    );

    return result;
  }
}
