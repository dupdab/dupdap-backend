import { Controller, Param, Patch, Body, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Merchant, MerchantRole } from './entities/merchant.entity';
import { MerchantsService } from './merchants.service';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('admin/merchants')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(MerchantRole.ADMIN, MerchantRole.SUPERADMIN)
@Controller({ path: 'admin/merchants', version: '1' })
export class MerchantsAdminController {
  constructor(private readonly merchantsService: MerchantsService) {}

  @Patch(':id/verify')
  @ApiOperation({ summary: 'Verify a merchant profile' })
  @ApiResponse({ status: 200, type: Merchant })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Admin only' })
  @ApiResponse({ status: 404, description: 'Merchant not found' })
  verify(@Param('id') id: string): Promise<Merchant> {
    return this.merchantsService.verifyMerchant(id);
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
}
