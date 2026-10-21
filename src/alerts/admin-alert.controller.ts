import { ApiOperation as AdminOperation, ApiResponse as AdminResponse, ApiBearerAuth as AdminBearer } from '@nestjs/swagger';
import { ApiErrors } from '../common/api-errors.decorator';
import { Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { MerchantRole } from '../merchants/entities/merchant.entity';
import { IpAllowlistGuard } from '../security/ip-allowlist.guard';
import { AdminAlert } from './admin-alert.entity';
import { AdminAlertService } from './admin-alert.service';

@UseGuards(IpAllowlistGuard, JwtAuthGuard, RolesGuard)
@Roles(MerchantRole.ADMIN)
@ApiErrors()
@AdminBearer('bearer')
@Controller('admin/alerts')
export class AdminAlertController {
  constructor(private readonly adminAlertService: AdminAlertService) {}

  @AdminOperation({ summary: 'Get collection' })
  @AdminResponse({ status: 200, description: 'Successful response' })
  @Get()
  list(): Promise<AdminAlert[]> {
    return this.adminAlertService.list();
  }

  @AdminOperation({ summary: 'Patch :id/acknowledge' })
  @AdminResponse({ status: 200, description: 'Successful response' })
  @Patch(':id/acknowledge')
  acknowledge(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<AdminAlert> {
    const adminId =
      (req as Request & { user?: { merchantId?: string } }).user?.merchantId ??
      null;
    return this.adminAlertService.acknowledge(id, adminId);
  }

  @AdminOperation({ summary: 'Patch :id/resolve' })
  @AdminResponse({ status: 200, description: 'Successful response' })
  @Patch(':id/resolve')
  resolve(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<AdminAlert> {
    const adminId =
      (req as Request & { user?: { merchantId?: string } }).user?.merchantId ??
      null;
    return this.adminAlertService.resolve(id, adminId);
  }
}
