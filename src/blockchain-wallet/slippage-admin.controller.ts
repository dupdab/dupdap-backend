import { ApiErrors } from '../common/api-errors.decorator';
import { Body, Controller, Patch, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { SlippageService } from './slippage.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { MerchantRole } from '../merchants/entities/merchant.entity';
import { RolesGuard } from '../auth/guards/roles.guard';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { AdminTwoFactorGuard } from '../auth/guards/admin-two-factor.guard';

@ApiTags('admin / slippage')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminTwoFactorGuard, RolesGuard)
@Roles(MerchantRole.SUPERADMIN)
@ApiErrors()
@Controller('admin/slippage')
export class SlippageAdminController {
  constructor(private readonly slippageService: SlippageService) {}

  @Put('max-bps')
  @ApiOperation({ summary: 'Set max slippage tolerance (400 if above the cap)' })
  async setMaxSlippage(@Body() body: { maxSlippageBps: number }) {
    await this.slippageService.setMaxSlippage(body.maxSlippageBps);
    return { maxSlippageBps: body.maxSlippageBps };
  }

  @Patch('cap')
  @ApiOperation({ summary: 'Override the slippage cap; justification is required and audited' })
  async overrideCap(
    @Body() body: { maxSlippageCapBps: number; justification: string },
    @Req() req: Request,
  ) {
    const adminId = (req as Request & { user: { merchantId: string } }).user.merchantId;
    await this.slippageService.overrideMaxSlippageCap(
      body.maxSlippageCapBps,
      body.justification,
      adminId,
      req.ip,
    );
    return { maxSlippageCapBps: body.maxSlippageCapBps };
  }
}
