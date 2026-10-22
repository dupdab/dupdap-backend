import {
  Controller,
  Post,
  Param,
  Body,
  Get,
  Query,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { MerchantRole } from '../merchants/entities/merchant.entity';
import { AdminTwoFactorGuard } from '../auth/guards/admin-two-factor.guard';
import { IpAllowlistGuard } from '../security/ip-allowlist.guard';
import { SettlementsService } from './settlements.service';
import { Settlement, SettlementStatus } from './entities/settlement.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

interface ApproveRejectBody {
  adminId: string;
}

interface PaginatedSettlementsDto {
  data: Settlement[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

@ApiTags('admin.settlements')
@ApiBearerAuth()
@UseGuards(IpAllowlistGuard, JwtAuthGuard, AdminTwoFactorGuard, RolesGuard)
@Roles(MerchantRole.ADMIN, MerchantRole.SUPERADMIN)
@Controller({ path: 'admin/settlements', version: '1' })
export class AdminSettlementsController {
  constructor(
    private readonly settlementsService: SettlementsService,
    @InjectRepository(AuditLog)
    private readonly auditLogRepo: Repository<AuditLog>,
  ) {}

  @Post(':id/approve')
  @Roles(MerchantRole.SUPERADMIN)
  @ApiOperation({ summary: 'Approve a pending-approval settlement and enqueue it for processing (SUPERADMIN only)' })
  @ApiParam({ name: 'id', description: 'Settlement UUID' })
  @ApiResponse({ status: 200, description: 'Settlement approved and enqueued' })
  @ApiResponse({ status: 403, description: 'SUPERADMIN role required' })
  @ApiResponse({ status: 404, description: 'Settlement not found' })
  @ApiResponse({ status: 400, description: 'Settlement is not pending approval' })
  async approve(
    @Param('id') id: string,
    @Body() body: ApproveRejectBody,
  ) {
    const adminId = body.adminId;
    if (!adminId) throw new NotFoundException('adminId is required');
    return this.settlementsService.approveSettlement(id, adminId);
  }

  @Post(':id/reject')
  @Roles(MerchantRole.SUPERADMIN)
  @ApiOperation({ summary: 'Reject a pending-approval settlement and notify the merchant (SUPERADMIN only)' })
  @ApiParam({ name: 'id', description: 'Settlement UUID' })
  @ApiResponse({ status: 200, description: 'Settlement rejected and merchant notified' })
  @ApiResponse({ status: 403, description: 'SUPERADMIN role required' })
  @ApiResponse({ status: 404, description: 'Settlement not found' })
  @ApiResponse({ status: 400, description: 'Settlement is not pending approval' })
  async reject(
    @Param('id') id: string,
    @Body() body: ApproveRejectBody,
  ) {
    const adminId = body.adminId;
    if (!adminId) throw new NotFoundException('adminId is required');
    return this.settlementsService.rejectSettlement(id, adminId);
  }

  @Get()
  @ApiOperation({ summary: 'List settlements for admin review (paginated, filterable)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'merchantId', required: false, type: String })
  @ApiQuery({ name: 'requiresApproval', required: false, type: Boolean })
  @ApiResponse({ status: 200, description: 'Paginated settlements' })
  async list(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('status') status?: SettlementStatus,
    @Query('merchantId') merchantId?: string,
    @Query('requiresApproval') requiresApproval?: string,
  ): Promise<PaginatedSettlementsDto> {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
    return this.settlementsService.findAllAdmin({
      page: pageNum,
      limit: limitNum,
      status,
      merchantId,
      requiresApproval:
        requiresApproval === 'true'
          ? true
          : requiresApproval === 'false'
          ? false
          : undefined,
    });
  }
}
