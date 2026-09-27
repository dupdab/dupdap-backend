import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { BlockchainWalletService } from './blockchain-wallet.service';
import { WalletResponseDto } from './dto/wallet-response.dto';
import { InternalServiceGuard } from '../auth/guards/internal-service.guard';

export class ProvisionWalletDto {
  userId: string;
  username: string;
}

/**
 * Internal controller for wallet provisioning.
 * Called by auth/registration service after user signup.
 * Not exposed to public API routes — enforced by InternalServiceGuard, which
 * requires a valid `x-internal-service-secret` header (shared secret).
 */
@ApiTags('Internal - Wallet')
@UseGuards(InternalServiceGuard)
@ApiHeader({ name: 'x-internal-service-secret', required: true, description: 'Internal service shared secret' })
@ApiUnauthorizedResponse({ description: 'Missing or invalid internal service secret' })
@Controller('internal/wallet')
export class InternalWalletController {
  constructor(private readonly walletService: BlockchainWalletService) {}

  @Post('provision')
  @ApiOperation({ summary: 'Provision wallet for new user (internal only)' })
  async provision(@Body() dto: ProvisionWalletDto): Promise<WalletResponseDto> {
    const wallet = await this.walletService.provision(dto.userId, dto.username);
    return WalletResponseDto.from(wallet);
  }
}
