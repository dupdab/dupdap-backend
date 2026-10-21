import { Controller, Param, Patch, Body, UseGuards, Request, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Merchant, MerchantRole } from './entities/merchant.entity';
import { MerchantsService } from './merchants.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ExtendApiKeyExpiryDto } from './dto/extend-api-key-expiry.dto';
import { KycStatus } from './entities/merchant.entity';

@ApiTags('admin/merchants')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(MerchantRole.ADMIN, MerchantRole.SUPERADMIN)
@Controller({ path: 'admin/merchants', version: '1' })
export class MerchantsAdminController {
  constructor(private readonly merchantsService: MerchantsService) {}

  @Get('kyc/pending') pendingKyc() { return this.merchantsService.listPendingKyc(); }

  @Patch(':id/kyc') reviewKyc(@Param('id') id: string, @Body('status') status: KycStatus) {
    return this.merchantsService.reviewKyc(id, status);
  }

  @Patch(':id/fee')
  @ApiOperation({ summary: 'Set custom fee rate for a merchant' })
  @ApiResponse({ status: 200, type: Merchant })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Admin only' })
  @ApiResponse({ status: 404, description: 'Merchant not found' })
  async setMerchantFee(
    @Param('id') id: string,
    @Body('customFeeRate') customFeeRate: number | null,
  ): Promise<Merchant> {
    return this.merchantsService.updateMerchantFee(id, customFeeRate);
  }

  /**
   * Extend (or set) the expiry date of a merchant's current API key.
   * Resets the 14-day reminder flag so the merchant receives a fresh warning.
   * Writes an audit log entry for compliance.
   */
  @Patch(':id/api-key/expiry')
  @ApiOperation({ summary: 'Extend API key expiry for a merchant (admin)' })
  @ApiParam({ name: 'id', description: 'Merchant UUID' })
  @ApiResponse({ status: 200, type: Merchant, description: 'Updated merchant record' })
  @ApiResponse({ status: 400, description: 'Validation failed or date out of range' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Admin only' })
  @ApiResponse({ status: 404, description: 'Merchant not found' })
  extendApiKeyExpiry(
    @Param('id') id: string,
    @Body() dto: ExtendApiKeyExpiryDto,
    @Request() req: { user: { merchantId: string } },
  ): Promise<Merchant> {
    return this.merchantsService.extendApiKeyExpiry(id, dto.newExpiresAt, req.user.merchantId);
  }
}
