import { Controller, Get, Patch, Param, Body, Query, Req, UseGuards } from '@nestjs/common';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { Request } from 'express';
import { AmlService } from './aml.service';
import { AmlFlagStatus } from './entities/aml-flag.entity';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { MerchantRole } from '../merchants/entities/merchant.entity';
import { IpAllowlistGuard } from '../security/ip-allowlist.guard';

export class ReviewFlagDto {
  @IsEnum(AmlFlagStatus)
  status: AmlFlagStatus;

  @IsOptional()
  @IsString()
  note?: string;
}

@UseGuards(IpAllowlistGuard, JwtAuthGuard, RolesGuard)
@Roles(MerchantRole.ADMIN)
@Controller('admin/aml')
export class AmlController {
  constructor(private readonly amlService: AmlService) {}

  @Get()
  findAll(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.amlService.findAll(+page, +limit);
  }

  @Get('pending')
  findPending(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.amlService.findPending(+page, +limit);
  }

  @Get('merchant/:merchantId')
  findByMerchant(@Param('merchantId') merchantId: string) {
    return this.amlService.findByMerchant(merchantId);
  }

  @Patch(':id/review')
  review(
    @Param('id') id: string,
    @Body() dto: ReviewFlagDto,
    @Req() req: Request & { user: { merchantId: string; email?: string } },
  ) {
    const reviewedBy = req.user.email ?? req.user.merchantId;
    return this.amlService.review(id, dto.status, reviewedBy, dto.note);
  }
}
