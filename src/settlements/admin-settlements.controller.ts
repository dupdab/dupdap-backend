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
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';
import { Auditable } from '../audit/decorators/auditable.decorator';
import { SettlementsService } from './settlements.service';
import { AdminSettlementsQueryDto } from './dto/admin-settlements-query.dto';

export class RejectSettlementDto {
  /** Why the settlement is rejected — shown to the merchant. */
  @ApiProperty({
    required: true,
    minLength: 5,
    maxLength: 500,
    example: 'Beneficiary account details could not be verified.',
  })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;

  @ApiProperty({ required: false, description: 'Optional note for the audit trail' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

interface AdminRequest {
  user?: { merchantId?: string; email?: string; role?: string };
}

@ApiTags('admin.settlements')
@UseGuards(JwtAuthGuard, AdminGuard)
@ApiErrors()
@AdminBearer('bearer')
@Controller('admin/settlements')
export class AdminSettlementsController {
  constructor(private readonly settlementsService: SettlementsService) {}

  @AdminResponse({ status: 200, description: 'Successful response' })
  @Get()
  @ApiOperation({
    summary: 'List settlements',
    description:
      'Paginated settlement list with optional status, merchant and date filters.',
  })
  async findAll(@Query() query: AdminSettlementsQueryDto) {
    return this.settlementsService.findAllAdmin(query);
  }

  @AdminResponse({ status: 200, description: 'Successful response' })
  @Post(':id/retry')
  @ApiOperation({
    summary: 'Retry a failed settlement',
    description: 'Re-enqueues a failed settlement for processing.',
  })
  @Auditable({ action: 'SETTLEMENT_RETRIED', resource: 'settlement' })
  async retrySettlement(@Param('id') id: string) {
    return this.settlementsService.retrySettlement(id);
  }

  /**
   * Approves a large settlement (#445). Restricted to SUPERADMIN because the
   * decision moves real money.
   */
  @AdminResponse({ status: 201, description: 'Successful response' })
  @Post(':id/approve')
  @UseGuards(SuperAdminGuard)
  @ApiOperation({
    summary: 'Approve a settlement',
    description:
      'Approves a settlement that is waiting for approval, enqueues the fiat transfer and notifies the merchant.',
  })
  @Auditable({ action: 'SETTLEMENT_APPROVED', resource: 'settlement' })
  async approveSettlement(
    @Param('id') id: string,
    @Req() req: AdminRequest,
  ) {
    const settlement = await this.settlementsService.approveSettlement(
      id,
      req?.user?.merchantId ?? 'unknown',
    );
    return {
      success: true,
      message: `Settlement ${id} approved and queued for processing.`,
      settlement,
    };
  }

  /**
   * Rejects a large settlement (#445). Restricted to SUPERADMIN; the merchant
   * is notified with the rejection reason.
   */
  @AdminResponse({ status: 201, description: 'Successful response' })
  @Post(':id/reject')
  @UseGuards(SuperAdminGuard)
  @ApiOperation({
    summary: 'Reject a settlement',
    description:
      'Rejects a settlement that is waiting for approval, stores the reason and notifies the merchant.',
  })
  @Auditable({ action: 'SETTLEMENT_REJECTED', resource: 'settlement' })
  async rejectSettlement(
    @Param('id') id: string,
    @Body() dto: RejectSettlementDto,
    @Req() req: AdminRequest,
  ) {
    const settlement = await this.settlementsService.rejectSettlement(
      id,
      req?.user?.merchantId ?? 'unknown',
      dto?.reason ?? 'Rejected by settlement team',
    );
    return {
      success: true,
      message: `Settlement ${id} rejected.`,
      settlement,
    };
  }
}
