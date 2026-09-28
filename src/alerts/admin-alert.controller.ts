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
@Controller('admin/alerts')
export class AdminAlertController {
  constructor(private readonly adminAlertService: AdminAlertService) {}

  @Get()
  list(): Promise<AdminAlert[]> {
    return this.adminAlertService.list();
  }

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
}
