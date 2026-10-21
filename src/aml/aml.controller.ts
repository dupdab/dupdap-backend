import { Body, Controller, Get, Param, Patch, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { MerchantRole } from '../merchants/entities/merchant.entity';
import { AmlService } from './aml.service';
import { AmlFlagStatus } from './entities/aml-flag.entity';

@ApiTags('admin/aml')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(MerchantRole.ADMIN, MerchantRole.SUPERADMIN)
@Controller('admin/aml')
export class AmlController {
  constructor(private readonly aml: AmlService) {}
  @Get('flags') list(@Query('page') page = '1', @Query('limit') limit = '20') {
    return this.aml.findReviewQueue(Number(page), Number(limit));
  }
  @Patch('flags/:id') review(@Param('id') id: string, @Body() body: { status: AmlFlagStatus; note?: string }, @Request() req: { user: { id: string } }) {
    return this.aml.review(id, body.status, req.user.id, body.note);
  }
}
