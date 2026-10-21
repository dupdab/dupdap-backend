import { Body, Controller, Get, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { OptionalJwtGuard } from '../auth/guards/optional-jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { MerchantRole } from '../merchants/entities/merchant.entity';
import { DisputeStatus } from './entities/payment-dispute.entity';
import { DisputesService } from './disputes.service';

@ApiTags('payment-disputes')
@ApiBearerAuth()
@Controller()
export class DisputesController {
  constructor(private readonly disputes: DisputesService) {}
  @Post('payments/:id/dispute')
  @UseGuards(OptionalJwtGuard)
  raise(@Param('id') id: string, @Body() body: { reason: string; customerEmail?: string }, @Request() req: { user?: { merchantId: string } }) {
    return this.disputes.raise(id, req.user?.merchantId, body.customerEmail, body.reason);
  }
  @Get('admin/disputes')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(MerchantRole.ADMIN, MerchantRole.SUPERADMIN)
  queue() { return this.disputes.queue(); }
  @Patch('admin/disputes/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(MerchantRole.ADMIN, MerchantRole.SUPERADMIN)
  review(@Param('id') id: string, @Body() body: { status: DisputeStatus; resolution?: string }, @Request() req: { user: { id: string } }) {
    return this.disputes.review(id, req.user.id, body.status, body.resolution);
  }
}
