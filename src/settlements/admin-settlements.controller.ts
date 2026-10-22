import { ApiOperation as AdminOperation, ApiResponse as AdminResponse, ApiBearerAuth as AdminBearer } from '@nestjs/swagger';
import { ApiErrors } from '../common/api-errors.decorator';
import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { SettlementsService } from './settlements.service';
import { AdminSettlementsQueryDto } from './dto/admin-settlements-query.dto';
import { Request } from 'express';
import { Auditable } from '../audit/decorators/auditable.decorator';

@ApiErrors()
@AdminBearer('bearer')
@Controller('admin/settlements')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminSettlementsController {
  constructor(private readonly settlementsService: SettlementsService) {}

  @AdminOperation({ summary: 'Get collection' })
  @AdminResponse({ status: 200, description: 'Successful response' })
  @Get()
  async findAll(@Query() query: AdminSettlementsQueryDto) {
    return this.settlementsService.findAllAdmin(query);
  }

  @AdminOperation({ summary: 'Post :id/retry' })
  @AdminResponse({ status: 201, description: 'Successful response' })
  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  @Auditable({ action: 'SETTLEMENT_RETRIED', resource: 'settlement' })
  async retrySettlement(@Param('id') id: string) {
    const result = await this.settlementsService.retrySettlement(id);
    if (!result.success) {
      throw new BadRequestException(result.message);
    }
    return { message: 'Settlement retry initiated successfully' };
  }

  @AdminOperation({ summary: 'Post :id/approve' })
  @AdminResponse({ status: 201, description: 'Successful response' })
  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @Auditable({ action: 'SETTLEMENT_APPROVED', resource: 'settlement' })
  async approveSettlement(
    @Param('id') id: string,
    @Req() req: Request & { user: { merchantId: string } },
  ) {
    const result = await this.settlementsService.approveSettlement(id, req.user?.merchantId);
    if (!result.success) {
      throw new BadRequestException(result.message);
    }
    return { message: 'Settlement approved successfully' };
  }
}
