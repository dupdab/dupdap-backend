import { Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrors } from '../common/api-errors.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { MerchantRole } from '../merchants/entities/merchant.entity';
import { RolesGuard } from '../auth/guards/roles.guard';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { AdminTwoFactorGuard } from '../auth/guards/admin-two-factor.guard';
import { WebhooksService } from './webhooks.service';

@ApiTags('admin / webhooks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminTwoFactorGuard, RolesGuard)
@Roles(MerchantRole.SUPERADMIN)
@ApiErrors()
@Controller('admin/webhooks')
export class WebhookCircuitAdminController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post(':id/circuit/reset')
  @ApiOperation({ summary: 'Manually reset an open webhook circuit' })
  async resetCircuit(@Param('id', ParseUUIDPipe) id: string) {
    return this.webhooksService.resetCircuit(id);
  }
}
